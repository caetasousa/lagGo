package ha

import (
	"context"
	"errors"
	"net"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Redis com Sentinel: três sentinels vigiam o primário "principal". Se ele
// não responde por 5 s (down-after-milliseconds), cada sentinel o marca como
// fora; com o quórum (2) concordando, um sentinel eleito promove a réplica.
// O cliente pergunta aos sentinels quem é o primário (FailoverClient).
//
// A replicação do Redis é sempre assíncrona. A "garantia" aqui é o WAIT 1:
// depois de cada escrita, espera ao menos 1 réplica confirmar o recebimento —
// o mais perto de "síncrono" que o Redis oferece (e ainda sem garantia de disco).

const mestre = "principal"

type sentinel struct {
	enderecos []string
	cliente   *redis.Client
}

func NovoSentinel(enderecos []string) *sentinel {
	s := &sentinel{enderecos: enderecos}
	if len(enderecos) > 0 {
		s.cliente = redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName: mestre, SentinelAddrs: enderecos,
			DialTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second,
			MaxRetries: -1, // sem novas tentativas escondidas: o ensaio quer ver cada falha
		})
	}
	return s
}

func (s *sentinel) sentinela(ctx context.Context) (*redis.SentinelClient, error) {
	var ultimo error = errors.New("HA_REDIS_SENTINELS não configurada")
	for _, end := range s.enderecos {
		c := redis.NewSentinelClient(&redis.Options{Addr: end, DialTimeout: time.Second, ReadTimeout: time.Second})
		if ultimo = c.Ping(ctx).Err(); ultimo == nil {
			return c, nil
		}
		c.Close()
	}
	return nil, ultimo
}

func (s *sentinel) Estado(ctx context.Context) dominio.EstadoCluster {
	e := dominio.EstadoCluster{}
	sc, err := s.sentinela(ctx)
	if err != nil {
		e.Erro = foraDoAr(err)
		return e
	}
	defer sc.Close()
	m, err := sc.Master(ctx, mestre).Result()
	if err != nil {
		e.Erro = err.Error()
		return e
	}
	e.Disponivel = true
	e.Lider = net.JoinHostPort(m["ip"], m["port"])
	e.Membros = append(e.Membros, dominio.Membro{Nome: e.Lider, Papel: "primário", Estado: m["flags"]})
	reps, _ := sc.Replicas(ctx, mestre).Result()
	for _, r := range reps {
		e.Membros = append(e.Membros, dominio.Membro{Nome: net.JoinHostPort(r["ip"], r["port"]), Papel: "réplica", Estado: r["flags"] + " · link " + r["master-link-status"]})
	}
	ss, _ := sc.Sentinels(ctx, mestre).Result()
	e.Detalhe = "sentinels: " + strconv.Itoa(len(ss)+1) + " · quórum " + m["quorum"] + " · down-after = 5 s"
	return e
}

func chave(rodada uuid.UUID) string { return "ha:ensaio:" + rodada.String() }

func (s *sentinel) Preparar(ctx context.Context, rodada uuid.UUID, garantia bool) (string, error) {
	if s.cliente == nil {
		return "", errors.New("HA_REDIS_SENTINELS não configurada")
	}
	if garantia {
		return "WAIT 1: cada escrita só conta como confirmada quando 1 réplica a recebeu", nil
	}
	return "sem WAIT: o primário confirma sozinho (replicação assíncrona)", nil
}

func (s *sentinel) Escrever(ctx context.Context, rodada uuid.UUID, n int, garantia bool) error {
	if err := s.cliente.RPush(ctx, chave(rodada), n).Err(); err != nil {
		return err
	}
	s.cliente.Expire(ctx, chave(rodada), time.Hour)
	if garantia {
		recebidas, err := s.cliente.Wait(ctx, 1, 500).Result()
		if err != nil {
			return err
		}
		if recebidas < 1 {
			return errors.New("WAIT 1: nenhuma réplica confirmou em 500 ms")
		}
	}
	return nil
}

// derrubar: DEBUG SLEEP 30 congela o primário (como um nó travado). Os
// sentinels o declaram fora em 5 s e promovem a réplica; quando ele acorda,
// os sentinels o reconfiguram como réplica do novo primário.
func (s *sentinel) Derrubar(ctx context.Context, lider string) (string, error) {
	c := redis.NewClient(&redis.Options{Addr: lider, DialTimeout: time.Second, ReadTimeout: 40 * time.Second})
	go func() {
		defer c.Close()
		_ = c.Do(context.WithoutCancel(ctx), "DEBUG", "SLEEP", "30").Err()
	}()
	return "DEBUG SLEEP 30 em " + lider + ": o primário congela por 30 s", nil
}

func (s *sentinel) Planejada(ctx context.Context, lider string) (string, error) {
	sc, err := s.sentinela(ctx)
	if err != nil {
		return "", err
	}
	defer sc.Close()
	if err := sc.Failover(ctx, mestre).Err(); err != nil {
		return "", err
	}
	return "SENTINEL FAILOVER: a réplica é promovida de forma ordenada", nil
}

func (s *sentinel) Conferir(ctx context.Context, rodada uuid.UUID, confirmadas []int) (int, error) {
	itens, err := s.cliente.LRange(ctx, chave(rodada), 0, -1).Result()
	if err != nil {
		return 0, err
	}
	ha := make(map[string]bool, len(itens))
	for _, i := range itens {
		ha[i] = true
	}
	n := 0
	for _, c := range confirmadas {
		if ha[strconv.Itoa(c)] {
			n++
		}
	}
	return n, nil
}
