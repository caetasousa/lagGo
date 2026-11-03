// Package cassandra: o Laboratório de Consistência ajustável (Fase 7).
//
// O cluster de estudo tem UM nó (três não caberiam na memória da máquina).
// Para ver a regra funcionar, o laboratório cria um keyspace com RF=3 nesse
// nó único: para o Cassandra, é um anel em que só 1 das 3 réplicas existe —
// exatamente a situação "dois nós fora do ar". QUORUM (2) e ALL (3) não têm
// réplicas suficientes e falham com Unavailable; ONE (1) funciona.
package cassandra

import (
	"context"
	"fmt"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

type Consistencia struct{ c *storage.Cassandra }

func NovaConsistencia(c *storage.Cassandra) *Consistencia { return &Consistencia{c: c} }

var niveis = map[string]gocql.Consistency{"ONE": gocql.One, "QUORUM": gocql.Quorum, "ALL": gocql.All}

// Preparar cria lab_rf1 ou lab_rf3 (rf vem validado: 1 ou 3).
func (a *Consistencia) Preparar(ctx context.Context, rf int) (string, error) {
	s, err := a.c.Session()
	if err != nil {
		return "", err
	}
	ks := fmt.Sprintf("lab_rf%d", rf)
	for _, cql := range []string{
		fmt.Sprintf(`CREATE KEYSPACE IF NOT EXISTS %s WITH replication = {'class': 'SimpleStrategy', 'replication_factor': %d}`, ks, rf),
		"CREATE TABLE IF NOT EXISTS " + ks + ".contas (id int PRIMARY KEY, valor int)",
	} {
		// DDL com ONE: criar o esquema não é o que se está medindo.
		if err := s.Query(cql).Consistency(gocql.One).ExecContext(ctx); err != nil {
			return "", err
		}
	}
	return ks, nil
}

// Tentar: um INSERT e um SELECT, os dois com o nível pedido. O erro do
// Cassandra vai para a tela como veio — ele diz quantas réplicas faltaram.
func (a *Consistencia) Tentar(ctx context.Context, keyspace, nivel string) dominio.Tentativa {
	var t dominio.Tentativa
	s, err := a.c.Session()
	if err != nil {
		t.ErroEscrita = err.Error()
		return t
	}
	cl := niveis[nivel]
	inicio := time.Now()
	err = s.Query("INSERT INTO "+keyspace+".contas (id, valor) VALUES (1, ?)", int(time.Now().Unix()%1000)).
		Consistency(cl).ExecContext(ctx)
	t.Escreveu = err == nil
	if err != nil {
		t.ErroEscrita = err.Error()
	}
	var v int
	err = s.Query("SELECT valor FROM "+keyspace+".contas WHERE id = 1").Consistency(cl).ScanContext(ctx, &v)
	t.Leu = err == nil || err == gocql.ErrNotFound
	if !t.Leu {
		t.ErroLeitura = err.Error()
	}
	t.MS = float64(time.Since(inicio).Microseconds()) / 1000
	return t
}

// NosVivos: o nó local mais os pares que ele conhece.
func (a *Consistencia) NosVivos(ctx context.Context) (int, error) {
	s, err := a.c.Session()
	if err != nil {
		return 0, err
	}
	var pares int
	err = s.Query("SELECT count(*) FROM system.peers").Consistency(gocql.One).ScanContext(ctx, &pares)
	return pares + 1, err
}
