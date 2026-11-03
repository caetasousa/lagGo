-- Consultas do PostgreSQL usadas pelo catálogo (MongoDB) e pelo carrinho (Redis)
-- — Fase 3. O documento do produto guarda o que é descritivo; preço VIGENTE e
-- estoque vêm sempre daqui (fonte da verdade transacional).

-- name: OfertasDosSkus :many
SELECT s.id, s.produto_id, s.descricao, s.preco, s.ativo,
       e.quantidade AS estoque, v.razao_social AS vendedor
  FROM sku s
  JOIN estoque e  ON e.sku_id = s.id
  JOIN vendedor v ON v.id = s.vendedor_id
 WHERE s.id = ANY(@ids::uuid[])
 ORDER BY s.preco, s.id;

-- name: NomeDoCliente :one
SELECT nome FROM cliente WHERE id = @id;

-- ---------------------------------------------------------------- seed do catálogo

-- name: CategoriasComAncestrais :many
-- Para cada categoria, o caminho e o ARRAY DE ANCESTRAIS (raiz → ela mesma):
-- é o padrão "Array of Ancestors" que o documento do MongoDB vai guardar.
WITH RECURSIVE arvore AS (
    SELECT c.id, c.nome, c.nome::text AS caminho, ARRAY[c.id] AS ancestrais
      FROM categoria c WHERE c.pai_id IS NULL
    UNION ALL
    SELECT c.id, c.nome, a.caminho || ' > ' || c.nome, a.ancestrais || c.id
      FROM categoria c JOIN arvore a ON c.pai_id = a.id
)
SELECT id, nome, caminho, ancestrais::int[] AS ancestrais FROM arvore;

-- name: SkusParaCatalogo :many
-- preco::text: o valor EXATO ("123.45") vai do numeric para o Decimal128 do
-- MongoDB sem passar por float.
SELECT s.id, s.categoria_id, s.descricao, s.preco::text AS preco, v.razao_social AS vendedor
  FROM sku s JOIN vendedor v ON v.id = s.vendedor_id
 ORDER BY s.categoria_id, s.id;

-- name: ClientesParaAvaliacoes :many
SELECT id, nome FROM cliente ORDER BY id LIMIT @limite;

-- name: VendidosPorSkuDesde :many
-- Reconstrói o ranking do Redis a partir da fonte da verdade.
SELECT i.sku_id, sum(i.quantidade)::bigint AS vendidos
  FROM item_pedido i JOIN pedido p ON p.id = i.pedido_id
 WHERE p.criado_em >= now() - make_interval(days => @dias::int)
   AND p.status <> 'CANCELADO'
 GROUP BY i.sku_id;
