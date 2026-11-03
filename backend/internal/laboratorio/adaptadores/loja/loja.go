// Package loja: a PONTE do laboratório para o contexto da loja. O Laboratório
// de Concorrência compra pelo checkout DE VERDADE da loja (o caso de uso
// aplicacao.Checkout, com as quatro estratégias), mas o laboratório não
// conhece os tipos da loja: este adaptador traduz de um lado para o outro
// (o que a literatura chama de camada anticorrupção). Implementa portas.Loja.
package loja

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	labdominio "github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	lojadominio "github.com/nosqlgo/marketplace/internal/loja/dominio"
)

type Loja struct{ checkout *aplicacao.Checkout }

func Nova(checkout *aplicacao.Checkout) *Loja { return &Loja{checkout: checkout} }

func (l *Loja) EstrategiaValida(e string) (string, error) {
	v, err := lojadominio.EstrategiaOuPadrao(lojadominio.Estrategia(e))
	var val lojadominio.ErrValidacao
	if errors.As(err, &val) {
		return e, labdominio.ErrValidacao{Msg: val.Msg}
	}
	return string(v), err
}

func (l *Loja) Comprar(ctx context.Context, c labdominio.Comprador, sku uuid.UUID, estrategia string, atraso time.Duration) (int, error) {
	r, err := l.checkout.Finalizar(ctx, lojadominio.Pedido{
		ClienteID: c.ClienteID, EnderecoID: c.EnderecoID, MetodoPagamento: "PIX",
		Itens: []lojadominio.Item{{SkuID: sku, Quantidade: 1}},
	}, lojadominio.Opcoes{Estrategia: lojadominio.Estrategia(estrategia), Atraso: atraso})
	if errors.Is(err, lojadominio.ErrSemEstoque) {
		return r.Tentativas, labdominio.ErrSemEstoque
	}
	return r.Tentativas, err
}
