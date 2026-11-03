// Comando seed-catalogo: monta o catálogo do MongoDB a partir do PostgreSQL e
// reconstrói os dados derivados do Redis (ranking, cache) e, desde a Fase 7,
// o grafo de compras do Neo4j. Chamado pelo `make seed` depois do seed.sql.
// Usa as mesmas variáveis de ambiente da API.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	lojamongo "github.com/nosqlgo/marketplace/internal/loja/adaptadores/mongo"
	lojaneo4j "github.com/nosqlgo/marketplace/internal/loja/adaptadores/neo4j"
	lojapg "github.com/nosqlgo/marketplace/internal/loja/adaptadores/postgres"
	lojaapp "github.com/nosqlgo/marketplace/internal/loja/aplicacao"
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
	saida := map[string]any{"catalogo": r, "duracao": time.Since(inicio).Round(time.Millisecond).String()}

	// Fase 7: o grafo é derivado dos pedidos — refeito a partir deles. Sem
	// Neo4j configurado (ou fora do ar), o seed segue: o laboratório tem o
	// botão "Reconstruir o grafo".
	if neo, err := storage.NewNeo4j(cfg.Neo4jURI, cfg.Neo4jUser, cfg.Neo4jPassword); err == nil {
		defer neo.Close(context.Background())
		rec := lojaapp.NovasRecomendacoes(lojaneo4j.NovoGrafo(neo, nil), lojamongo.NovoCatalogo(mg, cfg.MongoDatabase),
			lojapg.NovoHistoricoDeCompras(pg))
		if e, err := rec.Reconstruir(ctx); err != nil {
			slog.Warn("grafo não reconstruído (reconstrua pelo laboratório Grafo × SQL)", "err", err)
		} else {
			saida["grafo"] = e
		}
	}
	b, _ := json.Marshal(saida)
	os.Stdout.Write(append(b, '\n'))
	return nil
}
