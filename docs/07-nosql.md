# 07 · Bancos NoSQL (8.8)

## 1. Por que NoSQL existe

Bancos relacionais escalam bem **verticalmente** (máquina maior). Nos anos
2000, empresas como Google (BigTable, 2006) e Amazon (Dynamo, 2007)
precisavam escalar **horizontalmente** (mais máquinas) com alta
disponibilidade e aceitaram abrir mão de JOINs, esquema rígido e, em alguns
casos, de consistência forte. "NoSQL" passou a significar *Not Only SQL*.

Características comuns, não universais:

- esquema flexível (*schema-less* ou *schema-on-read*);
- distribuição nativa (particionamento/*sharding* e replicação);
- modelo de dados orientado à consulta, com desnormalização (docs/01);
- consistência ajustável ou eventual (modelo **BASE**).

## 2. Teorema CAP e PACELC

**CAP** (Brewer, 2000; provado por Gilbert e Lynch, 2002): diante de uma
**P**artição de rede, um sistema distribuído precisa escolher entre
**C**onsistência (todos veem o mesmo dado) e **A**vailability (toda
requisição recebe resposta).

**PACELC** (Abadi, 2010) completa a ideia: *se* houver Partição, escolhe-se
A ou C; *senão* (**E**lse), escolhe-se **L**atência ou **C**onsistência.

| Banco | Classificação típica | Observação |
|---|---|---|
| PostgreSQL (com réplica síncrona) | PC/EC | Consistência acima de tudo |
| MongoDB | PC/EC (padrão) | Ajustável via `writeConcern`/`readConcern`/`readPreference` |
| Redis (réplica assíncrona) | PA/EL | Pode perder escritas no failover |
| Cassandra | PA/EL (padrão) | **Consistência ajustável por consulta** (`ONE`, `QUORUM`, `ALL`) |
| Neo4j (cluster) | PC/EC | Consenso Raft no núcleo |

> Classificar um banco num quadrante do CAP simplifica demais, porque quase
> todos são configuráveis. Em prova, porém, essa tabela costuma ser cobrada.

## 3. Os quatro modelos

| Modelo | Unidade | Consulta por | Exemplos | Caso de uso no projeto |
|---|---|---|---|---|
| **Documento** | Documento JSON/BSON | Qualquer campo (com índices) | MongoDB, Couchbase, Firestore | Catálogo |
| **Chave-valor** | Par chave → valor | Só a chave | Redis, Valkey, DynamoDB, etcd | Carrinho, cache, sessão |
| **Wide-column** (famílias de colunas) | Linha com colunas dinâmicas agrupadas por partição | Chave de partição (+ clustering) | Cassandra, ScyllaDB, HBase, Bigtable | Eventos |
| **Grafo** | Nós + arestas com propriedades | Padrões de caminho | Neo4j, Amazon Neptune, Memgraph | Recomendação |

---

## MongoDB · Documentos

**Como funciona:** coleções de documentos **BSON** (JSON binário com tipos
extras: `ObjectId`, `Date`, `Decimal128`). Cada documento pode ter estrutura
diferente, mas dá para impor regras com **JSON Schema validation**.

**No projeto (Fase 3):** coleção `produtos`.

```js
{
  _id: ObjectId("..."),
  nome: "Notebook X 14",
  categoria: ["eletronicos", "informatica", "notebooks"],
  atributos: { ram_gb: 16, cpu: "...", tela_pol: 14 },   // varia por categoria
  skus: [ { sku_id: "uuid-pg", cor: "prata", preco: NumberDecimal("4999.90") } ],
  avaliacoes_recentes: [ { cliente: "Ana", nota: 5, texto: "..." } ], // padrão Subset
  nota_media: 4.7, qtd_avaliacoes: 312                                 // padrão Computed
}
```

**Conceitos para estudar:** embedding x referencing; *aggregation pipeline*
(`$match`, `$group`, `$lookup`, `$unwind`); índices (docs/04); replica set
(docs/08); *sharding* com escolha de *shard key*; `writeConcern: majority`;
change streams.

**Quando NÃO usar:** muitos relacionamentos N:M consultados de vários lados,
ou transações complexas como regra e não como exceção.

### Implementado na Fase 3

| Conceito | Onde |
|---|---|
| Validação `$jsonSchema` (`validationLevel: strict`) | [`loja/adaptadores/mongo/esquema.go`](../backend/internal/loja/adaptadores/mongo/esquema.go) |
| Índice de **texto** com pesos e idioma português | idem, `busca_texto` |
| Índice **multikey** + regra ESR (`categorias`, `preco_min`) | idem, `categoria_preco` |
| Índice **único** em campo de array (`skus.sku_id`) | idem, `sku_unico` |
| Padrões *Array of Ancestors*, *Extended Reference*, *Subset*, *Computed* | [`loja/adaptadores/mongo/documentos.go`](../backend/internal/loja/adaptadores/mongo/documentos.go) |
| `$facet` + `$bucket` (busca, total e facetas numa passada) | [`loja/adaptadores/mongo/busca.go`](../backend/internal/loja/adaptadores/mongo/busca.go) |
| `$group` + `$topN` + `$merge` (resumo das avaliações) | [`loja/adaptadores/mongo/semente.go`](../backend/internal/loja/adaptadores/mongo/semente.go) |
| Transação multi-documento + update com pipeline | [`loja/adaptadores/mongo/catalogo.go`](../backend/internal/loja/adaptadores/mongo/catalogo.go), `Avaliar` |
| `$collStats`, `serverStatus`, `replSetGetStatus` | [`painel/adaptadores/mongo/mongo.go`](../backend/internal/painel/adaptadores/mongo/mongo.go) |

Planos medidos (`$text` × regex, multikey × `COLLSCAN`) em
[fase-3.md §3](fases/fase-3.md#3-resultados-medidos).

---

## Redis · Chave-valor

**Como funciona:** banco **em memória**, com persistência opcional (RDB/AOF,
docs/08). Executa comandos em **uma única thread**, por isso cada comando é
atômico. O valor de uma chave pode ser uma estrutura de dados:

| Tipo | Uso no projeto | Comandos |
|---|---|---|
| String | Cache do produto (JSON) | `SET cache:produto:123 ... EX 300`, `GET` |
| Hash | Carrinho: `sku → quantidade` | `HSET carrinho:{sessao} sku 2`, `HGETALL`, `EXPIRE` |
| Sorted Set | Ranking de mais vendidos | `ZINCRBY mais_vendidos 2 sku`, `ZREVRANGE 0 9` |
| String + INCR | Rate limit (janela fixa) | `INCR rl:{ip}:{minuto}`, `EXPIRE 60` |
| Set | Produtos favoritos | `SADD`, `SISMEMBER` |
| Streams / Pub/Sub | Notificações ("seu pedido foi pago") | `XADD`/`XREAD` (persistente), `PUBLISH`/`SUBSCRIBE` (fire-and-forget) |
| JSON, Search (Redis 8) | Explorar como alternativa ao cache em string | `JSON.SET`, `FT.SEARCH` |

**Padrões:** *cache-aside* (lê do cache e, se faltar, busca no banco e grava
no cache), *write-through*, *TTL + invalidação*, *distributed lock* (com
cuidado: estude a discussão sobre o Redlock).

**Políticas de memória:** `maxmemory-policy` (`allkeys-lru`, `volatile-ttl`,
`noeviction`...). Veja [`infra/redis/redis.conf`](../infra/redis/redis.conf).

**Licença:** o Redis voltou a ter licença open source (AGPLv3) a partir da
versão 8. O **Valkey** é o fork mantido pela Linux Foundation e é compatível.

### Implementado na Fase 3

| Estrutura | Chave | Onde |
|---|---|---|
| HASH + `EXPIRE` em `MULTI`/`EXEC` | `carrinho:{sessao}` | [`loja/adaptadores/redis/redis.go`](../backend/internal/loja/adaptadores/redis/redis.go) |
| STRING + `SET … EX` (cache-aside) e `DEL` (invalidação) | `cache:produto:{id}` | [`loja/adaptadores/mongo/catalogo.go`](../backend/internal/loja/adaptadores/mongo/catalogo.go) |
| SORTED SET (`ZINCRBY`, `ZREVRANGE`) | `ranking:mais_vendidos` | `cart`, `catalog` |
| STREAM (`XADD … MAXLEN ~`) | `stream:pedidos` | `cart` |
| `INCR` + `EXPIRE NX` (janela fixa) | `rl:{rota}:{ip}:{minuto}` | [`plataforma/limite/limite.go`](../backend/internal/plataforma/limite/limite.go) |
| `SCAN` + `UNLINK` (nunca `KEYS`) | `cache:*` | seed e Painel do DBA |

Pipelines (`Pipelined`) mandam vários comandos numa ida só; `TxPipelined`
envolve em `MULTI/EXEC` (execução em bloco, **sem rollback**).

---

## Cassandra · Wide-column

**Como funciona:** os dados são distribuídos num **anel** por *consistent
hashing* da **chave de partição**. Não há mestre: todos os nós são iguais
(arquitetura *peer-to-peer*, herdada do Dynamo). As escritas vão para um
*commit log* e para a *memtable*, que depois vira *SSTable* imutável (árvore
**LSM**). Por isso escrever é muito barato.

**Chave primária = partição + clustering:**

```sql
PRIMARY KEY ((cliente_id), visto_em)
--           └ partition ┘ └ clustering ┘
```

- **Partition key:** define *em qual nó* o dado fica. Toda consulta deve informá-la.
- **Clustering key:** define a *ordem dentro da partição*.

**Regras de modelagem:** uma tabela por consulta; partições limitadas; nada
de JOIN (a tabela guarda **cópia** do que a tela mostra); evite
`ALLOW FILTERING`.

### Implementado na Fase 7: "vistos recentemente"

A pergunta é "quais os últimos produtos que **este** cliente abriu?". Então a
partição é o cliente e a clustering key é o instante, em ordem decrescente:
a leitura é **uma partição, já ordenada**, sem `ORDER BY` nem
`ALLOW FILTERING`.

```sql
CREATE TABLE marketplace.vistos_por_cliente (
  cliente_id uuid,
  visto_em   timeuuid,     -- instante + desempate: duas visitas no mesmo ms não se sobrescrevem
  produto_id text,
  nome       text,         -- cópia do MongoDB: não há JOIN
  PRIMARY KEY ((cliente_id), visto_em)
) WITH CLUSTERING ORDER BY (visto_em DESC)
  AND default_time_to_live = 2592000;   -- 30 dias

INSERT INTO marketplace.vistos_por_cliente (…) VALUES (…) USING TTL 2592000;
SELECT … FROM marketplace.vistos_por_cliente WHERE cliente_id = ? LIMIT 48;
```

| Decisão | Por quê |
|---|---|
| Uma linha por visita, deduplicação na API (`dominio.Distintos`) | escrever é barato (LSM, *append-only*); ler 48 linhas de uma partição também |
| TTL em toda linha | o histórico de navegação some sozinho (minimização da LGPD, cenário X2) |
| "Excluir minha conta" faz `DELETE … WHERE cliente_id = ?` | uma partição inteira some de uma vez; a *tombstone* esconde na hora e a compactação libera o espaço (X5) |
| Esquema garantido pela API a cada subida | como no MongoDB; não há `init.cql` para esquecer de rodar |
| O evento é gravado com prazo de 500 ms e o erro só é registrado | o histórico é efeito secundário: com o Cassandra fora, a página do produto abre (X4) |

Código: [`loja/adaptadores/cassandra/vistos.go`](../backend/internal/loja/adaptadores/cassandra/vistos.go).

**Consistência ajustável:** com fator de replicação RF=3, `QUORUM` = 2 nós.
Se *R + W > RF* (leituras + escritas), a leitura sempre enxerga a última
escrita.

**Laboratório de Consistência (Fase 7):** um cluster de 3 nós custaria
~3 GB. O laboratório usa o **mesmo efeito** com um nó só: cria o keyspace
`lab_rf3` com `replication_factor = 3` num cluster de **uma** réplica viva —
exatamente o que um cluster de 3 nós vê com dois nós caídos. Para cada nível
(`ONE`, `QUORUM`, `ALL`) ele escreve e lê, e mostra quem conseguiu:

| RF | ONE (precisa de 1) | QUORUM (precisa de ⌊RF/2⌋+1) | ALL (precisa de RF) |
|---|---|---|---|
| 1 | ✅ | ✅ (1) | ✅ (1) |
| 3, 1 réplica viva | ✅ — mas sem garantia de ler a última escrita | ❌ `Cannot achieve consistency level QUORUM` | ❌ |

Com `QUORUM` na escrita **e** na leitura, R + W = 2 + 2 > 3: sempre há um nó
em comum, e a leitura é forte. Com `ONE`/`ONE`, 1 + 1 ≤ 3: disponível, mas
pode ler um valor velho. É o **PA/EL** do PACELC escolhido **por consulta**.
Código: [`laboratorio/adaptadores/cassandra`](../backend/internal/laboratorio/adaptadores/cassandra/)
e a regra em [`laboratorio/dominio/consistencia.go`](../backend/internal/laboratorio/dominio/consistencia.go).

**ScyllaDB** é uma reimplementação em C++ compatível com o protocolo do
Cassandra. Você pode trocar a imagem para comparar.

---

## Neo4j · Grafos

**Como funciona:** *property graph*: **nós** com *labels* e **relacionamentos**
com tipo e direção, ambos com propriedades. A característica central é a
*index-free adjacency*: cada nó aponta diretamente para os vizinhos, então
percorrer um relacionamento custa O(1), não importa o tamanho do banco.

**Linguagem:** **Cypher**, base do padrão ISO **GQL** (2024).

### Implementado na Fase 7: "quem comprou também comprou"

O grafo é `(:Cliente)-[:COMPROU {unidades}]->(:Sku)`. Ele é **derivado** dos
pedidos do PostgreSQL: cada compra confirmada entra nele **depois do COMMIT**
(se o Neo4j estiver fora, a compra não falha — cenário Y4), e o grafo inteiro
se reconstrói a partir de `item_pedido` (botão "Reconstruir o grafo" e
`make seed`).

```cypher
// Alimentação: UNWIND transforma a lista em linhas; MERGE não duplica
UNWIND $linhas AS l
MERGE (c:Cliente {id: l.cliente})
MERGE (s:Sku {id: l.sku})
MERGE (c)-[r:COMPROU]->(s)
  ON CREATE SET r.unidades = l.unidades
  ON MATCH  SET r.unidades = r.unidades + l.unidades;

// Quem comprou algum SKU deste produto também comprou… (dois saltos)
MATCH (s:Sku) WHERE s.id IN $skus
MATCH (s)<-[:COMPROU]-(c:Cliente)-[:COMPROU]->(outro:Sku)
WHERE NOT outro.id IN $skus
RETURN outro.id AS sku, count(DISTINCT c) AS forca
ORDER BY forca DESC, sku LIMIT $limite;
```

As restrições `UNIQUE` em `Cliente.id` e `Sku.id` criam os índices que o
`MERGE` usa para achar o nó; sem elas, cada `MERGE` varreria o label inteiro.
Apagar o grafo é em lotes (`CALL … IN TRANSACTIONS`): **primeiro as arestas,
depois os nós** — um lote de nós com `DETACH DELETE` levaria junto as
centenas de arestas de um SKU popular e estouraria a memória por transação.

**Laboratório Grafo × SQL:** a mesma pergunta em Cypher (Neo4j) e em SQL
(self-join em `item_pedido`, no PostgreSQL), com o tempo de cada um e a
conferência de que as respostas são **iguais** (cenário Y3). Duas perguntas:
"também comprou" (2 saltos) e "alcance" (quantos clientes estão a 3 saltos: não compraram o SKU, mas
compraram algo que os compradores dele compraram — no SQL, uma cadeia de
CTEs com `DISTINCT` a cada salto). Os números medidos estão em
[fase-7.md](fases/fase-7.md#3-resultados-medidos): com 100 mil pedidos num
PostgreSQL bem indexado, o SQL empata ou ganha; a vantagem do grafo é a
**forma** da consulta, que não cresce com o número de saltos.

Código: [`loja/adaptadores/neo4j/grafo.go`](../backend/internal/loja/adaptadores/neo4j/grafo.go),
[`laboratorio/adaptadores/neo4j`](../backend/internal/laboratorio/adaptadores/neo4j/) e
[`laboratorio/adaptadores/postgres/grafo_sql.go`](../backend/internal/laboratorio/adaptadores/postgres/grafo_sql.go).

Neo4j Browser: http://localhost:7474 (usuário `neo4j`, senha de desenvolvimento no compose).

---

## 4. Quadro comparativo final

Como cada banco se comporta **neste projeto** e na configuração padrão de
cada um. "PA/EL" etc. segue o PACELC (seção 2): o que o banco escolhe sob
**P**artição (**A**vailability × **C**onsistency) e, **E**lse, em operação
normal (**L**atency × **C**onsistency).

| Critério | PostgreSQL | MongoDB | Redis | Cassandra | Neo4j |
|---|---|---|---|---|---|
| Modelo | relacional (tabelas, linhas) | documento (BSON) | chave-valor (estruturas em memória) | wide-column (partição + linhas ordenadas) | grafo de propriedades |
| Esquema | rígido, no banco (DDL, `CHECK`, FK) | flexível; validação opcional (`$jsonSchema`) | nenhum (o tipo é da chave) | tabela declarada, mas **uma por consulta** | sem esquema; restrições opcionais (`UNIQUE`) |
| Transações | ACID completas, `SERIALIZABLE` | ACID multi-documento (replica set) | `MULTI`/`EXEC` sem rollback; Lua atômico | por partição; LWT (`IF`) com Paxos | ACID (nó único na edição Community) |
| Escala horizontal | réplicas de leitura; escrita num primário (sharding só com extensões) | sharding nativo | Cluster (16384 slots) | nativa, sem mestre (anel) | réplicas de leitura (cluster na Enterprise) |
| Consistência | forte no primário; réplica assíncrona tem atraso | ajustável (`writeConcern`/`readConcern`) | assíncrona entre réplicas | **ajustável por consulta** (`ONE`/`QUORUM`/`ALL`) | forte no líder |
| PACELC | PC/EC | PC/EC (padrão `majority`) | PA/EL | PA/EL (ajustável até PC/EC) | PC/EC |
| Linguagem | SQL | MQL + aggregation pipeline | comandos | CQL (parece SQL, sem JOIN) | Cypher (base do ISO GQL) |
| Uso neste projeto | pedidos, estoque, contas (fonte da verdade) | catálogo, avaliações | carrinho, cache, sessão, ranking | "vistos recentemente" (eventos com TTL) | "quem comprou também comprou" |
| Melhor caso | dinheiro, estoque, integridade | agregados lidos inteiros, atributos variáveis | latência de µs, dado temporário | escrita massiva, séries por chave | relacionamentos de muitos saltos |
| Pior caso | escrita global distribuída | relações N:N com JOIN frequente | dado maior que a RAM, consulta por valor | consulta ad hoc, agregação, JOIN | agregação tabular, escrita massiva |

## Fontes para pesquisa

**Gerais**
- SADALAGE, P.; FOWLER, M. *NoSQL Essencial*. Novatec.
- KLEPPMANN, M. *Designing Data-Intensive Applications*. Cap. 2 (modelos), 3 (LSM x B-tree), 5 (replicação), 6 (particionamento), 9 (consistência).
- BREWER, E. [*CAP Twelve Years Later*](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/). InfoQ/IEEE Computer, 2012.
- ABADI, D. [*Consistency Tradeoffs in Modern Distributed Database System Design* (PACELC)](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf). IEEE Computer, 2012.
- DECANDIA, G. et al. [*Dynamo: Amazon's Highly Available Key-value Store*](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf). SOSP 2007.
- CHANG, F. et al. [*Bigtable: A Distributed Storage System for Structured Data*](https://research.google/pubs/bigtable-a-distributed-storage-system-for-structured-data/). OSDI 2006.

**MongoDB**
- [Manual](https://www.mongodb.com/docs/manual/) · [Aggregation](https://www.mongodb.com/docs/manual/aggregation/) · [Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/)
- [Schema Design Patterns](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/) · [Model Tree Structures (Array of Ancestors)](https://www.mongodb.com/docs/manual/applications/data-models-tree-structures/)
- Estágios usados: [`$facet`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/) · [`$bucket`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/bucket/) · [`$merge`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/) · [`$topN`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/topN/) · [`$collStats`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/collStats/)
- [Text Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/) · [Multikey Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/) · [Updates with Aggregation Pipeline](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/)
- [MongoDB University](https://learn.mongodb.com/): cursos gratuitos
- [Driver Go](https://www.mongodb.com/docs/drivers/go/current/)

**Redis**
- [Documentação](https://redis.io/docs/latest/) · [Tipos de dados](https://redis.io/docs/latest/develop/data-types/)
- [Streams](https://redis.io/docs/latest/develop/data-types/streams/) · [Sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) · [Pipelining](https://redis.io/docs/latest/develop/using-commands/pipelining/) · [Transactions](https://redis.io/docs/latest/develop/using-commands/transactions/)
- [SCAN](https://redis.io/docs/latest/commands/scan/) (e por que não `KEYS`) · [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- AWS. [Caching patterns (cache-aside, write-through)](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)
- NISHTALA, R. et al. [*Scaling Memcache at Facebook*](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala). NSDI 2013: cache-aside em escala, invalidação e *thundering herd*
- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832): por que memória × rede × disco
- [Redis University](https://university.redis.io/): cursos gratuitos
- [go-redis](https://redis.uptrace.dev/)
- [Valkey](https://valkey.io/)
- KLEPPMANN, M. [*How to do distributed locking*](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html): crítica ao Redlock

**Cassandra**
- [Documentação](https://cassandra.apache.org/doc/latest/) · [Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/index.html)
- [Consistência ajustável (Dynamo)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#tunable-consistency) · [Tombstones e compactação](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/index.html)
- [Driver Go (Apache)](https://github.com/apache/cassandra-gocql-driver)
- LAKSHMAN, A.; MALIK, P. [*Cassandra: A Decentralized Structured Storage System*](https://www.cs.cornell.edu/projects/ladis2009/papers/lakshman-ladis2009.pdf). LADIS 2009.

**Neo4j**
- [Cypher Manual](https://neo4j.com/docs/cypher-manual/current/) · [Driver Go](https://neo4j.com/docs/go-manual/current/)
- [`MERGE`](https://neo4j.com/docs/cypher-manual/current/clauses/merge/) · [`CALL … IN TRANSACTIONS`](https://neo4j.com/docs/cypher-manual/current/subqueries/subqueries-in-transactions/) · [Memória por transação](https://neo4j.com/docs/operations-manual/current/performance/memory-configuration/)
- [GraphAcademy](https://graphacademy.neo4j.com/): cursos gratuitos
- ROBINSON, I.; WEBBER, J.; EIFREM, E. [*Graph Databases*](https://www.oreilly.com/library/view/graph-databases-2nd/9781491930885/). 2. ed. O'Reilly.
