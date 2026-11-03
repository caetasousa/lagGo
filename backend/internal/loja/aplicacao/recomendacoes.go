package aplicacao

import (
	"cmp"
	"context"
	"log/slog"
	"slices"
	"time"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// Fase 7: "vistos recentemente" (Cassandra) e "quem comprou também comprou"
// (Neo4j). Os dois são efeitos secundários: se o banco deles estiver fora,
// a loja segue (cenários X4, Y4).

// Historico: os produtos que o cliente abriu.
type Historico struct{ vistos portas.Vistos }

func NovoHistorico(v portas.Vistos) *Historico { return &Historico{vistos: v} }

// Registrar nunca falha para quem chamou: o evento é secundário à página.
func (h *Historico) Registrar(ctx context.Context, c dominio.Conta, produtoID, nome string) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	v := dominio.Visto{ProdutoID: produtoID, Nome: nome, Em: time.Now().UTC().Truncate(time.Millisecond)}
	if err := h.vistos.Registrar(ctx, c.ClienteID, v, dominio.RetencaoDosVistos); err != nil {
		slog.Warn("evento de visualização não gravado (Cassandra)", "err", err)
	}
}

// Recentes: os últimos produtos DISTINTOS. A tabela guarda cada visita; a
// deduplicação é aqui — lê-se um pouco a mais para sobrar 8 distintos.
func (h *Historico) Recentes(ctx context.Context, c dominio.Conta) ([]dominio.Visto, error) {
	ev, err := h.vistos.Recentes(ctx, c.ClienteID, 6*dominio.VistosNaVitrine)
	if err != nil {
		return nil, err
	}
	return dominio.Distintos(ev, dominio.VistosNaVitrine), nil
}

// Recomendacoes: o grafo de compras e a sua reconstrução.
type Recomendacoes struct {
	grafo     portas.Grafo
	catalogo  portas.Catalogo
	historico portas.HistoricoDeCompras
}

func NovasRecomendacoes(g portas.Grafo, c portas.Catalogo, h portas.HistoricoDeCompras) *Recomendacoes {
	return &Recomendacoes{grafo: g, catalogo: c, historico: h}
}

// RecomendacoesPorPagina: quantos produtos a página do produto sugere.
const RecomendacoesPorPagina = 4

// ParaProduto: quem comprou algum SKU deste produto também comprou… O grafo
// responde por SKU; aqui os SKUs viram produtos (MongoDB), o próprio produto
// sai da lista (Y2) e a força de um produto é a do seu SKU mais forte.
func (r *Recomendacoes) ParaProduto(ctx context.Context, p dominio.Produto) ([]dominio.Recomendacao, error) {
	skus := make([]string, len(p.Skus))
	for i, s := range p.Skus {
		skus[i] = s.SkuID
	}
	co, err := r.grafo.TambemCompraram(ctx, skus, 40)
	if err != nil || len(co) == 0 {
		return []dominio.Recomendacao{}, err
	}
	ids := make([]string, len(co))
	for i, c := range co {
		ids[i] = c.SkuID
	}
	produtos, err := r.catalogo.ProdutosDosSkus(ctx, ids)
	if err != nil {
		return nil, err
	}
	porProduto := map[string]dominio.Recomendacao{}
	for _, c := range co {
		pr, ok := produtos[c.SkuID]
		if !ok || pr.ProdutoID == p.ID {
			continue
		}
		if atual, ja := porProduto[pr.ProdutoID]; !ja || c.Forca > atual.Forca {
			porProduto[pr.ProdutoID] = dominio.Recomendacao{ProdutoID: pr.ProdutoID, Nome: pr.Nome, Preco: pr.Preco, Forca: c.Forca}
		}
	}
	out := make([]dominio.Recomendacao, 0, len(porProduto))
	for _, rec := range porProduto {
		out = append(out, rec)
	}
	slices.SortFunc(out, func(a, b dominio.Recomendacao) int {
		return cmp.Or(cmp.Compare(b.Forca, a.Forca), cmp.Compare(a.Nome, b.Nome))
	})
	return out[:min(len(out), RecomendacoesPorPagina)], nil
}

// Reconstruir apaga o grafo e o refaz a partir dos pedidos — dado derivado
// se reconstrói da fonte (Y1). Em lotes, para caber na memória do Neo4j.
func (r *Recomendacoes) Reconstruir(ctx context.Context) (dominio.EstadoDoGrafo, error) {
	inicio := time.Now()
	if err := r.grafo.Limpar(ctx); err != nil {
		return dominio.EstadoDoGrafo{}, err
	}
	lidas, err := r.historico.Percorrer(ctx, 2000, func(lote []dominio.Compra) error {
		return r.grafo.Registrar(ctx, lote)
	})
	if err != nil {
		return dominio.EstadoDoGrafo{}, err
	}
	e, err := r.grafo.Estado(ctx)
	e.DuracaoMS, e.LidasDoPG = time.Since(inicio).Milliseconds(), lidas
	return e, err
}

func (r *Recomendacoes) Estado(ctx context.Context) (dominio.EstadoDoGrafo, error) {
	return r.grafo.Estado(ctx)
}
