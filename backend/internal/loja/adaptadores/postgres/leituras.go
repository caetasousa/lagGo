package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// dinheiro converte o numeric do PostgreSQL no texto exato do domínio.
// (O MarshalJSON do pgtype.Numeric já devolve o número com as casas certas.)
func dinheiro(n pgtype.Numeric) dominio.Dinheiro {
	b, err := n.MarshalJSON()
	if err != nil || string(b) == "null" {
		return "0"
	}
	return dominio.Dinheiro(b)
}

func dinheiroOuNulo(n pgtype.Numeric) *dominio.Dinheiro {
	if !n.Valid {
		return nil
	}
	d := dinheiro(n)
	return &d
}

func data(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.Format("2006-01-02")
	return &s
}

// ------------------------------------------------------------ ofertas e clientes

// Ofertas implementa portas.Ofertas: preço e estoque vigentes.
type Ofertas struct{ q *sqlcdb.Queries }

func NovasOfertas(pool *pgxpool.Pool) *Ofertas { return &Ofertas{q: sqlcdb.New(pool)} }

func (a *Ofertas) DosSkus(ctx context.Context, ids []uuid.UUID) ([]dominio.Oferta, error) {
	rows, err := a.q.OfertasDosSkus(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]dominio.Oferta, len(rows))
	for i, o := range rows {
		out[i] = dominio.Oferta{ID: o.ID, ProdutoID: o.ProdutoID, Descricao: o.Descricao, Preco: dinheiro(o.Preco),
			Ativo: o.Ativo, Estoque: o.Estoque, Vendedor: o.Vendedor}
	}
	return out, nil
}

// Clientes implementa portas.Clientes.
type Clientes struct{ q *sqlcdb.Queries }

func NovosClientes(pool *pgxpool.Pool) *Clientes { return &Clientes{q: sqlcdb.New(pool)} }

func (a *Clientes) Nome(ctx context.Context, id uuid.UUID) (string, error) {
	nome, err := a.q.NomeDoCliente(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", dominio.ErrClienteNaoEncontrado
	}
	return nome, err
}

// ------------------------------------------------------------ vitrine

// Vitrine implementa portas.Vitrine (consultas em db/queries/loja.sql).
type Vitrine struct{ q *sqlcdb.Queries }

func NovaVitrine(pool *pgxpool.Pool) *Vitrine { return &Vitrine{q: sqlcdb.New(pool)} }

// Categorias: a árvore com caminho e contagem de SKUs (CTE recursiva).
func (a *Vitrine) Categorias(ctx context.Context) ([]dominio.Categoria, error) {
	rows, err := a.q.ArvoreCategorias(ctx)
	out := make([]dominio.Categoria, len(rows))
	for i, c := range rows {
		out[i] = dominio.Categoria{ID: c.ID, Nome: c.Nome, Caminho: c.Caminho, Nivel: c.Nivel, Skus: c.Skus}
	}
	return out, err
}

// Skus: categoria inclui as subcategorias (função categoria_descendentes).
func (a *Vitrine) Skus(ctx context.Context, f dominio.FiltroSkus) ([]dominio.Sku, error) {
	p := sqlcdb.ListarSkusParams{Limite: f.Limite}
	if f.Busca != "" {
		p.Busca = &f.Busca
	}
	if f.Categoria > 0 {
		p.Categoria = &f.Categoria
	}
	rows, err := a.q.ListarSkus(ctx, p)
	out := make([]dominio.Sku, len(rows))
	for i, s := range rows {
		out[i] = dominio.Sku{ID: s.ID, Descricao: s.Descricao, Preco: dinheiro(s.Preco), Estoque: s.Estoque,
			Vendedor: s.Vendedor, Categoria: s.Categoria}
	}
	return out, err
}

// lerPedido monta o detalhe do pedido com as consultas que receber — no
// caso da conta, as de uma transação com o papel loja_cliente (RLS).
func lerPedido(ctx context.Context, q *sqlcdb.Queries, id uuid.UUID) (dominio.PedidoDetalhe, error) {
	p, err := q.BuscarPedido(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return dominio.PedidoDetalhe{}, dominio.ErrPedidoNaoEncontrado
	}
	if err != nil {
		return dominio.PedidoDetalhe{}, err
	}
	d := dominio.PedidoDetalhe{ID: p.ID, Status: p.Status, Total: dinheiro(p.Total), CriadoEm: p.CriadoEm,
		Cliente: p.Cliente, Cidade: p.Cidade, Uf: p.Uf, Itens: []dominio.ItemDoPedido{}, Pagamentos: []dominio.Pagamento{}}
	itens, err := q.ListarItensDoPedido(ctx, id)
	if err != nil {
		return d, err
	}
	for _, it := range itens {
		d.Itens = append(d.Itens, dominio.ItemDoPedido{Numero: it.Numero, SkuID: it.SkuID, Descricao: it.Descricao,
			Quantidade: it.Quantidade, PrecoUnitario: dinheiro(it.PrecoUnitario), Subtotal: dinheiro(it.Subtotal)})
	}
	pags, err := q.ListarPagamentosDoPedido(ctx, id)
	for _, pg := range pags {
		d.Pagamentos = append(d.Pagamentos, dominio.Pagamento{ID: pg.ID, Metodo: pg.Metodo, Valor: dinheiro(pg.Valor),
			Status: pg.Status, CriadoEm: pg.CriadoEm})
	}
	return d, err
}
