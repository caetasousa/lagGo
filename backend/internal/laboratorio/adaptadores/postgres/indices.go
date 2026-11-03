package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Indices implementa portas.Indices. Só os índices do catálogo
// (indices_catalogo.go) podem ser criados ou removidos: o nome vindo da URL
// é procurado lá, nunca concatenado em SQL.
type Indices struct{ pool *pgxpool.Pool }

func NovosIndices(pool *pgxpool.Pool) *Indices { return &Indices{pool: pool} }

func (a *Indices) estado(ctx context.Context, indices []dominio.Indice) ([]dominio.EstadoIndice, error) {
	nomes := make([]string, len(indices))
	for i, ind := range indices {
		nomes[i] = ind.Nome
	}
	const q = `
SELECT c.relname, x.indisvalid, pg_relation_size(c.oid),
       coalesce(s.idx_scan, 0), pg_get_indexdef(c.oid)
  FROM pg_class c
  JOIN pg_index x ON x.indexrelid = c.oid
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = c.oid
 WHERE c.relkind = 'i' AND c.relname = ANY($1)`
	rows, err := a.pool.Query(ctx, q, nomes)
	if err != nil {
		return nil, err
	}
	encontrados := map[string]dominio.EstadoIndice{}
	var (
		nome, def   string
		valido      bool
		bytes, usos int64
	)
	_, err = pgx.ForEachRow(rows, []any{&nome, &valido, &bytes, &usos, &def}, func() error {
		encontrados[nome] = dominio.EstadoIndice{Existe: true, Valido: valido, Bytes: bytes, Usos: usos, Definicao: def}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]dominio.EstadoIndice, len(indices))
	for i, ind := range indices {
		e := encontrados[ind.Nome]
		e.Indice = ind
		out[i] = e
	}
	return out, nil
}

func (a *Indices) Experimentos(ctx context.Context) ([]dominio.ExperimentoComEstado, error) {
	out := make([]dominio.ExperimentoComEstado, 0, len(experimentos))
	for _, e := range experimentos {
		est, err := a.estado(ctx, e.Indices)
		if err != nil {
			return nil, err
		}
		out = append(out, dominio.ExperimentoComEstado{Experimento: e, Indices: est})
	}
	return out, nil
}

// Criar: CONCURRENTLY não trava escritas na tabela, mas não roda dentro de
// transação. Depois, ANALYZE: índices de EXPRESSÃO só ganham estatísticas
// próprias com ele.
func (a *Indices) Criar(ctx context.Context, nome string) (time.Duration, error) {
	ind, ok := buscarIndice(nome)
	if !ok {
		return 0, dominio.ErrNaoEncontrado{Msg: "índice fora do catálogo do laboratório"}
	}
	inicio := time.Now()
	if _, err := a.pool.Exec(ctx, ind.Criar); err != nil {
		return 0, err
	}
	_, err := a.pool.Exec(ctx, "ANALYZE "+ind.Tabela)
	return time.Since(inicio), err
}

func (a *Indices) Remover(ctx context.Context, nome string) error {
	ind, ok := buscarIndice(nome)
	if !ok {
		return dominio.ErrNaoEncontrado{Msg: "índice fora do catálogo do laboratório"}
	}
	// O nome vem do catálogo (constante), não da requisição.
	_, err := a.pool.Exec(ctx, "DROP INDEX CONCURRENTLY IF EXISTS "+pgx.Identifier{ind.Nome}.Sanitize())
	return err
}

// Explain roda EXPLAIN (ANALYZE, BUFFERS) numa transação READ ONLY que é
// desfeita. ANALYZE EXECUTA a consulta de verdade — por isso só consultas do
// catálogo. Os ajustes já foram validados pela aplicação.
func (a *Indices) Explain(ctx context.Context, id, workMem string, ajustes map[string]string) (dominio.ResultadoExplain, error) {
	e, ok := buscarExperimento(id)
	if !ok {
		return dominio.ResultadoExplain{}, dominio.ErrNaoEncontrado{Msg: "experimento não encontrado"}
	}
	res := dominio.ResultadoExplain{Experimento: e.ID, WorkMem: workMem, Ajustes: ajustes}
	est, err := a.estado(ctx, e.Indices)
	if err != nil {
		return res, err
	}
	for _, i := range est {
		if i.Existe {
			res.IndicesPresentes = append(res.IndicesPresentes, i.Nome)
		}
	}

	err = pgx.BeginTxFunc(ctx, a.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '15s'"); err != nil {
			return err
		}
		if workMem != "" {
			// set_config(..., true) = SET LOCAL, mas aceita parâmetro ($1).
			if _, err := tx.Exec(ctx, "SELECT set_config('work_mem', $1, true)", workMem); err != nil {
				return err
			}
			res.WorkMem = workMem
		} else if err := tx.QueryRow(ctx, "SHOW work_mem").Scan(&res.WorkMem); err != nil {
			return err
		}

		for k, v := range ajustes {
			if _, err := tx.Exec(ctx, "SELECT set_config($1, $2, true)", k, v); err != nil {
				return err
			}
		}

		var args []any
		if e.Parametro != "" {
			var p string
			if err := tx.QueryRow(ctx, e.Parametro).Scan(&p); err != nil {
				return err
			}
			res.Parametro = &p
			args = append(args, p)
		}
		// Protocolo simples: o pgx interpola o parâmetro (com escape) e o
		// PostgreSQL planeja com o valor real, como no psql.
		rows, err := tx.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS) "+e.SQL,
			append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...)
		if err != nil {
			return err
		}
		res.Plano, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		return errRollback // nunca confirma nada
	})
	if err != nil && err != errRollback {
		return res, err
	}
	return res, nil
}

type rollbackErr struct{}

func (rollbackErr) Error() string { return "rollback" }

var errRollback error = rollbackErr{}
