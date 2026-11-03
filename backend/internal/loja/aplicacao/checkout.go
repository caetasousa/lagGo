// Package aplicacao são os CASOS DE USO da loja: finalizar uma compra, mexer
// no carrinho, ver um produto, avaliar, ler relatórios. Cada caso de uso
// orquestra o domínio e as portas — e não sabe qual banco está do outro lado.
//
// Regra de dependência: importa só dominio e portas (e a biblioteca padrão).
// Nada de pgx, mongo, redis, net/http. Confira em internal/app/arquitetura_test.go.
package aplicacao

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// MaxTentativas: quantas vezes uma compra abortada por concorrência é repetida.
const MaxTentativas = 5

// Checkout finaliza compras.
type Checkout struct {
	pedidos portas.Pedidos
}

func NovoCheckout(pedidos portas.Pedidos) *Checkout {
	return &Checkout{pedidos: pedidos}
}

// Finalizar valida o pedido e o grava (uma transação, no adaptador). Se o
// banco abortar por conflito de concorrência, a compra inteira é repetida —
// ele desfez tudo, então repetir é seguro. Se a Idempotency-Key já foi usada,
// devolve o pedido que ela criou.
func (c *Checkout) Finalizar(ctx context.Context, p dominio.Pedido, op dominio.Opcoes) (dominio.Resultado, error) {
	itens, err := dominio.Normalizar(p)
	if err != nil {
		return dominio.Resultado{}, err
	}
	if op.Estrategia, err = dominio.EstrategiaOuPadrao(op.Estrategia); err != nil {
		return dominio.Resultado{}, err
	}
	for tentativa := 1; ; tentativa++ {
		res, err := c.pedidos.Criar(ctx, p, itens, op)
		res.Tentativas = tentativa
		switch {
		case err == nil:
			return res, nil
		case errors.Is(err, dominio.ErrConflito) && tentativa < MaxTentativas:
			if err := esperar(ctx, backoff(tentativa)); err != nil {
				return res, err
			}
		case errors.Is(err, dominio.ErrChaveRepetida) && p.Chave != nil:
			existente, err := c.pedidos.PorChave(ctx, *p.Chave)
			existente.Tentativas, existente.Reaproveitado = tentativa, true
			return existente, err
		default:
			return res, err
		}
	}
}

// backoff exponencial com jitter: 10 ms, 20 ms, 40 ms… + aleatório. O jitter
// evita que as compras abortadas colidam de novo, em sincronia.
func backoff(tentativa int) time.Duration {
	base := 10 * time.Millisecond << (tentativa - 1)
	return base + rand.N(base)
}

func esperar(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
