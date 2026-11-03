# 04 · Índices e otimização de consultas (8.5)

## 1. O que é um índice

Uma estrutura auxiliar que permite achar linhas **sem ler a tabela inteira**,
como o índice remissivo de um livro. O preço:

- ocupa espaço;
- **torna as escritas mais lentas**, porque cada INSERT/UPDATE/DELETE atualiza todos os índices da tabela;
- precisa de manutenção (bloat, `REINDEX`).

## 2. Tipos de índice no PostgreSQL

| Tipo | Bom para | Exemplo no projeto |
|---|---|---|
| **B-tree** (padrão) | `=`, `<`, `>`, `BETWEEN`, `ORDER BY`, prefixo `LIKE 'abc%'` | `pedido(cliente_id)` |
| **Hash** | Só `=` | Raramente compensa sobre o B-tree |
| **GIN** | Valores "compostos": arrays, JSONB, full-text, trigramas | Busca `ILIKE '%note%'` com `pg_trgm`; `tsvector` |
| **GiST** | Geometria, intervalos, vizinho mais próximo | Raio de entrega (Fase extra) |
| **SP-GiST** | Dados particionáveis (árvores quad, prefixos) | — |
| **BRIN** | Tabelas enormes **ordenadas fisicamente** (tempo) | `pedido(criado_em)`: 24 KB contra 2,2 MB do B-tree (Lab, exp. 3) |

### Variações

```sql
-- Composto: a ORDEM das colunas importa (regra do prefixo mais à esquerda)
CREATE INDEX ON pedido (cliente_id, criado_em DESC);
--   serve: WHERE cliente_id = ?            ✔
--          WHERE cliente_id = ? ORDER BY criado_em DESC  ✔
--          WHERE criado_em > ?             ✘ (não começa por cliente_id)

-- Parcial: só indexa o que interessa (menor e mais rápido)
CREATE INDEX ON pedido (criado_em) WHERE status = 'PENDENTE';

-- De expressão: a consulta precisa usar a MESMA expressão
CREATE INDEX ON cliente (lower(email));

-- Cobertura (index-only scan): inclui colunas extras na folha
CREATE INDEX ON item_pedido (sku_id) INCLUDE (quantidade, preco_unitario);

-- Sem travar escritas em produção
CREATE INDEX CONCURRENTLY ...;
```

### Conceitos que caem em prova

- **Índice primário/clustered x secundário.** No PostgreSQL toda tabela é
  um *heap* e todos os índices são secundários. O comando `CLUSTER` reordena
  a tabela uma única vez, mas a ordem não se mantém. (No SQL Server e no
  MySQL/InnoDB a PK é *clustered*.)
- **Seletividade e cardinalidade.** Índice em coluna de baixa seletividade
  (ex.: `status` com 3 valores) quase nunca ajuda, exceto como índice parcial.
- **Densidade:** índice denso tem uma entrada por registro; esparso, uma por bloco (o BRIN é parecido).

## 3. Como o otimizador decide

O PostgreSQL usa um otimizador **baseado em custo**. Ele estima quantas linhas
cada etapa retorna (usando estatísticas de `pg_stats`, coletadas pelo
`ANALYZE`) e escolhe o plano de menor custo estimado.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM pedido WHERE cliente_id = '...' ORDER BY criado_em DESC LIMIT 10;
```

Como ler:

| Nó | Significado |
|---|---|
| `Seq Scan` | Leu a tabela inteira |
| `Index Scan` | Usou o índice e foi à tabela buscar as linhas |
| `Index Only Scan` | Respondeu só com o índice (exige *visibility map* em dia, ou seja, VACUUM) |
| `Bitmap Heap Scan` | Juntou várias posições pelo índice e leu as páginas em ordem |
| `Nested Loop` / `Hash Join` / `Merge Join` | Algoritmos de junção |
| `rows=` estimado x `actual rows=` | **Diferença grande indica estatística ruim**: rode `ANALYZE` ou use `CREATE STATISTICS` |
| `Buffers: shared hit / read` | Páginas lidas do cache x do disco |

Use o [explain.dalibo.com](https://explain.dalibo.com/) ou o
[explain.depesz.com](https://explain.depesz.com/) para visualizar planos. Na
Fase 2 o Painel do DBA terá a própria tela de EXPLAIN.

## 4. Por que meu índice não foi usado?

1. Função na coluna: `WHERE lower(email) = ...` sem índice de expressão.
2. Tipo diferente: comparar `text` com `integer` provoca conversão implícita.
3. `LIKE '%abc'` (curinga no início) não usa B-tree; use GIN + `pg_trgm`.
4. A consulta retorna boa parte da tabela, e então o Seq Scan é **mais barato** mesmo.
5. Estatísticas desatualizadas.
6. `OR` entre colunas diferentes (às vezes vira BitmapOr, às vezes não).

## 5. Otimização além dos índices

- Selecione só as colunas necessárias (evite `SELECT *`).
- Paginação por **keyset** em vez de `OFFSET` grande:
  `WHERE (criado_em, id) < ($1, $2) ORDER BY criado_em DESC, id DESC LIMIT 20`.
- Evite N+1 consultas (busque os itens de vários pedidos com `= ANY($1)`).
- Materialized views para relatórios pesados (docs/05).
- Particionamento para tabelas enormes (docs/06).
- Cache no Redis para leituras repetidas (docs/07).

## 6. Índices no MongoDB (Fase 3)

```js
db.produtos.createIndex({ categoria: 1, preco: -1 })     // composto
db.produtos.createIndex({ nome: "text", descricao: "text" }) // texto
db.produtos.find({ categoria: "notebook" }).sort({ preco: -1 }).explain("executionStats")
// procure IXSCAN (bom) x COLLSCAN (varredura completa)
```

A regra **ESR** (*Equality, Sort, Range*) define a ordem das chaves num índice composto.

## 7. Laboratório de Índices (tela /indices)

Na tela **Lab: Índices** (http://localhost:3000/indices) cada experimento
tem uma consulta, os índices candidatos (com botões `CREATE INDEX` /
`DROP INDEX`) e o botão **EXPLAIN ANALYZE**. Código:
[`indices_catalogo.go`](../backend/internal/laboratorio/adaptadores/postgres/indices_catalogo.go) (catálogo) e
[`indices.go`](../backend/internal/laboratorio/adaptadores/postgres/indices.go).

| # | Experimento | Conceito |
|---|---|---|
| 1 | Últimos pedidos de um cliente | índice em FK; composto evita Sort |
| 2 | Histórico de vendas de um SKU | índice em FK; algoritmo de junção |
| 3 | Pedidos de um dia | regra do prefixo; **B-tree × BRIN** |
| 4 | Fila de pendentes | **índice parcial** × coluna de baixa seletividade |
| 5 | Nome sem diferenciar maiúsculas | **índice de expressão** |
| 6 | Trecho do e-mail (`ILIKE '%x%'`) | **GIN + pg_trgm** |
| 7 | Curva ABC | quando índice não ajuda; **work_mem** |

Os resultados medidos estão em [fase-2.md §3](fases/fase-2.md#3-resultados-medidos).

Como o laboratório executa:

- `EXPLAIN (ANALYZE, BUFFERS)` **executa** a consulta. Por isso roda numa transação `READ ONLY` que é desfeita, com `statement_timeout`, e só para consultas do catálogo.
- O parâmetro `$1` é escolhido por uma consulta (ex.: um cliente fixo), então antes e depois comparam a mesma coisa.
- Os índices são criados com `CREATE INDEX CONCURRENTLY` (não trava escritas) e, em seguida, roda-se `ANALYZE`: índices de **expressão** só ganham estatísticas depois dele.
- Cada `CREATE`/`DROP INDEX` fica registrado pelo *event trigger* de auditoria (Painel do DBA → Auditoria de esquema).

### BRIN e a ordem física

Um BRIN guarda, para cada bloco de 128 páginas, o **mínimo e o máximo** da
coluna. Ele só descarta blocos se os valores estiverem fisicamente agrupados.
Confira a correlação em `pg_stats`:

```sql
SELECT attname, correlation FROM pg_stats WHERE tablename = 'pedido';
-- criado_em ≈ 1.0 → BRIN eficaz;  ≈ 0 → BRIN inútil
```

O seed grava os pedidos em ordem cronológica (como num sistema real) e chega
a correlação 1,000. Na primeira versão do seed, com ordem aleatória, a
correlação era 0,003.

### Exercícios extras no `psql`

```sql
SET enable_seqscan = off;      -- força o uso de índice para comparar custos
SET enable_bitmapscan = off;
SET random_page_cost = 1.1;    -- SSD: deixa o índice mais atrativo
RESET ALL;

-- índices nunca usados (candidatos a remoção)
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
  FROM pg_stat_user_indexes WHERE idx_scan = 0;
```

## Fontes para pesquisa

- WINAND, M. [*Use The Index, Luke!*](https://use-the-index-luke.com/): livro gratuito, a melhor referência sobre índices B-tree
- PostgreSQL. [Indexes](https://www.postgresql.org/docs/current/indexes.html): [tipos](https://www.postgresql.org/docs/current/indexes-types.html), [multicoluna](https://www.postgresql.org/docs/current/indexes-multicolumn.html), [parciais](https://www.postgresql.org/docs/current/indexes-partial.html), [index-only scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
- PostgreSQL. [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) e [Statistics Used by the Planner](https://www.postgresql.org/docs/current/planner-stats.html)
- PostgreSQL. [GIN](https://www.postgresql.org/docs/current/gin.html), [BRIN](https://www.postgresql.org/docs/current/brin.html), [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html), [Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL Wiki: Index Maintenance](https://wiki.postgresql.org/wiki/Index_Maintenance)
- SUZUKI, H. [The Internals of PostgreSQL, cap. 3: Query Processing](https://www.interdb.jp/pg/pgsql03.html)
- BAYER, R.; McCREIGHT, E. *Organization and Maintenance of Large Ordered Indices*. Acta Informatica, 1972. [DOI](https://doi.org/10.1007/BF00288683): o artigo que criou a B-tree
- COMER, D. *The Ubiquitous B-Tree*. ACM Computing Surveys, 1979. [DOI](https://doi.org/10.1145/356770.356776)
- KLEPPMANN, M. *Designing Data-Intensive Applications*. Cap. 3, "Storage and Retrieval" (B-tree × LSM-tree)
- As fontes de **cada passo do tutorial e cada experimento** do Laboratório de Índices estão no próprio laboratório (catálogo em `frontend/src/components/fontes.tsx`)
- MongoDB. [Indexes](https://www.mongodb.com/docs/manual/indexes/) e [The ESR Rule](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
