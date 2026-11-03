package aplicacao

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/laboratorio/portas"
)

// ------------------------------------------------------------ conexões

// Conexoes: o Laboratório de Conexões e PgBouncer. A aplicação põe N clientes
// para repetir a mesma consulta curta por S segundos e mede; a porta sabe
// abrir a conexão de cada jeito.
type Conexoes struct {
	pg portas.Conexoes
	mu sync.Mutex // um experimento por vez: as medidas não se misturam
}

func NovasConexoes(pg portas.Conexoes) *Conexoes { return &Conexoes{pg: pg} }

func (c *Conexoes) Rodar(ctx context.Context, modo string, clientes, segundos int) (dominio.ResultadoConexoes, error) {
	r := dominio.ResultadoConexoes{Modo: modo, Clientes: clientes, Segundos: segundos}
	if err := dominio.ValidarConexoes(modo, clientes, segundos); err != nil {
		return r, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	r.MaxConnections, _ = c.pg.MaxConnections(ctx)
	op, fechar, err := c.pg.Preparar(ctx, modo)
	if err != nil {
		return r, err
	}
	defer fechar()

	ctxRun, cancel := context.WithTimeout(ctx, time.Duration(segundos)*time.Second)
	defer cancel()

	// Monitor: o pico de processos do experimento no PostgreSQL, a cada 100 ms.
	monitorFim := make(chan struct{})
	go func() {
		defer close(monitorFim)
		t := time.NewTicker(100 * time.Millisecond)
		defer t.Stop()
		for {
			if n, err := c.pg.ProcessosDoExperimento(context.Background(), modo); err == nil && n > r.MaxConexoesPG {
				r.MaxConexoesPG = n
			}
			select {
			case <-ctxRun.Done():
				return
			case <-t.C:
			}
		}
	}()

	var (
		mu  sync.Mutex
		lat []time.Duration
		wg  sync.WaitGroup
	)
	for range clientes {
		wg.Go(func() {
			for ctxRun.Err() == nil {
				inicio := time.Now()
				err := op(ctxRun)
				d := time.Since(inicio)
				mu.Lock()
				switch {
				case err == nil:
					lat = append(lat, d)
				case ctxRun.Err() == nil: // erro de verdade, não o fim do tempo
					r.Erros++
					if r.PrimeiroErro == "" {
						r.PrimeiroErro = c.pg.Mensagem(err)
					}
				}
				mu.Unlock()
				if err != nil {
					time.Sleep(50 * time.Millisecond)
				}
			}
		})
	}
	wg.Wait()
	<-monitorFim

	r.Operacoes = len(lat)
	r.OpsPorSegundo = float64(len(lat)) / float64(segundos)
	slices.Sort(lat)
	r.P50MS, r.P95MS = dominio.Percentil(lat, 0.50), dominio.Percentil(lat, 0.95)
	return r, nil
}

// ------------------------------------------------------------ replicação

// Replicacao: o Laboratório de Replicação. Para cada transação: grava no
// primário com o synchronous_commit pedido e procura a linha na réplica logo
// depois do COMMIT — o que um usuário veria se a próxima tela lesse da réplica.
// EsperaPorLinha: quanto se espera UMA linha aparecer na réplica antes de
// contá-la como "não apareceu". OrcamentoDeEspera: o total de espera da
// rodada inteira (com a réplica muito atrasada, as últimas nem esperam).
const (
	EsperaPorLinha    = 2 * time.Second
	OrcamentoDeEspera = 15 * time.Second
)

type Replicacao struct {
	rep portas.Replicacao
	mu  sync.Mutex
}

func NovaReplicacao(rep portas.Replicacao) *Replicacao { return &Replicacao{rep: rep} }

func (l *Replicacao) Rodar(ctx context.Context, modo string, transacoes int, comCarga bool) (dominio.ResultadoReplicacao, error) {
	r := dominio.ResultadoReplicacao{Modo: modo, Transacoes: transacoes, ComCarga: comCarga}
	if err := dominio.ValidarReplicacao(modo, transacoes); err != nil {
		return r, err
	}
	if !l.rep.Configurada() {
		return r, dominio.ErrValidacao{Msg: "sem réplica configurada (POSTGRES_REPLICA_URL)"}
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	// Guarda do cenário S6: sem a réplica conectada como síncrona, um COMMIT
	// com remote_write/on/remote_apply esperaria por ela PARA SEMPRE.
	var err error
	if r.EstadoReplica, err = l.rep.EstadoDaReplica(ctx); err != nil {
		return r, err
	}
	if slices.Contains(dominio.ModosQueEsperam, modo) && !strings.HasPrefix(r.EstadoReplica, "streaming / sync") {
		return r, dominio.ErrValidacao{Msg: "a réplica não está conectada como síncrona (" + r.EstadoReplica +
			"): com " + modo + " o COMMIT esperaria por ela para sempre. Confira o serviço postgres-replica."}
	}

	// Carga opcional: outra conexão gerando muito WAL ao mesmo tempo. Com a
	// réplica ocupada aplicando esse volume, o "às vezes" dos modos que não
	// esperam vira "quase nunca".
	// defer roda na ordem inversa: para a carga, espera a goroutine dela e só
	// então limpa — mesmo num retorno antecipado ou com a requisição cancelada.
	rodada := uuid.New()
	defer func() { _ = l.rep.Limpar(context.WithoutCancel(ctx), rodada) }()
	ctxCarga, pararCarga := context.WithCancel(ctx)
	var carga sync.WaitGroup
	defer carga.Wait()
	defer pararCarga()
	if comCarga {
		carga.Go(func() {
			for ctxCarga.Err() == nil {
				_ = l.rep.Carga(ctxCarga)
			}
		})
	}

	var commits, ateAparecer []time.Duration
	var esperado time.Duration // soma das esperas pela réplica nesta rodada
	for i := 0; i < transacoes; i++ {
		id, dur, err := l.rep.Gravar(ctx, rodada, modo)
		if err != nil {
			return r, err
		}
		commits = append(commits, dur)

		inicio := time.Now()
		visivel, err := l.rep.NaReplica(ctx, id)
		if err != nil {
			return r, err
		}
		if visivel {
			r.VisiveisNaHora++
			continue
		}
		// Espera a linha aparecer, até EsperaPorLinha — e só enquanto houver
		// orçamento: a rodada inteira nunca passa muito de OrcamentoDeEspera,
		// longe do corte de 60 s do servidor (cenário S7).
		prazo := min(EsperaPorLinha, OrcamentoDeEspera-esperado)
		for !visivel && time.Since(inicio) < prazo {
			time.Sleep(time.Millisecond)
			if visivel, err = l.rep.NaReplica(ctx, id); err != nil {
				return r, err
			}
		}
		esperado += time.Since(inicio)
		if visivel {
			ateAparecer = append(ateAparecer, time.Since(inicio))
		} else {
			r.NaoApareceram++
		}
		// Nem a primeira linha chegou: a réplica não está aplicando nada.
		// Medir o resto seria só esperar à toa — melhor dizer o que fazer.
		if i == 0 && !visivel {
			return r, dominio.ErrValidacao{Msg: "a réplica não aplicou a linha gravada nem depois de " + EsperaPorLinha.String() +
				": ela está parada ou desconectada (estado visto no primário: " + r.EstadoReplica + "). " +
				"Reinicie o serviço postgres-replica (docker compose restart postgres-replica) e confira em Painel do DBA → Replicação."}
		}
		if i%10 == 0 {
			if b, err := l.rep.AtrasoEmBytes(ctx); err == nil {
				r.AtrasoMaxBytes = max(r.AtrasoMaxBytes, b)
			}
		}
	}
	pararCarga()
	carga.Wait()

	slices.Sort(commits)
	slices.Sort(ateAparecer)
	r.CommitP50MS, r.CommitP95MS = dominio.Percentil(commits, 0.50), dominio.Percentil(commits, 0.95)
	r.AteAparecerP50 = dominio.Percentil(ateAparecer, 0.50)
	if len(ateAparecer) > 0 {
		r.AteAparecerMax = dominio.Percentil(ateAparecer, 1)
	}
	return r, nil
}

// ------------------------------------------------------------ cache

// Cache: o Laboratório de Cache. O mesmo documento lido N vezes direto do
// banco e N vezes pelo cache-aside, começando com o cache vazio.
type Cache struct{ c portas.CatalogoParaCache }

func NovoCache(c portas.CatalogoParaCache) *Cache { return &Cache{c: c} }

func (l *Cache) Rodar(ctx context.Context, leituras int) (dominio.ResultadoLabCache, error) {
	if err := dominio.ValidarLeituras(leituras); err != nil {
		return dominio.ResultadoLabCache{}, err
	}
	id, nome, err := l.c.PrimeiroProduto(ctx)
	if err != nil {
		return dominio.ResultadoLabCache{}, err
	}
	r := dominio.ResultadoLabCache{Produto: nome}

	// 1. Sem cache: toda leitura vai ao banco.
	var lat []time.Duration
	for range leituras {
		t := time.Now()
		if _, err := l.c.LerDoBanco(ctx, id); err != nil {
			return r, err
		}
		lat = append(lat, time.Since(t))
	}
	r.SemCache = dominio.Medir(lat)

	// 2. Cache-aside, começando frio: a primeira é falha, as demais acertos.
	if err := l.c.ApagarDoCache(ctx, id); err != nil {
		return r, err
	}
	lat = lat[:0]
	for range leituras {
		t := time.Now()
		_, achou, err := l.c.LerDoCache(ctx, id)
		if err != nil {
			return r, err
		}
		if achou {
			r.Acertos++
		} else {
			r.Falhas++
			doc, err := l.c.LerDoBanco(ctx, id)
			if err != nil {
				return r, err
			}
			if err := l.c.GravarNoCache(ctx, id, doc); err != nil {
				return r, err
			}
		}
		lat = append(lat, time.Since(t))
	}
	r.ComCache = dominio.Medir(lat)
	var ttl time.Duration
	r.BytesNoRedis, ttl = l.c.NoCache(ctx, id)
	r.TTLSegundos = int64(ttl / time.Second)
	return r, nil
}
