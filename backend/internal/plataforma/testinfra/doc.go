//go:build integration

// Package testinfra sobe bancos EFÊMEROS para os testes de integração
// (Testcontainers): PostgreSQL, MongoDB, Redis e, desde a Fase 7, Cassandra
// e Neo4j (nosql.go) — os bancos que o projeto usa.
//
// O que ele NÃO faz, de propósito:
//
//   - não lê .env, POSTGRES_URL nem variável de ambiente alguma;
//   - não usa porta fixa: cada container publica numa porta efêmera;
//   - não toca no banco do docker compose de desenvolvimento.
//
// Um container de cada banco por PACOTE de teste (sync.Once), derrubado no
// TestMain por Encerrar(). Cada teste ganha o seu próprio database: dois
// testes nunca enxergam os dados um do outro.
//
// As imagens são as MESMAS do docker-compose.yml. Testar contra outra versão
// seria testar outro banco — ao atualizar uma, atualize a outra. O PostgreSQL
// do compose é postgres:18.6-alpine + pgBackRest (infra/postgres/Dockerfile):
// aqui fica a imagem base, sem a réplica nem o arquivamento — esses (Fase 5)
// se testam no E2E, como o PgBouncer.
package testinfra

const (
	imagemPostgres  = "postgres:18.6-alpine"
	imagemMongo     = "mongo:9.0.4"
	imagemRedis     = "redis:8.10.3-alpine"
	imagemCassandra = "cassandra:5.0.9"
	imagemNeo4j     = "neo4j:2026.10.1-community"
)

// Encerrar derruba os containers do pacote. Chame no TestMain, depois de
// m.Run(), para não deixar container órfão — inclusive quando um teste falha.
func Encerrar() {
	encerrarPostgres()
	encerrarMongo()
	encerrarRedis()
	encerrarNoSQL()
}
