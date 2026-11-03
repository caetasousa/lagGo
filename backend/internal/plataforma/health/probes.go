package health

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

func Postgres(pool *pgxpool.Pool) Probe {
	return Probe{Name: "PostgreSQL", Model: "relacional", Check: func(ctx context.Context) (string, error) {
		var v string
		err := pool.QueryRow(ctx, "SHOW server_version").Scan(&v)
		return v, err
	}}
}

// PostgresReplica (Fase 5): a réplica de leitura. Além de responder, ela
// PRECISA estar em recuperação — uma "réplica" que aceita escrita deixou de
// ser réplica (cenário S2).
func PostgresReplica(pool *pgxpool.Pool) Probe {
	return Probe{Name: "PostgreSQL réplica", Model: "réplica de leitura", Check: func(ctx context.Context) (string, error) {
		if pool == nil {
			return "", storage.ErrDisabled
		}
		var v string
		var emRecuperacao bool
		if err := pool.QueryRow(ctx, "SELECT current_setting('server_version'), pg_is_in_recovery()").Scan(&v, &emRecuperacao); err != nil {
			return "", err
		}
		if !emRecuperacao {
			return v, errors.New("não está em recuperação: aceita escrita (deixou de ser réplica)")
		}
		return v, nil
	}}
}

func Mongo(client *mongo.Client) Probe {
	return Probe{Name: "MongoDB", Model: "documento", Check: func(ctx context.Context) (string, error) {
		var info struct {
			Version string `bson:"version"`
		}
		err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&info)
		return info.Version, err
	}}
}

func Redis(rdb *redis.Client) Probe {
	return Probe{Name: "Redis", Model: "chave-valor", Check: func(ctx context.Context) (string, error) {
		info, err := rdb.Info(ctx, "server").Result()
		if err != nil {
			return "", err
		}
		for line := range strings.Lines(info) {
			if v, ok := strings.CutPrefix(line, "redis_version:"); ok {
				return strings.TrimSpace(v), nil
			}
		}
		return "", nil
	}}
}

func Cassandra(c *storage.Cassandra) Probe {
	return Probe{Name: "Cassandra", Model: "wide-column", Check: func(ctx context.Context) (string, error) {
		session, err := c.Session()
		if err != nil {
			return "", err
		}
		var v string
		err = session.Query("SELECT release_version FROM system.local").ScanContext(ctx, &v)
		return v, err
	}}
}

// Neo4j recebe o driver e o erro de criação (ErrDisabled quando não configurado).
func Neo4j(driver neo4j.Driver, initErr error) Probe {
	return Probe{Name: "Neo4j", Model: "grafo", Check: func(ctx context.Context) (string, error) {
		if initErr != nil {
			return "", initErr
		}
		info, err := driver.GetServerInfo(ctx)
		if err != nil {
			return "", err
		}
		return strings.TrimPrefix(info.Agent(), "Neo4j/"), nil
	}}
}
