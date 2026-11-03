-- Consultas do checkout transacional (adaptador internal/loja/adaptadores/postgres/pedidos.go, docs/03).
-- Todas rodam DENTRO da mesma transação, via sqlcdb.Queries.WithTx(tx).

-- name: CriarPedido :one
-- Primeiro comando da transação: se a chave de idempotência já existir, a
-- violação de UNIQUE (23505) aborta tudo antes de mexer no estoque.
INSERT INTO pedido (cliente_id, endereco_id, chave_idempotencia)
VALUES (@cliente_id, @endereco_id, @chave_idempotencia)
RETURNING id;

-- name: BuscarSkusParaVenda :many
SELECT id, preco, ativo
  FROM sku
 WHERE id = ANY(@ids::uuid[]);

-- ---------------------------------------------------------------------------
-- Estratégias de baixa de estoque (comparadas no Laboratório de Concorrência)
-- ---------------------------------------------------------------------------

-- name: LerEstoque :one
-- Leitura SEM lock: usada pelas estratégias "ingenua" e "serializavel".
SELECT quantidade FROM estoque WHERE sku_id = @sku_id;

-- name: LerEstoqueComLock :one
-- Lock PESSIMISTA: trava a linha até o COMMIT/ROLLBACK. Outras transações que
-- pedirem FOR UPDATE na mesma linha ficam esperando (wait_event_type = Lock).
SELECT quantidade FROM estoque WHERE sku_id = @sku_id FOR UPDATE;

-- name: GravarEstoque :exec
-- Grava um valor ABSOLUTO calculado pela aplicação: é aqui que nasce o
-- "lost update" quando a leitura anterior não travou a linha.
-- (atualizado_em é preenchido pelo trigger trg_atualizado_em — Fase 2)
UPDATE estoque SET quantidade = @quantidade
 WHERE sku_id = @sku_id;

-- name: DebitarEstoque :exec
-- Débito RELATIVO (quantidade - x): usado depois do FOR UPDATE.
UPDATE estoque SET quantidade = quantidade - @quantidade
 WHERE sku_id = @sku_id;

-- name: DebitarEstoqueSeHouver :execrows
-- UPDATE CONDICIONAL e atômico: verificação e escrita num único comando.
-- 0 linhas afetadas = sem estoque.
UPDATE estoque SET quantidade = quantidade - @quantidade
 WHERE sku_id = @sku_id AND quantidade >= @quantidade;

-- ---------------------------------------------------------------------------

-- name: InserirItemPedido :exec
INSERT INTO item_pedido (pedido_id, numero, sku_id, quantidade, preco_unitario)
VALUES (@pedido_id, @numero, @sku_id, @quantidade, @preco_unitario);

-- name: FecharPedido :one
-- O total já foi somado item a item pelo trigger trg_total_pedido (Fase 2);
-- aqui só mudamos o status e lemos o resultado.
UPDATE pedido
   SET status = 'PAGO'
 WHERE id = @pedido_id
RETURNING total;

-- name: RegistrarPagamento :exec
-- Gateway de pagamento simulado: sempre aprova.
INSERT INTO pagamento (pedido_id, metodo, valor, status)
VALUES (@pedido_id, @metodo, @valor, 'APROVADO');

-- name: BuscarPedidoPorChave :one
SELECT id FROM pedido WHERE chave_idempotencia = @chave;

-- name: ClientesAleatorios :many
-- Laboratório: sorteia compradores (cliente + um endereço ativo dele).
SELECT c.id AS cliente_id, e.id AS endereco_id
  FROM cliente c
  JOIN endereco e ON e.cliente_id = c.id AND e.ativo
 ORDER BY random()
 LIMIT @limite;
