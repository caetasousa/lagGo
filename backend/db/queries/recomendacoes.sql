-- Fonte do grafo de recomendações (Fase 7). Adaptador:
-- internal/loja/adaptadores/postgres/historico.go.

-- name: ComprasPorClienteESku :many
-- Uma linha por (cliente, SKU) com o total de unidades: é exatamente uma
-- aresta (Cliente)-[:COMPROU]->(Sku) do grafo. Pedido cancelado não conta.
SELECT p.cliente_id, i.sku_id, sum(i.quantidade)::int AS unidades
  FROM item_pedido i
  JOIN pedido p ON p.id = i.pedido_id
 WHERE p.status <> 'CANCELADO'
 GROUP BY p.cliente_id, i.sku_id
 ORDER BY p.cliente_id, i.sku_id;
