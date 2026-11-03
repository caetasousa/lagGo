package aplicacao

import (
	"context"
	"time"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/laboratorio/portas"
)

// Roteiros do banco: o experimento é o próprio SQL (no adaptador). O caso de
// uso valida o pedido e delega.

type Isolamento struct{ p portas.Isolamento }

func NovoIsolamento(p portas.Isolamento) *Isolamento { return &Isolamento{p: p} }

func (a *Isolamento) Roteiros() []dominio.Roteiro { return a.p.Roteiros() }

func (a *Isolamento) Rodar(ctx context.Context, roteiro, nivel string) (dominio.ResultadoIsolamento, error) {
	if _, ok := dominio.NiveisDeIsolamento[nivel]; !ok {
		return dominio.ResultadoIsolamento{}, dominio.ErrValidacao{Msg: "roteiro ou nível de isolamento desconhecido"}
	}
	return a.p.Rodar(ctx, roteiro, nivel)
}

type MVCC struct{ p portas.MVCC }

func NovoMVCC(p portas.MVCC) *MVCC { return &MVCC{p: p} }

func (a *MVCC) Estado(ctx context.Context) (dominio.EstadoMVCC, error) { return a.p.Estado(ctx) }

func (a *MVCC) Executar(ctx context.Context, acao string, fillfactor int) (dominio.ResultadoMVCC, error) {
	if err := dominio.ValidarAcaoMVCC(acao, fillfactor); err != nil {
		return dominio.ResultadoMVCC{Acao: acao}, err
	}
	return a.p.Executar(ctx, acao, fillfactor)
}

type Expurgo struct{ p portas.Expurgo }

func NovoExpurgo(p portas.Expurgo) *Expurgo { return &Expurgo{p: p} }

func (a *Expurgo) Expurgar(ctx context.Context, metodo string, linhas int) (dominio.ResultadoExpurgo, error) {
	if err := dominio.ValidarExpurgo(metodo, linhas); err != nil {
		return dominio.ResultadoExpurgo{}, err
	}
	return a.p.Expurgar(ctx, metodo, linhas)
}

type Backup struct{ p portas.Backup }

func NovoBackup(p portas.Backup) *Backup { return &Backup{p: p} }

func (a *Backup) Info(ctx context.Context) (dominio.InfoBackup, error) { return a.p.Info(ctx) }

func (a *Backup) Fazer(ctx context.Context, tipo string) (dominio.ResultadoBackup, error) {
	if err := dominio.ValidarTipoDeBackup(tipo); err != nil {
		return dominio.ResultadoBackup{Tipo: tipo}, err
	}
	return a.p.Fazer(ctx, tipo)
}

func (a *Backup) PITR(ctx context.Context, alvo string) (dominio.ResultadoPITR, error) {
	esperadas, err := dominio.LinhasEsperadasNoAlvo(alvo)
	if err != nil {
		return dominio.ResultadoPITR{Alvo: alvo}, err
	}
	return a.p.PITR(ctx, alvo, esperadas)
}

type Indices struct{ p portas.Indices }

func NovosIndices(p portas.Indices) *Indices { return &Indices{p: p} }

func (a *Indices) Experimentos(ctx context.Context) ([]dominio.ExperimentoComEstado, error) {
	return a.p.Experimentos(ctx)
}

func (a *Indices) Explain(ctx context.Context, id, workMem string, ajustes map[string]string) (dominio.ResultadoExplain, error) {
	if err := dominio.ValidarAjustes(workMem, ajustes); err != nil {
		return dominio.ResultadoExplain{}, err
	}
	r, err := a.p.Explain(ctx, id, workMem, ajustes)
	if err == nil {
		r.LerPlano()
	}
	return r, err
}

func (a *Indices) Criar(ctx context.Context, nome string) (time.Duration, error) {
	return a.p.Criar(ctx, nome)
}
func (a *Indices) Remover(ctx context.Context, nome string) error { return a.p.Remover(ctx, nome) }
