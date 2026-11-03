// Package aplicacao do Painel do DBA. Quase tudo é leitura: o caso de uso
// repassa à porta (a entrada da aplicação é sempre esta camada; o adaptador
// HTTP nunca fala direto com um banco). As exceções têm regra — a manutenção
// (só VACUUM e ANALYZE) e o cancelamento de pedidos expirados (limites do lote).
package aplicacao

import (
	"context"
	"slices"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
	"github.com/nosqlgo/marketplace/internal/painel/portas"
)

type Painel struct {
	pg         portas.Postgres
	manutencao portas.Manutencao
	replicacao portas.Replicacao
	redis      portas.Redis
	mongo      portas.Mongo
	pgbouncer  portas.PgBouncer
}

func NovoPainel(pg portas.Postgres, manutencao portas.Manutencao, replicacao portas.Replicacao,
	redis portas.Redis, mongo portas.Mongo, pgbouncer portas.PgBouncer) *Painel {
	return &Painel{pg: pg, manutencao: manutencao, replicacao: replicacao, redis: redis, mongo: mongo, pgbouncer: pgbouncer}
}

// ------------------------------------------------------------ leituras

func (p *Painel) VisaoGeral(ctx context.Context) (dominio.VisaoGeral, error) {
	return p.pg.VisaoGeral(ctx)
}
func (p *Painel) ConsultasCaras(ctx context.Context, limite int) ([]dominio.ConsultaCara, error) {
	return p.pg.ConsultasCaras(ctx, limite)
}
func (p *Painel) Sessoes(ctx context.Context) ([]dominio.Sessao, error) { return p.pg.Sessoes(ctx) }
func (p *Painel) Locks(ctx context.Context) ([]dominio.Lock, error)     { return p.pg.Locks(ctx) }
func (p *Painel) Tabelas(ctx context.Context) ([]dominio.SaudeTabela, error) {
	return p.pg.Tabelas(ctx)
}
func (p *Painel) Indices(ctx context.Context) ([]dominio.SaudeIndice, error) {
	return p.pg.Indices(ctx)
}
func (p *Painel) Cache(ctx context.Context) (dominio.EstadoCache, error) { return p.pg.Cache(ctx) }
func (p *Painel) Metricas(ctx context.Context) (dominio.Metricas, error) { return p.pg.Metricas(ctx) }
func (p *Painel) Particoes(ctx context.Context) ([]dominio.Particao, error) {
	return p.pg.Particoes(ctx)
}
func (p *Painel) Replicacao(ctx context.Context) (dominio.EstadoReplicacao, error) {
	return p.replicacao.Estado(ctx)
}
func (p *Painel) Redis(ctx context.Context) (dominio.EstadoRedis, error) { return p.redis.Estado(ctx) }
func (p *Painel) Mongo(ctx context.Context) (dominio.EstadoMongo, error) { return p.mongo.Estado(ctx) }
func (p *Painel) PgBouncer(ctx context.Context) (dominio.EstadoPgBouncer, error) {
	return p.pgbouncer.Estado(ctx)
}
func (p *Painel) Auditoria(ctx context.Context, limite int) ([]dominio.RegistroAuditoria, error) {
	return p.pg.Auditoria(ctx, limite)
}
func (p *Painel) AuditoriaDDL(ctx context.Context, limite int) ([]dominio.RegistroDDL, error) {
	return p.pg.AuditoriaDDL(ctx, limite)
}

// ------------------------------------------------------------ ações

// ManterTabela: VACUUM ou ANALYZE numa tabela da aplicação.
func (p *Painel) ManterTabela(ctx context.Context, acao, tabela string) (dominio.ResultadoManutencao, error) {
	if !slices.Contains(dominio.AcoesDeManutencao, acao) {
		return dominio.ResultadoManutencao{}, dominio.ErrRequisicao{Msg: "ação deve ser vacuum ou analyze"}
	}
	return p.manutencao.Executar(ctx, acao, tabela)
}

// CancelarExpirados: pedidos PENDENTES mais velhos que a idade, em lotes.
func (p *Painel) CancelarExpirados(ctx context.Context, idadeHoras, lote int) (dominio.ResultadoCancelamento, error) {
	if err := dominio.ValidarCancelamento(idadeHoras, lote); err != nil {
		return dominio.ResultadoCancelamento{}, err
	}
	return p.manutencao.CancelarExpirados(ctx, idadeHoras, lote)
}
