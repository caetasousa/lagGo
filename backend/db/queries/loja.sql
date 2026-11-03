-- Consultas de leitura da loja (internal/loja).

-- name: ListarSkus :many
SELECT s.id, s.descricao, s.preco, e.quantidade AS estoque,
       v.razao_social AS vendedor, c.nome AS categoria
  FROM sku s
  JOIN estoque e   ON e.sku_id = s.id
  JOIN vendedor v  ON v.id = s.vendedor_id
  JOIN categoria c ON c.id = s.categoria_id
 WHERE s.ativo
   AND (sqlc.narg(busca)::text IS NULL OR s.descricao ILIKE '%' || sqlc.narg(busca)::text || '%')
   -- Filtro por categoria INCLUINDO subcategorias (função com CTE recursiva — Fase 2)
   AND (sqlc.narg(categoria)::int IS NULL
        OR s.categoria_id IN (SELECT d.id FROM categoria_descendentes(sqlc.narg(categoria)::int) d))
 ORDER BY (s.id = '11111111-1111-1111-1111-111111111111') DESC, s.descricao
 LIMIT @limite;

-- name: ListarClientes :many
-- DISTINCT ON (exclusivo do PostgreSQL): uma linha por cliente, com o endereço
-- ativo mais recente. O ORDER BY precisa começar pelas colunas do DISTINCT ON.
-- Lê da VIEW cliente_publico (Fase 2): o e-mail chega mascarado.
SELECT DISTINCT ON (c.nome, c.id)
       c.id, c.nome, c.email, e.id AS endereco_id, e.cidade, e.uf
  FROM cliente_publico c
  JOIN endereco e ON e.cliente_id = c.id AND e.ativo
 ORDER BY c.nome, c.id, e.criado_em DESC
 LIMIT @limite;

-- name: BuscarPedido :one
SELECT p.id, p.status, p.total, p.criado_em,
       c.nome AS cliente, e.cidade, e.uf
  FROM pedido p
  JOIN cliente c  ON c.id = p.cliente_id
  JOIN endereco e ON e.id = p.endereco_id
 WHERE p.id = @id;

-- name: ListarItensDoPedido :many
SELECT i.numero, i.sku_id, s.descricao, i.quantidade, i.preco_unitario,
       (i.quantidade * i.preco_unitario)::numeric(12,2) AS subtotal
  FROM item_pedido i
  JOIN sku s ON s.id = i.sku_id
 WHERE i.pedido_id = @pedido_id
 ORDER BY i.numero;

-- name: ListarPagamentosDoPedido :many
SELECT id, metodo, valor, status, criado_em
  FROM pagamento
 WHERE pedido_id = @pedido_id
 ORDER BY criado_em;

-- name: ListarPedidosDoCliente :many
-- "Meus pedidos" (Fase 4). Usa o índice composto (cliente_id, criado_em DESC)
-- da Fase 2: as linhas já saem na ordem, e o LIMIT para cedo.
SELECT p.id, p.status, p.total, p.criado_em,
       (SELECT count(*) FROM item_pedido i WHERE i.pedido_id = p.id)::int AS itens
  FROM pedido p
 WHERE p.cliente_id = @cliente_id
 ORDER BY p.criado_em DESC
 LIMIT @limite;
