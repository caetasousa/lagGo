# Fase 7: wide-column e grafo

**Tópico:** 8.8 (bancos NoSQL: wide-column e grafo; CAP e PACELC)
**Status:** ✅ "vistos recentemente" (Cassandra), consistência ajustável, recomendações (Neo4j), Grafo × SQL e o quadro comparativo final

Os dois bancos que faltavam entraram na loja, cada um no problema em que é
bom. O **Cassandra** guarda os produtos que cada cliente abriu: muita escrita,
leitura sempre pela mesma chave e dado que pode sumir sozinho (TTL). O
**Neo4j** guarda quem comprou o quê e responde "quem comprou isto também
comprou…" andando dois saltos no grafo. Os dois são **secundários**: a fonte
da verdade continua no PostgreSQL. Se um deles cair, a página e a compra
seguem (X4, Y4), e o grafo inteiro se reconstrói dos pedidos.

## 1. Etapas

| # | Entregável | Onde | Como verificar |
|---|---|---|---|
| 7.0 | Cenários primeiro | [`e2e/CENARIOS.md`](../../e2e/CENARIOS.md) seções X e Y, escritas antes do código | relatório do E2E |
| 7.1 | Infra | Cassandra e Neo4j saem do perfil `nosql` e entram no núcleo com heap reduzido (`docker-compose.yml`); o `init.cql` saiu: o esquema é garantido pela API; `testinfra` e o stack de E2E sobem os dois | `[G1]`, `GET /api/health` |
| 7.2 | Vistos recentemente | [`cassandra/vistos.go`](../../backend/internal/loja/adaptadores/cassandra/vistos.go): partição por cliente, clustering `visto_em DESC`, TTL de 30 dias; `dominio.Distintos` deduplica; a página do produto registra a visita com login opcional | `[X1]`, `[X2]`, `[X4]` |
| 7.3 | LGPD | "Excluir minha conta" apaga a partição do cliente no Cassandra; o inventário de [docs/10](../10-seguranca-governanca.md#inventário-de-dados-pessoais-lgpd-art-37) ganhou as duas linhas novas | `[X5]` |
| 7.4 | Laboratório de Consistência | [`laboratorio/dominio/consistencia.go`](../../backend/internal/laboratorio/dominio/consistencia.go) (R + W > RF) e o adaptador `laboratorio/adaptadores/cassandra`: keyspaces `lab_rf1` e `lab_rf3`, uma escrita e uma leitura por nível | `[X3]` |
| 7.5 | Grafo de compras | [`neo4j/grafo.go`](../../backend/internal/loja/adaptadores/neo4j/grafo.go): `UNWIND` + `MERGE`, restrições `UNIQUE`; o checkout da loja grava a compra no grafo **depois do COMMIT**; `Recomendacoes.Reconstruir` refaz tudo a partir de [`recomendacoes.sql`](../../backend/db/queries/recomendacoes.sql) em lotes | `[Y1]`, `[Y4]` |
| 7.6 | Recomendações | "Quem comprou também comprou" na página do produto: dois saltos no Neo4j, SKUs viram produtos (MongoDB), o próprio produto sai | `[Y2]` |
| 7.7 | Laboratório Grafo × SQL | a mesma pergunta em Cypher e em SQL (`laboratorio/adaptadores/neo4j` e `postgres/grafo_sql.go`), com tempos e a conferência de que as respostas batem | `[Y3]` |
| 7.8 | Didática | tutoriais "do zero", ilustrações ([`IlustracoesFase7.tsx`](../../frontend/src/components/IlustracoesFase7.tsx)), fontes verificadas, selos `cassandra-vistos`, `cassandra-consistencia` e `neo4j-grafo`; laboratórios agrupados pelos serviços `cassandra` e `neo4j` | `[K1]`–`[K5]`, `[L6]` |
| 7.9 | Quadro comparativo final | [docs/07 §4](../07-nosql.md#4-quadro-comparativo-final): modelo, esquema, transações, escala, consistência, PACELC e casos de uso dos cinco bancos | `[M1]` |

## 2. Objetos criados

| Banco | Objeto | Para quê |
|---|---|---|
| Cassandra | keyspace `marketplace` (SimpleStrategy, RF=1) | a loja (um nó só) |
| Cassandra | tabela `vistos_por_cliente`, `PRIMARY KEY ((cliente_id), visto_em)`, `CLUSTERING ORDER BY (visto_em DESC)`, `default_time_to_live = 2592000` | "vistos recentemente": uma partição, já ordenada |
| Cassandra | keyspaces `lab_rf1`, `lab_rf3` e a tabela `contas` em cada um | Laboratório de Consistência |
| Neo4j | nós `:Cliente {id}`, `:Sku {id}`; relacionamento `:COMPROU {unidades}` | o grafo de compras |
| Neo4j | restrições `cliente_id` e `sku_id` (`UNIQUE`) | o índice que o `MERGE` usa |
| PostgreSQL | consulta `ComprasPorClienteESku` (sqlc) | a fonte do grafo: uma linha por aresta |

## 3. Resultados medidos

Na máquina de estudo (WSL, ~3,8 GB), com o seed de 100 mil pedidos.

### Reconstruir o grafo a partir dos pedidos

| Etapa | Resultado |
|---|---|
| Arestas lidas do PostgreSQL (`GROUP BY cliente, sku`) | 236.837 |
| Grafo resultante | 9.993 clientes, 2.001 SKUs, 236.837 `COMPROU` |
| Tempo total (apagar + gravar em lotes de 2.000 + contar) | **17,4 s** |

### Grafo × SQL (mesmo SKU, o mais comprado; 3 execuções)

| Pergunta | Neo4j | PostgreSQL | Respostas iguais? |
|---|---|---|---|
| Também comprou (2 saltos) | 17,6 · 17,7 · 14,2 ms | 8,1 · 8,7 · 9,4 ms | sim |
| Alcance (clientes a 3 saltos: 9.834) | 373 · 113 · 115 ms | 118 · 131 · 148 ms | sim |

A primeira execução no Neo4j paga o aquecimento (planos e page cache). Com
100 mil pedidos e os índices de `item_pedido`, o PostgreSQL **empata ou
ganha**: o volume ainda cabe todo na memória e o planejador escolhe bons
hash joins. O que o grafo entrega aqui é a **forma** da consulta: o Cypher de
3 saltos tem o mesmo jeito do de 2, e o SQL virou três CTEs. A vantagem de
desempenho da *index-free adjacency* aparece com mais saltos e com grafos
muito maiores que a memória (exercício 3).

### Consistência ajustável (um nó, RF=3 declarado)

| Nível | Réplicas exigidas | Escrita | Leitura |
|---|---|---|---|
| ONE | 1 | ✅ 17 ms | ✅ |
| QUORUM | 2 | ❌ `Cannot achieve consistency level QUORUM` | ❌ |
| ALL | 3 | ❌ `Cannot achieve consistency level ALL` | ❌ |

Com RF=1, os três níveis exigem 1 réplica e todos funcionam.

### Memória (`docker stats`, ociosos depois do seed)

Medido no stack de E2E logo depois dos testes da Fase 7 (grafo reconstruído):

| Contêiner | Memória | Limite no compose |
|---|---|---|
| Cassandra | 300 MiB | heap de 384 MB (`MAX_HEAP_SIZE`) |
| Neo4j | 577 MiB | heap de 256 MB + page cache de 96 MB (o resto é a JVM e o driver Bolt) |
| MongoDB (para comparar) | 249 MiB | — |
| PostgreSQL (para comparar) | 105 MiB | — |

Os dois bancos novos somam ~880 MiB: é por isso que entraram no núcleo com
heap reduzido, e não com os padrões (1 GB e 512 MB, que não cabiam junto do
perfil `ha` no E2E).

### Testes

TESTES_AQUI

### O que os testes pegaram durante a fase

| Onde | Defeito | Correção |
|---|---|---|
| integração `[X1]` | o esquema do Cassandra era criado com o prazo do evento (500 ms): criar keyspace e tabela leva ~1 s, e as primeiras visitas se perdiam | o esquema tem prazo próprio (30 s), separado do evento |
| ambiente de desenvolvimento (`make seed` com 100 mil pedidos) | reconstruir o grafo cheio estourava a memória por transação do Neo4j (179 MiB): o `Limpar` apagava 5.000 nós por lote com `DETACH DELETE`, e um lote levava junto todas as arestas desses nós (um SKU popular tem centenas) | apagar primeiro as arestas, depois os nós, em lotes de 10.000 (tamanho previsível) |
| E2E `[X3]` | o teste marcava o rádio com `getByLabel(...).check()`, mas o `input` dos cartões de opção é `display: none`: o primeiro "check" passava (a opção já estava marcada) e o segundo esperava para sempre | o teste clica no texto dentro do `radiogroup`, como os outros laboratórios |
| E2E `[Y1]` | o teste supunha "~3 a 10 co-compradores" por produto no seed; o real é ~80, e 15 compras novas nunca levavam o par ao topo | o teste usa a recomendação nº 1 de hoje e confere que a força dela sobe 15 depois das compras |
| E2E `[Y3]` | "Perguntar aos dois bancos" funcionava **durante** a reconstrução: comparava um grafo pela metade com o SQL ("não batem"); o teste também não esperava a reconstrução terminar | o botão fica desabilitado enquanto reconstrói; o teste espera "reconstruído em" |
| E2E `[Y1]` (com a spec do material em paralelo: 3 de 3 falhas) | a **primeira** consulta a um Neo4j recém-ligado leva ~1,2 s sozinha (JIT da JVM, page cache vazio, plano do Cypher por compilar); com a máquina ocupada passava do prazo de 3 s da página, e o primeiro visitante via "Recomendações indisponíveis". Além disso, as restrições eram criadas com o contexto da requisição: se o navegador saía da página, a criação era cancelada no meio | a API **aquece** o Neo4j ao subir (`Grafo.Aquecer`: esquema + a própria consulta das recomendações, repetindo até ele responder); `garantirEsquema` ganhou prazo próprio (`context.WithoutCancel`), como no Cassandra. Mesmo aquecido, falhou de novo: requisições canceladas pela navegação fecham a conexão do driver (o Bolt não retoma uma consulta interrompida), e abrir outra passava de 3 s com a máquina em swap (2,7 GB, o E2E inteiro não cabe nos 3,8 GB). O bloco de recomendações passou a ter **uma nova tentativa** (o padrão do app; antes era `retry: false`) |
| integração `[Y4]` (ao corrigir o `[Y1]`) | a primeira versão do prazo próprio do esquema ignorava também o PRAZO de quem chamava: com o Neo4j fora, a compra levava **30 s** (o teste só olhava o status e passava) | o esquema herda o prazo da requisição e ignora só o cancelamento; o Y4 agora exige que compra e recomendação respondam em menos de 5 s |
| integração `[Y1]`–`[Y3]` | a preparação sorteava 3 SKUs que podiam ser do mesmo produto | escolhe 3 SKUs de produtos diferentes |
| E2E `[T2]` (Fase 5) | com os 15 checkouts do `[Y1]` rodando em paralelo, o incremental copiou 62% do full (o pgBackRest copia por arquivo, e `item_pedido` mudou entre os dois backups); o teste exigia menos de 10% | a margem passou a 80%: ainda pega o incremental que copia tudo de novo |
| revisão contra o CLAUDE.md (dado pessoal novo → `Contas.Esquecer`) | "excluir minha conta" deixava o histórico de navegação no Cassandra (sumiria só pelo TTL, em 30 dias) | cenário `[X5]`, `Vistos.Apagar` (um `DELETE` pela partition key) chamado no fim de `Contas.Esquecer`; sabotagem conferida: sem a chamada, o teste falha com "3 eventos" |
| integração (desenho do Alcance) | a versão ingênua em Cypher (um `MATCH` só com `NOT (c2)-[:COMPROU]->(x)`) fazia 16,2 milhões de acessos ao banco | `collect` + `WITH DISTINCT` (como as CTEs do SQL): 426 mil acessos |

## 4. API da fase

```bash
# vistos recentemente (logado: o cookie de sessão da Fase 6)
curl -b c.txt localhost:8080/api/catalogo/produtos/<id>       # registra a visita
curl -b c.txt localhost:8080/api/conta/vistos                  # os 8 últimos distintos

# recomendações e o grafo
curl localhost:8080/api/catalogo/produtos/<id>/recomendacoes
curl localhost:8080/api/recomendacoes/grafo                    # contagens
curl -X POST localhost:8080/api/recomendacoes/grafo/reconstruir

# laboratórios
curl -X POST localhost:8080/api/lab/consistencia -H 'Content-Type: application/json' -d '{"rf":3}'
curl localhost:8080/api/lab/grafo/skus
curl -X POST localhost:8080/api/lab/grafo -H 'Content-Type: application/json' -d '{"pergunta":"alcance","sku_id":"<id>"}'
```

## 5. O frontend

- **Início:** "Vistos recentemente" (selo Cassandra), para quem está logado.
- **Produto:** "Quem comprou também comprou" (selo Neo4j), com a força de cada sugestão.
- **Laboratórios → cassandra → Consistência ajustável** (`/lab/consistencia`): escolha RF=1 ou RF=3 e veja cada nível escrever e ler.
- **Laboratórios → neo4j → Grafo × SQL** (`/lab/grafo`): reconstruir o grafo, escolher a pergunta e o SKU, ver as duas consultas, os tempos e se as respostas batem.

## 6. Exercícios para você

- [ ] **Modele outra consulta:** "quais clientes abriram ESTE produto hoje?". Por que a tabela `vistos_por_cliente` não serve? Escreva a tabela nova (dica: outra partition key) e diga quantas escritas cada visita passa a custar.
- [ ] **Partição sem limite:** um robô abre 10 milhões de produtos com a mesma conta. O que acontece com a partição dele? Como um *bucket* por dia na partition key (`(cliente_id, dia)`) resolveria, e o que a consulta passa a precisar?
- [ ] **Mais saltos:** escreva "alcance em 4 saltos" em Cypher e em SQL. Meça os dois. Em quantos saltos o SQL deixa de caber na memória da máquina?
- [ ] **Tombstones:** apague uma conta com histórico e rode `nodetool tablestats marketplace.vistos_por_cliente` no contêiner. Onde aparecem as tombstones? O que é `gc_grace_seconds` e por que ele existe num cluster com vários nós?
- [ ] **R + W > RF na prática:** com RF=3, qual a combinação de níveis de escrita e leitura que dá leitura forte e ainda aceita **escrever** com um nó fora? E para **ler** com um nó fora?
- [ ] **O grafo atrasado:** derrube o Neo4j, faça uma compra e suba de novo. A compra está no grafo? Proponha um jeito de não perder essas arestas sem transação entre bancos (dica: *outbox* no PostgreSQL ou o stream de pedidos do Redis da Fase 3).
- [ ] **Preencha você mesmo:** refaça o quadro comparativo de [docs/07 §4](../07-nosql.md#4-quadro-comparativo-final) para um sistema que você conhece. Onde você trocaria um banco por outro?

## 7. Observações

- **Um nó de cada.** O Cassandra de estudo tem um nó (RF=1 na loja); o laboratório simula as réplicas que faltam com `lab_rf3`. Um cluster de 3 nós de verdade custaria ~3 GB, mais do que a máquina tem.
- **O grafo pode atrasar.** A aresta é gravada depois do COMMIT e, se o Neo4j estiver fora, ela se perde até a próxima reconstrução (exercício 6).
- **Continua em aberto (da Fase 6):** API sem superusuário, TLS no PostgreSQL, ACL no Redis, autenticação no MongoDB e no Cassandra da loja, Docker secrets ([fase-6.md §7](fase-6.md#7-observações-para-as-próximas-fases)).
