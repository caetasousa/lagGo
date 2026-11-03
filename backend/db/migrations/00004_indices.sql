-- Fase 2 · Índices nas chaves estrangeiras (docs/04-indices-otimizacao.md)
--
-- O PostgreSQL cria índice automaticamente para PRIMARY KEY e UNIQUE, mas
-- NÃO para FOREIGN KEY. Sem índice na FK:
--   * JOINs e buscas "pedidos do cliente X" leem a tabela inteira (Seq Scan);
--   * apagar/alterar a linha PAI obriga a varrer a tabela FILHA para checar a FK.
--
-- O Laboratório de Índices (tela /indices) permite remover e recriar estes
-- índices para medir a diferença com EXPLAIN ANALYZE.
--
-- Aqui usamos CREATE INDEX comum (dentro da transação da migração). Em uma
-- tabela grande em produção, use CREATE INDEX CONCURRENTLY — que não trava
-- escritas, mas não roda dentro de transação (no goose, use a anotação
-- "NO TRANSACTION" no topo do arquivo).

-- +goose Up

-- Composto: atende "WHERE cliente_id = ?" E "... ORDER BY criado_em DESC" sem sort.
CREATE INDEX idx_pedido_cliente_criado ON pedido (cliente_id, criado_em DESC);

CREATE INDEX idx_item_pedido_sku   ON item_pedido (sku_id);
CREATE INDEX idx_pagamento_pedido  ON pagamento (pedido_id);
CREATE INDEX idx_endereco_cliente  ON endereco (cliente_id);
CREATE INDEX idx_sku_vendedor      ON sku (vendedor_id);
CREATE INDEX idx_sku_categoria     ON sku (categoria_id);
CREATE INDEX idx_categoria_pai     ON categoria (pai_id);

-- Sem índice próprio, de propósito:
--   item_pedido(pedido_id)  → já é o PREFIXO da PK (pedido_id, numero)
--   pedido(endereco_id, ...) → endereços nunca são apagados (são desativados)

-- +goose Down
DROP INDEX idx_categoria_pai;
DROP INDEX idx_sku_categoria;
DROP INDEX idx_sku_vendedor;
DROP INDEX idx_endereco_cliente;
DROP INDEX idx_pagamento_pedido;
DROP INDEX idx_item_pedido_sku;
DROP INDEX idx_pedido_cliente_criado;
