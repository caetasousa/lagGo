// Package config lê a configuração da API a partir de variáveis de ambiente
// (12-factor app: https://12factor.net/pt_br/config).
package config

import "github.com/caarlos0/env/v11"

type Config struct {
	HTTPAddr      string   `env:"HTTP_ADDR" envDefault:":8080"`
	CORSOrigins   []string `env:"CORS_ORIGINS" envSeparator:"," envDefault:"http://localhost:5173,http://localhost:3000"`
	RunMigrations bool     `env:"RUN_MIGRATIONS" envDefault:"true"`

	// Fase 6: chave do CPF (pgcrypto). Obrigatória e sem valor padrão no
	// código — segredo não mora no repositório (o compose traz uma de
	// desenvolvimento).
	ChaveCPF string `env:"CPF_CHAVE,required"`

	// Rate limit (Redis) nas rotas que escrevem: requisições por minuto por IP.
	RateLimitPorMinuto int `env:"RATE_LIMIT_POR_MINUTO" envDefault:"30"`

	// PostgreSQL — dados transacionais (ACID).
	PostgresURL string `env:"POSTGRES_URL,required"`
	// Réplica por streaming (Fase 5): relatórios e Laboratório de Replicação.
	// Vazio = sem réplica (as leituras vão ao primário).
	PostgresReplicaURL string `env:"POSTGRES_REPLICA_URL"`

	// PgBouncer (Fase 4) — usado só pelo Laboratório de Conexões e pelo painel.
	// A API em si conecta direto (com o próprio pool).
	PgBouncerURL      string `env:"PGBOUNCER_URL"`
	PgBouncerAdminURL string `env:"PGBOUNCER_ADMIN_URL"`

	// Laboratório de Alta Disponibilidade (Fase 5, perfil ha). Vazio = o
	// laboratório diz que os clusters não estão no ar.
	HAPostgresURL    string   `env:"HA_POSTGRES_URL"`
	HAPatroniURLs    []string `env:"HA_PATRONI_URLS" envSeparator:","`
	HAMongoURI       string   `env:"HA_MONGO_URI"`
	HARedisSentinels []string `env:"HA_REDIS_SENTINELS" envSeparator:","`

	// MongoDB — catálogo de produtos (documentos).
	MongoURI      string `env:"MONGO_URI,required"`
	MongoDatabase string `env:"MONGO_DATABASE" envDefault:"marketplace"`

	// Redis — chave-valor (sessão, carrinho, cache, ranking).
	RedisAddr     string `env:"REDIS_ADDR" envDefault:"localhost:6379"`
	RedisPassword string `env:"REDIS_PASSWORD"`

	// Cassandra — wide-column (eventos). Opcional: vazio = desabilitado.
	CassandraHosts    []string `env:"CASSANDRA_HOSTS" envSeparator:","`
	CassandraKeyspace string   `env:"CASSANDRA_KEYSPACE" envDefault:"marketplace"`

	// Neo4j — grafo (recomendações). Opcional: vazio = desabilitado.
	Neo4jURI      string `env:"NEO4J_URI"`
	Neo4jUser     string `env:"NEO4J_USER" envDefault:"neo4j"`
	Neo4jPassword string `env:"NEO4J_PASSWORD"`
}

func Load() (Config, error) {
	return env.ParseAs[Config]()
}
