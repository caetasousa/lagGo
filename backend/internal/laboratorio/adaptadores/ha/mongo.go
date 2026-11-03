package ha

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// MongoDB: replica set rsha de 3 nós. Failover NATIVO: os membros trocam
// heartbeats a cada 2 s e, sem notícias do primário por electionTimeoutMillis
// (10 s), os secundários elegem outro (protocolo derivado do Raft). O driver
// redescobre a topologia sozinho e repete UMA vez a escrita que falhou
// (retryable writes).
//
// A "garantia" aqui é o write concern: w: "majority" só confirma depois que a
// maioria gravou — a escrita sobrevive à eleição. Com w: 1 o primário
// confirma sozinho, e o que ele não repassou antes de cair é desfeito
// (rollback) quando ele volta como secundário.

type mongoRS struct {
	uri     string
	cliente *mongo.Client
	erro    error
}

func NovoMongoRS(uri string) *mongoRS {
	m := &mongoRS{uri: uri}
	if uri == "" {
		m.erro = errors.New("HA_MONGO_URI não configurada")
		return m
	}
	m.cliente, m.erro = mongo.Connect(options.Client().ApplyURI(uri).SetAppName("marketplace-api").
		SetServerSelectionTimeout(2 * time.Second).SetTimeout(2 * time.Second))
	return m
}

func (m *mongoRS) colecao(garantia bool) *mongo.Collection {
	wc := writeconcern.W1()
	if garantia {
		wc = writeconcern.Majority()
	}
	return m.cliente.Database("ha").Collection("ensaio", options.Collection().SetWriteConcern(wc))
}

func (m *mongoRS) Estado(ctx context.Context) dominio.EstadoCluster {
	e := dominio.EstadoCluster{}
	if m.erro != nil {
		e.Erro = foraDoAr(m.erro)
		return e
	}
	var st struct {
		Membros []struct {
			Nome   string    `bson:"name"`
			Estado string    `bson:"stateStr"`
			Saude  float64   `bson:"health"`
			Optime time.Time `bson:"optimeDate"`
		} `bson:"members"`
	}
	if err := m.cliente.Database("admin").RunCommand(ctx, bson.D{{Key: "replSetGetStatus", Value: 1}}).Decode(&st); err != nil {
		e.Erro = foraDoAr(err)
		return e
	}
	e.Disponivel = true
	var primario time.Time
	for _, x := range st.Membros {
		if x.Estado == "PRIMARY" {
			primario = x.Optime
			e.Lider = x.Nome
		}
	}
	for _, x := range st.Membros {
		papel := map[string]string{"PRIMARY": "primário", "SECONDARY": "secundário"}[x.Estado]
		if papel == "" {
			papel = "fora"
		}
		mb := dominio.Membro{Nome: x.Nome, Papel: papel, Estado: x.Estado}
		if x.Estado == "SECONDARY" && !primario.IsZero() {
			s := primario.Sub(x.Optime).Seconds()
			mb.Atraso = &s
		}
		e.Membros = append(e.Membros, mb)
	}
	e.Detalhe = "maioria = 2 de 3 membros · electionTimeoutMillis = 10 s"
	return e
}

func (m *mongoRS) Preparar(ctx context.Context, rodada uuid.UUID, garantia bool) (string, error) {
	if m.erro != nil {
		return "", m.erro
	}
	_, err := m.cliente.Database("ha").Collection("ensaio").DeleteMany(ctx, bson.D{{Key: "em", Value: bson.D{{Key: "$lt", Value: time.Now().Add(-time.Hour)}}}})
	if garantia {
		return `write concern w: "majority": a escrita só é confirmada quando 2 dos 3 nós a têm`, err
	}
	return "write concern w: 1: o primário confirma sozinho", err
}

func (m *mongoRS) Escrever(ctx context.Context, rodada uuid.UUID, n int, garantia bool) error {
	_, err := m.colecao(garantia).InsertOne(ctx, bson.D{{Key: "rodada", Value: rodada.String()}, {Key: "n", Value: n}, {Key: "em", Value: time.Now()}})
	return err
}

// direto abre uma conexão só com UM membro (sem descobrir o replica set),
// com o mesmo usuário da URI do replica set.
func (m *mongoRS) direto(ctx context.Context, membro string) (*mongo.Client, error) {
	u, err := url.Parse(m.uri)
	if err != nil {
		return nil, err
	}
	u.Host = membro
	u.RawQuery = "directConnection=true&authSource=admin"
	return mongo.Connect(options.Client().ApplyURI(u.String()).
		SetServerSelectionTimeout(2 * time.Second).SetTimeout(5 * time.Second))
}

// derrubar simula a QUEDA do primário. Um shutdown comum é educado demais:
// o primário deixa o posto e indica um sucessor (election handoff), e a troca
// leva milissegundos. Numa queda de verdade ninguém avisa: os secundários só
// percebem pela falta de heartbeats, depois de electionTimeoutMillis (10 s).
// Por isso, antes do shutdown, o handoff é desligado neste nó.
// O infra/mongo-ha/supervisor.sh o sobe de novo 30 s depois — como secundário.
func (m *mongoRS) Derrubar(ctx context.Context, lider string) (string, error) {
	c, err := m.direto(ctx, lider)
	if err != nil {
		return "", err
	}
	defer c.Disconnect(context.Background())
	adm := c.Database("admin")
	if err := adm.RunCommand(ctx, bson.D{{Key: "setParameter", Value: 1}, {Key: "enableElectionHandoff", Value: false}}).Err(); err != nil {
		return "", err
	}
	err = adm.RunCommand(ctx, bson.D{{Key: "shutdown", Value: 1}, {Key: "force", Value: true}, {Key: "timeoutSecs", Value: 1}}).Err()
	// O servidor cai no meio da resposta: erro de conexão aqui é o esperado.
	if err != nil && !conexaoCaiu(err) {
		return "", err
	}
	return "queda de " + lider + " (shutdown sem election handoff): os outros dois só percebem pela falta de heartbeats", nil
}

func (m *mongoRS) Planejada(ctx context.Context, lider string) (string, error) {
	c, err := m.direto(ctx, lider)
	if err != nil {
		return "", err
	}
	defer c.Disconnect(context.Background())
	// replSetStepDown: o primário deixa o posto e fica 30 s sem poder voltar.
	err = c.Database("admin").RunCommand(ctx, bson.D{{Key: "replSetStepDown", Value: 30}}).Err()
	if err != nil && !conexaoCaiu(err) {
		return "", err
	}
	return "replSetStepDown em " + lider + ": ele deixa o posto e indica um sucessor (election handoff)", nil
}

func (m *mongoRS) Conferir(ctx context.Context, rodada uuid.UUID, confirmadas []int) (int, error) {
	// Lê do primário com read concern majority: o que sobreviveu de verdade.
	col := m.cliente.Database("ha").Collection("ensaio",
		options.Collection().SetReadPreference(readpref.Primary()))
	n, err := col.CountDocuments(ctx, bson.D{{Key: "rodada", Value: rodada.String()}, {Key: "n", Value: bson.D{{Key: "$in", Value: confirmadas}}}})
	return int(n), err
}

func conexaoCaiu(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "connection") || strings.Contains(s, "eof") || strings.Contains(s, "socket") ||
		strings.Contains(s, "closed") || strings.Contains(s, "shutdown") || mongo.IsNetworkError(err) || errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(s, "interrupted")
}
