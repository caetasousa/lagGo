//go:build integration

package testinfra

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

// bancoModelo é migrado UMA vez e serve de TEMPLATE para o banco de cada teste:
// copiar um banco pronto custa milissegundos; migrar, centenas deles.
// bancoAdmin existe porque CREATE DATABASE ... TEMPLATE exige que ninguém
// esteja conectado ao modelo.
const (
	bancoModelo = "modelo"
	bancoAdmin  = "postgres"
)

var (
	pgUmaVez sync.Once
	pgSrv    *tcpostgres.PostgresContainer
	pgURL    string
	pgErr    error
)

// Postgres devolve um pool ligado a um banco migrado, vazio e exclusivo do teste.
func Postgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return novoBanco(t, bancoModelo)
}

// PostgresVazio devolve um banco SEM migrações (para testar as próprias migrações).
func PostgresVazio(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return novoBanco(t, "")
}

func novoBanco(t *testing.T, template string) *pgxpool.Pool {
	t.Helper()
	pgUmaVez.Do(subirPostgres)
	if pgErr != nil {
		t.Fatalf("não consegui subir o PostgreSQL de teste: %v\n\n"+
			"Estes testes exigem Docker. `make check` roda a suíte sem container.", pgErr)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	// Nome gerado aqui (letras e dígitos), nunca vindo de fora: CREATE DATABASE
	// não aceita parâmetro.
	nome := "t" + strings.ReplaceAll(uuid.NewString(), "-", "")
	ddl := "CREATE DATABASE " + nome
	if template != "" {
		ddl += " TEMPLATE " + template
	}
	if err := execAdmin(ctx, ddl); err != nil {
		t.Fatalf("criando o banco do teste: %v", err)
	}

	pool, err := storage.NewPostgres(ctx, urlDe(nome))
	if err != nil {
		t.Fatalf("conectando ao banco do teste: %v", err)
	}
	// O pool fecha ANTES do DROP: uma conexão aberta impediria a remoção.
	t.Cleanup(func() {
		pool.Close()
		_ = execAdmin(context.Background(), "DROP DATABASE IF EXISTS "+nome+" (FORCE)")
	})
	return pool
}

func subirPostgres() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	pgSrv, pgErr = tcpostgres.Run(ctx, imagemPostgres,
		tcpostgres.WithDatabase(bancoAdmin),
		tcpostgres.WithUsername("teste"),
		tcpostgres.WithPassword("teste"),
		// Igual ao infra/postgres/postgresql.conf: o Painel do DBA lê pg_stat_statements.
		testcontainers.WithCmdArgs("-c", "shared_preload_libraries=pg_stat_statements"),
		// O Postgres registra "ready" duas vezes (a primeira é o servidor
		// temporário do initdb); esperar a segunda evita conectar cedo demais.
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(2*time.Minute),
		),
	)
	if pgErr != nil {
		return
	}
	if pgURL, pgErr = pgSrv.ConnectionString(ctx, "sslmode=disable"); pgErr != nil {
		return
	}
	if pgErr = execAdmin(ctx, "CREATE DATABASE "+bancoModelo); pgErr != nil {
		return
	}

	pool, err := storage.NewPostgres(ctx, urlDe(bancoModelo))
	if err != nil {
		pgErr = err
		return
	}
	defer pool.Close() // libera o modelo para servir de TEMPLATE

	// Feito pelo infra/postgres/init no compose; aqui, no modelo.
	if _, pgErr = pool.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"); pgErr != nil {
		return
	}
	if err := storage.Migrar(ctx, pool); err != nil {
		pgErr = fmt.Errorf("migrando o banco-modelo: %w", err)
	}
}

func execAdmin(ctx context.Context, sql string) error {
	admin, err := pgxpool.New(ctx, pgURL)
	if err != nil {
		return err
	}
	defer admin.Close()
	_, err = admin.Exec(ctx, sql)
	return err
}

// urlDe troca só o nome do database na URL que o container devolveu.
func urlDe(banco string) string {
	if i := strings.LastIndex(pgURL, "/"+bancoAdmin); i >= 0 {
		return pgURL[:i] + "/" + banco + pgURL[i+len("/"+bancoAdmin):]
	}
	return pgURL
}

func encerrarPostgres() {
	if pgSrv != nil {
		_ = pgSrv.Terminate(context.Background())
		pgSrv = nil
	}
}
