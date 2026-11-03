# Fase 4: administração e tuning do PostgreSQL

**Tópicos:** 8.7 (administração e otimização do PostgreSQL), com laboratórios que também cobrem 8.4 (isolamento) e 8.8 (cache)
**Status:** ✅ implementada · exercícios do estudante em aberto (seção 6)

A fase também redesenhou o frontend para ser **mais didático** e simulou o
resto da loja (seção 5).

## 1. Etapas

| # | Etapa | Entregáveis | Como verificar |
|---|---|---|---|
| 4.0 | Cenários primeiro | [`e2e/CENARIOS.md`](../../e2e/CENARIOS.md) seções L, J, H, P, N, R e G4–G7, escritas antes do código | relatório do E2E |
| 4.1 | Migração de administração | [`00006_administracao.sql`](../../backend/db/migrations/00006_administracao.sql): `pg_buffercache`, `pgstattuple`, fillfactor/autovacuum do estoque, **auditoria particionada**, schema `lab` | `TestMigracoesSobemDescemESobemDeNovo` |
| 4.2 | Painel: administração | [`painel/adaptadores/postgres/postgres.go`](../../backend/internal/painel/adaptadores/postgres/postgres.go): saúde das tabelas, índices nunca usados, shared_buffers, métricas, partições, VACUUM | Painel → PostgreSQL; `[G4]`–`[G6]` |
| 4.3 | PgBouncer | serviço no compose + [`infra/pgbouncer/pgbouncer.ini`](../../infra/pgbouncer/pgbouncer.ini) comentado, `make pgbench`, painel | Painel → PgBouncer; `[G7]` |
| 4.4 | Laboratório de Índices: ajustes e particionamento | `enable_*`, `random_page_cost` por sessão; 2 experimentos de *partition pruning* | `[E3]`, `[E4]` |
| 4.5 | **Lab: Isolamento e Deadlock** | [`laboratorio/adaptadores/postgres/isolamento.go`](../../backend/internal/laboratorio/adaptadores/postgres/isolamento.go): 6 roteiros × 4 níveis | `[J1]`–`[J4]`; tabela de anomalias em integração |
| 4.6 | **Lab: MVCC e VACUUM** | [`laboratorio/adaptadores/postgres/mvcc.go`](../../backend/internal/laboratorio/adaptadores/postgres/mvcc.go) | `[H1]`–`[H3]` |
| 4.7 | **Lab: Particionamento e Expurgo** | [`laboratorio/adaptadores/postgres/expurgo.go`](../../backend/internal/laboratorio/adaptadores/postgres/expurgo.go) | `[P1]`, `[P2]` |
| 4.8 | **Lab: Conexões e PgBouncer** | [`laboratorio/adaptadores/postgres/operacoes.go`](../../backend/internal/laboratorio/adaptadores/postgres/operacoes.go) | `[N1]`–`[N3]` |
| 4.9 | **Lab: Cache** | [`laboratorio/aplicacao/medidos.go`](../../backend/internal/laboratorio/aplicacao/medidos.go) | `[R1]` |
| 4.10 | Frontend didático e loja simulada | selos de banco, "Em uma frase / Por dentro", início, conta simulada, meus pedidos, página do pedido, hub de laboratórios, painel em abas, gráficos | `[L1]`–`[L5]` |

## 2. Objetos criados no banco

| Objeto | Para quê |
|---|---|
| `pg_buffercache`, `pgstattuple` | ver o que está no `shared_buffers`; contar tuplas mortas e espaço livre exatos |
| `estoque` com `fillfactor = 80` e autovacuum a 2% | espaço para HOT updates na tabela mais atualizada; limpeza mais frequente |
| `auditoria.log` **particionada por mês** (`PRIMARY KEY (id, em)`) + `auditoria.log_padrao` (DEFAULT) | consultas por período leem uma partição; expurgo por DROP |
| `auditoria.criar_particao(timestamptz)`, `CALL auditoria.garantir_particoes(atrás, à frente)` | cria partições (a API chama ao subir) |
| `CALL auditoria.expurgar(manter_meses)` | DETACH + DROP das partições antigas |
| `auditoria.gerar_historico(mês, linhas)` | histórico **sintético** (`usuario = 'historico-sintetico'`) para o seed e o laboratório |
| schema `lab`: `conta`, `plantao`, `inchaco` (autovacuum desligado) | tabelas dos laboratórios; nada de dado da loja |
| `application_name = 'marketplace-api'` nas conexões da API | separar as conexões da API das abertas pelos experimentos |

## 3. Resultados medidos

Ambiente: WSL2 com 12 núcleos e 3,8 GB, seed completo. Valores de uma execução; a ordem de grandeza se repete.

### Isolamento (comportamento do PostgreSQL 18, confirmado em teste de integração)

| Roteiro | READ UNCOMMITTED | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|---|
| Leitura suja | **não acontece** | não | não | não |
| Leitura não repetível | acontece | **acontece** | não | não |
| Fantasma | acontece | acontece | **não** (snapshot) | não |
| Lost update | acontece | **acontece** (saldo 120, perdeu +10) | aborta **40001** | aborta 40001 |
| Write skew | acontece | acontece | **acontece** (ninguém de plantão) | aborta **40001** |
| Deadlock | vítima **40P01** após `deadlock_timeout` (~1 s), em qualquer nível |||

### MVCC e VACUUM (`lab.inchaco`, 20 mil linhas, UPDATE em 10% delas)

| Ação | Tamanho | Tuplas mortas | HOT | WAL |
|---|---|---|---|---|
| Recriar, fillfactor 100 | 3,8 MB | 0 | — | 6,8 MB |
| UPDATE coluna sem índice | 3,8 → 4,2 MB | 0 → 2.000 | **0 de 2.000** | 830 KB |
| UPDATE coluna indexada | 4,2 → 4,6 MB | → 2.000 | 0 de 2.000 | 1.084 KB |
| VACUUM | **4,6 → 4,6 MB** | 2.000 → 0 | — | ~0 |
| VACUUM FULL | **4,6 → 3,8 MB** | 0 | — | 4,7 MB |
| Recriar, fillfactor 70 | 5,4 MB (30% livre) | 0 | — | 6,8 MB |
| UPDATE coluna sem índice | **5,4 → 5,4 MB** | 0 → 2.000 | **2.000 de 2.000** | **141 KB** |

Com espaço livre na página, o UPDATE é HOT: não cresce a tabela, não toca os índices e gera ~6× menos WAL.

**Horizonte do VACUUM:** com outros testes rodando em paralelo, o VACUUM às vezes deixou versões mortas para trás — alguma transação aberta ainda podia enxergá-las. O laboratório agora mostra a transação mais antiga quando isso acontece; transação longa é a causa mais comum de tabela inchada em produção.

### Expurgo de um mês (30 mil linhas)

| Método | Duração | WAL | Arquivo | Tuplas mortas | Outros meses |
|---|---|---|---|---|---|
| DELETE | 13,4 ms | **1.645 KB** | 6,3 MB → 6,3 MB | 30.000 | 120.000 → 120.000 |
| DETACH + DROP | 8,8 ms | **22 KB** (75× menos) | removido | 0 | 120.000 → 120.000 |

### Partition pruning (auditoria de um mês, ~10 mil de 120 mil linhas)

| Consulta | Partições lidas | Buffers | Execução |
|---|---|---|---|
| `em >= $1 AND em < $1 + 1 mês` | **1** | 231 | 7,4 ms |
| a mesma com `enable_partition_pruning = off` | 18 | 674 | 21 ms |
| `date_trunc('month', em) = $1` | 18 | **2.736** | 74 ms |

### Conexões (50 clientes, 3 s, consulta curta)

| Modo | Consultas/s | p50 | p95 | Pico de processos no PostgreSQL | Erros |
|---|---|---|---|---|---|
| Conexão nova direto no PostgreSQL | 448 | 102 ms | 205 ms | 30 | 0 |
| Conexão nova no PgBouncer | 1.924 | 24 ms | 47 ms | **20** (= `default_pool_size`) | 3 (timeout de conexão) |
| Pool na aplicação (10 conexões) | **11.783** | 4 ms | 6 ms | **10** | 0 |
| Direto com **120** clientes | 350 | — | — | 51 | **630 × `53300 too many clients`** |
| PgBouncer com 120 clientes | 2.101 | — | — | 20 | 12 |

### pgbench (`make pgbench`, 20 clientes, 10 s, só leitura, TCP + SCRAM)

| Cenário | tps | Latência média |
|---|---|---|
| Conexões mantidas, direto | **23.552** | 0,85 ms |
| Conexões mantidas, via PgBouncer | 14.076 | 1,42 ms (um salto a mais) |
| Conexão nova por transação (`-C`), direto | 573 | 35 ms |
| Conexão nova por transação (`-C`), via PgBouncer | 142–205 | 98–141 ms |

**A lição:** o ganho grande é **manter conexões abertas** (pool): 40× mais tps
que abrir uma por transação. O PgBouncer **não acelera** a abertura de
conexões; o que ele faz é deixar milhares de clientes compartilharem poucas
conexões reais — ver o pico de 20 processos com 120 clientes, contra 630
recusas no modo direto.

**Em aberto (exercício):** com `-C` o PgBouncer ficou limitado a ~200
conexões/s neste ambiente, mesmo com pouca CPU. Hipóteses já **descartadas**
com medição: resolução de DNS (o `getent` é instantâneo; com IP fica igual),
CPU do PgBouncer (~10% durante o teste), negociação SSL/GSS (desligadas, igual)
e cálculo do SCRAM a partir da senha em texto (com o *verifier* no
`userlist.txt`, igual). Com 1 cliente, a conexão via PgBouncer custa 7,2 ms
contra 4,6 ms direto.

### Cache (200 leituras do mesmo produto)

| | p50 | p95 | Total |
|---|---|---|---|
| Direto no MongoDB | 0,56 ms | 1,02 ms | 125 ms |
| Cache-aside no Redis | **0,17 ms** | 0,36 ms | **43 ms** |

1 falha (a primeira) e 199 acertos; a cópia ocupa 1,1 KB no Redis.

### Testes

| Suíte | Resultado |
|---|---|
| Integração (`make check-db`, 6 pacotes) | todos passam |
| E2E (`make e2e`) | **45 de 45** cenários |

### O que os testes pegaram durante a fase

| Teste | Defeito | Correção |
|---|---|---|
| integração `[G4]` | tabelas comuns sumiam do painel: `pg_partition_tree()` devolve **zero linhas** para tabela não particionada | `UNION` com a própria tabela |
| integração `[P1]` | depois do DROP, a contagem de "outros meses" usava `::regclass` da partição que não existia mais | comparação por nome |
| integração `[H3]` | a expectativa (≥90% HOT num UPDATE da tabela inteira) estava errada: não cabe nos 30% livres de cada página | o laboratório atualiza 10% das linhas; contadores por diferença dentro da transação |
| integração `[E3]` | parâmetros com `OFFSET 4321` só funcionavam com o seed completo | parâmetro relativo ao total |
| E2E `[N2]` | o pico de conexões contava as do pool da API e as ociosas do PgBouncer | separação por `client_addr` e `application_name` |
| E2E `[G7]` | o pool do PgBouncer só nasce na primeira conexão | o teste gera tráfego antes; o painel explica |
| E2E (carrinho) | o ícone 🛒 por CSS `::before` entrava no **nome acessível** do link | ícone com `aria-hidden` |
| E2E `[A1]` | dois botões com nome "Buscar" (o da busca rápida) | nome próprio para cada um |
| prints do E2E | gráficos estreitos: `<figure>` tem margem lateral padrão | `margin: 0` |
| E2E `[P2]` (depois da entrega) | o "antes → depois" dos outros meses incluía o mês corrente, que a loja continua gravando: inserções legítimas no meio do expurgo faziam o teste falhar às vezes | a conta considera só os **meses já fechados** |
| reinício do Docker | o nginx resolve `api` só ao subir: se a API ainda não existia, o frontend morria e não voltava | `resolver` + variável no `proxy_pass` (resolve a cada requisição), `depends_on: service_healthy` e `restart: unless-stopped` |

## 4. API da fase

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dba/postgres/tabelas` · `/indices` · `/cache` · `/metricas` · `/particoes` | painel de administração |
| POST | `/api/dba/postgres/manutencao` | `{"acao": "vacuum" \| "analyze", "tabela": "public.pedido"}` |
| GET | `/api/dba/pgbouncer` | `SHOW POOLS`, `SHOW STATS`, `SHOW CONFIG` |
| GET / POST | `/api/lab/isolamento/roteiros` · `/api/lab/isolamento` | `{"roteiro": "lost-update", "nivel": "repeatable_read"}` |
| GET / POST | `/api/lab/mvcc` | `{"acao": "recriar" \| "atualizar" \| "atualizar_indexada" \| "vacuum" \| "vacuum_full", "fillfactor": 70}` |
| POST | `/api/lab/expurgo` | `{"metodo": "delete" \| "drop", "linhas": 30000}` |
| POST | `/api/lab/conexoes` | `{"modo": "direto" \| "pgbouncer" \| "pool", "clientes": 50, "segundos": 3}` |
| POST | `/api/lab/cache` | `{"leituras": 200}` |
| GET | `/api/loja/clientes/{id}/pedidos` | "Meus pedidos" |
| POST | `/api/dba/indices/experimentos/{id}/explain` | agora aceita `"ajustes": {"enable_seqscan": "off", …}` |

## 5. O frontend didático

| Recurso | O que faz |
|---|---|
| **Selo de banco** (🐘 PostgreSQL, 🍃 MongoDB, 🟥 Redis, 🔀 PgBouncer) | ao lado de cada bloco, diz de onde veio aquele dado; o *tooltip* explica por quê |
| **"Em uma frase" + "Por dentro"** | a explicação simples sempre visível; a profundidade (SQL, plano, conceito) num bloco que abre |
| **Conclusão** nos laboratórios | traduz o resultado ("45 vendas com 5 em estoque: lost update") em vez de só mostrar números |
| **Loja simulada** | início (categorias, mais vendidos, mais bem avaliados), "Entrar como" (login simulado), meus pedidos, página do pedido com a linha do tempo |
| **Laboratórios** | página que agrupa por tópico do edital, com os das próximas fases marcados como "em breve" |
| **Painel em abas** | Visão geral (com gráficos ao vivo) · PostgreSQL · MongoDB e Redis · PgBouncer · Auditoria · Manutenção |
| **Gráficos** | uma série por gráfico de linha (nunca dois eixos), barras com rótulo direto e cor fixa por entidade; paleta validada para daltonismo |

### Correção didática (depois da entrega da fase)

| Pedido | O que mudou |
|---|---|
| Mais explicação nos laboratórios, inclusive de cada opção | Todo laboratório abre com **O conceito** (linguagem simples + glossário) e mostra **Sobre esta opção** para a estratégia, situação, nível, ação ou modo escolhido: o que é, uma analogia, o comando exato e o que esperar |
| Dizer qual recurso está sendo testado ("Redis" não diz se é cache, sessão ou fila) | Catálogo de **usos** (`components/usos.tsx`): o selo agora diz "Redis · cache do produto", "Redis · carrinho da sessão", "Redis · ranking de mais vendidos", "Redis · limite de requisições", "Redis · fila de eventos de pedidos"… Cada laboratório tem a ficha **O que este laboratório usa** (estrutura, chave/tabela, por quê, comandos); o de Cache mostra os 5 usos do Redis lado a lado; o painel mostra o uso de cada prefixo de chave |
| Índices sempre foram confusos | **Índices do zero**: tutorial em 8 passos com ilustrações (Seq Scan × B-tree), o preço do índice, o planejador, as armadilhas, os tipos e como ler o plano. Cada experimento agora diz **a pergunta**, **o que o banco faz sem índice**, **o que muda com o índice** e **o que observar**; cada índice explica o que guarda; o plano vem **traduzido em passos numerados** na ordem de execução; o quadro **antes × depois** compara páginas lidas e tempo |

Cenários novos: `[L6]`, `[K1]`, `[K2]`, `[E5]`, `[E6]` — suíte E2E com **50 de 50**.

### Fontes e profundidade igual em todos os laboratórios

| Pedido | O que mudou |
|---|---|
| Dizer de onde vem cada explicação, para pesquisar | Catálogo de **fontes** (`components/fontes.tsx`, 87 fontes): cada uma tem tipo (📘 documentação oficial, 📗 livro, 📄 artigo, 🧪 ferramenta, ⚖️ lei), título, link, seção e o que ela **confirma** — para o aluno saber o que procurar ao abrir. Aparecem em três níveis: **Fontes deste passo** (cada passo dos tutoriais), **Fontes desta opção** / **Fontes deste experimento** (cada estratégia, situação, ação, modo e experimento de índice) e **Fontes para pesquisar** (a lista completa no fim de cada laboratório). Um id inexistente não compila (`IdFonte`); `make links` confere cada link **e cada âncora** (85 links, 0 falhas em 2026-11-02; o DOI da ACM devolve 403 a robôs e é só aviso) |
| O mesmo nível de detalhe do de Índices nos outros laboratórios | Todo laboratório ganhou o seu tutorial **"do zero"** (componente `Tutorial`, conteúdo em `components/tutoriais.tsx`), com 7 a 9 passos e ilustrações em SVG (`components/Ilustracoes.tsx`): **Concorrência** (transação, lost update na linha do tempo, por que o banco deixou, os três jeitos de corrigir, deadlock), **Isolamento** (snapshot em RC × RR, as anomalias, padrão × PostgreSQL, esperar ou abortar, write skew e SSI, deadlock), **MVCC e VACUUM** (páginas e tuplas, versões com xmin/xmax, visibilidade, HOT × não HOT, VACUUM, VACUUM FULL, horizonte, autovacuum e WAL), **Particionamento** (retenção e LGPD, partições, pruning, DELETE × DROP, DEFAULT e partições futuras), **Conexões** (processo por conexão, custo de conectar, `max_connections`, pool na aplicação, PgBouncer, modos de pool, p50/p95) e **Cache** (latências, Redis e os 5 usos, cache-aside falha/acerto, TTL e invalidação, eviction, o que não vai para o cache) |

Cenários novos: `[K3]` (conteúdo sem fonte) e `[K4]` (laboratório sem tutorial "do zero"). O teste do K4 percorre **todos os passos** de todos os tutoriais e exige fontes em cada um.

### Laboratórios por serviço e o material de estudo no app

| Pedido | O que mudou |
|---|---|
| Dividir os laboratórios pelos serviços do docker compose | `/labs` agrupa por serviço (`postgres`, `pgbouncer`, `mongo`, `redis`, `cassandra`, `neo4j`): o papel do serviço, os laboratórios prontos, os "em breve" com a fase do roadmap, os outros serviços envolvidos ("também usa"), o material e as telas relacionadas. O `mongo` aparece com **"Ainda sem laboratório próprio"** (hoje ele só serve a loja e o Laboratório de Cache); `cassandra` e `neo4j` indicam o perfil `nosql` e a Fase 7 |
| Os `.md` têm mais detalhe que o app: levar o mesmo conteúdo e as mesmas fontes para o React | **Material de estudo** (`/estudo`): o app renderiza os próprios `docs/*.md` (tópicos e diários das fases) com tabelas, diagramas Mermaid, sumário, âncoras iguais às do GitHub e links entre documentos. Não há cópia: o compose entrega `docs/` ao build do `web` (`additional_contexts`). Cada laboratório termina com o link **Material completo do tópico**; o "Para aprofundar" do "Por dentro" virou link |

Cenários novos: `[K5]` e `[M1]`–`[M5]`. O `[M1]` lê os arquivos `.md` (o `rodar.sh` copia `docs/` para o container do Playwright) e exige que **cada seção e cada fonte** de cada documento apareça na tela. As bibliotecas novas (react-markdown, remark-gfm, Mermaid) ficam fora do pacote principal: a página carrega sob demanda e o Mermaid só quando um documento com diagrama abre (+8 KB no pacote principal).

## 6. Exercícios para você

- [ ] **Isolamento no `psql`:** reproduza o write skew em dois terminais e depois corrija sem SERIALIZABLE (dica: `SELECT … FOR UPDATE` nas linhas lidas, ou uma restrição).
- [ ] **Horizonte do VACUUM:** abra um `BEGIN; SELECT 1;` num `psql` e deixe aberto. Rode UPDATE e VACUUM no laboratório. Quantas mortas sobram? Feche a transação e rode de novo.
- [ ] **Autovacuum:** ligue o autovacuum de `lab.inchaco` (`ALTER TABLE … SET (autovacuum_enabled = true)`), faça vários UPDATEs e veja o `ultimo_autovacuum` no painel. Calcule quando ele dispara pela fórmula `threshold + scale_factor × linhas`.
- [ ] **Partição DEFAULT:** insira uma linha com `em` daqui a 2 anos. Onde ela foi parar? Tente `CALL auditoria.garantir_particoes(0, 30)` e explique o erro.
- [ ] **Retenção:** rode `CALL auditoria.expurgar(6, NULL)` e confira as partições no Laboratório de Expurgo.
- [ ] **O mistério do PgBouncer com `-C`:** continue a investigação da seção 3 (dicas: `SHOW STATS` durante o teste, `strace`/`perf` no container, `listen_backlog`, `log_connections`).
- [ ] **`shared_buffers`:** mude para 64 MB no `postgresql.conf`, reinicie e compare a taxa de acerto do cache e o laboratório de índices.
- [ ] **pg_stat_statements:** rode `SELECT pg_stat_statements_reset()`, use a loja por 5 minutos e explique as 3 consultas mais caras.

## 7. Observações para as próximas fases

- A API ainda é superusuária: VACUUM FULL, `session_replication_role`, event triggers e o console do PgBouncer dependem disso. Fase 6.
- O PgBouncer ainda não está na frente da API (ela usa o próprio pool). Na Fase 5, com réplica e failover, ele (ou o HAProxy) passa a ser o ponto de entrada.
- A partição DEFAULT da auditoria deve ficar vazia. Um alerta no painel para "linhas na default" é um bom acréscimo.
