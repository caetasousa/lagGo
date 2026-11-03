package aplicacao

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// Catalogo são os casos de uso do catálogo: buscar, ver, avaliar, mais vendidos.
type Catalogo struct {
	catalogo portas.Catalogo
	cache    portas.CacheDeProdutos
	ofertas  portas.Ofertas
	clientes portas.Clientes
	ranking  portas.Ranking
}

func NovoCatalogo(catalogo portas.Catalogo, cache portas.CacheDeProdutos, ofertas portas.Ofertas,
	clientes portas.Clientes, ranking portas.Ranking) *Catalogo {
	return &Catalogo{catalogo: catalogo, cache: cache, ofertas: ofertas, clientes: clientes, ranking: ranking}
}

func (c *Catalogo) Buscar(ctx context.Context, f dominio.FiltroBusca) (dominio.ResultadoBusca, error) {
	return c.catalogo.Buscar(ctx, f)
}

// Detalhe aplica o padrão CACHE-ASIDE: procura no cache; se faltar, lê o
// catálogo e guarda a cópia com validade. O banco não sabe que o cache
// existe. Preço e estoque NUNCA vêm do cache: as ofertas são lidas na hora.
func (c *Catalogo) Detalhe(ctx context.Context, id string) (dominio.Detalhe, error) {
	d := dominio.Detalhe{Cache: "hit"}
	p, achou, err := c.cache.Ler(ctx, id)
	if err != nil {
		// Cache fora do ar: segue sem ele em vez de falhar a página.
		slog.Warn("cache do produto indisponível", "id", id, "err", err)
	}
	if !achou {
		d.Cache = "miss"
		if p, err = c.catalogo.Produto(ctx, id); err != nil {
			return dominio.Detalhe{}, err
		}
		if err := c.cache.Gravar(ctx, id, p, dominio.TempoDeCache); err != nil {
			slog.Warn("não gravou o cache do produto", "id", id, "err", err)
		}
	}
	d.Produto = p

	ids := make([]uuid.UUID, 0, len(p.Skus))
	for _, s := range p.Skus {
		if u, err := uuid.Parse(s.SkuID); err == nil {
			ids = append(ids, u)
		}
	}
	if d.Ofertas, err = c.ofertas.DosSkus(ctx, ids); err != nil {
		return dominio.Detalhe{}, err
	}
	return d, nil
}

// Avaliar valida, confere que o cliente existe (integridade ENTRE bancos é
// trabalho da aplicação: não há FK do MongoDB para o PostgreSQL), grava e
// invalida a cópia em cache, que ficou velha.
func (c *Catalogo) Avaliar(ctx context.Context, produtoID string, a dominio.NovaAvaliacao) (dominio.ResultadoAvaliacao, error) {
	if err := a.Validar(); err != nil {
		return dominio.ResultadoAvaliacao{}, err
	}
	nome, err := c.clientes.Nome(ctx, a.ClienteID)
	if err != nil {
		return dominio.ResultadoAvaliacao{}, err
	}
	res, err := c.catalogo.Avaliar(ctx, dominio.Avaliacao{
		ProdutoID: produtoID, ClienteID: a.ClienteID, ClienteNome: dominio.NomePublico(nome),
		Nota: a.Nota, Texto: a.Texto, Em: time.Now().UTC().Truncate(time.Millisecond),
	})
	if err != nil {
		return res, err
	}
	// Apagar (e não atualizar) a cópia é o mais simples e seguro: a próxima
	// leitura repõe.
	_ = c.cache.Apagar(ctx, produtoID)
	return res, nil
}

// MaisVendidos: o placar (Redis) completado com o nome e o preço (MongoDB) —
// duas leituras por chave, em vez de somar os itens de pedido a cada visita.
func (c *Catalogo) MaisVendidos(ctx context.Context, limite int64) ([]dominio.MaisVendido, error) {
	top, err := c.ranking.Top(ctx, limite)
	if err != nil {
		return nil, err
	}
	skus := make([]string, len(top))
	for i, t := range top {
		skus[i] = t.SkuID
	}
	produtos, err := c.catalogo.ProdutosDosSkus(ctx, skus)
	if err != nil {
		return nil, err
	}
	out := make([]dominio.MaisVendido, 0, len(top))
	for _, t := range top {
		if p, ok := produtos[t.SkuID]; ok {
			out = append(out, dominio.MaisVendido{SkuID: t.SkuID, Vendidos: t.Vendidos, ProdutoID: p.ProdutoID, Nome: p.Nome, Preco: p.Preco})
		}
	}
	return out, nil
}
