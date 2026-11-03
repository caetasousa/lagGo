//go:build integration

package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/nosqlgo/marketplace/db/migrations"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

// Como quebra: uma migração nova não sobe num banco vazio, ou o "-- +goose
// Down" dela não desfaz o que o Up criou (e o próximo Up falha).
func TestMigracoesSobemDescemESobemDeNovo(t *testing.T) {
	pool := testinfra.PostgresVazio(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"); err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrar(ctx, pool); err != nil {
		t.Fatalf("subindo do zero: %v", err)
	}

	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 0); err != nil {
		t.Fatalf("descendo todas: %v", err)
	}
	var tabelas int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','auditoria','relatorio')
	                         AND tablename <> 'goose_db_version'`).Scan(&tabelas)
	if tabelas != 0 {
		t.Fatalf("o Down deixou %d tabelas para trás", tabelas)
	}
	if err := storage.Migrar(ctx, pool); err != nil {
		t.Fatalf("subindo de novo depois do Down: %v", err)
	}
}
