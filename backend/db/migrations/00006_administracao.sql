-- Fase 4 · Administração e tuning do PostgreSQL (docs/06-postgresql-admin.md)
--
--  1. Extensões de diagnóstico: pg_buffercache (o que está no shared_buffers)
--     e pgstattuple (tuplas mortas e espaço livre, exatos).
--  2. estoque: fillfactor e autovacuum ajustados para a tabela mais atualizada.
--  3. auditoria.log PARTICIONADA por mês (RANGE em "em"), com procedures para
--     criar partições futuras e expurgar as antigas com DROP — em vez de DELETE.
--  4. Schema lab: tabelas dos laboratórios de Isolamento e de MVCC/VACUUM.

-- +goose Up

-- ============================================================ 1. extensões
CREATE EXTENSION IF NOT EXISTS pg_buffercache;
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- ============================================================ 2. estoque
-- fillfactor 80: cada página fica com 20% livre. Um UPDATE que não mexe em
-- coluna indexada pode gravar a nova versão NA MESMA página (HOT update):
-- sem tocar nos índices e sem crescer a tabela.
-- Autovacuum mais agressivo: o padrão (20% de tuplas mortas) demora demais
-- numa tabela pequena e muito atualizada.
ALTER TABLE estoque SET (fillfactor = 80,
                         autovacuum_vacuum_scale_factor = 0.02,
                         autovacuum_analyze_scale_factor = 0.02);

-- ============================================================ 3. auditoria.log particionada
-- Uma tabela de log só cresce. Particionada por mês:
--   * consultas por período leem só as partições do período (partition pruning);
--   * expurgar um mês é DROP TABLE da partição: instantâneo, quase sem WAL e
--     sem tuplas mortas — um DELETE do mesmo mês reescreveria cada linha.
-- A chave primária de uma tabela particionada PRECISA conter a chave de partição.
ALTER TABLE auditoria.log RENAME TO log_antigo;

CREATE TABLE auditoria.log (
    id        bigint      GENERATED ALWAYS AS IDENTITY,
    tabela    text        NOT NULL,
    operacao  text        NOT NULL,
    chave     text,
    usuario   text        NOT NULL DEFAULT current_user,
    aplicacao text        DEFAULT current_setting('application_name', true),
    transacao bigint      NOT NULL DEFAULT pg_current_xact_id()::text::bigint,
    em        timestamptz NOT NULL DEFAULT now(),
    antes     jsonb,
    depois    jsonb,
    PRIMARY KEY (id, em)
) PARTITION BY RANGE (em);

COMMENT ON TABLE auditoria.log IS
  'Trilha de auditoria (DML), particionada por mês. Expurgo: CALL auditoria.expurgar(meses). Atenção LGPD (docs/10).';

-- Partição DEFAULT: recebe o que cair fora de todas as faixas, em vez de dar
-- erro. Deve ficar VAZIA: criar uma partição cuja faixa tenha linhas na
-- default falha (e varrer a default para checar custa caro).
CREATE TABLE auditoria.log_padrao PARTITION OF auditoria.log DEFAULT;

-- +goose StatementBegin
CREATE FUNCTION auditoria.criar_particao(p_inicio timestamptz) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_tz     constant text := 'America/Sao_Paulo';
    v_mes    timestamp := date_trunc('month', p_inicio AT TIME ZONE v_tz);
    v_nome   text := 'log_' || to_char(v_mes, 'YYYYMM');
BEGIN
    IF to_regclass('auditoria.' || v_nome) IS NULL THEN
        -- format(%I, %L): identificador e literal escapados — SQL dinâmico seguro.
        EXECUTE format('CREATE TABLE auditoria.%I PARTITION OF auditoria.log FOR VALUES FROM (%L) TO (%L)',
                       v_nome, v_mes AT TIME ZONE v_tz, (v_mes + interval '1 month') AT TIME ZONE v_tz);
    END IF;
    RETURN v_nome;
END
$$;
-- +goose StatementEnd

-- Cria as partições de p_meses_atras até p_meses_frente (idempotente). A API
-- chama ao subir; em produção, um agendador (pg_cron) ou a extensão pg_partman.
-- +goose StatementBegin
CREATE PROCEDURE auditoria.garantir_particoes(p_meses_atras integer DEFAULT 1, p_meses_frente integer DEFAULT 3)
LANGUAGE plpgsql AS $$
BEGIN
    FOR i IN -p_meses_atras .. p_meses_frente LOOP
        PERFORM auditoria.criar_particao(now() + make_interval(months => i));
    END LOOP;
END
$$;
-- +goose StatementEnd

-- Expurgo por retenção: DETACH + DROP das partições mais antigas que
-- p_manter_meses. Devolve quantas partições saíram.
-- +goose StatementBegin
CREATE PROCEDURE auditoria.expurgar(p_manter_meses integer, INOUT p_removidas integer DEFAULT 0)
LANGUAGE plpgsql AS $$
DECLARE
    v_corte date := (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                     - make_interval(months => p_manter_meses))::date;
    r record;
BEGIN
    p_removidas := 0;
    FOR r IN
        SELECT c.relname
          FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = 'auditoria.log'::regclass
           AND c.relname ~ '^log_[0-9]{6}$'
           AND to_date(substr(c.relname, 5), 'YYYYMM') < v_corte
         ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE auditoria.log DETACH PARTITION auditoria.%I', r.relname);
        EXECUTE format('DROP TABLE auditoria.%I', r.relname);
        p_removidas := p_removidas + 1;
    END LOOP;
END
$$;
-- +goose StatementEnd

-- Histórico sintético (seed e Laboratório de Expurgo). Marcado como
-- usuario = 'historico-sintetico' para nunca se confundir com auditoria real.
-- +goose StatementBegin
CREATE FUNCTION auditoria.gerar_historico(p_inicio timestamptz, p_linhas integer) RETURNS integer
LANGUAGE sql AS $$
    -- O mês é calculado no MESMO fuso das partições: no fuso da sessão (ex.:
    -- UTC), as primeiras horas cairiam no mês anterior — e na partição DEFAULT.
    WITH mes AS (
        SELECT date_trunc('month', p_inicio AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS ini,
               (date_trunc('month', p_inicio AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo' AS fim
    )
    INSERT INTO auditoria.log (tabela, operacao, chave, usuario, aplicacao, transacao, em, antes, depois)
    SELECT (ARRAY['pedido', 'pagamento', 'sku'])[1 + g % 3],
           'UPDATE',
           md5(g::text),
           'historico-sintetico',
           'seed',
           g,
           mes.ini + random() * (mes.fim - mes.ini - interval '1 second'),
           jsonb_build_object('status', 'PAGO'),
           jsonb_build_object('status', 'ENVIADO')
      FROM generate_series(1, p_linhas) g, mes;
    SELECT p_linhas;
$$;
-- +goose StatementEnd

CALL auditoria.garantir_particoes(1, 3);

-- Copia o que já havia (OVERRIDING: mantém os ids) e ajusta a sequência.
INSERT INTO auditoria.log OVERRIDING SYSTEM VALUE SELECT * FROM auditoria.log_antigo;
SELECT setval(pg_get_serial_sequence('auditoria.log', 'id'),
              coalesce((SELECT max(id) FROM auditoria.log), 0) + 1, false);
DROP TABLE auditoria.log_antigo;

-- ============================================================ 4. laboratórios
CREATE SCHEMA lab;

-- Laboratório de Isolamento: contas (leituras não repetíveis, fantasmas,
-- lost update, deadlock) e plantão médico (write skew).
CREATE TABLE lab.conta (
    id      text    PRIMARY KEY,
    titular text    NOT NULL,
    saldo   integer NOT NULL
);
CREATE TABLE lab.plantao (
    medico     text    PRIMARY KEY,
    de_plantao boolean NOT NULL
);

-- Laboratório de MVCC/VACUUM. Autovacuum DESLIGADO de propósito: o
-- experimento precisa que as tuplas mortas fiquem lá até você rodar o VACUUM.
CREATE TABLE lab.inchaco (
    id        integer PRIMARY KEY,
    valor     integer NOT NULL,
    indexada  integer NOT NULL,
    texto     text    NOT NULL
) WITH (autovacuum_enabled = false, fillfactor = 100);
CREATE INDEX idx_inchaco_indexada ON lab.inchaco (indexada);

-- +goose Down
DROP SCHEMA lab CASCADE;

CREATE TABLE auditoria.log_antigo (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabela    text        NOT NULL,
    operacao  text        NOT NULL,
    chave     text,
    usuario   text        NOT NULL DEFAULT current_user,
    aplicacao text        DEFAULT current_setting('application_name', true),
    transacao bigint      NOT NULL DEFAULT pg_current_xact_id()::text::bigint,
    em        timestamptz NOT NULL DEFAULT now(),
    antes     jsonb,
    depois    jsonb
);
INSERT INTO auditoria.log_antigo OVERRIDING SYSTEM VALUE SELECT * FROM auditoria.log;
DROP TABLE auditoria.log;
ALTER TABLE auditoria.log_antigo RENAME TO log;
SELECT setval(pg_get_serial_sequence('auditoria.log', 'id'),
              coalesce((SELECT max(id) FROM auditoria.log), 0) + 1, false);
DROP FUNCTION auditoria.gerar_historico(timestamptz, integer);
DROP PROCEDURE auditoria.expurgar(integer, integer);
DROP PROCEDURE auditoria.garantir_particoes(integer, integer);
DROP FUNCTION auditoria.criar_particao(timestamptz);

ALTER TABLE estoque RESET (fillfactor, autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
DROP EXTENSION IF EXISTS pgstattuple;
DROP EXTENSION IF EXISTS pg_buffercache;
