-- Fase 2 · Triggers (docs/05-procedures-triggers-views.md)
--
--  1. auditoria.registrar()      → trilha de auditoria genérica (DML) em jsonb
--  2. auditoria.registrar_ddl()  → EVENT TRIGGER: registra mudanças de esquema (DDL)
--  3. definir_atualizado_em()    → BEFORE UPDATE: mantém a coluna atualizado_em
--  4. atualizar_total_pedido()   → AFTER em item_pedido: mantém o atributo derivado pedido.total
--
-- Blocos com $$ ... ; precisam de StatementBegin/End para o goose não
-- quebrar o SQL nos pontos-e-vírgulas internos.

-- +goose Up

-- ============================================================ 1. auditoria de DML
CREATE SCHEMA auditoria;

CREATE TABLE auditoria.log (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabela    text        NOT NULL,
    operacao  text        NOT NULL,            -- INSERT | UPDATE | DELETE
    chave     text,                            -- id do registro afetado
    usuario   text        NOT NULL DEFAULT current_user,
    aplicacao text        DEFAULT current_setting('application_name', true),
    transacao bigint      NOT NULL DEFAULT pg_current_xact_id()::text::bigint,
    em        timestamptz NOT NULL DEFAULT now(),   -- now() = início da transação
    antes     jsonb,
    depois    jsonb
);

COMMENT ON TABLE auditoria.log IS
  'Trilha de auditoria (DML). Atenção LGPD: copia dados das linhas — não auditar tabelas com dados pessoais sem necessidade (docs/10).';

-- +goose StatementBegin
CREATE FUNCTION auditoria.registrar() RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER: roda com os privilégios do DONO da função. Na Fase 6 a
-- aplicação não terá permissão de escrever em auditoria.log diretamente,
-- só através deste trigger. search_path fixo evita sequestro de objetos.
SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_antes  jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
    v_depois jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
BEGIN
    IF TG_OP = 'UPDATE' AND v_antes = v_depois THEN
        RETURN NULL;  -- UPDATE que não mudou nada não gera registro
    END IF;
    INSERT INTO auditoria.log (tabela, operacao, chave, antes, depois)
    VALUES (TG_TABLE_NAME, TG_OP, coalesce(v_depois, v_antes) ->> 'id', v_antes, v_depois);
    RETURN NULL;  -- em trigger AFTER o retorno é ignorado
END
$$;
-- +goose StatementEnd

-- Auditamos o que envolve dinheiro. cliente/endereco ficam de fora de
-- propósito (dados pessoais — minimização, LGPD). estoque fica de fora por
-- volume: é a linha mais atualizada do sistema.
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON pedido
    FOR EACH ROW EXECUTE FUNCTION auditoria.registrar();
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON pagamento
    FOR EACH ROW EXECUTE FUNCTION auditoria.registrar();
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON sku
    FOR EACH ROW EXECUTE FUNCTION auditoria.registrar();

-- ============================================================ 2. auditoria de DDL
CREATE TABLE auditoria.ddl (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    em          timestamptz NOT NULL DEFAULT now(),
    usuario     text        NOT NULL DEFAULT current_user,
    comando     text        NOT NULL,     -- CREATE INDEX, DROP TABLE, ...
    tipo_objeto text,
    objeto      text
);

-- +goose StatementBegin
CREATE FUNCTION auditoria.registrar_ddl() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        INSERT INTO auditoria.ddl (comando, tipo_objeto, objeto)
        VALUES (r.command_tag, r.object_type, r.object_identity);
    END LOOP;
END
$$;
-- +goose StatementEnd

-- DROP não aparece em pg_event_trigger_ddl_commands(): tem evento próprio.
-- +goose StatementBegin
CREATE FUNCTION auditoria.registrar_drop() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM pg_event_trigger_dropped_objects() WHERE original LOOP
        INSERT INTO auditoria.ddl (comando, tipo_objeto, objeto)
        VALUES (tg_tag, r.object_type, r.object_identity);
    END LOOP;
END
$$;
-- +goose StatementEnd

-- Event triggers são do BANCO inteiro (não de uma tabela) e exigem superusuário.
CREATE EVENT TRIGGER trg_auditoria_ddl ON ddl_command_end
    EXECUTE FUNCTION auditoria.registrar_ddl();
CREATE EVENT TRIGGER trg_auditoria_drop ON sql_drop
    EXECUTE FUNCTION auditoria.registrar_drop();

-- ============================================================ 3. atualizado_em
-- +goose StatementBegin
CREATE FUNCTION definir_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;  -- em BEFORE, o que retornar é o que será gravado
END
$$;
-- +goose StatementEnd

CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON pedido
    FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON estoque
    FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();

-- ============================================================ 4. pedido.total
-- Manutenção INCREMENTAL do atributo derivado: soma/subtrai só o item que
-- mudou, em vez de recalcular a soma do pedido inteiro a cada linha.
-- Alternativa: trigger FOR EACH STATEMENT com transition tables
-- (REFERENCING NEW TABLE AS ...), melhor para INSERTs em massa.
-- +goose StatementBegin
CREATE FUNCTION atualizar_total_pedido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE pedido SET total = total - OLD.quantidade * OLD.preco_unitario
         WHERE id = OLD.pedido_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE pedido SET total = total + NEW.quantidade * NEW.preco_unitario
         WHERE id = NEW.pedido_id;
    END IF;
    RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER trg_total_pedido AFTER INSERT OR UPDATE OR DELETE ON item_pedido
    FOR EACH ROW EXECUTE FUNCTION atualizar_total_pedido();

-- +goose Down
DROP TRIGGER trg_total_pedido ON item_pedido;
DROP FUNCTION atualizar_total_pedido();
DROP TRIGGER trg_atualizado_em ON estoque;
DROP TRIGGER trg_atualizado_em ON pedido;
DROP FUNCTION definir_atualizado_em();
DROP EVENT TRIGGER trg_auditoria_drop;
DROP EVENT TRIGGER trg_auditoria_ddl;
DROP TRIGGER trg_auditoria ON sku;
DROP TRIGGER trg_auditoria ON pagamento;
DROP TRIGGER trg_auditoria ON pedido;
DROP SCHEMA auditoria CASCADE;
