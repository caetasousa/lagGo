package postgres

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Relatorios implementa portas.Relatorios sobre a materialized view
// relatorio.vendas_por_dia (db/queries/relatorios.sql: CUBE, janelas, CTE).
//
// O REFRESH (escrita) vai sempre ao primário; as consultas vão à réplica, se
// houver. Relatório tolera alguns milissegundos de atraso — é o caso clássico
// de "escalar leitura" com réplicas (docs/08).
type Relatorios struct {
	primario *pgxpool.Pool
	replica  *pgxpool.Pool // nil = sem réplica (testes de integração, ou não configurada)
}

func NovosRelatorios(primario, replica *pgxpool.Pool) *Relatorios {
	return &Relatorios{primario: primario, replica: replica}
}

// comoLeitor roda a consulta numa transação SÓ DE LEITURA, no papel
// relatorio_leitura (Fase 6): mesmo que uma consulta de relatório tivesse um
// DELETE por engano, o banco recusaria — o papel só tem SELECT (cenário W2).
// Os papéis existem também na réplica: ela é uma cópia do cluster inteiro.
func comoLeitor[T any](ctx context.Context, pool *pgxpool.Pool, consulta func(*sqlcdb.Queries) ([]T, error)) ([]T, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE relatorio_leitura"); err != nil {
		return nil, err
	}
	rows, err := consulta(sqlcdb.New(tx))
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit(ctx)
}

// ler executa a consulta na réplica e, se ela falhar (fora do ar, ainda
// clonando), no primário — devolvendo de onde leu.
func ler[T any](ctx context.Context, a *Relatorios, consulta func(*sqlcdb.Queries) ([]T, error)) ([]T, dominio.Origem, error) {
	if a.replica != nil {
		rows, err := comoLeitor(ctx, a.replica, consulta)
		if err == nil {
			return rows, dominio.OrigemReplica, nil
		}
		slog.Warn("réplica indisponível; lendo do primário", "err", err)
	}
	rows, err := comoLeitor(ctx, a.primario, consulta)
	return rows, dominio.OrigemPrimario, err
}

func (a *Relatorios) VendasMensais(ctx context.Context, meses int32) ([]dominio.VendaMensal, dominio.Origem, error) {
	rows, origem, err := ler(ctx, a, func(q *sqlcdb.Queries) ([]sqlcdb.VendasMensaisPorUFRow, error) {
		return q.VendasMensaisPorUF(ctx, meses)
	})
	out := make([]dominio.VendaMensal, len(rows))
	for i, r := range rows {
		out[i] = dominio.VendaMensal{Mes: data(r.Mes), Uf: r.Uf, Pedidos: r.Pedidos, Receita: dinheiro(r.Receita), Nivel: r.Nivel}
	}
	return out, origem, err
}

func (a *Relatorios) ReceitaDiaria(ctx context.Context, dias int32) ([]dominio.ReceitaDia, dominio.Origem, error) {
	rows, origem, err := ler(ctx, a, func(q *sqlcdb.Queries) ([]sqlcdb.ReceitaDiariaRow, error) { return q.ReceitaDiaria(ctx, dias) })
	out := make([]dominio.ReceitaDia, len(rows))
	for i, r := range rows {
		dia := ""
		if d := data(r.Dia); d != nil {
			dia = *d
		}
		out[i] = dominio.ReceitaDia{Dia: dia, Pedidos: r.Pedidos, Receita: dinheiro(r.Receita),
			MediaMovel7d: dinheiro(r.MediaMovel7d), Variacao: dinheiroOuNulo(r.Variacao)}
	}
	return out, origem, err
}

func (a *Relatorios) CurvaABC(ctx context.Context, dias int32) ([]dominio.ClasseABC, dominio.Origem, error) {
	rows, origem, err := ler(ctx, a, func(q *sqlcdb.Queries) ([]sqlcdb.CurvaABCRow, error) { return q.CurvaABC(ctx, dias) })
	out := make([]dominio.ClasseABC, len(rows))
	for i, r := range rows {
		out[i] = dominio.ClasseABC{Classe: r.Classe, Skus: r.Skus, Receita: dinheiro(r.Receita)}
	}
	return out, origem, err
}

func (a *Relatorios) StatusAtualizacao(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error) {
	return a.status(ctx, ler)
}

func (a *Relatorios) status(ctx context.Context,
	leitor func(context.Context, *Relatorios, func(*sqlcdb.Queries) ([]sqlcdb.RelatorioAtualizacao, error)) ([]sqlcdb.RelatorioAtualizacao, dominio.Origem, error),
) ([]dominio.Atualizacao, dominio.Origem, error) {
	rows, origem, err := leitor(ctx, a, func(q *sqlcdb.Queries) ([]sqlcdb.RelatorioAtualizacao, error) { return q.StatusAtualizacao(ctx) })
	out := make([]dominio.Atualizacao, len(rows))
	for i, r := range rows {
		out[i] = dominio.Atualizacao{Objeto: r.Objeto, AtualizadoEm: r.AtualizadoEm, DuracaoMs: dinheiro(r.DuracaoMs)}
	}
	return out, origem, err
}

// Atualizar roda a procedure do REFRESH MATERIALIZED VIEW CONCURRENTLY.
//
// Read-your-writes (cenário S3): o REFRESH acontece no primário e a tela
// relê em seguida — da réplica. Se ela ainda não aplicou o WAL do REFRESH,
// o usuário veria o relatório velho. Então, antes de reler, espera a réplica
// alcançar o ponto do WAL (LSN) em que o primário estava depois da escrita.
// Se demorar demais, relê do primário.
func (a *Relatorios) Atualizar(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error) {
	if _, err := a.primario.Exec(ctx, "CALL relatorio.atualizar_vendas_por_dia()"); err != nil {
		return nil, "", err
	}
	if a.replica != nil {
		if err := EsperarReplica(ctx, a.primario, a.replica, 3*time.Second); err != nil {
			slog.Warn("réplica não alcançou o REFRESH a tempo; lendo do primário", "err", err)
			return a.status(ctx, doPrimario)
		}
	}
	return a.StatusAtualizacao(ctx)
}

func doPrimario[T any](ctx context.Context, a *Relatorios, consulta func(*sqlcdb.Queries) ([]T, error)) ([]T, dominio.Origem, error) {
	rows, err := comoLeitor(ctx, a.primario, consulta)
	return rows, dominio.OrigemPrimario, err
}

// EsperarReplica bloqueia até a réplica ter REAPLICADO todo o WAL que o
// primário já tinha gerado no momento da chamada (pg_current_wal_lsn no
// primário ≤ pg_last_wal_replay_lsn na réplica), ou até o prazo.
//
// É a técnica de "consistência causal" por LSN: em vez de ler sempre do
// primário, a leitura espera a réplica chegar ao ponto da última escrita.
func EsperarReplica(ctx context.Context, primario, replica *pgxpool.Pool, prazo time.Duration) error {
	var alvo string
	if err := primario.QueryRow(ctx, "SELECT pg_current_wal_lsn()::text").Scan(&alvo); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, prazo)
	defer cancel()
	for {
		var alcancou bool
		err := replica.QueryRow(ctx, "SELECT coalesce(pg_last_wal_replay_lsn() >= $1::pg_lsn, false)", alvo).Scan(&alcancou)
		if err != nil {
			return err
		}
		if alcancou {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}
