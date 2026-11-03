package postgres

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Laboratório de MVCC e VACUUM, na tabela lab.inchaco (autovacuum desligado).
//
// No PostgreSQL um UPDATE não sobrescreve a linha: grava uma VERSÃO nova e
// marca a antiga como morta. Quem limpa as mortas é o VACUUM (que só marca o
// espaço como reutilizável) ou o VACUUM FULL (que reescreve a tabela inteira,
// devolve o espaço ao disco — e trava a tabela enquanto isso).

var mvccMu sync.Mutex

// MVCC implementa portas.MVCC.
type MVCC struct{ pool *pgxpool.Pool }

func NovoMVCC(pool *pgxpool.Pool) *MVCC { return &MVCC{pool: pool} }

func (a *MVCC) Estado(ctx context.Context) (dominio.EstadoMVCC, error) {
	return estadoInchaco(ctx, a.pool)
}

func estadoInchaco(ctx context.Context, pool *pgxpool.Pool) (dominio.EstadoMVCC, error) {
	var e dominio.EstadoMVCC
	err := pool.QueryRow(ctx, `
SELECT coalesce((SELECT split_part(o, '=', 2)::int FROM unnest(c.reloptions) o WHERE o LIKE 'fillfactor=%'), 100),
       pg_relation_size(c.oid), pg_indexes_size(c.oid),
       s.tuple_count, s.dead_tuple_count, s.free_space, s.free_percent,
       coalesce((SELECT format('ctid=%s xmin=%s xmax=%s', ctid, xmin, xmax) FROM lab.inchaco WHERE id = 1), '—')
  FROM pg_class c, pgstattuple('lab.inchaco') s
 WHERE c.oid = 'lab.inchaco'::regclass`).Scan(&e.Fillfactor, &e.BytesTabela, &e.BytesIndices,
		&e.TuplasVivas, &e.TuplasMortas, &e.EspacoLivre, &e.PctLivre, &e.Linha1)
	return e, err
}

// Executar: recriar | atualizar | atualizar_indexada | vacuum | vacuum_full
func (a *MVCC) Executar(ctx context.Context, acao string, fillfactor int) (dominio.ResultadoMVCC, error) {
	pool := a.pool
	mvccMu.Lock()
	defer mvccMu.Unlock()
	r := dominio.ResultadoMVCC{Acao: acao}
	var err error
	if r.Antes, err = estadoInchaco(ctx, pool); err != nil {
		return r, err
	}
	var lsn0 string
	if err := pool.QueryRow(ctx, "SELECT pg_current_wal_lsn()::text").Scan(&lsn0); err != nil {
		return r, err
	}
	inicio := time.Now()

	switch acao {
	case "recriar":
		if fillfactor != 100 && fillfactor != 70 {
			return r, dominio.ErrValidacao{Msg: "fillfactor deve ser 100 ou 70"}
		}
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			// fillfactor é número validado acima (100 ou 70), não texto livre.
			if _, err := tx.Exec(ctx, fmt.Sprintf("ALTER TABLE lab.inchaco SET (fillfactor = %d)", fillfactor)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "TRUNCATE lab.inchaco"); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO lab.inchaco SELECT g, 0, g, repeat('x', 150) FROM generate_series(1, $1) g`, dominio.LinhasDoInchaco)
			return err
		})
	case "atualizar", "atualizar_indexada":
		coluna := "valor"
		if acao == "atualizar_indexada" {
			coluna = "indexada"
		}
		// Atualiza 10% das linhas (id múltiplo de 10), como num sistema real,
		// em que só uma fração muda de cada vez. Um UPDATE da tabela INTEIRA
		// não caberia nos 30% livres de cada página, e o HOT despencaria.
		//
		// Contadores: pg_stat_get_xact_* (os globais chegam com atraso). Eles
		// podem trazer valores pendentes de transações anteriores da mesma
		// conexão, por isso medimos a DIFERENÇA antes/depois do UPDATE.
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			const contadores = `SELECT pg_stat_get_xact_tuples_updated('lab.inchaco'::regclass),
			                           pg_stat_get_xact_tuples_hot_updated('lab.inchaco'::regclass)`
			var upd0, hot0 int64
			if err := tx.QueryRow(ctx, contadores).Scan(&upd0, &hot0); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "UPDATE lab.inchaco SET "+coluna+" = "+coluna+" + 1 WHERE id % 10 = 0"); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, contadores).Scan(&r.Atualizadas, &r.HOT); err != nil {
				return err
			}
			r.Atualizadas -= upd0
			r.HOT -= hot0
			return nil
		})
	case "vacuum":
		_, err = pool.Exec(ctx, "VACUUM lab.inchaco")
	case "vacuum_full":
		_, err = pool.Exec(ctx, "VACUUM FULL lab.inchaco")
	default:
		return r, dominio.ErrValidacao{Msg: "ação desconhecida"}
	}
	if err != nil {
		return r, err
	}
	r.DuracaoMS = float64(time.Since(inicio).Microseconds()) / 1000
	if err := pool.QueryRow(ctx, "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::bigint", lsn0).Scan(&r.WALBytes); err != nil {
		return r, err
	}
	r.Depois, err = estadoInchaco(ctx, pool)
	if err == nil && acao == "vacuum" && r.Depois.TuplasMortas > 0 {
		_ = pool.QueryRow(ctx, `
SELECT format('pid %s (%s), aberta há %s ms: %s', pid, coalesce(nullif(application_name, ''), '?'),
              round(extract(epoch FROM clock_timestamp() - xact_start) * 1000), left(query, 80))
  FROM pg_stat_activity
 WHERE backend_xmin IS NOT NULL AND pid <> pg_backend_pid()
 ORDER BY age(backend_xmin) DESC
 LIMIT 1`).Scan(&r.Horizonte)
	}
	return r, err
}
