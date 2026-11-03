package storage

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/nosqlgo/marketplace/db/migrations"
)

// Migrar aplica as migrações SQL embutidas (db/migrations) com o goose.
// É a mesma função na API e nos testes de integração: o banco de teste nasce
// pelo mesmo caminho que o de desenvolvimento.
func Migrar(ctx context.Context, pool *pgxpool.Pool) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return err
	}
	results, err := provider.Up(ctx)
	for _, r := range results {
		slog.Debug("migração aplicada", "arquivo", r.Source.Path, "duração", r.Duration)
	}
	return err
}
