// Package app é a RAIZ DE COMPOSIÇÃO da arquitetura hexagonal: o único lugar
// que conhece todos os pedaços e os liga — cria os adaptadores (postgres,
// mongo, redis…), entrega-os aos casos de uso como portas, e os casos de uso
// aos adaptadores HTTP. Nenhum outro pacote faz isso.
//
//	loja/        o marketplace        dominio · aplicacao · portas · adaptadores
//	laboratorio/ os experimentos      dominio · aplicacao · portas · adaptadores
//	painel/      o Painel do DBA      dominio · aplicacao · portas · adaptadores
//	plataforma/  o que é de todos     config, conexões, migrações, health, rate limit
//
// A API (cmd/api) e os testes de integração do servidor usam EXATAMENTE esta
// montagem: um teste que montasse as rotas por conta própria testaria outro
// servidor. Veja docs/12-arquitetura-hexagonal.md.
package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/mongo"

	labcatalogo "github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/catalogo"
	labha "github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/ha"
	labhttp "github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/http"
	labloja "github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/loja"
	labpg "github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/postgres"
	labapp "github.com/nosqlgo/marketplace/internal/laboratorio/aplicacao"
	lojahttp "github.com/nosqlgo/marketplace/internal/loja/adaptadores/http"
	lojamongo "github.com/nosqlgo/marketplace/internal/loja/adaptadores/mongo"
	lojapg "github.com/nosqlgo/marketplace/internal/loja/adaptadores/postgres"
	lojaredis "github.com/nosqlgo/marketplace/internal/loja/adaptadores/redis"
	"github.com/nosqlgo/marketplace/internal/loja/adaptadores/senha"
	lojaapp "github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	painelhttp "github.com/nosqlgo/marketplace/internal/painel/adaptadores/http"
	painelmongo "github.com/nosqlgo/marketplace/internal/painel/adaptadores/mongo"
	painelbouncer "github.com/nosqlgo/marketplace/internal/painel/adaptadores/pgbouncer"
	painelpg "github.com/nosqlgo/marketplace/internal/painel/adaptadores/postgres"
	painelredis "github.com/nosqlgo/marketplace/internal/painel/adaptadores/redis"
	painelapp "github.com/nosqlgo/marketplace/internal/painel/aplicacao"
	"github.com/nosqlgo/marketplace/internal/plataforma/health"
	"github.com/nosqlgo/marketplace/internal/plataforma/limite"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

type Conexoes struct {
	Postgres *pgxpool.Pool
	// Réplica de leitura (Fase 5); nil = sem réplica (as leituras vão ao primário).
	PostgresReplica *pgxpool.Pool
	// URLs para os laboratórios que abrem conexões novas de propósito
	// (Laboratório de Conexões). PgBouncer vazio = modo indisponível.
	PostgresURL       string
	PgBouncerURL      string
	PgBouncerAdminURL string
	// Clusters do Laboratório de Alta Disponibilidade (perfil ha). Opcionais.
	HA        ConfigHA
	Mongo     *mongo.Client
	MongoDB   string
	Redis     *redis.Client
	Cassandra *storage.Cassandra // opcional: hosts vazios = desabilitado
	Neo4j     neo4j.Driver       // opcional
	Neo4jErr  error              // storage.ErrDisabled quando não configurado
}

type ConfigHA struct {
	PostgresURL    string
	PatroniURLs    []string
	MongoURI       string
	RedisSentinels []string
}

type Opcoes struct {
	CORSOrigins []string
	// Intervalo do REFRESH da materialized view dos relatórios; 0 = não agenda.
	AtualizarRelatorios time.Duration
	// Requisições por minuto por IP nas rotas que escrevem; 0 = sem limite.
	LimitePorMinuto int
	// Chave do CPF cifrado (Fase 6). Obrigatória.
	ChaveCPF string
}

// Montar devolve o handler HTTP completo. Tarefas de fundo (o refresh
// periódico) vivem enquanto ctx não for cancelado.
func Montar(ctx context.Context, c Conexoes, op Opcoes) (http.Handler, error) {
	if op.ChaveCPF == "" {
		return nil, errors.New("CPF_CHAVE não configurada: o cadastro cifra o CPF com ela")
	}
	if c.Cassandra == nil {
		c.Cassandra = storage.NewCassandra(nil)
	}
	if c.Neo4j == nil && c.Neo4jErr == nil {
		c.Neo4jErr = storage.ErrDisabled
	}

	// O MongoDB não tem migração: as coleções, a validação e os índices são
	// garantidos a cada subida (idempotente).
	if err := lojamongo.GarantirEsquema(ctx, c.Mongo.Database(c.MongoDB)); err != nil {
		return nil, err
	}
	// Partições da auditoria: o mês corrente e os próximos precisam existir
	// ANTES de chegar a primeira linha (senão ela cai na partição DEFAULT).
	if _, err := c.Postgres.Exec(ctx, "CALL auditoria.garantir_particoes(1, 3)"); err != nil {
		return nil, err
	}

	// ---------------------------------------------------------- loja
	pedidos := lojapg.NovosPedidos(c.Postgres)
	ofertas := lojapg.NovasOfertas(c.Postgres)
	checkout := lojaapp.NovoCheckout(pedidos)
	relatorios := lojaapp.NovosRelatorios(lojapg.NovosRelatorios(c.Postgres, c.PostgresReplica))
	if op.AtualizarRelatorios > 0 {
		relatorios.AtualizarPeriodicamente(ctx, op.AtualizarRelatorios)
	}
	catalogo := lojamongo.NovoCatalogo(c.Mongo, c.MongoDB)
	loja := lojahttp.NovosHandlers(
		checkout,
		lojaapp.NovoCarrinho(lojaredis.NovosCarrinhos(c.Redis), ofertas, pedidos, lojaredis.NovosEfeitos(c.Redis), checkout),
		lojaapp.NovoCatalogo(catalogo, lojaredis.NovoCache(c.Redis), ofertas,
			lojapg.NovosClientes(c.Postgres), lojaredis.NovoRanking(c.Redis)),
		lojaapp.NovaVitrine(lojapg.NovaVitrine(c.Postgres)),
		relatorios,
		lojaapp.NovasContas(lojapg.NovasContas(c.Postgres, op.ChaveCPF), senha.Novo(), lojaredis.NovasSessoes(c.Redis),
			lojapg.NovosMeusPedidos(c.Postgres), catalogo, lojaredis.NovoCache(c.Redis)),
	)

	// ---------------------------------------------------------- painel do DBA
	pg := painelpg.Novo(c.Postgres)
	painel := painelhttp.NovosHandlers(painelapp.NovoPainel(pg, pg, painelpg.NovaReplicacao(c.Postgres, c.PostgresReplica),
		painelredis.Novo(c.Redis), painelmongo.Novo(c.Mongo, c.MongoDB), painelbouncer.Novo(c.PgBouncerAdminURL)))

	// ---------------------------------------------------------- laboratório
	backup := labpg.NovoBackup(c.Postgres, c.PostgresURL)
	lab := labhttp.NovosHandlers(labhttp.Labs{
		Corrida:    labapp.NovaCorrida(labpg.NovoEstoque(c.Postgres), labloja.Nova(checkout)),
		Isolamento: labapp.NovoIsolamento(labpg.NovoIsolamento(c.Postgres)),
		MVCC:       labapp.NovoMVCC(labpg.NovoMVCC(c.Postgres)),
		Expurgo:    labapp.NovoExpurgo(labpg.NovoExpurgo(c.Postgres)),
		Conexoes:   labapp.NovasConexoes(labpg.NovasConexoes(c.Postgres, c.PostgresURL, c.PgBouncerURL)),
		Replicacao: labapp.NovaReplicacao(labpg.NovaReplicacao(c.Postgres, c.PostgresReplica)),
		Backup:     labapp.NovoBackup(backup),
		Indices:    labapp.NovosIndices(labpg.NovosIndices(c.Postgres)),
		Cache:      labapp.NovoCache(labcatalogo.Novo(c.Mongo, c.MongoDB, c.Redis)),
		HA: labapp.NovoHA(
			labha.NovoPatroni(c.HA.PostgresURL, c.HA.PatroniURLs),
			labha.NovoMongoRS(c.HA.MongoURI),
			labha.NovoSentinel(c.HA.RedisSentinels)),
	})

	// ---------------------------------------------------------- rotas
	saude := health.NewHandler(
		health.Postgres(c.Postgres),
		health.PostgresReplica(c.PostgresReplica),
		health.Mongo(c.Mongo),
		health.Redis(c.Redis),
		health.Cassandra(c.Cassandra),
		health.Neo4j(c.Neo4j, c.Neo4jErr),
	)
	limitar := func(nome string) func(http.Handler) http.Handler {
		return limite.PorIP(c.Redis, nome, op.LimitePorMinuto)
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: op.CORSOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization", "X-Sessao", "Idempotency-Key"},
		// Cookie da sessão (Fase 6) em chamadas de outra origem (Vite em :5173).
		AllowCredentials: true,
		ExposedHeaders:   []string{"X-Cache", "X-Origem-Leitura", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"},
	}))
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", saude.ServeHTTP)
		loja.Rotas(r, limitar)
		painel.Rotas(r)
		lab.Rotas(r)
		// Próximas fases (README): /events (Fase 7, Cassandra) e /recommend (Fase 7, Neo4j).
	})
	return r, nil
}
