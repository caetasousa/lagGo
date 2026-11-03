//go:build integration

package testinfra

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

var (
	rdUmaVez sync.Once
	rdSrv    *tcredis.RedisContainer
	rdOpts   *redis.Options
	rdErr    error
	rdMu     sync.Mutex
	rdProxDB int
)

// Redis devolve um cliente num database (0–15) limpo para o teste.
// O Redis não tem "CREATE DATABASE": os 16 databases numerados são reciclados
// com FLUSHDB. Testes com Redis NÃO podem usar t.Parallel() — com mais de 16
// em paralelo, dois dividiriam o mesmo database.
func Redis(t *testing.T) *redis.Client {
	t.Helper()
	rdUmaVez.Do(subirRedis)
	if rdErr != nil {
		t.Fatalf("não consegui subir o Redis de teste: %v", rdErr)
	}
	rdMu.Lock()
	db := rdProxDB
	rdProxDB = (rdProxDB + 1) % 16
	rdMu.Unlock()

	opts := *rdOpts
	opts.DB = db
	rdb := redis.NewClient(&opts)
	if err := rdb.FlushDB(context.Background()).Err(); err != nil {
		t.Fatalf("limpando o Redis do teste: %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func subirRedis() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if rdSrv, rdErr = tcredis.Run(ctx, imagemRedis); rdErr != nil {
		return
	}
	uri, err := rdSrv.ConnectionString(ctx)
	if err != nil {
		rdErr = err
		return
	}
	rdOpts, rdErr = redis.ParseURL(uri)
}

func encerrarRedis() {
	if rdSrv != nil {
		_ = rdSrv.Terminate(context.Background())
		rdSrv = nil
	}
}
