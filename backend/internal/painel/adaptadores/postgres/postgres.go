// Package postgres: o adaptador do Painel do DBA para o PostgreSQL. As
// consultas usam as visões de estatística (pg_stat_*), pg_locks,
// pg_buffercache e a auditoria — leia docs/06-postgresql-admin.md antes de mexer.
// É SQL dinâmico/administrativo: por isso não está no sqlc.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// esquemasDaAplicacao: o painel só olha (e só mexe em) tabelas daqui.
var esquemasDaAplicacao = []string{"public", "auditoria", "relatorio", "lab"}

// Postgres implementa portas.Postgres e portas.Manutencao.
type Postgres struct {
	pool *pgxpool.Pool
}

func Novo(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (a *Postgres) VisaoGeral(ctx context.Context) (dominio.VisaoGeral, error) {
	const q = `
SELECT version(),
       pg_postmaster_start_time(),
       pg_database_size(current_database()),
       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
       current_setting('max_connections')::bigint,
       (SELECT 100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0)
          FROM pg_stat_database WHERE datname = current_database())::float8,
       pg_is_in_recovery()`
	var o dominio.VisaoGeral
	err := a.pool.QueryRow(ctx, q).Scan(&o.Version, &o.StartedAt, &o.DatabaseBytes, &o.Connections,
		&o.MaxConnections, &o.CacheHitRatio, &o.InRecovery)
	return o, err
}

// ConsultasCaras: as que mais consumiram tempo total (pg_stat_statements).
func (a *Postgres) ConsultasCaras(ctx context.Context, limite int) ([]dominio.ConsultaCara, error) {
	const q = `
SELECT queryid::text, left(query, 500), calls, total_exec_time, mean_exec_time,
       rows, shared_blks_hit, shared_blks_read
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT $1`
	return coletar[dominio.ConsultaCara](ctx, a.pool, q, limite)
}

// Sessoes: quem está conectado e quem bloqueia quem (docs/03).
func (a *Postgres) Sessoes(ctx context.Context) ([]dominio.Sessao, error) {
	const q = `
SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       (extract(epoch FROM clock_timestamp() - query_start) * 1000)::float8,
       pg_blocking_pids(pid), left(query, 500)
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
 ORDER BY query_start NULLS LAST`
	return coletar[dominio.Sessao](ctx, a.pool, q)
}

// Locks de linha aparecem como locktype = 'transactionid': quem espera uma
// linha travada espera, na verdade, a TRANSAÇÃO que a travou terminar. Os
// AccessShareLock de leitura em tabelas são omitidos (são milhares e não
// bloqueiam nada além de DDL).
func (a *Postgres) Locks(ctx context.Context) ([]dominio.Lock, error) {
	const q = `
SELECT l.pid, l.locktype, l.mode, l.granted,
       l.relation::regclass::text,
       l.transactionid::text,
       a.state,
       CASE WHEN NOT l.granted
            THEN (extract(epoch FROM clock_timestamp() - l.waitstart) * 1000)::float8 END,
       pg_blocking_pids(l.pid),
       left(a.query, 300)
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE a.datname = current_database()
   AND l.pid <> pg_backend_pid()
   AND l.locktype <> 'virtualxid'
   AND NOT (l.locktype = 'relation' AND l.mode = 'AccessShareLock' AND l.granted)
 ORDER BY l.granted, l.pid
 LIMIT 200`
	return coletar[dominio.Lock](ctx, a.pool, q)
}

// Tabelas: a tabela particionada aparece UMA vez, somando as partições.
func (a *Postgres) Tabelas(ctx context.Context) ([]dominio.SaudeTabela, error) {
	const q = `
WITH t AS (
    SELECT c.oid, n.nspname || '.' || c.relname AS nome, c.relkind, coalesce(c.reloptions, '{}') AS opcoes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY($1)
)
SELECT t.nome, t.relkind = 'p', count(*) FILTER (WHERE t.relkind = 'p'),
       coalesce(sum(pg_relation_size(pt.relid)), 0)::bigint,
       coalesce(sum(pg_indexes_size(pt.relid)), 0)::bigint,
       coalesce(sum(pg_total_relation_size(pt.relid)), 0)::bigint,
       coalesce(sum(s.n_live_tup), 0)::bigint, coalesce(sum(s.n_dead_tup), 0)::bigint,
       coalesce(sum(s.n_tup_upd), 0)::bigint, coalesce(sum(s.n_tup_hot_upd), 0)::bigint,
       coalesce(sum(s.seq_scan), 0)::bigint, coalesce(sum(s.idx_scan), 0)::bigint,
       max(s.last_vacuum), max(s.last_autovacuum), max(s.last_analyze), max(s.last_autoanalyze),
       coalesce(sum(s.autovacuum_count), 0)::bigint, t.opcoes
  FROM t
 -- pg_partition_tree() devolve ZERO linhas para tabela comum: o UNION
 -- garante que ela entre como a própria "folha".
 CROSS JOIN LATERAL (SELECT relid FROM pg_partition_tree(t.oid) WHERE isleaf
                     UNION ALL SELECT t.oid WHERE t.relkind = 'r') pt
  LEFT JOIN pg_stat_user_tables s ON s.relid = pt.relid
 GROUP BY t.oid, t.nome, t.relkind, t.opcoes
 ORDER BY 6 DESC`
	return coletar[dominio.SaudeTabela](ctx, a.pool, q, esquemasDaAplicacao)
}

func (a *Postgres) Indices(ctx context.Context) ([]dominio.SaudeIndice, error) {
	const q = `
SELECT s.schemaname || '.' || s.relname, s.indexrelname, s.idx_scan, pg_relation_size(s.indexrelid),
       x.indisunique, x.indisprimary, pg_get_indexdef(s.indexrelid),
       s.idx_scan = 0 AND NOT x.indisunique AND NOT x.indisprimary
  FROM pg_stat_user_indexes s
  JOIN pg_index x ON x.indexrelid = s.indexrelid
  JOIN pg_class c ON c.oid = s.relid
 WHERE s.schemaname = ANY($1) AND NOT c.relispartition
 ORDER BY 8 DESC, pg_relation_size(s.indexrelid) DESC`
	return coletar[dominio.SaudeIndice](ctx, a.pool, q, esquemasDaAplicacao)
}

// Cache: o que ocupa o shared_buffers agora (pg_buffercache).
func (a *Postgres) Cache(ctx context.Context) (dominio.EstadoCache, error) {
	var e dominio.EstadoCache
	if err := a.pool.QueryRow(ctx, `SELECT count(*), count(relfilenode) FROM pg_buffercache`).Scan(&e.TotalBuffers, &e.Usados); err != nil {
		return e, err
	}
	const q = `
SELECT n.nspname || '.' || c.relname,
       CASE c.relkind WHEN 'r' THEN 'tabela' WHEN 'i' THEN 'índice' WHEN 'm' THEN 'materialized view'
                      WHEN 't' THEN 'TOAST' ELSE c.relkind::text END,
       count(*), count(*) FILTER (WHERE b.isdirty), round(avg(b.usagecount), 1)::float8,
       round(100.0 * count(*) / $1, 2)::float8
  FROM pg_buffercache b
  JOIN pg_class c ON b.relfilenode = pg_relation_filenode(c.oid)
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
 GROUP BY 1, 2
 ORDER BY 3 DESC
 LIMIT 15`
	var err error
	e.Relacoes, err = coletar[dominio.RelacaoNoCache](ctx, a.pool, q, e.TotalBuffers)
	return e, err
}

// Metricas: contadores ACUMULADOS; a taxa (commits/s) é a diferença entre duas
// leituras dividida pelo intervalo — quem faz a conta é o frontend.
func (a *Postgres) Metricas(ctx context.Context) (dominio.Metricas, error) {
	const q = `
SELECT clock_timestamp(), xact_commit, xact_rollback, tup_returned + tup_fetched,
       tup_inserted + tup_updated + tup_deleted, blks_read, blks_hit, deadlocks, temp_bytes,
       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'),
       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend')
  FROM pg_stat_database WHERE datname = current_database()`
	var m dominio.Metricas
	err := a.pool.QueryRow(ctx, q).Scan(&m.Em, &m.Commits, &m.Rollbacks, &m.TuplasLidas, &m.TuplasEscr,
		&m.BlocosDisco, &m.BlocosCache, &m.Deadlocks, &m.BytesTemp, &m.ConexoesAtiv, &m.ConexoesTotal)
	return m, err
}

// Particoes de auditoria.log.
func (a *Postgres) Particoes(ctx context.Context) ([]dominio.Particao, error) {
	const q = `
SELECT c.relname, pg_get_expr(c.relpartbound, c.oid), greatest(c.reltuples, 0)::bigint, pg_total_relation_size(c.oid)
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
 WHERE i.inhparent = 'auditoria.log'::regclass
 ORDER BY c.relname`
	return coletar[dominio.Particao](ctx, a.pool, q)
}

func (a *Postgres) Auditoria(ctx context.Context, limite int) ([]dominio.RegistroAuditoria, error) {
	const q = `
SELECT id, tabela, operacao, chave, usuario, transacao, em, antes, depois
  FROM auditoria.log
 ORDER BY id DESC
 LIMIT $1`
	return coletar[dominio.RegistroAuditoria](ctx, a.pool, q, limite)
}

// AuditoriaDDL: preenchida pelo EVENT TRIGGER (migração 00003), inclui os
// índices criados e removidos pelo Laboratório de Índices.
func (a *Postgres) AuditoriaDDL(ctx context.Context, limite int) ([]dominio.RegistroDDL, error) {
	const q = `
SELECT id, em, usuario, comando, tipo_objeto, objeto
  FROM auditoria.ddl
 ORDER BY id DESC
 LIMIT $1`
	return coletar[dominio.RegistroDDL](ctx, a.pool, q, limite)
}

// ------------------------------------------------------------ manutenção

var comandosManutencao = map[string]string{
	"vacuum":  "VACUUM (VERBOSE OFF, ANALYZE) ",
	"analyze": "ANALYZE ",
}

// Executar: VACUUM não roda dentro de transação — pool.Exec em modo autocommit.
func (a *Postgres) Executar(ctx context.Context, acao, tabela string) (dominio.ResultadoManutencao, error) {
	cmd, ok := comandosManutencao[acao]
	if !ok {
		return dominio.ResultadoManutencao{}, dominio.ErrRequisicao{Msg: "ação deve ser vacuum ou analyze"}
	}
	// A tabela precisa existir num esquema da aplicação; o nome vai escapado.
	var esquema, nome string
	err := a.pool.QueryRow(ctx, `
SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = to_regclass($1) AND c.relkind IN ('r', 'p') AND n.nspname = ANY($2)`, tabela, esquemasDaAplicacao).Scan(&esquema, &nome)
	if err != nil {
		return dominio.ResultadoManutencao{}, dominio.ErrValidacao{Msg: "tabela desconhecida"}
	}
	inicio := time.Now()
	if _, err := a.pool.Exec(ctx, cmd+pgx.Identifier{esquema, nome}.Sanitize()); err != nil {
		return dominio.ResultadoManutencao{}, err
	}
	return dominio.ResultadoManutencao{Acao: acao, Tabela: esquema + "." + nome, DuracaoMS: time.Since(inicio).Milliseconds()}, nil
}

// CancelarExpirados chama uma PROCEDURE que faz COMMIT a cada lote. Por isso:
// sem BEGIN em volta (modo autocommit) e o resultado volta pelo parâmetro INOUT.
func (a *Postgres) CancelarExpirados(ctx context.Context, idadeHoras, lote int) (dominio.ResultadoCancelamento, error) {
	inicio := time.Now()
	var r dominio.ResultadoCancelamento
	err := a.pool.QueryRow(ctx, "CALL cancelar_pedidos_expirados($1::interval, $2, NULL)",
		fmt.Sprintf("%d hours", idadeHoras), lote).Scan(&r.Cancelados)
	r.Lotes = (int(r.Cancelados) + lote - 1) / lote
	r.DuracaoMS = time.Since(inicio).Milliseconds()
	return r, err
}

// coletar lê as linhas na ordem das colunas para os campos do tipo.
func coletar[T any](ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) ([]T, error) {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[T])
}
