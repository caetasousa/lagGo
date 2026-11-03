# Atalhos do projeto. `make help` lista tudo.
.PHONY: pgbench help up up-nosql up-ha up-tools up-all down reset logs ps psql mongosh redis-cli cqlsh cypher \
        backend-run frontend-dev migration sqlc seed check check-backend check-frontend check-db e2e links

COMPOSE := docker compose

help: ## Lista os comandos
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Sobe o núcleo (postgres, mongo, redis, api, web)
	$(COMPOSE) up -d --build

up-nosql: ## Sobe núcleo + cassandra + neo4j
	$(COMPOSE) --profile nosql up -d --build

up-ha: ## Sobe núcleo + clusters de alta disponibilidade (Patroni/etcd/HAProxy, Mongo rsha, Redis Sentinel; ~600 MB)
	$(COMPOSE) --profile ha up -d --build

up-tools: ## Sobe núcleo + pgAdmin + RedisInsight
	$(COMPOSE) --profile tools up -d --build

up-all: ## Sobe tudo
	$(COMPOSE) --profile nosql --profile ha --profile tools up -d --build

down: ## Para os containers (mantém os dados)
	$(COMPOSE) --profile nosql --profile tools down

reset: ## Para e APAGA todos os volumes (dados)
	$(COMPOSE) --profile nosql --profile tools down -v

logs: ## Acompanha os logs (ex.: make logs s=api)
	$(COMPOSE) logs -f $(s)

ps: ## Estado dos containers
	$(COMPOSE) --profile nosql --profile tools ps

psql: ## Console do PostgreSQL
	$(COMPOSE) exec postgres psql -U marketplace -d marketplace

mongosh: ## Console do MongoDB
	$(COMPOSE) exec mongo mongosh marketplace

redis-cli: ## Console do Redis
	$(COMPOSE) exec redis redis-cli

cqlsh: ## Console do Cassandra
	$(COMPOSE) exec cassandra cqlsh

cypher: ## Console do Neo4j
	$(COMPOSE) exec neo4j cypher-shell -u neo4j -p marketplace123

backend-run: ## Roda a API local (bancos no Docker; usa backend/.env)
	cd backend && set -a && . ./.env && set +a && go run ./cmd/api

frontend-dev: ## Roda o React com hot reload em http://localhost:5173
	cd frontend && npm run dev

migration: ## Cria migração SQL (ex.: make migration name=cria_clientes)
	cd backend && go run github.com/pressly/goose/v3/cmd/goose@v3.29.0 -s -dir db/migrations create $(name) sql

seed: ## APAGA e recria os dados de estudo (PostgreSQL, catálogo no MongoDB, Redis)
	$(COMPOSE) exec -T postgres psql -U marketplace -d marketplace < backend/db/seed/seed.sql
	$(COMPOSE) exec -T api seed-catalogo

# ------------------------------------------------------------------ qualidade
#
# Três níveis, do mais rápido ao mais completo (CLAUDE.md, seção Testes):
#   check     sem Docker: build, vet, testes unitários, typecheck e build do front
#   check-db  integração com PostgreSQL, MongoDB e Redis EFÊMEROS (Testcontainers)
#   e2e       o app inteiro pelo navegador, num stack isolado (nosqlgo-e2e)
# Nenhum deles toca no banco de desenvolvimento.

check: check-backend check-frontend ## Checks sem Docker (backend + frontend)
	@echo "✓ backend e frontend ok"

check-backend: ## go build + vet + testes unitários
	cd backend && go build ./... && go vet ./... && go vet -tags=integration ./... && go test ./...

check-frontend: ## typecheck + build do React
	cd frontend && npm run build && rm -f tsconfig.tsbuildinfo

check-db: ## Integração com bancos efêmeros (exige Docker)
	cd backend && go test -tags=integration -count=1 ./...

e2e: ## E2E do app inteiro num stack isolado (exige Docker; MANTER=1, E2E_ARGS="-g D1")
	./e2e/rodar.sh

links: ## Confere os links e âncoras do catálogo de fontes dos laboratórios (exige internet)
	node frontend/scripts/verificar-fontes.mjs

pgbench: ## Benchmark: pgbench com conexão nova por transação, direto × via PgBouncer
	$(COMPOSE) exec -T postgres sh -c 'createdb -U marketplace bench 2>/dev/null; pgbench -U marketplace -i -s 10 -q bench'
	@echo "=== direto no PostgreSQL (-C: uma conexão nova por transação; TCP + senha SCRAM, como a aplicação)"
	$(COMPOSE) exec -T -e PGPASSWORD=marketplace postgres pgbench -h 127.0.0.1 -U marketplace -c 20 -j 4 -T 10 -C -S -n bench | grep -E "^(tps|latency|number of failed)"
	@echo "=== via PgBouncer (-C também: conexões novas só no PgBouncer)"
	$(COMPOSE) exec -T -e PGPASSWORD=marketplace postgres pgbench -h pgbouncer -p 6432 -U marketplace -c 20 -j 4 -T 10 -C -S -n bench | grep -E "^(tps|latency|number of failed)"
	@echo "=== via PgBouncer, conexões mantidas (sem -C)"
	$(COMPOSE) exec -T -e PGPASSWORD=marketplace postgres pgbench -h pgbouncer -p 6432 -U marketplace -c 20 -j 4 -T 10 -S -n bench | grep -E "^(tps|latency|number of failed)"
	@echo "=== direto, conexões mantidas (sem -C: o que um pool faz)"
	$(COMPOSE) exec -T -e PGPASSWORD=marketplace postgres pgbench -h 127.0.0.1 -U marketplace -c 20 -j 4 -T 10 -S -n bench | grep -E "^(tps|latency|number of failed)"

sqlc: ## Gera código Go a partir de backend/db/queries
	docker run --rm --user $$(id -u):$$(id -g) -v $(CURDIR)/backend:/src -w /src sqlc/sqlc:1.31.1 generate
