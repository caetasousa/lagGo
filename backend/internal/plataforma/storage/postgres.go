// Package storage abre as conexões com cada banco de dados do projeto.
// Cada arquivo corresponde a um modelo de dados — veja docs/00-arquitetura.md.
package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPostgres cria um pool de conexões (pgxpool). Um pool reaproveita conexões
// TCP já autenticadas; abrir uma conexão nova no PostgreSQL custa um processo
// no servidor (veja docs/06-postgresql-admin.md, seção PgBouncer).
// NewPostgresReplica abre o pool da réplica de leitura (Fase 5). Diferente do
// primário, NÃO testa a conexão: a API sobe mesmo com a réplica fora do ar
// (ela ainda pode estar clonando o primário), e quem lê dela sabe cair no
// primário. url vazia = sem réplica (nil).
func NewPostgresReplica(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, nil
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("postgres réplica: config inválida: %w", err)
	}
	cfg.MaxConns = 10
	cfg.ConnConfig.RuntimeParams["application_name"] = "marketplace-api"
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres réplica: %w", err)
	}
	return pool, nil
}

func NewPostgres(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("postgres: config inválida: %w", err)
	}
	cfg.MaxConns = 20 // o Laboratório de Concorrência disputa conexões de propósito
	// Nome na pg_stat_activity: o Painel e o Laboratório de Conexões distinguem
	// as conexões da própria API das abertas pelos experimentos.
	cfg.ConnConfig.RuntimeParams["application_name"] = "marketplace-api"
	cfg.MinConns = 1
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}
	return pool, nil
}
