-- Fase 6: cadastro e login, papéis com menor privilégio, Row-Level Security,
-- CPF cifrado (pgcrypto) e o "direito ao esquecimento" da LGPD
-- (docs/10-seguranca-governanca.md, cenários Q e W).

-- +goose Up

-- ---------------------------------------------------------------- credenciais
-- A senha mora num schema à parte: quem lista "cliente" não vê nem o hash.
-- O hash é calculado NA API (argon2id), nunca aqui: uma função do banco
-- receberia a senha em texto como parâmetro — e parâmetros vão parar no log
-- de consultas lentas. A CHECK é a última barreira: o banco recusa qualquer
-- coisa que não tenha cara de hash argon2id (cenário Q7).
CREATE SCHEMA conta;

CREATE TABLE conta.credencial (
    cliente_id    uuid        PRIMARY KEY REFERENCES cliente (id) ON DELETE CASCADE,
    senha_hash    text        NOT NULL CHECK (senha_hash LIKE '$argon2id$%'),
    criada_em     timestamptz NOT NULL DEFAULT now(),
    ultimo_acesso timestamptz
);

COMMENT ON TABLE conta.credencial IS
  'Fase 6: hash argon2id da senha (calculado na API). Nunca guarda a senha.';

-- ---------------------------------------------------------------- CPF (pgcrypto)
-- cpf_cifrado: pgp_sym_encrypt(cpf, chave) — só quem tem a chave lê.
-- cpf_hmac:    hmac(cpf, chave, 'sha256') — determinístico: permite o UNIQUE
--              ("este CPF já tem conta?") sem decifrar ninguém (cenário W3).
-- cpf_final:   os 2 últimos dígitos, em claro, só para a tela mascarada
--              (***.***.***-12) sem precisar da chave.
-- Os clientes do seed não têm CPF: as colunas aceitam NULL.
ALTER TABLE cliente
    ADD COLUMN cpf_cifrado    bytea,
    ADD COLUMN cpf_hmac       bytea UNIQUE,
    ADD COLUMN cpf_final      char(2) CHECK (cpf_final ~ '^[0-9]{2}$'),
    ADD COLUMN anonimizado_em timestamptz;

-- Visão mascarada: o que um atendente (ou uma tela) pode ver.
CREATE VIEW conta.v_cliente_mascarado AS
SELECT c.id,
       c.nome,
       regexp_replace(c.email::text, '^(.).*(@.*)$', '\1***\2') AS email,
       CASE WHEN c.cpf_final IS NULL THEN NULL ELSE '***.***.***-' || c.cpf_final END AS cpf,
       c.criado_em,
       c.anonimizado_em
  FROM cliente c;

-- ---------------------------------------------------------------- papéis
-- Papéis SEM login (NOLOGIN): a API conecta com o seu usuário e, só dentro da
-- transação que precisa, assume o papel menor (SET LOCAL ROLE). Papel é do
-- CLUSTER, não do banco: se já existe (outro banco do mesmo servidor), fica.
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'loja_cliente') THEN
        CREATE ROLE loja_cliente NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'relatorio_leitura') THEN
        CREATE ROLE relatorio_leitura NOLOGIN;
    END IF;
END
$$;
-- +goose StatementEnd

-- loja_cliente: o cliente logado lendo os PRÓPRIOS pedidos. Só SELECT.
GRANT USAGE ON SCHEMA public TO loja_cliente;
GRANT SELECT ON pedido, item_pedido, pagamento, sku, cliente, endereco TO loja_cliente;

-- relatorio_leitura: os relatórios. Só SELECT, nada de escrever (cenário W2).
GRANT USAGE ON SCHEMA public, relatorio TO relatorio_leitura;
GRANT SELECT ON pedido, item_pedido, sku, categoria TO relatorio_leitura;
GRANT SELECT ON ALL TABLES IN SCHEMA relatorio TO relatorio_leitura;

-- ---------------------------------------------------------------- Row-Level Security
-- Com RLS ligada, um papel comum só vê as linhas que alguma POLICY libera
-- (sem policy, não vê nada). O dono das tabelas e o superusuário continuam
-- vendo tudo — por isso a API troca de papel antes das leituras do cliente.
--
-- Quem é o cliente? A API grava na transação: set_config('app.cliente_id',
-- …, true). current_setting(…, true) devolve NULL se não foi definido — e
-- "cliente_id = NULL" não é verdadeiro para linha nenhuma: sem sessão, zero
-- linhas, nunca "todas" (cenário W1).
ALTER TABLE pedido      ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamento   ENABLE ROW LEVEL SECURITY;

CREATE POLICY pedido_do_cliente ON pedido FOR SELECT TO loja_cliente
    USING (cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid);
-- Itens e pagamentos seguem o pedido: a subconsulta em pedido também passa
-- pela policy acima, então só "existe" o pedido que é do cliente.
CREATE POLICY item_do_cliente ON item_pedido FOR SELECT TO loja_cliente
    USING (EXISTS (SELECT 1 FROM pedido p WHERE p.id = item_pedido.pedido_id));
CREATE POLICY pagamento_do_cliente ON pagamento FOR SELECT TO loja_cliente
    USING (EXISTS (SELECT 1 FROM pedido p WHERE p.id = pagamento.pedido_id));

-- Relatório agrega TODOS os pedidos: policy própria, só de leitura.
CREATE POLICY relatorio_le_pedidos ON pedido FOR SELECT TO relatorio_leitura USING (true);
CREATE POLICY relatorio_le_itens   ON item_pedido FOR SELECT TO relatorio_leitura USING (true);

-- ---------------------------------------------------------------- LGPD
-- "Direito ao esquecimento" (art. 18): apaga o que identifica a pessoa, mas
-- MANTÉM os pedidos — a lei fiscal manda guardá-los (art. 16, I: cumprimento
-- de obrigação legal). O pedido fica ligado a um cliente anônimo; cidade e UF
-- ficam (estatística sem identificar ninguém). Numa procedure para ser uma
-- operação só: ou tudo é anonimizado, ou nada.
-- +goose StatementBegin
CREATE PROCEDURE conta.esquecer_cliente(p_cliente uuid)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE cliente
       SET nome = 'Cliente removido',
           email = 'removido-' || id || '@anonimo.invalid',
           cpf_cifrado = NULL, cpf_hmac = NULL, cpf_final = NULL,
           anonimizado_em = now()
     WHERE id = p_cliente AND anonimizado_em IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cliente % não existe ou já foi anonimizado', p_cliente
            USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE endereco
       SET cep = '00000000', logradouro = '(removido)', numero = '-', complemento = NULL, ativo = false
     WHERE cliente_id = p_cliente;
    DELETE FROM conta.credencial WHERE cliente_id = p_cliente;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP PROCEDURE conta.esquecer_cliente(uuid);

DROP POLICY relatorio_le_itens ON item_pedido;
DROP POLICY relatorio_le_pedidos ON pedido;
DROP POLICY pagamento_do_cliente ON pagamento;
DROP POLICY item_do_cliente ON item_pedido;
DROP POLICY pedido_do_cliente ON pedido;
ALTER TABLE pagamento   DISABLE ROW LEVEL SECURITY;
ALTER TABLE item_pedido DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedido      DISABLE ROW LEVEL SECURITY;

-- Tira os privilégios DESTE banco. O papel só é apagado se nenhum outro banco
-- do servidor ainda o usa (papel é do cluster).
REVOKE ALL ON ALL TABLES IN SCHEMA relatorio FROM relatorio_leitura;
REVOKE ALL ON pedido, item_pedido, sku, categoria FROM relatorio_leitura;
REVOKE ALL ON SCHEMA public, relatorio FROM relatorio_leitura;
REVOKE ALL ON pedido, item_pedido, pagamento, sku, cliente, endereco FROM loja_cliente;
REVOKE ALL ON SCHEMA public FROM loja_cliente;
-- +goose StatementBegin
DO $$
BEGIN
    DROP ROLE IF EXISTS loja_cliente;
    DROP ROLE IF EXISTS relatorio_leitura;
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'papéis mantidos: outro banco do servidor ainda os usa';
END
$$;
-- +goose StatementEnd

DROP VIEW conta.v_cliente_mascarado;
ALTER TABLE cliente
    DROP COLUMN anonimizado_em,
    DROP COLUMN cpf_final,
    DROP COLUMN cpf_hmac,
    DROP COLUMN cpf_cifrado;
DROP TABLE conta.credencial;
DROP SCHEMA conta;
