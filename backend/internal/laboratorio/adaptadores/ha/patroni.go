// Package ha: os adaptadores dos clusters de alta disponibilidade (perfil
// ha do compose) — Patroni, o replica set rsha do MongoDB e o Redis com
// Sentinel. Cada um implementa portas.ClusterHA.
package ha

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// PostgreSQL + Patroni. A escrita vai pelo HAProxy (porta 5000), que só deixa
// passar para o nó cujo Patroni responde 200 em /primary. A API REST do
// Patroni (porta 8008) diz quem é quem e aceita switchover e mudança de config.

type patroni struct {
	url      string   // HAProxy
	rest     []string // API REST de cada nó
	http     *http.Client
	lento    *http.Client // o switchover só responde quando termina (segundos)
	pool     *pgxpool.Pool
	poolErro error
}

func NovoPatroni(url string, rest []string) *patroni {
	p := &patroni{url: url, rest: rest, http: &http.Client{Timeout: 2 * time.Second}, lento: &http.Client{Timeout: 60 * time.Second}}
	if url == "" {
		p.poolErro = errors.New("HA_POSTGRES_URL não configurada")
		return p
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		p.poolErro = err
		return p
	}
	cfg.MaxConns = 4
	cfg.ConnConfig.RuntimeParams["application_name"] = "marketplace-api"
	p.pool, p.poolErro = pgxpool.NewWithConfig(context.Background(), cfg)
	return p
}

type membroPatroni struct {
	Nome     string   `json:"name"`
	Papel    string   `json:"role"` // leader | replica | sync_standby | standby_leader
	Estado   string   `json:"state"`
	Host     string   `json:"host"`
	Porta    int      `json:"port"`
	Timeline int      `json:"timeline"`
	Lag      *float64 `json:"lag"`
}

// cluster pergunta ao primeiro nó que responder (qualquer um sabe o estado
// inteiro: ele vem do etcd).
func (p *patroni) cluster(ctx context.Context) ([]membroPatroni, error) {
	var ultimo error = errors.New("HA_PATRONI_URLS não configurada")
	for _, base := range p.rest {
		var r struct {
			Membros []membroPatroni `json:"members"`
		}
		if ultimo = p.chamar(ctx, http.MethodGet, base+"/cluster", nil, &r); ultimo == nil {
			return r.Membros, nil
		}
	}
	return nil, ultimo
}

func (p *patroni) chamar(ctx context.Context, metodo, endereco string, corpo any, saida any) error {
	return p.chamarCom(ctx, p.http, metodo, endereco, corpo, saida)
}

func (p *patroni) chamarCom(ctx context.Context, cliente *http.Client, metodo, endereco string, corpo any, saida any) error {
	var leitor io.Reader
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		leitor = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, endereco, leitor)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := cliente.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("patroni %s %s: %d %s", metodo, endereco, res.StatusCode, bytes.TrimSpace(b))
	}
	if saida != nil {
		return json.Unmarshal(b, saida)
	}
	return nil
}

func (p *patroni) Estado(ctx context.Context) dominio.EstadoCluster {
	e := dominio.EstadoCluster{}
	membros, err := p.cluster(ctx)
	if err != nil {
		e.Erro = foraDoAr(err)
		return e
	}
	e.Disponivel = true
	for _, m := range membros {
		papel := map[string]string{"leader": "líder", "replica": "réplica", "sync_standby": "réplica síncrona"}[m.Papel]
		if papel == "" {
			papel = m.Papel
		}
		if m.Papel == "leader" {
			e.Lider = m.Nome
		}
		e.Membros = append(e.Membros, dominio.Membro{Nome: m.Nome, Papel: papel, Estado: m.Estado + " · timeline " + strconv.Itoa(m.Timeline), Atraso: m.Lag})
	}
	var cfg struct {
		Sincrono bool `json:"synchronous_mode"`
		TTL      int  `json:"ttl"`
	}
	if len(p.rest) > 0 && p.chamar(ctx, http.MethodGet, p.rest[0]+"/config", nil, &cfg) == nil {
		e.Detalhe = fmt.Sprintf("synchronous_mode = %v · ttl da chave de líder = %d s", cfg.Sincrono, cfg.TTL)
	}
	return e
}

func (p *patroni) Preparar(ctx context.Context, rodada uuid.UUID, garantia bool) (string, error) {
	if p.poolErro != nil {
		return "", p.poolErro
	}
	// synchronous_mode: o Patroni passa a manter uma réplica como síncrona e
	// só a promove se ela tiver tudo — failover sem perder COMMIT confirmado.
	if len(p.rest) == 0 {
		return "", errors.New("HA_PATRONI_URLS não configurada")
	}
	if err := p.chamar(ctx, http.MethodPatch, p.rest[0]+"/config", map[string]any{"synchronous_mode": garantia}, nil); err != nil {
		return "", err
	}
	if garantia {
		// Espera o Patroni eleger a réplica síncrona.
		prazo := time.Now().Add(20 * time.Second)
		for {
			m, err := p.cluster(ctx)
			if err == nil && contem(m, "sync_standby") {
				break
			}
			if time.Now().After(prazo) {
				return "", errors.New("o Patroni não elegeu uma réplica síncrona em 20 s")
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	_, err := p.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS ensaio_ha (rodada uuid, n int, em timestamptz DEFAULT clock_timestamp());
		DELETE FROM ensaio_ha WHERE em < now() - interval '1 hour'`)
	if garantia {
		return "synchronous_mode ligado: o COMMIT espera a réplica síncrona", err
	}
	return "synchronous_mode desligado: replicação assíncrona", err
}

func contem(ms []membroPatroni, papel string) bool {
	for _, m := range ms {
		if m.Papel == papel {
			return true
		}
	}
	return false
}

func (p *patroni) Escrever(ctx context.Context, rodada uuid.UUID, n int, _ bool) error {
	_, err := p.pool.Exec(ctx, "INSERT INTO ensaio_ha (rodada, n) VALUES ($1, $2)", rodada, n)
	return err
}

// derrubar: no nó líder, mata o processo do Patroni (o PID está em
// /tmp/patroni.pid, gravado pelo infra/patroni/supervisor.sh). Sem o agente,
// a chave de líder no etcd deixa de ser renovada e expira em até ttl
// segundos; a réplica então se elege. O supervisor derruba o PostgreSQL do
// nó junto — é o nó inteiro caindo.
func (p *patroni) Derrubar(ctx context.Context, lider string) (string, error) {
	membros, err := p.cluster(ctx)
	if err != nil {
		return "", err
	}
	for _, m := range membros {
		if m.Nome != lider {
			continue
		}
		u, err := url.Parse(p.url)
		if err != nil {
			return "", err
		}
		u.Host = m.Host + ":" + strconv.Itoa(m.Porta)
		conn, err := pgx.Connect(ctx, u.String())
		if err != nil {
			return "", err
		}
		defer conn.Close(ctx)
		// COPY ... TO PROGRAM: executa um comando no servidor (superusuário).
		// Comando fixo, nada vem da requisição.
		_, err = conn.Exec(ctx, `COPY (SELECT 1) TO PROGRAM 'kill -9 $(cat /tmp/patroni.pid)'`)
		return "kill -9 no Patroni de " + lider + ": a chave de líder no etcd para de ser renovada", err
	}
	return "", fmt.Errorf("líder %s não encontrado", lider)
}

func (p *patroni) Planejada(ctx context.Context, lider string) (string, error) {
	// Switchover: o líder atual entrega o posto de forma ordenada.
	var ultimo error
	for _, base := range p.rest {
		if ultimo = p.chamarCom(ctx, p.lento, http.MethodPost, base+"/switchover", map[string]string{"leader": lider}, nil); ultimo == nil {
			return "POST /switchover: " + lider + " entrega a liderança de forma ordenada", nil
		}
	}
	return "", ultimo
}

func (p *patroni) Conferir(ctx context.Context, rodada uuid.UUID, confirmadas []int) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx, "SELECT count(*) FROM ensaio_ha WHERE rodada = $1 AND n = ANY($2)", rodada, confirmadas).Scan(&n)
	return n, err
}
