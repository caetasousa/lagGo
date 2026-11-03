# 02 · Linguagem SQL (8.2)

## 1. Sublinguagens

| Sigla | Nome | Comandos | No projeto |
|---|---|---|---|
| **DDL** | Data Definition | `CREATE`, `ALTER`, `DROP`, `TRUNCATE` | `backend/db/migrations/` |
| **DML** | Data Manipulation | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | `backend/db/queries/` |
| **DQL** | Data Query | `SELECT` | `backend/db/queries/`, relatórios |
| **DCL** | Data Control | `GRANT`, `REVOKE` | Fase 6 (roles) |
| **TCL** | Transaction Control | `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` | Checkout (docs/03) |

## 2. Ordem lógica de execução do SELECT

Escrevemos numa ordem e o banco avalia em outra. Entender isso explica muitos
erros, como "por que não posso usar o alias no `WHERE`?":

```
FROM / JOIN → WHERE → GROUP BY → HAVING → janelas (OVER) → SELECT → DISTINCT → ORDER BY → LIMIT/OFFSET
```

## 3. Roteiro de consultas para praticar (Fase 1 e 2)

Todas usam o modelo de [docs/01](01-modelagem-dados.md). Rode com `make psql`.

### JOINs

```sql
-- INNER: pedidos com o nome do cliente
SELECT p.id, c.nome, p.total
  FROM pedido p
  JOIN cliente c ON c.id = p.cliente_id;

-- LEFT + anti-join: clientes que nunca compraram
SELECT c.*
  FROM cliente c
  LEFT JOIN pedido p ON p.cliente_id = c.id
 WHERE p.id IS NULL;
-- equivalente com NOT EXISTS (normalmente o preferido):
SELECT c.* FROM cliente c
 WHERE NOT EXISTS (SELECT 1 FROM pedido p WHERE p.cliente_id = c.id);
```

> Pegadinha clássica: `NOT IN (subconsulta)` retorna **nada** se a subconsulta
> tiver algum `NULL`. Prefira `NOT EXISTS`.

### Agregação

```sql
SELECT v.razao_social, count(*) AS pedidos, sum(i.quantidade * i.preco_unitario) AS receita
  FROM item_pedido i
  JOIN sku s      ON s.id = i.sku_id
  JOIN vendedor v ON v.id = s.vendedor_id
 GROUP BY v.razao_social
HAVING sum(i.quantidade * i.preco_unitario) > 10000
 ORDER BY receita DESC;

-- Subtotais e total geral
SELECT date_trunc('month', criado_em) AS mes, status, sum(total)
  FROM pedido
 GROUP BY ROLLUP (1, 2);
```

### GROUPING SETS, ROLLUP e CUBE (subtotais)

Geram, numa consulta só, várias agregações em níveis diferentes. A função
`grouping(col, ...)` devolve um *bitmask* que diz quais colunas foram
"somadas" naquela linha (onde aparece `NULL` de subtotal).

| Cláusula | Agrupamentos gerados para `(mes, uf)` |
|---|---|
| `GROUP BY GROUPING SETS ((mes), (uf))` | exatamente os listados: por mês e por UF |
| `GROUP BY ROLLUP (mes, uf)` | `(mes, uf)`, `(mes)`, `()` (hierárquico, da direita para a esquerda) |
| `GROUP BY CUBE (mes, uf)` | `(mes, uf)`, `(mes)`, `(uf)`, `()` (todas as combinações, 2ⁿ) |

O relatório **Receita por mês e UF** usa `CUBE` para obter os totais por mês,
por UF e o geral numa só ida ao banco: veja `VendasMensaisPorUF` em
[`relatorios.sql`](../backend/db/queries/relatorios.sql).

### CTEs (`WITH`) e CTE recursiva

```sql
-- Árvore de categorias: Eletrônicos > Informática > Notebooks
WITH RECURSIVE arvore AS (
  SELECT id, nome, pai_id, nome::text AS caminho, 1 AS nivel
    FROM categoria WHERE pai_id IS NULL
  UNION ALL
  SELECT c.id, c.nome, c.pai_id, a.caminho || ' > ' || c.nome, a.nivel + 1
    FROM categoria c JOIN arvore a ON c.pai_id = a.id
)
SELECT * FROM arvore ORDER BY caminho;
```

### Funções de janela

```sql
-- Top 3 produtos por vendedor
SELECT * FROM (
  SELECT s.vendedor_id, s.id AS sku_id, sum(i.quantidade) AS vendidos,
         rank() OVER (PARTITION BY s.vendedor_id ORDER BY sum(i.quantidade) DESC) AS posicao
    FROM item_pedido i JOIN sku s ON s.id = i.sku_id
   GROUP BY s.vendedor_id, s.id
) t WHERE posicao <= 3;

-- Receita diária com média móvel de 7 dias e variação contra o dia anterior
SELECT dia, receita,
       avg(receita) OVER (ORDER BY dia ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS media_7d,
       receita - lag(receita) OVER (ORDER BY dia) AS variacao
  FROM vendas_por_dia;
```

**`ROWS` × `RANGE` na moldura da janela:** `ROWS BETWEEN 6 PRECEDING` conta
as 7 últimas **linhas**; se faltar um dia (sem vendas), a "média de 7 dias"
cobre 8 dias de calendário. `RANGE BETWEEN INTERVAL '6 days' PRECEDING` conta
**valores** da coluna de ordenação, então dias faltantes não distorcem. O
relatório de receita diária usa `RANGE`.

**Curva ABC (Pareto)** é um bom exercício de janela com soma acumulada:
`sum(receita) OVER (ORDER BY receita DESC ROWS UNBOUNDED PRECEDING) / sum(receita) OVER ()`.

### UPSERT e MERGE

```sql
INSERT INTO estoque (sku_id, quantidade) VALUES ($1, $2)
ON CONFLICT (sku_id) DO UPDATE SET quantidade = estoque.quantidade + EXCLUDED.quantidade;
```

### Operações de conjunto

`UNION` (remove duplicatas) x `UNION ALL` (não remove e é mais rápido),
`INTERSECT` e `EXCEPT`.

## 4. NULL e lógica de três valores

`NULL = NULL` não é verdadeiro: o resultado é **desconhecido**. Por isso
usamos `IS NULL`, `IS DISTINCT FROM` e `coalesce()`. `count(*)` conta linhas,
enquanto `count(coluna)` ignora NULLs.

## 5. SQL no Go: sempre parametrizado

```go
// ERRADO: SQL injection
pool.Query(ctx, "SELECT * FROM cliente WHERE email = '"+email+"'")
// CERTO: parâmetro posicional ($1); o driver envia o valor separado do SQL
pool.Query(ctx, "SELECT * FROM cliente WHERE email = $1", email)
```

Com o sqlc você escreve o SQL em `backend/db/queries/*.sql` e chama funções Go
tipadas. Veja [docs/11](11-stack-go-react-docker.md).

## 6. Gerar volume para os testes

```sql
INSERT INTO cliente (id, email, nome)
SELECT gen_random_uuid(), 'cliente' || g || '@exemplo.com', 'Cliente ' || g
  FROM generate_series(1, 100000) g;
```

## 7. Onde está no projeto

| Técnica | Arquivo / consulta |
|---|---|
| JOIN de 4 tabelas, `ILIKE`, parâmetro opcional (`sqlc.narg`) | [`loja.sql`](../backend/db/queries/loja.sql): `ListarSkus` |
| `DISTINCT ON` (exclusivo do PostgreSQL) | `loja.sql`: `ListarClientes` |
| `= ANY($1::uuid[])` (lista de parâmetros) | [`checkout.sql`](../backend/db/queries/checkout.sql): `BuscarSkusParaVenda` |
| `UPDATE ... WHERE` condicional, `RETURNING` | `checkout.sql`: `DebitarEstoqueSeHouver`, `FecharPedido` |
| `CUBE` + `grouping()` | [`relatorios.sql`](../backend/db/queries/relatorios.sql): `VendasMensaisPorUF` |
| Janela com `RANGE ... INTERVAL`, `lag()` | `relatorios.sql`: `ReceitaDiaria` |
| Soma acumulada (Pareto) | `relatorios.sql`: `CurvaABC` |
| CTE recursiva | `relatorios.sql`: `ArvoreCategorias`; função `categoria_descendentes()` |
| CTEs que modificam dados (`WITH ... UPDATE ... RETURNING`) | procedure `cancelar_pedidos_expirados()` em [`00005`](../backend/db/migrations/00005_funcoes_views_procedures.sql) |
| Tabelas temporárias, `generate_series`, `LATERAL` | [`seed.sql`](../backend/db/seed/seed.sql) |

## Fontes para pesquisa

- PostgreSQL. [Tutorial: The SQL Language](https://www.postgresql.org/docs/current/tutorial-sql.html)
- PostgreSQL. [Queries](https://www.postgresql.org/docs/current/queries.html), [WITH Queries (CTEs)](https://www.postgresql.org/docs/current/queries-with.html)
- PostgreSQL. [GROUPING SETS, CUBE e ROLLUP](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUPING-SETS)
- PostgreSQL. [Window Functions (tutorial)](https://www.postgresql.org/docs/current/tutorial-window.html) e [lista de funções](https://www.postgresql.org/docs/current/functions-window.html)
- PostgreSQL. [INSERT … ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html) e [MERGE](https://www.postgresql.org/docs/current/sql-merge.html)
- WINAND, M. [Modern SQL](https://modern-sql.com/): recursos do SQL padrão e suporte por banco
- [PostgreSQL Exercises](https://pgexercises.com/): exercícios interativos
- [SQLBolt](https://sqlbolt.com/): tutorial interativo para iniciantes
- OWASP. [SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
