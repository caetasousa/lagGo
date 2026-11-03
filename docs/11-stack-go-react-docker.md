# 11 · Stack: Go, React e Docker

## Backend (Go)

| Biblioteca | Para quê | Onde no código | Documentação |
|---|---|---|---|
| **Go 1.27** | Linguagem | — | [go.dev/doc](https://go.dev/doc/) · [Tour](https://go.dev/tour/) · [Effective Go](https://go.dev/doc/effective_go) |
| `log/slog` (stdlib) | Logs estruturados | `cmd/api/main.go` | [pkg.go.dev/log/slog](https://pkg.go.dev/log/slog) |
| **chi** v5 | Roteador HTTP compatível com `net/http` | `internal/*/adaptadores/http` | [go-chi.io](https://go-chi.io/) |
| **pgx** v5 | Driver PostgreSQL nativo + pool (`pgxpool`) | `internal/plataforma/storage/postgres.go`, adaptadores `postgres` | [pkg.go.dev](https://pkg.go.dev/github.com/jackc/pgx/v5) · [wiki](https://github.com/jackc/pgx/wiki) |
| **sqlc** | Gera Go tipado a partir de SQL | `sqlc.yaml`, `db/queries` | [docs.sqlc.dev](https://docs.sqlc.dev/) |
| **goose** v3 | Migrações versionadas | `db/migrations`, `cmd/api/main.go` | [pressly.github.io/goose](https://pressly.github.io/goose/) |
| **mongo-driver** v2 | MongoDB | `internal/plataforma/storage/mongo.go` | [Go Driver](https://www.mongodb.com/docs/drivers/go/current/) |
| **go-redis** v9 | Redis | `internal/plataforma/storage/redis.go` | [redis.uptrace.dev](https://redis.uptrace.dev/) |
| **cassandra-gocql-driver** v2 | Cassandra (driver oficial da Apache) | `internal/plataforma/storage/cassandra.go` | [GitHub](https://github.com/apache/cassandra-gocql-driver) |
| **neo4j-go-driver** v6 | Neo4j | `internal/plataforma/storage/neo4j.go` | [Go Manual](https://neo4j.com/docs/go-manual/current/) |
| **env** v11 | Configuração por variáveis de ambiente | `internal/plataforma/config` | [GitHub](https://github.com/caarlos0/env) |
| **testcontainers-go** | Bancos efêmeros nos testes de integração | `internal/plataforma/testinfra` | [golang.testcontainers.org](https://golang.testcontainers.org/) |

### Por que pgx + sqlc em vez de um ORM (GORM, ent)?

- O SQL fica **explícito**, que é o objetivo do estudo.
- O sqlc valida o SQL contra o esquema **na geração do código**.
- Sem "mágica": dá para ler e otimizar cada consulta com `EXPLAIN`.

### Fluxo para adicionar uma tabela

```bash
make migration name=cria_cliente          # cria backend/db/migrations/0000N_cria_cliente.sql
# edite o SQL (seções -- +goose Up / -- +goose Down)
# escreva as consultas em backend/db/queries/cliente.sql
make sqlc                                 # gera backend/internal/sqlcdb
make up                                   # a API aplica a migração ao subir
```

### Conceitos de Go usados com banco

- `context.Context` em **toda** chamada de banco (timeouts e cancelamento).
- `defer rows.Close()` / `pgx.CollectRows` para não vazar conexões.
- Erros com `errors.Is`/`errors.As` (ex.: `*pgconn.PgError` com `Code == "40001"`).
- Concorrência com goroutines para os testes de carga (docs/03). Exemplo: `sync.WaitGroup.Go` em `internal/plataforma/health`.

## Frontend (React)

| Biblioteca | Para quê | Documentação |
|---|---|---|
| **React 19** | UI | [react.dev](https://react.dev/learn) |
| **Vite 8** | Dev server e build | [vite.dev](https://vite.dev/guide/) |
| **TypeScript 7** | Tipagem; compilador nativo, muito mais rápido | [typescriptlang.org](https://www.typescriptlang.org/docs/) |
| **React Router 8** | Rotas (`/loja`, `/dba`) | [reactrouter.com](https://reactrouter.com/) |
| **TanStack Query 5** | Busca de dados, cache e atualização periódica (`refetchInterval`) | [tanstack.com/query](https://tanstack.com/query/latest/docs/framework/react/overview) |

Estrutura:

```
frontend/src/
├── api/client.ts             ← fetch + tipos das respostas da API
├── components/Async.tsx      ← estados de carregando/erro
├── pages/LojaPage.tsx
└── pages/dba/PainelDBAPage.tsx
```

Em desenvolvimento, o `vite.config.ts` faz proxy de `/api` para `localhost:8080`.
No Docker, o `nginx.conf` faz o mesmo para `api:8080`.

Na Fase 4 entra uma biblioteca de gráficos (ex.: [Recharts](https://recharts.github.io/))
para as métricas do Painel.

## Testes

Três níveis, do mais rápido ao mais completo. As regras (cenários antes do
código, nada de mock de banco, nada de tocar no banco de desenvolvimento)
estão no [`CLAUDE.md`](../CLAUDE.md#-testes).

| | Comando | Ferramenta | O que sobe |
|---|---|---|---|
| ⚡ | `make check` | `go test`, `tsc` | nada |
| 🐘 | `make check-db` | [Testcontainers for Go](https://golang.testcontainers.org/) | um PostgreSQL, um MongoDB (replica set) e um Redis por pacote de teste, em portas efêmeras |
| 🧭 | `make e2e` | [Playwright](https://playwright.dev/) | o stack `nosqlgo-e2e` (postgres, mongo, redis, api, web), semeado do zero |

### Integração (`internal/plataforma/testinfra`)

- **PostgreSQL:** um banco-**modelo** é migrado uma vez; cada teste ganha uma
  cópia (`CREATE DATABASE t… TEMPLATE modelo`), que custa milissegundos e é
  apagada no fim. Testes nunca enxergam os dados uns dos outros.
- **MongoDB:** um database por teste no mesmo container (replica set `rs0`,
  para haver transação).
- **Redis:** os 16 databases numerados são reciclados com `FLUSHDB`.
- `internal/app` testa o **servidor inteiro por HTTP**, montado por
  `app.Montar`, a mesma função que a API usa.

### E2E (`e2e/`)

- [`CENARIOS.md`](../e2e/CENARIOS.md): como cada funcionalidade pode quebrar.
  Cada teste cita um id (`[A4]`); id sem teste vira **lacuna** no relatório.
- [`rodar.sh`](../e2e/rodar.sh): sobe o stack isolado, semeia, roda o
  Playwright **dentro da imagem oficial** (nada de navegador instalado na
  máquina), copia o relatório e derruba tudo. `MANTER=1` deixa de pé;
  `E2E_ARGS="-g B5"` roda um cenário.
- `e2e/relatorio/resumo.md`: resultado por cenário, print de cada tela,
  commit e imagens usadas. `html/index.html` tem o *trace* das falhas.

Fontes: [Testcontainers for Go](https://golang.testcontainers.org/) ·
[Playwright: Best Practices](https://playwright.dev/docs/best-practices) ·
[Playwright: Locators](https://playwright.dev/docs/locators) ·
[Playwright em Docker](https://playwright.dev/docs/docker) ·
FOWLER, M. [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)

## Docker e Compose

| Conceito | Onde |
|---|---|
| **Multi-stage build**: compila numa imagem grande e roda numa pequena | `backend/Dockerfile`, `frontend/Dockerfile` |
| **Healthcheck**: o compose só sobe a API quando os bancos estão prontos | `docker-compose.yml` (`depends_on: condition: service_healthy`) |
| **Volumes nomeados**: os dados sobrevivem ao `docker compose down` | `pgdata`, `mongodata`... (`make reset` apaga) |
| **Profiles**: serviços opcionais | `nosql`, `tools` |
| **Bind mounts de configuração** | `infra/*/` montados como somente leitura (`:ro`) |
| **Init scripts** | `infra/postgres/init` (executa só na criação do volume) |

Documentação: [Docker Compose](https://docs.docker.com/compose/) ·
[Profiles](https://docs.docker.com/compose/how-tos/profiles/) ·
[Startup order](https://docs.docker.com/compose/how-tos/startup-order/) ·
[Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) ·
Imagens oficiais: [postgres](https://hub.docker.com/_/postgres),
[mongo](https://hub.docker.com/_/mongo), [redis](https://hub.docker.com/_/redis),
[cassandra](https://hub.docker.com/_/cassandra), [neo4j](https://hub.docker.com/_/neo4j)

### Recursos de máquina

Medido em repouso (sem carga), em 2026-11-01:

| Serviço | RAM |
|---|---|
| PostgreSQL + Redis + API + nginx | ~70 MB |
| MongoDB | ~330 MB |
| Cassandra | ~300 MB (heap limitado a 384 MB no compose) |
| Neo4j | ~580 MB com o grafo carregado (heap de 256 MB + page cache de 96 MB) |

Sob carga (seed de milhões de linhas, `pgbench`) o consumo sobe. Reserve
**3 GB** para `make up` (Cassandra e Neo4j fazem parte do núcleo desde a
Fase 7) e mais ~600 MB para o perfil `ha`. Números medidos em
[fase-7.md](fases/fase-7.md#3-resultados-medidos).

No WSL2, ajuste o limite de memória em `%UserProfile%\.wslconfig` (`memory=8GB`) se precisar.
