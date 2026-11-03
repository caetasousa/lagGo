package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// HistoricoDeCompras implementa portas.HistoricoDeCompras: a FONTE do grafo
// de recomendações (db/queries/recomendacoes.sql).
type HistoricoDeCompras struct{ q *sqlcdb.Queries }

func NovoHistoricoDeCompras(pool *pgxpool.Pool) *HistoricoDeCompras {
	return &HistoricoDeCompras{q: sqlcdb.New(pool)}
}

// Percorrer entrega as compras agregadas em lotes. Uma consulta só (~150 mil
// linhas pequenas cabem com folga na memória); os lotes são para o Neo4j.
func (a *HistoricoDeCompras) Percorrer(ctx context.Context, lote int, f func([]dominio.Compra) error) (int64, error) {
	rows, err := a.q.ComprasPorClienteESku(ctx)
	if err != nil {
		return 0, err
	}
	for i := 0; i < len(rows); i += lote {
		fim := min(i+lote, len(rows))
		compras := make([]dominio.Compra, 0, fim-i)
		for _, r := range rows[i:fim] {
			compras = append(compras, dominio.Compra{ClienteID: r.ClienteID, Itens: []dominio.Item{{SkuID: r.SkuID, Quantidade: r.Unidades}}})
		}
		if err := f(compras); err != nil {
			return int64(i), err
		}
	}
	return int64(len(rows)), nil
}
