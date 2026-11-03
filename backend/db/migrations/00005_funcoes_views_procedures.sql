-- Fase 2 · Funções, views, materialized view e procedures
-- (docs/05-procedures-triggers-views.md)

-- +goose Up

-- ============================================================ FUNÇÃO
-- Devolve a categoria e todas as descendentes (CTE recursiva).
-- STABLE: não altera o banco e, dentro de uma consulta, dá o mesmo resultado
-- para os mesmos argumentos — o planner pode otimizar com isso.
-- +goose StatementBegin
CREATE FUNCTION categoria_descendentes(p_raiz integer)
RETURNS TABLE (id integer, nivel integer)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE d AS (
        SELECT c.id, 0 AS nivel FROM categoria c WHERE c.id = p_raiz
        UNION ALL
        SELECT c.id, d.nivel + 1 FROM categoria c JOIN d ON c.pai_id = d.id
    )
    SELECT d.id, d.nivel FROM d
$$;
-- +goose StatementEnd

-- ============================================================ VIEW de segurança
-- Esconde o e-mail completo: a loja só precisa mostrar "a***@exemplo.com".
-- security_barrier impede que funções "vazadoras" no WHERE de quem consulta
-- a view sejam executadas antes do filtro da view (docs/10).
CREATE VIEW cliente_publico WITH (security_barrier) AS
SELECT id,
       nome,
       regexp_replace(email::text, '^(.)[^@]*(@.*)$', '\1***\2') AS email,
       criado_em
  FROM cliente;

-- ============================================================ MATERIALIZED VIEW
CREATE SCHEMA relatorio;

-- Vendas por dia e UF, pré-agregadas: os relatórios leem ~5 mil linhas
-- em vez de juntar 100 mil pedidos com endereços a cada acesso.
-- AT TIME ZONE fixo: sem ele, o "dia" dependeria do TimeZone da sessão
-- que executou o REFRESH.
CREATE MATERIALIZED VIEW relatorio.vendas_por_dia AS
SELECT (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date                    AS dia,
       date_trunc('month', p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
       e.uf::text                                                               AS uf,
       count(*)                                                                 AS pedidos,
       sum(p.total)                                                             AS receita
  FROM pedido p
  JOIN endereco e ON e.id = p.endereco_id
 WHERE p.status IN ('PAGO', 'ENVIADO', 'ENTREGUE')
 GROUP BY 1, 2, 3;

-- Obrigatório para REFRESH ... CONCURRENTLY (que não bloqueia leituras).
CREATE UNIQUE INDEX ON relatorio.vendas_por_dia (dia, uf);

-- Materialized views não guardam quando foram atualizadas: registramos aqui.
CREATE TABLE relatorio.atualizacao (
    objeto        text          PRIMARY KEY,
    atualizado_em timestamptz   NOT NULL,
    duracao_ms    numeric(10,1) NOT NULL
);

-- ============================================================ PROCEDURES
-- +goose StatementBegin
CREATE PROCEDURE relatorio.atualizar_vendas_por_dia()
LANGUAGE plpgsql AS $$
DECLARE
    v_inicio timestamptz := clock_timestamp();  -- clock_timestamp = relógio real; now() = início da transação
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY relatorio.vendas_por_dia;
    INSERT INTO relatorio.atualizacao (objeto, atualizado_em, duracao_ms)
    VALUES ('relatorio.vendas_por_dia', clock_timestamp(),
            extract(epoch FROM clock_timestamp() - v_inicio) * 1000)
    ON CONFLICT (objeto) DO UPDATE
        SET atualizado_em = EXCLUDED.atualizado_em, duracao_ms = EXCLUDED.duracao_ms;
END
$$;
-- +goose StatementEnd

-- Cancela pedidos PENDENTES antigos e devolve o estoque, EM LOTES.
-- Só uma PROCEDURE pode dar COMMIT no meio: cada lote libera seus locks em
-- vez de segurar milhares de linhas até o fim (uma FUNCTION não pode).
-- Restrições: não pode ser chamada dentro de BEGIN ... COMMIT do cliente e
-- não pode ser SECURITY DEFINER.
-- +goose StatementBegin
CREATE PROCEDURE cancelar_pedidos_expirados(
    p_idade         interval DEFAULT interval '2 days',
    p_lote          integer  DEFAULT 500,
    INOUT p_cancelados integer DEFAULT 0
)
LANGUAGE plpgsql AS $$
DECLARE
    v_qtd integer;
BEGIN
    p_cancelados := 0;
    LOOP
        -- CTEs que modificam dados: executam uma vez cada, na mesma instrução.
        WITH alvo AS (
            SELECT id FROM pedido
             WHERE status = 'PENDENTE' AND criado_em < now() - p_idade
             ORDER BY criado_em
             LIMIT p_lote
               FOR UPDATE SKIP LOCKED      -- ignora pedidos que outra sessão está mexendo
        ), cancelados AS (
            UPDATE pedido p SET status = 'CANCELADO'
              FROM alvo WHERE p.id = alvo.id
            RETURNING p.id
        ), devolucao AS (
            -- ORDER BY sku_id não garante a ordem dos locks num UPDATE ... FROM;
            -- concorrendo com checkouts multi-item, um deadlock é possível (e o
            -- PostgreSQL abortaria um dos lados). Discuta em docs/fases/fase-2.md.
            UPDATE estoque e SET quantidade = e.quantidade + d.qtd
              FROM (SELECT i.sku_id, sum(i.quantidade) AS qtd
                      FROM item_pedido i JOIN cancelados c ON c.id = i.pedido_id
                     GROUP BY i.sku_id) d
             WHERE e.sku_id = d.sku_id
        )
        SELECT count(*) INTO v_qtd FROM cancelados;

        EXIT WHEN v_qtd = 0;
        p_cancelados := p_cancelados + v_qtd;
        COMMIT;  -- fim do lote: grava e libera os locks
    END LOOP;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP PROCEDURE cancelar_pedidos_expirados(interval, integer, integer);
DROP PROCEDURE relatorio.atualizar_vendas_por_dia();
DROP SCHEMA relatorio CASCADE;
DROP VIEW cliente_publico;
DROP FUNCTION categoria_descendentes(integer);
