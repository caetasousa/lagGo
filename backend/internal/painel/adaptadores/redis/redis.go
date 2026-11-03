// Package redis: o adaptador do Painel do DBA para o Redis (INFO, SCAN por
// prefixo, o stream de pedidos). Só lê: nunca KEYS, sempre SCAN em lotes.
package redis

import (
	"context"
	"strconv"
	"strings"

	goredis "github.com/redis/go-redis/v9"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// O stream que a loja alimenta depois de cada compra (loja/adaptadores/redis).
const streamPedidos = "stream:pedidos"

// Redis implementa portas.Redis.
type Redis struct{ rdb *goredis.Client }

func Novo(rdb *goredis.Client) *Redis { return &Redis{rdb: rdb} }

var camposInfo = []string{
	"redis_version", "uptime_in_seconds", "connected_clients", "used_memory_human", "used_memory_peak_human",
	"maxmemory_human", "maxmemory_policy", "keyspace_hits", "keyspace_misses", "expired_keys", "evicted_keys",
	"aof_enabled", "rdb_last_save_time", "rdb_changes_since_last_save", "total_commands_processed",
}

const limiteVarredura = 20000

// Estado: INFO, taxa de acerto, chaves por prefixo (SCAN) e o stream de pedidos.
func (a *Redis) Estado(ctx context.Context) (dominio.EstadoRedis, error) {
	info, err := a.rdb.Info(ctx, "server", "clients", "memory", "stats", "persistence").Result()
	if err != nil {
		return dominio.EstadoRedis{}, err
	}
	todos := map[string]string{}
	for linha := range strings.Lines(info) {
		if k, v, ok := strings.Cut(strings.TrimSpace(linha), ":"); ok {
			todos[k] = v
		}
	}
	e := dominio.EstadoRedis{Info: map[string]string{}, ChavesPorTipo: map[string]int{}}
	for _, c := range camposInfo {
		e.Info[c] = todos[c]
	}
	hits, _ := strconv.ParseFloat(todos["keyspace_hits"], 64)
	misses, _ := strconv.ParseFloat(todos["keyspace_misses"], 64)
	if hits+misses > 0 {
		v := 100 * hits / (hits + misses)
		e.HitRatio = &v
	}

	// Contagem por prefixo com SCAN (em lotes, sem travar o servidor).
	// KEYS * percorreria tudo de uma vez — proibido em produção.
	iter := a.rdb.Scan(ctx, 0, "*", 1000).Iterator()
	for iter.Next(ctx) {
		prefixo, _, _ := strings.Cut(iter.Val(), ":")
		e.ChavesPorTipo[prefixo]++
		if e.ChavesVarridas++; e.ChavesVarridas >= limiteVarredura {
			e.VarreduraParou = true
			break
		}
	}

	e.TamanhoStream, _ = a.rdb.XLen(ctx, streamPedidos).Result()
	msgs, _ := a.rdb.XRevRangeN(ctx, streamPedidos, "+", "-", 5).Result()
	for _, m := range msgs {
		item := map[string]any{"id": m.ID}
		for k, v := range m.Values {
			item[k] = v
		}
		e.Stream = append(e.Stream, item)
	}
	return e, nil
}
