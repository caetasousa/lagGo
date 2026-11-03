package aplicacao

import (
	"context"
	"sync"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/laboratorio/portas"
)

// ------------------------------------------------------------ consistência ajustável

// Consistencia: o Laboratório de Consistência (Cassandra). Para cada nível,
// uma escrita e uma leitura; o resultado mostra quem conseguiu e quem não.
type Consistencia struct {
	c  portas.Consistencia
	mu sync.Mutex
}

func NovaConsistencia(c portas.Consistencia) *Consistencia { return &Consistencia{c: c} }

func (l *Consistencia) Rodar(ctx context.Context, rf int) (dominio.ResultadoConsistencia, error) {
	r := dominio.ResultadoConsistencia{RF: rf}
	if err := dominio.ValidarConsistencia(rf); err != nil {
		return r, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	var err error
	if r.Keyspace, err = l.c.Preparar(ctx, rf); err != nil {
		return r, dominio.ErrValidacao{Msg: "o Cassandra não respondeu (ele leva ~1 min para subir): " + err.Error()}
	}
	if r.Vivas, err = l.c.NosVivos(ctx); err != nil {
		return r, err
	}
	for _, nivel := range dominio.NiveisDeConsistencia {
		t := l.c.Tentar(ctx, r.Keyspace, nivel)
		t.Nivel, t.Necessarias = nivel, dominio.Necessarias(nivel, rf)
		t.ForteComEle = 2*t.Necessarias > rf // lendo e escrevendo no mesmo nível: R + W > RF
		r.Tentativas = append(r.Tentativas, t)
	}
	return r, nil
}

// ------------------------------------------------------------ grafo × SQL

// GrafoXSQL: a mesma pergunta no Neo4j e no PostgreSQL.
type GrafoXSQL struct {
	grafo portas.GrafoLab
	sql   portas.SQLDoGrafo
	mu    sync.Mutex
}

func NovoGrafoXSQL(g portas.GrafoLab, s portas.SQLDoGrafo) *GrafoXSQL {
	return &GrafoXSQL{grafo: g, sql: s}
}

func (l *GrafoXSQL) Skus(ctx context.Context) ([]dominio.SkuParaOGrafo, error) {
	return l.sql.SkusParaOGrafo(ctx)
}

func (l *GrafoXSQL) Rodar(ctx context.Context, pergunta, sku string) (dominio.ResultadoGrafo, error) {
	r := dominio.ResultadoGrafo{Pergunta: pergunta, SkuID: sku}
	if err := dominio.ValidarPerguntaDoGrafo(pergunta); err != nil {
		return r, err
	}
	if _, err := uuid.Parse(sku); err != nil {
		return r, dominio.ErrValidacao{Msg: "sku inválido"}
	}
	// Um de cada vez: duas consultas pesadas em paralelo mediriam a disputa
	// pela CPU, não os bancos.
	l.mu.Lock()
	defer l.mu.Unlock()
	var err error
	if pergunta == "tambem_comprou" {
		if r.SQL, err = l.sql.TambemCompraram(ctx, sku); err != nil {
			return r, err
		}
		r.Grafo, err = l.grafo.TambemCompraram(ctx, sku)
	} else {
		if r.SQL, err = l.sql.Alcance(ctx, sku); err != nil {
			return r, err
		}
		r.Grafo, err = l.grafo.Alcance(ctx, sku)
	}
	if err != nil {
		return r, dominio.ErrValidacao{Msg: "o Neo4j não respondeu: " + err.Error()}
	}
	r.Iguais = dominio.MesmaResposta(r.Grafo, r.SQL)
	return r, nil
}
