package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// O lado "SQL" do Laboratório Grafo × SQL (Fase 7). A mesma pergunta do
// Cypher, escrita com self-joins: cada "salto" do grafo vira dois JOINs
// (item_pedido → pedido) — e cada JOIN multiplica as linhas intermediárias.
const (
	SQLTambemComprou = `SELECT i2.sku_id::text AS sku, count(DISTINCT p1.cliente_id) AS forca
  FROM item_pedido i1
  JOIN pedido p1 ON p1.id = i1.pedido_id AND p1.status <> 'CANCELADO'
  JOIN pedido p2 ON p2.cliente_id = p1.cliente_id AND p2.status <> 'CANCELADO'
  JOIN item_pedido i2 ON i2.pedido_id = p2.id
 WHERE i1.sku_id = $1 AND i2.sku_id <> $1 AND i2.sku_id <> $2
 GROUP BY i2.sku_id
 ORDER BY forca DESC, sku
 LIMIT 10`

	SQLAlcance = `WITH compradores AS (
  SELECT DISTINCT p.cliente_id
    FROM item_pedido i JOIN pedido p ON p.id = i.pedido_id AND p.status <> 'CANCELADO'
   WHERE i.sku_id = $1
), skus2 AS (
  SELECT DISTINCT i.sku_id
    FROM compradores c
    JOIN pedido p ON p.cliente_id = c.cliente_id AND p.status <> 'CANCELADO'
    JOIN item_pedido i ON i.pedido_id = p.id
   WHERE i.sku_id <> $2
)
SELECT count(DISTINCT p.cliente_id) AS total
  FROM skus2 s
  JOIN item_pedido i ON i.sku_id = s.sku_id
  JOIN pedido p ON p.id = i.pedido_id AND p.status <> 'CANCELADO'
 WHERE p.cliente_id NOT IN (SELECT cliente_id FROM compradores)`
)

type GrafoSQL struct{ pool *pgxpool.Pool }

func NovoGrafoSQL(pool *pgxpool.Pool) *GrafoSQL { return &GrafoSQL{pool: pool} }

// medir roda a consulta numa transação só de leitura com prazo de 30 s.
func (a *GrafoSQL) medir(ctx context.Context, f func(pgx.Tx) error) (float64, error) {
	tx, err := a.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '30s'"); err != nil {
		return 0, err
	}
	inicio := time.Now()
	if err := f(tx); err != nil {
		return 0, err
	}
	return float64(time.Since(inicio).Microseconds()) / 1000, tx.Commit(ctx)
}

func (a *GrafoSQL) TambemCompraram(ctx context.Context, sku string) (dominio.Medida, error) {
	m := dominio.Medida{Banco: "PostgreSQL", Consulta: SQLTambemComprou, Linhas: []dominio.LinhaGrafo{}}
	var err error
	m.MS, err = a.medir(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, SQLTambemComprou, sku, dominio.SkuLaboratorio)
		if err != nil {
			return err
		}
		m.Linhas, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (dominio.LinhaGrafo, error) {
			var l dominio.LinhaGrafo
			return l, r.Scan(&l.SkuID, &l.Forca)
		})
		return err
	})
	return m, err
}

func (a *GrafoSQL) Alcance(ctx context.Context, sku string) (dominio.Medida, error) {
	m := dominio.Medida{Banco: "PostgreSQL", Consulta: SQLAlcance, Linhas: []dominio.LinhaGrafo{}}
	var err error
	m.MS, err = a.medir(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, SQLAlcance, sku, dominio.SkuLaboratorio).Scan(&m.Total)
	})
	return m, err
}

// SkusParaOGrafo: os 6 SKUs com mais compradores — bons pontos de partida.
func (a *GrafoSQL) SkusParaOGrafo(ctx context.Context) ([]dominio.SkuParaOGrafo, error) {
	rows, err := a.pool.Query(ctx, `
		SELECT i.sku_id::text, s.descricao, count(DISTINCT p.cliente_id) AS compradores
		  FROM item_pedido i
		  JOIN pedido p ON p.id = i.pedido_id AND p.status <> 'CANCELADO'
		  JOIN sku s ON s.id = i.sku_id
		 WHERE i.sku_id <> $1
		 GROUP BY i.sku_id, s.descricao
		 ORDER BY compradores DESC, i.sku_id
		 LIMIT 6`, dominio.SkuLaboratorio)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (dominio.SkuParaOGrafo, error) {
		var s dominio.SkuParaOGrafo
		return s, r.Scan(&s.ID, &s.Descricao, &s.Compradores)
	})
}
