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
	"log/slog"
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
	grafo   portas.Grafo // opcional (Fase 7): nil = não alimenta o grafo
}

func NovoCheckout(pedidos portas.Pedidos) *Checkout {
	return &Checkout{pedidos: pedidos}
}

// ComGrafo: o mesmo checkout, mas que depois do COMMIT soma a compra ao grafo
// de recomendações. A loja usa este; o Laboratório de Concorrência usa o sem
// grafo, para o tempo da corrida medir só o PostgreSQL.
func (c *Checkout) ComGrafo(g portas.Grafo) *Checkout {
	return &Checkout{pedidos: c.pedidos, grafo: g}
}

// alimentarGrafo: efeito DEPOIS do COMMIT. Não há transação entre o
// PostgreSQL e o Neo4j: se o grafo falhar, a compra continua valendo (Y4) —
// e a próxima reconstrução do grafo, a partir dos pedidos, a recupera.
func (c *Checkout) alimentarGrafo(ctx context.Context, p dominio.Pedido, itens []dominio.Item) {
	if c.grafo == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := c.grafo.Registrar(ctx, []dominio.Compra{{ClienteID: p.ClienteID, Itens: itens}}); err != nil {
		slog.Warn("compra não entrou no grafo (será recuperada na reconstrução)", "err", err)
	}
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
			c.alimentarGrafo(ctx, p, itens)
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
