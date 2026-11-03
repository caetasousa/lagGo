package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nosqlgo/marketplace/internal/app"
	"github.com/nosqlgo/marketplace/internal/plataforma/config"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("api encerrada com erro", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Bancos obrigatórios: a API não sobe sem eles.
	pg, err := storage.NewPostgres(ctx, cfg.PostgresURL)
	if err != nil {
		return err
	}
	defer pg.Close()

	if cfg.RunMigrations {
		if err := storage.Migrar(ctx, pg); err != nil {
			return err
		}
	}

	// Réplica (Fase 5): opcional e sem ping — pode ainda estar clonando.
	replica, err := storage.NewPostgresReplica(ctx, cfg.PostgresReplicaURL)
	if err != nil {
		return err
	}
	if replica != nil {
		defer replica.Close()
	}

	mongoClient, err := storage.NewMongo(ctx, cfg.MongoURI)
	if err != nil {
		return err
	}
	defer mongoClient.Disconnect(context.Background())

	rdb, err := storage.NewRedis(ctx, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		return err
	}
	defer rdb.Close()

	// Cassandra e Neo4j (Fase 7): conectam sob demanda — a API sobe sem eles.
	cass := storage.NewCassandra(cfg.CassandraHosts)
	defer cass.Close()
	neo, neoErr := storage.NewNeo4j(cfg.Neo4jURI, cfg.Neo4jUser, cfg.Neo4jPassword)
	if neoErr == nil {
		defer neo.Close(context.Background())
	}

	router, err := app.Montar(ctx, app.Conexoes{
		Postgres: pg, PostgresReplica: replica, Mongo: mongoClient, MongoDB: cfg.MongoDatabase, Redis: rdb,
		PostgresURL: cfg.PostgresURL, PgBouncerURL: cfg.PgBouncerURL, PgBouncerAdminURL: cfg.PgBouncerAdminURL,
		Cassandra: cass, CassandraKeyspace: cfg.CassandraKeyspace, Neo4j: neo, Neo4jErr: neoErr,
		HA: app.ConfigHA{PostgresURL: cfg.HAPostgresURL, PatroniURLs: cfg.HAPatroniURLs, MongoURI: cfg.HAMongoURI, RedisSentinels: cfg.HARedisSentinels},
	}, app.Opcoes{
		CORSOrigins:         cfg.CORSOrigins,
		AtualizarRelatorios: 10 * time.Minute,
		AquecerGrafo:        true,
		LimitePorMinuto:     cfg.RateLimitPorMinuto,
		ChaveCPF:            cfg.ChaveCPF,
	})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	slog.Info("api ouvindo", "addr", cfg.HTTPAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
