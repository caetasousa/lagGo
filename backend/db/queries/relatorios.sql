-- Relatórios (adaptador internal/loja/adaptadores/postgres/relatorios.go, Fase 2). Técnicas: docs/02-sql.md.

-- name: VendasMensaisPorUF :many
-- CUBE gera todas as combinações de subtotais:
--   (mes, uf)  → célula      grouping = 0
--   (mes)      → total do mês grouping = 1
--   (uf)       → total da UF  grouping = 2
--   ()         → total geral  grouping = 3
-- ROLLUP (mes, uf) geraria só as três primeiras... menos o total por UF.
-- grouping() devolve um bitmask dizendo quais colunas foram "agregadas".
-- Nas linhas de subtotal a coluna agregada vem NULL; coalesce troca por ''
-- (o campo "nivel" é quem diz que tipo de linha é).
SELECT mes, coalesce(uf, '')::text AS uf,
       -- coalesce: sem nenhuma venda, o CUBE ainda devolve a linha do total
       -- geral, com sum() = NULL (soma de conjunto vazio é NULL, não 0).
       coalesce(sum(pedidos), 0)::bigint        AS pedidos,
       coalesce(sum(receita), 0)::numeric(14,2) AS receita,
       grouping(mes, uf)::int                   AS nivel
  FROM relatorio.vendas_por_dia
 WHERE mes >= (date_trunc('month', current_date) - make_interval(months => @meses::int))::date
 GROUP BY CUBE (mes, uf)
 ORDER BY mes NULLS LAST, uf NULLS LAST;

-- name: ReceitaDiaria :many
-- Funções de janela sobre a materialized view.
-- RANGE com INTERVAL considera DIAS DE CALENDÁRIO (dias sem venda contam);
-- ROWS BETWEEN 6 PRECEDING contaria as 7 últimas LINHAS, mesmo com buracos.
WITH diario AS (
    SELECT dia, sum(pedidos)::bigint AS pedidos, sum(receita) AS receita
      FROM relatorio.vendas_por_dia
     GROUP BY dia
)
SELECT dia, pedidos, receita::numeric(14,2) AS receita,
       round(avg(receita) OVER (ORDER BY dia RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW), 2)::numeric(14,2) AS media_movel_7d,
       (receita - lag(receita) OVER (ORDER BY dia))::numeric(14,2) AS variacao
  FROM diario
 ORDER BY dia DESC
 LIMIT @dias;

-- name: CurvaABC :many
-- Classificação ABC (Pareto): A = SKUs que somam os primeiros 80% da receita,
-- B = até 95%, C = o resto. Soma acumulada com janela ordenada.
-- Consulta pesada de propósito: experimento "curva-abc" do Laboratório de Índices.
WITH receita_sku AS (
    SELECT i.sku_id, sum(i.quantidade * i.preco_unitario) AS receita
      FROM item_pedido i
      JOIN pedido p ON p.id = i.pedido_id
     WHERE p.status IN ('PAGO', 'ENVIADO', 'ENTREGUE')
       AND p.criado_em >= now() - make_interval(days => @dias::int)
     GROUP BY i.sku_id
), acumulado AS (
    SELECT receita,
           sum(receita) OVER (ORDER BY receita DESC ROWS UNBOUNDED PRECEDING)
             / sum(receita) OVER () AS fracao_acumulada
      FROM receita_sku
)
SELECT (CASE WHEN fracao_acumulada <= 0.80 THEN 'A'
             WHEN fracao_acumulada <= 0.95 THEN 'B'
             ELSE 'C' END)::text            AS classe,
       count(*)::bigint                     AS skus,
       sum(receita)::numeric(14,2)          AS receita
  FROM acumulado
 GROUP BY 1
 ORDER BY 1;

-- name: ArvoreCategorias :many
-- CTE recursiva que monta o caminho ("Eletrônicos > Informática > Notebooks")
-- e conta os SKUs de cada categoria INCLUINDO as subcategorias.
WITH RECURSIVE arvore AS (
    SELECT c.id, c.nome, c.nome::text AS caminho, 1 AS nivel
      FROM categoria c
     WHERE c.pai_id IS NULL
    UNION ALL
    SELECT c.id, c.nome, a.caminho || ' > ' || c.nome, a.nivel + 1
      FROM categoria c
      JOIN arvore a ON c.pai_id = a.id
)
SELECT a.id, a.nome, a.caminho, a.nivel,
       (SELECT count(*) FROM sku s
         WHERE s.ativo
           AND s.categoria_id IN (SELECT d.id FROM categoria_descendentes(a.id) d))::bigint AS skus
  FROM arvore a
 ORDER BY a.caminho;

-- name: StatusAtualizacao :many
SELECT objeto, atualizado_em, duracao_ms FROM relatorio.atualizacao ORDER BY objeto;
