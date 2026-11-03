// Package aplicacao do LABORATÓRIO: os experimentos. Onde há orquestração —
// goroutines que partem juntas, laços que medem tempo, o ensaio de failover —
// ela está aqui; o banco fica atrás das portas.
//
// Regra de dependência: só dominio e portas (e a biblioteca padrão).
package aplicacao

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/laboratorio/portas"
)

// Corrida: o Laboratório de Concorrência. N compradores tentam comprar 1
// unidade do mesmo SKU AO MESMO TEMPO, pelo checkout da loja, e o resultado é
// contado. É o experimento central da Fase 1 (docs/03).
type Corrida struct {
	estoque portas.EstoqueDoLaboratorio
	loja    portas.Loja
}

func NovaCorrida(estoque portas.EstoqueDoLaboratorio, loja portas.Loja) *Corrida {
	return &Corrida{estoque: estoque, loja: loja}
}

func (c *Corrida) Rodar(ctx context.Context, p dominio.CorridaParams) (dominio.CorridaResultado, error) {
	if p.SkuID == uuid.Nil {
		p.SkuID = dominio.SkuLaboratorio
	}
	var err error
	if p.Estrategia, err = c.loja.EstrategiaValida(p.Estrategia); err != nil {
		return dominio.CorridaResultado{}, err
	}
	if err := dominio.ValidarCorrida(p); err != nil {
		return dominio.CorridaResultado{}, err
	}
	if err := c.estoque.Redefinir(ctx, p.SkuID, p.EstoqueInicial); err != nil {
		return dominio.CorridaResultado{}, err
	}
	compradores, err := c.estoque.Compradores(ctx, p.Compradores)
	if err != nil {
		return dominio.CorridaResultado{}, err
	}
	if len(compradores) == 0 {
		return dominio.CorridaResultado{}, dominio.ErrValidacao{Msg: "nenhum cliente cadastrado — rode `make seed`"}
	}

	res := dominio.CorridaResultado{CorridaParams: p}
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		largada = make(chan struct{})
		atraso  = time.Duration(p.AtrasoMS) * time.Millisecond
	)
	for i := range p.Compradores {
		comprador := compradores[i%len(compradores)]
		wg.Go(func() {
			<-largada // todos partem juntos
			tentativas, err := c.loja.Comprar(ctx, comprador, p.SkuID, p.Estrategia, atraso)

			mu.Lock()
			defer mu.Unlock()
			if tentativas > 1 {
				res.Retentativas += tentativas - 1
			}
			switch {
			case err == nil:
				res.Vendidos++
			case errors.Is(err, dominio.ErrSemEstoque):
				res.SemEstoque++
			default:
				res.Erros++
				if res.PrimeiroErro == "" {
					res.PrimeiroErro = err.Error()
				}
			}
		})
	}

	inicio := time.Now()
	close(largada)
	wg.Wait()
	res.DuracaoMS = float64(time.Since(inicio).Microseconds()) / 1000

	if res.EstoqueFinal, err = c.estoque.Ler(ctx, p.SkuID); err != nil {
		return res, err
	}
	res.VendasAMais = max(0, res.Vendidos-int(p.EstoqueInicial))
	res.Consistente = res.EstoqueFinal == p.EstoqueInicial-int32(res.Vendidos)
	return res, nil
}
