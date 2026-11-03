// Package redis são os ADAPTADORES da loja para o Redis: carrinho (HASH com
// validade), cache do produto (STRING com TTL), ranking (SORTED SET) e os
// efeitos depois do COMMIT (MULTI: esvazia o carrinho, soma no ranking e
// publica no STREAM). Todo comando do Redis da loja mora aqui.
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

// Chaves. O prefixo é o "namespace": é por ele que o Painel do DBA conta as
// chaves (SCAN, nunca KEYS) e que a carga do catálogo apaga o cache.
const (
	PrefixoCarrinho = "carrinho:"
	PrefixoCache    = "cache:produto:"
	ChaveRanking    = "ranking:mais_vendidos"
	StreamPedidos   = "stream:pedidos"
	// Fase 6: sessão de login (sessao:{sha256 do token}) e o índice das
	// sessões de cada cliente (sessao:cliente:{id}), para encerrar todas.
	PrefixoSessao = "sessao:"
)

func chaveDoCarrinho(sessao uuid.UUID) string { return PrefixoCarrinho + sessao.String() }

// ------------------------------------------------------------ carrinho

// Carrinhos implementa portas.Carrinhos: um HASH por sessão
// (carrinho:{sessao} → sku_id: quantidade), com validade renovada a cada
// alteração — carrinho abandonado some sozinho, sem rotina de limpeza.
type Carrinhos struct{ rdb *goredis.Client }

func NovosCarrinhos(rdb *goredis.Client) *Carrinhos { return &Carrinhos{rdb: rdb} }

func (a *Carrinhos) Ler(ctx context.Context, sessao uuid.UUID) (map[uuid.UUID]int32, time.Duration, error) {
	// Pipeline: HGETALL e TTL numa ida só ao Redis.
	var campos *goredis.MapStringStringCmd
	var ttl *goredis.DurationCmd
	chave := chaveDoCarrinho(sessao)
	if _, err := a.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		campos = p.HGetAll(ctx, chave)
		ttl = p.TTL(ctx, chave)
		return nil
	}); err != nil {
		return nil, 0, err
	}
	qtd := map[uuid.UUID]int32{}
	for k, v := range campos.Val() {
		id, err1 := uuid.Parse(k)
		n, err2 := strconv.Atoi(v)
		if err1 == nil && err2 == nil && n > 0 {
			qtd[id] = int32(n)
		}
	}
	return qtd, ttl.Val(), nil
}

func (a *Carrinhos) Definir(ctx context.Context, sessao, sku uuid.UUID, quantidade int, validade time.Duration) error {
	chave := chaveDoCarrinho(sessao)
	// MULTI/EXEC: a escrita e a renovação da validade acontecem juntas.
	_, err := a.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		if quantidade == 0 {
			p.HDel(ctx, chave, sku.String())
		} else {
			p.HSet(ctx, chave, sku.String(), quantidade)
		}
		p.Expire(ctx, chave, validade)
		return nil
	})
	return err
}

func (a *Carrinhos) Esvaziar(ctx context.Context, sessao uuid.UUID) error {
	return a.rdb.Del(ctx, chaveDoCarrinho(sessao)).Err()
}

// ------------------------------------------------------------ efeitos do pedido

// Efeitos implementa portas.EfeitosDoPedido.
type Efeitos struct{ rdb *goredis.Client }

func NovosEfeitos(rdb *goredis.Client) *Efeitos { return &Efeitos{rdb: rdb} }

// Confirmado: numa transação do Redis (MULTI), esvazia o carrinho, soma no
// ranking e publica o evento no stream.
func (a *Efeitos) Confirmado(ctx context.Context, sessao uuid.UUID, r dominio.Resultado, itens []dominio.Item) error {
	_, err := a.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		p.Del(ctx, chaveDoCarrinho(sessao))
		for _, it := range itens {
			p.ZIncrBy(ctx, ChaveRanking, float64(it.Quantidade), it.SkuID.String())
		}
		// Stream: log de eventos persistente (diferente do Pub/Sub, que some
		// se ninguém estiver ouvindo). MAXLEN ~ limita o tamanho.
		p.XAdd(ctx, &goredis.XAddArgs{Stream: StreamPedidos, MaxLen: 1000, Approx: true, Values: map[string]any{
			"pedido_id": r.PedidoID.String(), "total": string(r.Total), "itens": len(itens),
		}})
		return nil
	})
	return err
}

func (a *Efeitos) Reaproveitado(ctx context.Context, sessao uuid.UUID) error {
	return a.rdb.Del(ctx, chaveDoCarrinho(sessao)).Err()
}

// ------------------------------------------------------------ cache do produto

// Cache implementa portas.CacheDeProdutos: o produto em JSON numa STRING com TTL.
type Cache struct{ rdb *goredis.Client }

func NovoCache(rdb *goredis.Client) *Cache { return &Cache{rdb: rdb} }

func (a *Cache) Ler(ctx context.Context, id string) (dominio.Produto, bool, error) {
	var p dominio.Produto
	b, err := a.rdb.Get(ctx, PrefixoCache+id).Bytes()
	if errors.Is(err, goredis.Nil) {
		return p, false, nil
	}
	if err != nil {
		return p, false, err
	}
	if err := json.Unmarshal(b, &p); err != nil {
		return p, false, err
	}
	return p, true, nil
}

func (a *Cache) Gravar(ctx context.Context, id string, p dominio.Produto, validade time.Duration) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return a.rdb.Set(ctx, PrefixoCache+id, b, validade).Err()
}

func (a *Cache) Apagar(ctx context.Context, id string) error {
	return a.rdb.Del(ctx, PrefixoCache+id).Err()
}

// ------------------------------------------------------------ ranking

// Ranking implementa portas.Ranking: o SORTED SET dos mais vendidos.
type Ranking struct{ rdb *goredis.Client }

func NovoRanking(rdb *goredis.Client) *Ranking { return &Ranking{rdb: rdb} }

// Top: ZREVRANGE (maior pontuação primeiro).
func (a *Ranking) Top(ctx context.Context, n int64) ([]dominio.PosicaoNoRanking, error) {
	top, err := a.rdb.ZRevRangeWithScores(ctx, ChaveRanking, 0, n-1).Result()
	out := make([]dominio.PosicaoNoRanking, len(top))
	for i, z := range top {
		out[i] = dominio.PosicaoNoRanking{SkuID: z.Member.(string), Vendidos: int64(z.Score)}
	}
	return out, err
}
