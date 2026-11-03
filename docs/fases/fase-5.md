# Fase 5: replicação, backup e alta disponibilidade

**Tópicos:** 8.10 (replicação, backup e recuperação) e 8.11 (alta disponibilidade)
**Status:** ✅ implementada · exercícios do estudante em aberto (seção 6)

A loja passou a ter uma **réplica de leitura** e **arquivamento contínuo do
WAL** com pgBackRest. Para alta disponibilidade há três **clusters só de
laboratório** (perfil `ha`): PostgreSQL com Patroni, MongoDB em replica set de
3 nós e Redis com Sentinel. Eles não substituem os bancos da loja: triplicar
os bancos do dia a dia não caberia nos 3,8 GB da máquina de estudo (seção 7).

## 1. Etapas

| # | Etapa | Entregáveis | Como verificar |
|---|---|---|---|
| 5.0 | Cenários primeiro | [`e2e/CENARIOS.md`](../../e2e/CENARIOS.md) seções S, T e U, escritas antes do código | relatório do E2E |
| 5.1 | Imagem do PostgreSQL | [`infra/postgres/Dockerfile`](../../infra/postgres/Dockerfile) (oficial + pgBackRest 2.58.0) e [`entrypoint.sh`](../../infra/postgres/entrypoint.sh): no primário cria o usuário `replicador` e a *stanza*; na réplica, clona com `pg_basebackup -R -C -S replica1`. [`pg_hba.conf`](../../infra/postgres/pg_hba.conf) passa a vir do repositório (`hba_file`) | `docker compose up`; `[S2]` |
| 5.2 | Réplica por streaming | serviço `postgres-replica`; os **relatórios leem da réplica** (cabeçalho `X-Origem-Leitura`, selo na tela) e o "Atualizar" espera a réplica alcançar o LSN do REFRESH (*read-your-writes*) | `[S1]`, `[S3]` |
| 5.3 | Painel → Replicação | [`painel/adaptadores/postgres/replicacao.go`](../../backend/internal/painel/adaptadores/postgres/replicacao.go): `pg_stat_replication` (os quatro LSNs e os atrasos), slots, `pg_stat_archiver`, o lado da réplica (`pg_stat_wal_receiver`) | `[S4]`, `[T1]` |
| 5.4 | **Lab: Replicação** | [`laboratorio/aplicacao/medidos.go`](../../backend/internal/laboratorio/aplicacao/medidos.go): grava com cada `synchronous_commit` e procura a linha na réplica; carga opcional; recusa os modos que esperam se a réplica não estiver conectada | `[S1]`, `[S5]`; `[S6]` em integração |
| 5.5 | Arquivamento + **Lab: Backup e PITR** | `archive_command = pgbackrest archive-push`, `archive_timeout`; [`laboratorio/adaptadores/postgres/backup.go`](../../backend/internal/laboratorio/adaptadores/postgres/backup.go): backups full/diff/incr e o PITR de um `DROP TABLE` numa **instância à parte** (porta 5433) | `[T2]`–`[T4]` |
| 5.6 | Perfil `ha`: PostgreSQL | etcd ×3, Patroni ×2 ([`infra/patroni/`](../../infra/patroni/)), HAProxy ([`infra/haproxy/haproxy.cfg`](../../infra/haproxy/haproxy.cfg)) | `[U1]`–`[U3]` |
| 5.7 | Perfil `ha`: MongoDB e Redis | replica set `rsha` de 3 nós com autenticação por keyfile ([`infra/mongo-ha/`](../../infra/mongo-ha/)); Redis primário + réplica + 3 Sentinels ([`infra/redis-ha/`](../../infra/redis-ha/)) | `[U4]`, `[U5]` |
| 5.8 | **Lab: Alta Disponibilidade** | pacote [`laboratorio/adaptadores/ha`](../../backend/internal/laboratorio/adaptadores/ha/): o mesmo ensaio nas três tecnologias (queda ou troca planejada, com ou sem garantia), RTO e RPO medidos; assíncrono (a tela acompanha) | `[U1]`–`[U5]`; `[U6]` em unidade |
| 5.9 | Didática | tutoriais "do zero" (Replicação; Backup e PITR; Alta disponibilidade) com ilustrações e fontes por passo; laboratórios agrupados por serviço; aba Replicação no painel | `[K2]`–`[K5]`, `[M5]` |
| 5.10 | Backend em **arquitetura hexagonal** | o backend inteiro reorganizado em três contextos — `loja`, `laboratorio`, `painel` — cada um com `dominio`, `portas`, `aplicacao` e `adaptadores`; `plataforma` para o que é comum e `app` como raiz de composição. A API HTTP não mudou. Conceito em [12 · Arquitetura hexagonal](../12-arquitetura-hexagonal.md) | `arquitetura_test.go` (regra de dependência); a suíte E2E inteira sem alteração |
| 5.11 | Tema visual e navegação | tema escuro retrofuturista "Neon 3000" em [`styles.css`](../../frontend/src/styles.css) (tokens com contraste ≥ 4,5:1; ilustrações, gráficos e diagramas Mermaid com as cores do tema); cabeçalho numa barra só, com menu em três grupos que recolhe num botão abaixo de 1000 px e marca a seção atual (inclusive dentro de um laboratório) | `[V1]`–`[V4]` |

## 2. Objetos criados

| Objeto | Onde | Para quê |
|---|---|---|
| papel `replicador` (LOGIN REPLICATION) | cluster (entrypoint) | a conexão de replicação da réplica; não lê tabelas |
| slot físico `replica1` | primário | guarda o WAL que a réplica ainda não recebeu (até `max_slot_wal_keep_size = 1GB`) |
| stanza `main` | repositório do pgBackRest (volume `pgbackrest`) | a configuração de backup do cluster |
| `lab.replicacao` | migração [`00007_replicacao.sql`](../../backend/db/migrations/00007_replicacao.sql) | os COMMITs do Laboratório de Replicação |
| `lab.pitr_clientes` | criada e apagada pelo Laboratório de Backup e PITR | a tabela "apagada sem querer" |
| `ensaio_ha` (Patroni), `ha.ensaio` (Mongo), `ha:ensaio:*` (Redis) | clusters do perfil `ha` | as escritas do ensaio de failover |

Configuração nova do PostgreSQL ([`postgresql.conf`](../../infra/postgres/postgresql.conf)): `archive_mode`, `archive_command`, `archive_timeout = 300`, `max_slot_wal_keep_size`, `hba_file`, `synchronous_standby_names = 'replica1'` com `synchronous_commit = local` (o padrão **não** espera a réplica; o laboratório pede por transação) e `hot_standby_feedback`.

## 3. Resultados medidos

Ambiente: WSL2 com 12 núcleos e 3,8 GB, seed completo (banco de ~297 MB). Valores de uma execução; a ordem de grandeza se repete.

### Replicação: o custo de cada `synchronous_commit` (50 transações)

| Modo | COMMIT p50 | COMMIT p95 | Na réplica logo após o COMMIT | Tempo até aparecer (p50 / máx.) |
|---|---|---|---|---|
| `off` | 0,28 ms | 0,60 ms | 0 de 50 | **200 ms** / 405 ms |
| `local` | 2,2 ms | 3,7 ms | 0 de 50 | 3,4 ms / 8,8 ms |
| `remote_write` | 2,9 ms | 3,9 ms | 1 de 50 | 3,0 ms / 3,9 ms |
| `on` | 5,0 ms | 7,3 ms | 50 de 50 | — |
| `remote_apply` | 4,5 ms | 8,1 ms | **50 de 50** (garantido) | — |

Com **carga** (outra conexão gravando ~3 MB de WAL por comando ao mesmo tempo):

| Modo | COMMIT p50 | COMMIT p95 | Na réplica logo após | Até aparecer (máx.) | Maior atraso visto |
|---|---|---|---|---|---|
| `local` | 5,6 ms | 11,7 ms | 0 de 50 | 180 ms | 895 KB de WAL |
| `remote_apply` | 20,9 ms | **272 ms** | 50 de 50 | — | — |

Leituras: `on` mostrou 50 de 50 só porque a réplica aplicou antes da leitura chegar — não há garantia. Com `off`, os ~200 ms são o `wal_writer_delay`: o walsender só envia WAL já gravado no disco, e com `off` quem grava é o WAL writer, em ciclos. Sob carga, `remote_apply` espera a réplica aplicar todo o WAL que veio antes: é o primeiro a sofrer.

### Backup (pgBackRest, compressão zstd)

| Backup | Duração | Copiou | No repositório | Depende de |
|---|---|---|---|---|
| full | 9,0 s | 297 MB | 50,6 MB | — |
| incr | 1,1 s | 2,5 MB | 279 KB | o full |
| diff | 0,9 s | 2,6 MB | 281 KB | o full |
| incr | 1,0 s | 2,6 MB | 285 KB | o full e o diff |

### PITR (`DROP TABLE` às cegas, recuperação numa instância à parte)

| Alvo | Esperado | Restaurado | RTO do ensaio (restore + recuperação) |
|---|---|---|---|
| logo antes do DROP | 1.500 linhas | 1.500 | 8,2–8,8 s |
| entre os dois lotes | 1.000 linhas | 1.000 | 8,6–9,9 s |

O RTO cresce com o tamanho do banco (o restore copia o cluster inteiro) e com o WAL a reaplicar: num banco de 2 TB seriam horas.

### Failover (escritor a cada 100 ms)

| Cluster | Ação | Garantia | Escrita fora (RTO) | Confirmadas perdidas (RPO) |
|---|---|---|---|---|
| Patroni | queda (kill -9 no líder) | assíncrono | **18,0 s** | 0 de 51 |
| Patroni | queda | `synchronous_mode` | 20,5 s | 0 de 51 |
| Patroni | switchover | assíncrono | 2,8 s | 0 de 74 |
| MongoDB | `shutdown` comum (com *election handoff*) | `w: 1` | **0,1 s** (nenhuma escrita falhou) | 0 de 81 |
| MongoDB | queda (shutdown **sem** handoff) | `w: 1` | **8,1 s** | 0 de 51 |
| Redis | `DEBUG SLEEP 30` no primário | sem WAIT | **6,6 s** | 0 de 51 |

Leituras: o failover do Patroni fica perto do `ttl` (20 s) — é quanto a chave de líder vale depois que ninguém a renova. O MongoDB é rápido porque elege por heartbeats (10 s de `electionTimeoutMillis`, e a detecção começou antes). O Redis segue o `down-after-milliseconds` (5 s) + quórum + promoção. Nenhum ensaio perdeu escrita confirmada: na mesma máquina a réplica recebe em milissegundos. O risco do modo assíncrono é real, mas raro — é o tipo de coisa que análises como as do Jepsen provocam com partições de rede.

**Volta do antigo líder (U3):** o `patroni1` derrubado voltou sozinho como **réplica** na linha do tempo 2 (com `pg_rewind`), sem nunca haver dois líderes.

### Memória

| Conjunto | RAM |
|---|---|
| réplica (`postgres-replica`, `shared_buffers = 128MB`) | ~80 MB |
| perfil `ha` inteiro | ~600 MB (etcd 3 × 15–28 MB, Patroni 2 × 60–70 MB, HAProxy 29 MB, Mongo 3 × 100–130 MB, Redis e Sentinels ~40 MB) |

### Testes

| Suíte | Resultado |
|---|---|
| Unidade (`make check`) | inclui `internal/laboratorio/aplicacao` e `dominio` (U6 e o cálculo do RTO) |
| Integração (`make check-db`, 6 pacotes) | todos passam, inclusive `[S6]` e a migração 00007 subindo e descendo |
| E2E (`make e2e`, com o perfil `ha`) | **66 de 66** em ~3 min (os ensaios de failover levam 40–60 s cada); depois da 5.10 e da 5.11, **70 de 70** em 3,4 min (com `[V1]`–`[V4]`) |
| Volume antigo | o banco de desenvolvimento, criado antes da fase, subiu com a imagem nova sem perder dados: o entrypoint criou o `replicador` e a stanza, e a réplica clonou e passou a receber o WAL |

### O que os testes (e os ensaios) pegaram durante a fase

| Onde | Defeito | Correção |
|---|---|---|
| E2E `[T3]` | o PITR contava as linhas **no meio da recuperação**: `pg_ctl start -w` volta assim que a instância aceita conexões, e em *hot standby* isso acontece quando ela fica consistente — antes de chegar ao alvo. Veio 1.000 onde o alvo pedia 1.500 (ou a tabela nem existia) | a instância à parte sobe com `hot_standby=off` (só aceita conexão depois de recuperar e ser promovida), a API espera, confere `pg_is_in_recovery() = false` e que a instância subiu agora, e recusa se já houver alguém na porta 5433 |
| ensaio do Laboratório de Backup | a saída JSON do `pgbackrest info` não termina com quebra de linha e "grudava" no marcador do código de saída | quebra de linha antes do marcador |
| ensaio de alta disponibilidade | MongoDB sem autenticação só aceita `shutdown` vindo de localhost | o replica set de laboratório ganhou autenticação por keyfile (como em produção) |
| ensaio de alta disponibilidade | o `shutdown` do MongoDB faz *election handoff* — a troca levava 0,1 s e não simulava queda nenhuma | para a "queda", o laboratório desliga o `enableElectionHandoff` no primário antes; a troca planejada mantém o handoff |
| ensaio de alta disponibilidade | o switchover do Patroni só responde quando termina; o cliente HTTP (2 s) desistia e o ensaio registrava "a ação falhou" | cliente com prazo maior para o switchover |
| primeira subida | a imagem do PostgreSQL 18 (Alpine) não tem `su-exec` | `gosu`, que é o que o entrypoint oficial usa |
| integração (health) | o teste listava os bancos esperados e não sabia da réplica (no testinfra ela não existe: "disabled") | a réplica entra na lista, e o teste também confere a quantidade de bancos |
| E2E `[M1]` | o título "… perfil `ha`)" do docs/09 tem nome acessível "perfil ha )" — o código dentro do título ganha um espaço | o teste compara o texto ignorando espaço antes da pontuação |
| Laboratório de Replicação (uso) | com a réplica parada, cada transação esperava 2 s pela linha: 50 transações = 100 s, e o servidor cortava em 60 s — a tela girava e falhava sem explicar (`[S7]`: 1 min 40 s no teste) | desiste se nem a primeira linha aparecer em 2 s, com mensagem dizendo o que reiniciar; teto de 15 s de espera por rodada; limpeza mesmo com a requisição cancelada |
| réplica de desenvolvimento (uso) | `docker compose up --build api` recria o primário (é dependência); o contêiner novo herda o mesmo IP e a réplica ficou presa numa conexão fantasma — `streaming` do lado dela, nada no `pg_stat_replication` — por 40 min (`[S8]`) | keepalive de TCP no `primary_conninfo` (entrypoint, vale para volume antigo): recriando o primário, a réplica voltou em 5 s |

## 4. API da fase

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dba/replicacao` | as duas pontas da replicação + arquivamento |
| POST | `/api/lab/replicacao` | `{"modo": "off" \| "local" \| "remote_write" \| "on" \| "remote_apply", "transacoes": 50, "com_carga": false}` |
| GET / POST | `/api/lab/backup` | repositório e arquivamento · `{"tipo": "full" \| "diff" \| "incr"}` |
| POST | `/api/lab/pitr` | `{"alvo": "antes-do-drop" \| "antes-do-lote2"}` |
| GET / POST | `/api/lab/ha` | os três clusters e o ensaio atual · `{"tecnologia": "patroni" \| "mongo" \| "redis", "acao": "queda" \| "planejada", "garantia": true}` (202: roda em segundo plano) |
| GET | `/api/relatorios/*` | agora com o cabeçalho `X-Origem-Leitura: replica \| primario` |
| GET | `/api/health` | novo item "PostgreSQL réplica" (falha se ela aceitar escrita) |

## 5. O frontend

| Recurso | O que faz |
|---|---|
| **Laboratório de Replicação** (`/lab/replicacao`) | os cinco `synchronous_commit`, o caminho do WAL desenhado com a etapa que o COMMIT espera, gráficos de custo e de visibilidade |
| **Laboratório de Backup e PITR** (`/lab/backup`) | backups full/diff/incr com a cadeia de dependência; o PITR com as etapas e o RTO |
| **Laboratório de Alta Disponibilidade** (`/lab/ha`) | uma aba por tecnologia: topologia desenhada, membros ao vivo, o ensaio com gráfico de escritas por segundo, eventos e conclusão (RTO/RPO) |
| **Painel → Replicação** | LSNs enviado/gravado/durável/aplicado, atrasos, slot, arquivamento e o lado da réplica |
| **Relatórios** | selo "Lido da réplica" (ou do primário, se ela estiver fora) |
| **Laboratórios por serviço** | novas seções `postgres-replica`, `patroni`, `mongo-ha`, `redis-ha` |

## 6. Exercícios para você

- [ ] **Réplica fora:** `docker compose stop postgres-replica`. O que mostram o painel (slot inativo, WAL retido), os relatórios (selo) e o Laboratório de Replicação com `remote_apply`? Suba de novo e veja-a alcançar.
- [ ] **Slot que enche o disco:** com a réplica parada, gere muito WAL (Laboratório de Replicação com carga) e acompanhe `retido_bytes`. O que acontece ao passar de `max_slot_wal_keep_size`?
- [ ] **PITR à mão:** num terminal no container do `postgres`, repita o `pgbackrest restore --type=time` do laboratório e copie a tabela de volta ao primário com `pg_dump -t` + `pg_restore`.
- [ ] **RPO do arquivamento:** com `archive_timeout = 300`, quanto se perderia se o disco do primário morresse agora? Como reduzir — e qual o custo?
- [ ] **ttl do Patroni:** `curl -X PATCH -d '{"ttl": 10, "loop_wait": 3}' http://patroni1:8008/config` (de dentro da rede) e meça o failover de novo. O que piora com um ttl pequeno?
- [ ] **Quórum do etcd:** pare dois dos três etcd e tente um switchover. Por que o Patroni do líder rebaixa a si mesmo?
- [ ] **Rollback no MongoDB:** com `w: 1`, consegue provocar um rollback? (dica: congele a replicação de um secundário antes de derrubar o primário).
- [ ] **Leia o Jepsen:** compare o que o laboratório mediu com [Jepsen: Redis](https://aphyr.com/posts/283-jepsen-redis).

## 7. Observações para as próximas fases

- **Os clusters de HA são de laboratório.** A loja segue com um primário e uma réplica: pôr Patroni na frente do banco da loja (e Mongo/Redis em cluster) triplicaria a memória do dia a dia. Numa máquina maior, o caminho é apontar a `POSTGRES_URL` para o HAProxy.
- **`COPY … FROM PROGRAM`** é como a API dispara o pgBackRest e derruba o líder do Patroni — um shell no servidor que só o superusuário tem. A **Fase 6** tira o superusuário da API: o backup passa para um serviço próprio, ou um papel com `pg_execute_server_program` restrito.
- **Credenciais novas de desenvolvimento** (`replicador`, keyfile e usuário do Mongo de laboratório): Fase 6, Docker secrets.
- **3-2-1:** o repositório do pgBackRest está no mesmo host. Um MinIO (S3) local seria a "outra mídia".
- **Replicação sem TLS** dentro da rede do compose: Fase 6.
- O `DEBUG` do Redis está ligado **só** no Redis de laboratório (`infra/redis-ha/redis.conf`).
- **Intermitência em aberto:** numa execução da suíte (02/11/2026), `[E1]` e `[H1]` falharam juntos — o `CREATE INDEX CONCURRENTLY` esperou mais de 10 s e o VACUUM não recolheu as tuplas mortas em 20 s. Os dois sintomas apontam para uma transação antiga segurando o horizonte do banco. Não se repetiu em duas execuções seguidas (25/25 e 70/70), nem com uma vigia de `pg_stat_activity` ligada. Próximo passo: deixar a vigia (transações > 3 s e `xmin` do slot da réplica) no `rodar.sh` e anexá-la ao relatório quando um teste falhar.
- **Fase 7 na arquitetura hexagonal:** Cassandra e Neo4j entram como **adaptadores** novos (`loja/adaptadores/cassandra`, `…/neo4j`) atrás de portas da loja (ex.: `portas.Eventos`, `portas.Recomendacoes`); o Transactional Outbox é um caso de uso da aplicação. Nada do domínio muda.
