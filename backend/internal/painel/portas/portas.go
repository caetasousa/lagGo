// Package portas do Painel do DBA: o que o painel pergunta a cada banco.
// Cada interface é implementada por um adaptador (postgres, redis, mongo,
// pgbouncer), com as consultas às visões internas daquele banco.
package portas

import (
	"context"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// Postgres: as visões de estatística do PostgreSQL (pg_stat_*, pg_locks,
// pg_buffercache…) e a auditoria. docs/06.
type Postgres interface {
	VisaoGeral(ctx context.Context) (dominio.VisaoGeral, error)
	ConsultasCaras(ctx context.Context, limite int) ([]dominio.ConsultaCara, error)
	Sessoes(ctx context.Context) ([]dominio.Sessao, error)
	Locks(ctx context.Context) ([]dominio.Lock, error)
	Tabelas(ctx context.Context) ([]dominio.SaudeTabela, error)
	Indices(ctx context.Context) ([]dominio.SaudeIndice, error)
	Cache(ctx context.Context) (dominio.EstadoCache, error)
	Metricas(ctx context.Context) (dominio.Metricas, error)
	Particoes(ctx context.Context) ([]dominio.Particao, error)
	Auditoria(ctx context.Context, limite int) ([]dominio.RegistroAuditoria, error)
	AuditoriaDDL(ctx context.Context, limite int) ([]dominio.RegistroDDL, error)
}

// Manutencao: o que o painel pode MUDAR no PostgreSQL.
type Manutencao interface {
	// Executar roda VACUUM ou ANALYZE numa tabela de um esquema da aplicação
	// (dominio.ErrValidacao se a tabela não for conhecida).
	Executar(ctx context.Context, acao, tabela string) (dominio.ResultadoManutencao, error)
	// CancelarExpirados chama a PROCEDURE que cancela pedidos pendentes
	// antigos e devolve o estoque, com COMMIT a cada lote.
	CancelarExpirados(ctx context.Context, idadeHoras, lote int) (dominio.ResultadoCancelamento, error)
}

// Replicacao: as duas pontas da replicação física e o arquivamento.
type Replicacao interface {
	Estado(ctx context.Context) (dominio.EstadoReplicacao, error)
}

type Redis interface {
	Estado(ctx context.Context) (dominio.EstadoRedis, error)
}

type Mongo interface {
	Estado(ctx context.Context) (dominio.EstadoMongo, error)
}

// PgBouncer: o console de administração (SHOW POOLS/STATS/CONFIG).
type PgBouncer interface {
	Estado(ctx context.Context) (dominio.EstadoPgBouncer, error)
}
