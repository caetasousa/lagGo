package aplicacao

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/laboratorio/portas"
)

// HA é o Laboratório de Alta Disponibilidade. O ensaio é o mesmo nos três
// clusters: um escritor grava a cada 100 ms; depois de 3 s o laboratório
// derruba o líder (ou pede uma troca planejada) e o escritor segue gravando
// até o cluster voltar. Mede quanto tempo a escrita ficou fora (RTO) e
// quantas escritas CONFIRMADAS sumiram (RPO).
type HA struct {
	clusters map[string]portas.ClusterHA
	mu       sync.Mutex
	ensaio   *ensaio // o atual ou o último
}

// ensaio: o dominio.Ensaio mais o que só o laço precisa.
type ensaio struct {
	*dominio.Ensaio
	inicio      time.Time
	confirmadas []int
	sucessos    []float64
}

func NovoHA(patroni, mongo, redis portas.ClusterHA) *HA {
	return &HA{clusters: map[string]portas.ClusterHA{"patroni": patroni, "mongo": mongo, "redis": redis}}
}

// Estado dos três clusters (em paralelo: um fora do ar não atrasa os outros).
func (l *HA) Estado(ctx context.Context) map[string]dominio.EstadoCluster {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	r := make(map[string]dominio.EstadoCluster, len(dominio.Tecnologias))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, nome := range dominio.Tecnologias {
		wg.Go(func() {
			e := l.clusters[nome].Estado(ctx)
			e.Tecnologia = nome
			if !e.Disponivel && e.Erro == "" {
				e.Erro = "fora do ar"
			}
			mu.Lock()
			r[nome] = e
			mu.Unlock()
		})
	}
	wg.Wait()
	return r
}

// Ensaio devolve uma cópia do ensaio atual (ou do último).
func (l *HA) Ensaio() *dominio.Ensaio {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.ensaio == nil {
		return nil
	}
	c := *l.ensaio.Ensaio
	c.Pontos = slices.Clone(l.ensaio.Pontos)
	c.Eventos = slices.Clone(l.ensaio.Eventos)
	return &c
}

// Iniciar dispara um ensaio em segundo plano (ele dura até ~1 min; a tela
// acompanha pelo GET). Um de cada vez.
func (l *HA) Iniciar(ctx context.Context, tecnologia, acao string, garantia bool) (*dominio.Ensaio, error) {
	c, ok := l.clusters[tecnologia]
	if !ok {
		return nil, dominio.ErrValidacao{Msg: "tecnologia deve ser patroni, mongo ou redis"}
	}
	if acao != "queda" && acao != "planejada" {
		return nil, dominio.ErrValidacao{Msg: "ação deve ser queda ou planejada"}
	}
	est := c.Estado(ctx)
	if !est.Disponivel {
		return nil, dominio.ErrValidacao{Msg: "o cluster " + tecnologia + " não está no ar (" + est.Erro + "). Suba os clusters de laboratório com: make up-ha"}
	}
	if est.Lider == "" {
		return nil, dominio.ErrValidacao{Msg: "o cluster " + tecnologia + " está sem líder agora (talvez no meio de uma eleição). Espere alguns segundos."}
	}
	l.mu.Lock()
	if l.ensaio != nil && l.ensaio.Rodando {
		l.mu.Unlock()
		return nil, dominio.ErrValidacao{Msg: "já há um ensaio rodando (" + l.ensaio.Tecnologia + ")"}
	}
	e := &ensaio{Ensaio: &dominio.Ensaio{Tecnologia: tecnologia, Acao: acao, Garantia: garantia, Rodando: true,
		Fase: "preparando", LiderAntes: est.Lider}, inicio: time.Now()}
	l.ensaio = e
	l.mu.Unlock()

	// O ensaio sobrevive ao fim da requisição que o disparou.
	go l.rodar(context.WithoutCancel(ctx), c, e)
	return l.Ensaio(), nil
}

func (l *HA) mudar(e *ensaio, f func()) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f()
}

func (l *HA) evento(e *ensaio, texto string) {
	l.mudar(e, func() { e.Eventos = append(e.Eventos, dominio.Evento{T: time.Since(e.inicio).Seconds(), Texto: texto}) })
}

const (
	intervalo    = 100 * time.Millisecond
	antesDaAcao  = 3 * time.Second
	limiteEnsaio = 75 * time.Second
)

func (l *HA) rodar(ctx context.Context, c portas.ClusterHA, e *ensaio) {
	defer l.mudar(e, func() { e.Rodando = false; e.Fase = "fim" })
	rodada := uuid.New()
	falhar := func(err error) {
		slog.Error("ensaio de alta disponibilidade", "tecnologia", e.Tecnologia, "err", err)
		l.mudar(e, func() { e.Erro = err.Error() })
	}
	txt, err := c.Preparar(ctx, rodada, e.Garantia)
	if err != nil {
		falhar(err)
		return
	}
	l.mudar(e, func() { e.Fase = "escrevendo"; e.inicio = time.Now() })
	if txt != "" {
		l.evento(e, txt)
	}
	l.evento(e, "escritor começou: uma escrita a cada 100 ms (líder: "+e.LiderAntes+")")

	acionado := false
	var tAcao float64
	sucessosDepois := 0
	for n := 1; ; n++ {
		proxima := time.Now().Add(intervalo)
		t := time.Since(e.inicio).Seconds()
		if t > limiteEnsaio.Seconds() {
			l.evento(e, "limite de 75 s: o cluster não voltou a aceitar escrita")
			break
		}
		ctxE, cancel := context.WithTimeout(ctx, time.Second)
		err := c.Escrever(ctxE, rodada, n, e.Garantia)
		cancel()
		l.mudar(e, func() {
			e.Tentativas++
			b := int(t * 2) // balde de 0,5 s
			for len(e.Pontos) <= b {
				e.Pontos = append(e.Pontos, dominio.Ponto{T: float64(len(e.Pontos)) / 2})
			}
			if err == nil {
				e.Pontos[b].OK++
				e.Confirmadas++
				e.confirmadas = append(e.confirmadas, n)
				e.sucessos = append(e.sucessos, t)
			} else {
				e.Pontos[b].Falha++
			}
		})

		if !acionado && t >= antesDaAcao.Seconds() {
			acionado, tAcao = true, t
			l.mudar(e, func() { e.AcaoEm = t; e.Fase = "derrubando o líder" })
			go func() {
				var txt string
				var err error
				if e.Acao == "queda" {
					txt, err = c.Derrubar(ctx, e.LiderAntes)
				} else {
					txt, err = c.Planejada(ctx, e.LiderAntes)
				}
				if err != nil {
					l.evento(e, "a ação falhou: "+err.Error())
					return
				}
				l.evento(e, txt)
				l.mudar(e, func() { e.Fase = "esperando o cluster voltar" })
			}()
		}
		if acionado {
			if err == nil {
				sucessosDepois++
			} else {
				if !l.temEvento(e, "primeira escrita recusada") {
					l.evento(e, "primeira escrita recusada: "+resumir(err))
				}
				sucessosDepois = 0
			}
			// Acabou: 2 s seguidos de sucesso, ao menos 5 s depois da ação.
			if sucessosDepois >= 20 && t-tAcao > 5 {
				break
			}
		}
		time.Sleep(time.Until(proxima))
	}

	l.mudar(e, func() { e.Fase = "conferindo"; e.ForaMS = dominio.MaiorIntervalo(e.sucessos, tAcao) * 1000 })
	// Quem é o líder agora? (pode levar alguns segundos para o estado assentar)
	for i := 0; i < 20; i++ {
		est := c.Estado(ctx)
		if est.Lider != "" && (est.Lider != e.LiderAntes || e.Acao == "queda") {
			l.mudar(e, func() { e.LiderDepois = est.Lider })
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	l.evento(e, "líder agora: "+e.LiderDepois)
	l.mu.Lock()
	confirmadas := slices.Clone(e.confirmadas)
	l.mu.Unlock()
	presentes, err := c.Conferir(ctx, rodada, confirmadas)
	if err != nil {
		falhar(err)
		return
	}
	l.mudar(e, func() { e.Perdidas = len(confirmadas) - presentes })
	l.evento(e, "conferência: das "+strconv.Itoa(len(confirmadas))+" escritas confirmadas, "+strconv.Itoa(presentes)+" estão no novo líder")
}

func (l *HA) temEvento(e *ensaio, prefixo string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.ContainsFunc(e.Eventos, func(ev dominio.Evento) bool { return strings.HasPrefix(ev.Texto, prefixo) })
}

func resumir(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "sem resposta em 1 s"
	}
	s := err.Error()
	if len(s) > 120 {
		s = s[:120] + "…"
	}
	return s
}
