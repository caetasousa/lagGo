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
PRIMARY KEY ((usuario_id, dia), ocorrido_em)
--          └─ partition key ─┘ └ clustering ┘
```

- **Partition key:** define *em qual nó* o dado fica. Toda consulta deve informá-la.
- **Clustering key:** define a *ordem dentro da partição*.

Veja [`infra/cassandra/init.cql`](../infra/cassandra/init.cql).

**Regras de modelagem:** uma tabela por consulta; partições limitadas (por
isso incluímos `dia`); nada de JOIN; evite `ALLOW FILTERING`.

**Consistência ajustável:** com fator de replicação RF=3, `QUORUM` = 2 nós.
Se *R + W > RF* (leituras + escritas), a leitura sempre enxerga a última
escrita.

**Experimento (Fase 7):** `CONSISTENCY ONE;` x `CONSISTENCY QUORUM;` no
`cqlsh` com um nó desligado (exige subir 3 nós).

**ScyllaDB** é uma reimplementação em C++ compatível com o protocolo do
Cassandra. Você pode trocar a imagem para comparar.

---

## Neo4j · Grafos

**Como funciona:** *property graph*: **nós** com *labels* e **relacionamentos**
com tipo e direção, ambos com propriedades. A característica central é a
*index-free adjacency*: cada nó aponta diretamente para os vizinhos, então
percorrer um relacionamento custa O(1), não importa o tamanho do banco.

**Linguagem:** **Cypher**, base do padrão ISO **GQL** (2024).

```cypher
// Alimentado a partir dos pedidos do PostgreSQL (Fase 7)
MERGE (c:Cliente {id: $cliente})
MERGE (p:Produto {id: $produto})
MERGE (c)-[:COMPROU]->(p);

// Quem comprou este produto também comprou...
MATCH (:Produto {id: $produto})<-[:COMPROU]-(:Cliente)-[:COMPROU]->(outro:Produto)
WHERE outro.id <> $produto
RETURN outro.id, count(*) AS forca
ORDER BY forca DESC LIMIT 5;
```

**Exercício:** escreva a mesma recomendação em SQL (self-join em
`item_pedido`) e compare a legibilidade e o plano de execução. Faça o mesmo
para 3 saltos ("amigos de amigos de amigos").

Neo4j Browser: http://localhost:7474 (perfil `nosql`).

---

## 4. Quadro comparativo final (para preencher na Fase 7)

| Critério | PostgreSQL | MongoDB | Redis | Cassandra | Neo4j |
|---|---|---|---|---|---|
| Modelo | | | | | |
| Esquema | | | | | |
| Transações | | | | | |
| Escala horizontal | | | | | |
| Consistência | | | | | |
| Linguagem de consulta | | | | | |
| Melhor caso de uso | | | | | |
| Pior caso de uso | | | | | |

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
- [Driver Go (Apache)](https://github.com/apache/cassandra-gocql-driver)
- LAKSHMAN, A.; MALIK, P. [*Cassandra: A Decentralized Structured Storage System*](https://www.cs.cornell.edu/projects/ladis2009/papers/lakshman-ladis2009.pdf). LADIS 2009.

**Neo4j**
- [Cypher Manual](https://neo4j.com/docs/cypher-manual/current/) · [Driver Go](https://neo4j.com/docs/go-manual/current/)
- [GraphAcademy](https://graphacademy.neo4j.com/): cursos gratuitos
- ROBINSON, I.; WEBBER, J.; EIFREM, E. [*Graph Databases*](https://www.oreilly.com/library/view/graph-databases-2nd/9781491930885/). 2. ed. O'Reilly.
