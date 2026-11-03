// Comando seed-catalogo: monta o catálogo do MongoDB a partir do PostgreSQL e
// reconstrói os dados derivados do Redis (ranking, cache). Chamado pelo
// `make seed` depois do seed.sql. Usa as mesmas variáveis de ambiente da API.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	lojamongo "github.com/nosqlgo/marketplace/internal/loja/adaptadores/mongo"
	"github.com/nosqlgo/marketplace/internal/plataforma/config"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("seed do catálogo falhou", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pg, err := storage.NewPostgres(ctx, cfg.PostgresURL)
	if err != nil {
		return err
	}
	defer pg.Close()
	mg, err := storage.NewMongo(ctx, cfg.MongoURI)
	if err != nil {
		return err
	}
	defer mg.Disconnect(context.Background())
	rdb, err := storage.NewRedis(ctx, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		return err
	}
	defer rdb.Close()

	inicio := time.Now()
	r, err := lojamongo.Semear(ctx, pg, mg.Database(cfg.MongoDatabase), rdb)
	if err != nil {
		return err
	}
	saida, _ := json.Marshal(map[string]any{"catalogo": r, "duracao": time.Since(inicio).Round(time.Millisecond).String()})
	os.Stdout.Write(append(saida, '\n'))
	return nil
}
