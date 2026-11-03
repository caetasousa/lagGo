package aplicacao

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// ErrCarrinhoVazio: finalizar sem itens.
var ErrCarrinhoVazio = dominio.ErrValidacao{Msg: "carrinho vazio"}

// Carrinho são os casos de uso do carrinho. Ele guarda só a intenção de
// compra; preço e estoque vêm das Ofertas na hora de mostrar.
type Carrinho struct {
	carrinhos portas.Carrinhos
	ofertas   portas.Ofertas
	pedidos   portas.Pedidos
	efeitos   portas.EfeitosDoPedido
	checkout  *Checkout
}

func NovoCarrinho(carrinhos portas.Carrinhos, ofertas portas.Ofertas, pedidos portas.Pedidos,
	efeitos portas.EfeitosDoPedido, checkout *Checkout) *Carrinho {
	return &Carrinho{carrinhos: carrinhos, ofertas: ofertas, pedidos: pedidos, efeitos: efeitos, checkout: checkout}
}

func (c *Carrinho) Ver(ctx context.Context, sessao uuid.UUID) (dominio.Carrinho, error) {
	r := dominio.Carrinho{Itens: []dominio.ItemCarrinho{}}
	qtd, validade, err := c.carrinhos.Ler(ctx, sessao)
	if err != nil {
		return r, err
	}
	r.TTLSegundos = int64(validade / time.Second)
	if validade < 0 {
		r.TTLSegundos = int64(validade) // -2 (não existe) ou -1 (sem validade)
	}
	if len(qtd) == 0 {
		return r, nil
	}
	ids := make([]uuid.UUID, 0, len(qtd))
	for id := range qtd {
		ids = append(ids, id)
	}
	// Preço e estoque VIGENTES: o carrinho só guarda a intenção.
	ofertas, err := c.ofertas.DosSkus(ctx, ids)
	if err != nil {
		return r, err
	}
	for _, o := range ofertas {
		r.Itens = append(r.Itens, dominio.ItemCarrinho{Oferta: o, Quantidade: qtd[o.ID]})
	}
	return r, nil
}

// DefinirItem põe a quantidade de um SKU (0 remove) e devolve o carrinho.
func (c *Carrinho) DefinirItem(ctx context.Context, sessao, sku uuid.UUID, quantidade int) (dominio.Carrinho, error) {
	if err := dominio.ValidarQuantidade(quantidade); err != nil {
		return dominio.Carrinho{}, err
	}
	if quantidade > 0 {
		o, err := c.ofertas.DosSkus(ctx, []uuid.UUID{sku})
		if err != nil {
			return dominio.Carrinho{}, err
		}
		if len(o) == 0 || !o[0].Ativo {
			return dominio.Carrinho{}, dominio.ErrSkuInvalido
		}
	}
	if err := c.carrinhos.Definir(ctx, sessao, sku, quantidade, dominio.ValidadeDoCarrinho); err != nil {
		return dominio.Carrinho{}, err
	}
	return c.Ver(ctx, sessao)
}

func (c *Carrinho) Esvaziar(ctx context.Context, sessao uuid.UUID) error {
	return c.carrinhos.Esvaziar(ctx, sessao)
}

// Finalizar transforma o carrinho num pedido. Os itens vêm do carrinho; o
// pedido é gravado no PostgreSQL; SÓ DEPOIS do COMMIT vêm os efeitos no Redis.
func (c *Carrinho) Finalizar(ctx context.Context, sessao uuid.UUID, p dominio.Pedido) (dominio.Resultado, error) {
	if len(p.Itens) > 0 {
		return dominio.Resultado{}, dominio.ErrValidacao{Msg: "os itens vêm do carrinho, não do corpo da requisição"}
	}
	qtd, _, err := c.carrinhos.Ler(ctx, sessao)
	if err != nil {
		return dominio.Resultado{}, err
	}
	for id, n := range qtd {
		p.Itens = append(p.Itens, dominio.Item{SkuID: id, Quantidade: n})
	}
	if len(p.Itens) == 0 {
		// Carrinho vazio. Se a MESMA Idempotency-Key já gerou um pedido (o
		// primeiro envio esvaziou o carrinho), devolve esse pedido.
		if p.Chave != nil {
			if r, err := c.pedidos.PorChave(ctx, *p.Chave); err == nil {
				r.Tentativas, r.Reaproveitado = 1, true
				return r, nil
			} else if !errors.Is(err, dominio.ErrPedidoNaoEncontrado) {
				return dominio.Resultado{}, err
			}
		}
		return dominio.Resultado{}, ErrCarrinhoVazio
	}

	res, err := c.checkout.Finalizar(ctx, p, dominio.Opcoes{})
	if err != nil {
		return res, err
	}
	if res.Reaproveitado {
		err = c.efeitos.Reaproveitado(ctx, sessao)
	} else {
		err = c.efeitos.Confirmado(ctx, sessao, res, p.Itens)
	}
	if err != nil {
		// Não há transação entre bancos: o pedido está gravado e vale.
		slog.Warn("pedido gravado, mas os efeitos no Redis falharam", "pedido", res.PedidoID, "err", err)
	}
	return res, nil
}
