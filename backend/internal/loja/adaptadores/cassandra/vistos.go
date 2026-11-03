// Package cassandra é o adaptador da loja para o Cassandra (Fase 7):
// "vistos recentemente", eventos de navegação com TTL.
//
// Modelagem do Cassandra: UMA TABELA POR CONSULTA. A pergunta é "os últimos
// produtos que ESTE cliente abriu"; então a partição é o cliente (todas as
// linhas dele no mesmo nó, lidas de uma vez) e a clustering key é o instante,
// em ordem decrescente (o mais novo já vem primeiro, sem ORDER BY nem
// ALLOW FILTERING — cenário X2).
package cassandra

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

// Esquema garantido a cada subida (idempotente), como o do MongoDB. Num
// cluster de verdade: NetworkTopologyStrategy com RF=3 por datacenter; aqui,
// um nó só, RF=1.
const esquema = `CREATE KEYSPACE IF NOT EXISTS %[1]s
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
CREATE TABLE IF NOT EXISTS %[1]s.vistos_por_cliente (
  cliente_id uuid,
  visto_em   timeuuid,
  produto_id text,
  nome       text,
  PRIMARY KEY ((cliente_id), visto_em)
) WITH CLUSTERING ORDER BY (visto_em DESC)
  AND default_time_to_live = 2592000`

// Nome de keyspace: só letras, dígitos e _ (vai no texto do CQL).
var nomeValido = regexp.MustCompile(`^[a-z][a-z0-9_]{0,47}$`)

// Vistos implementa portas.Vistos.
type Vistos struct {
	c        *storage.Cassandra
	keyspace string

	mu     sync.Mutex
	pronto bool
}

func NovosVistos(c *storage.Cassandra, keyspace string) *Vistos {
	return &Vistos{c: c, keyspace: keyspace}
}

// sessao conecta (preguiçoso: o Cassandra leva ~1 min para subir) e garante
// o esquema na primeira vez que der certo.
func (a *Vistos) sessao(ctx context.Context) (*gocql.Session, error) {
	s, err := a.c.Session()
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.pronto {
		// O esquema tem o PRÓPRIO prazo: criar keyspace e tabela leva ~1 s, e
		// o prazo curto do evento (500 ms) faria a criação falhar — e as
		// primeiras visitas se perderiam (pego pelo teste X1).
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if err := GarantirEsquema(ctx, s, a.keyspace); err != nil {
			return nil, err
		}
		a.pronto = true
	}
	return s, nil
}

// GarantirEsquema cria o keyspace e a tabela, se não existirem.
func GarantirEsquema(ctx context.Context, s *gocql.Session, keyspace string) error {
	if !nomeValido.MatchString(keyspace) {
		return fmt.Errorf("keyspace inválido: %q", keyspace)
	}
	for _, cql := range splitCQL(fmt.Sprintf(esquema, keyspace)) {
		if err := s.Query(cql).ExecContext(ctx); err != nil {
			return err
		}
	}
	return nil
}

// Registrar: um INSERT por visita. USING TTL explícito (além do padrão da
// tabela): a retenção é decisão do domínio, não do DBA.
func (a *Vistos) Registrar(ctx context.Context, cliente uuid.UUID, v dominio.Visto, retencao time.Duration) error {
	s, err := a.sessao(ctx)
	if err != nil {
		return err
	}
	return s.Query(`INSERT INTO `+a.keyspace+`.vistos_por_cliente (cliente_id, visto_em, produto_id, nome)
		VALUES (?, ?, ?, ?) USING TTL ?`,
		gocql.UUID(cliente), gocql.UUIDFromTime(v.Em), v.ProdutoID, v.Nome, int(retencao.Seconds())).ExecContext(ctx)
}

// Recentes lê UMA partição, já ordenada pela clustering key.
func (a *Vistos) Recentes(ctx context.Context, cliente uuid.UUID, limite int) ([]dominio.Visto, error) {
	s, err := a.sessao(ctx)
	if err != nil {
		return nil, err
	}
	iter := s.Query(`SELECT visto_em, produto_id, nome FROM `+a.keyspace+`.vistos_por_cliente
		WHERE cliente_id = ? LIMIT ?`, gocql.UUID(cliente), limite).IterContext(ctx)
	var (
		quando   gocql.UUID
		id, nome string
		out      []dominio.Visto
	)
	for iter.Scan(&quando, &id, &nome) {
		out = append(out, dominio.Visto{ProdutoID: id, Nome: nome, Em: quando.Time().UTC()})
	}
	return out, iter.Close()
}

// Apagar remove a partição inteira do cliente: um DELETE só pela partition
// key (LGPD, cenário X5). No Cassandra o DELETE grava uma *tombstone* que
// esconde as linhas na hora; o espaço volta na compactação, depois do
// gc_grace_seconds. Sem Cassandra configurado, não há histórico a apagar.
func (a *Vistos) Apagar(ctx context.Context, cliente uuid.UUID) error {
	s, err := a.sessao(ctx)
	if errors.Is(err, storage.ErrDisabled) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.Query(`DELETE FROM `+a.keyspace+`.vistos_por_cliente WHERE cliente_id = ?`,
		gocql.UUID(cliente)).ExecContext(ctx)
}

// TTLRestante (para o teste X2): quantos segundos faltam para a linha sumir.
func (a *Vistos) TTLRestante(ctx context.Context, cliente uuid.UUID) (int, error) {
	s, err := a.sessao(ctx)
	if err != nil {
		return 0, err
	}
	var ttl int
	err = s.Query(`SELECT TTL(nome) FROM `+a.keyspace+`.vistos_por_cliente WHERE cliente_id = ? LIMIT 1`,
		gocql.UUID(cliente)).ScanContext(ctx, &ttl)
	return ttl, err
}

func splitCQL(s string) []string {
	var out []string
	for _, p := range regexp.MustCompile(`;\s*\n`).Split(s, -1) {
		if p = regexp.MustCompile(`^\s+|\s+$`).ReplaceAllString(p, ""); p != "" {
			out = append(out, p)
		}
	}
	return out
}
