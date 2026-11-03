package aplicacao

import (
	"context"
	"log/slog"
	"time"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// Vitrine e Relatorios são leituras: o caso de uso só repassa à porta. Ficam
// aqui mesmo assim para o adaptador HTTP nunca falar direto com um banco — a
// entrada da aplicação é sempre esta camada.

type Vitrine struct{ v portas.Vitrine }

func NovaVitrine(v portas.Vitrine) *Vitrine { return &Vitrine{v: v} }

func (a *Vitrine) Categorias(ctx context.Context) ([]dominio.Categoria, error) {
	return a.v.Categorias(ctx)
}

func (a *Vitrine) Skus(ctx context.Context, f dominio.FiltroSkus) ([]dominio.Sku, error) {
	return a.v.Skus(ctx, f)
}

type Relatorios struct{ r portas.Relatorios }

func NovosRelatorios(r portas.Relatorios) *Relatorios { return &Relatorios{r: r} }

func (a *Relatorios) VendasMensais(ctx context.Context, meses int32) ([]dominio.VendaMensal, dominio.Origem, error) {
	return a.r.VendasMensais(ctx, meses)
}

func (a *Relatorios) ReceitaDiaria(ctx context.Context, dias int32) ([]dominio.ReceitaDia, dominio.Origem, error) {
	return a.r.ReceitaDiaria(ctx, dias)
}

func (a *Relatorios) CurvaABC(ctx context.Context, dias int32) ([]dominio.ClasseABC, dominio.Origem, error) {
	return a.r.CurvaABC(ctx, dias)
}

func (a *Relatorios) StatusAtualizacao(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error) {
	return a.r.StatusAtualizacao(ctx)
}

func (a *Relatorios) Atualizar(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error) {
	return a.r.Atualizar(ctx)
}

// AtualizarPeriodicamente mantém o resumo "quase atual". O atraso aceitável
// (o intervalo) é decisão de negócio: relatório gerencial tolera minutos; o
// estoque da loja não tolera nada.
func (a *Relatorios) AtualizarPeriodicamente(ctx context.Context, intervalo time.Duration) {
	go func() {
		t := time.NewTicker(intervalo)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if _, _, err := a.r.Atualizar(ctx); err != nil {
					slog.Error("atualizar o resumo de vendas", "err", err)
				}
			}
		}
	}()
}
