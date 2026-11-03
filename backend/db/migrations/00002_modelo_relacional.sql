-- Fase 1 · Modelo relacional do marketplace (docs/01-modelagem-dados.md)
--
-- Decisões registradas aqui de propósito, para estudo:
--  * Chaves primárias uuid (gen_random_uuid, extensão pgcrypto) nas entidades
--    expostas pela API; identity (inteiro) em tabelas de domínio pequenas.
--  * Dinheiro em numeric(12,2), NUNCA float (0.1 + 0.2 <> 0.3 em ponto flutuante).
--  * Datas em timestamptz (instante absoluto, independe do fuso do servidor).
--  * Status como text + CHECK em vez de ENUM: adicionar valor num ENUM exige
--    ALTER TYPE; num CHECK basta trocar a constraint. (Ambos são válidos.)
--  * Os índices nas FKs estão AUSENTES DE PROPÓSITO: o PostgreSQL não cria índice
--    automático em FK (só em PK e UNIQUE). Criá-los e medir o ganho é a Fase 2
--    (docs/04-indices-otimizacao.md).

-- +goose Up

-- ---------------------------------------------------------------- clientes
CREATE TABLE cliente (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       text        NOT NULL CHECK (btrim(nome) <> ''),
    email      citext      NOT NULL UNIQUE,          -- citext: Ana@X.com = ana@x.com
    criado_em  timestamptz NOT NULL DEFAULT now()
);

-- Endereço é IMUTÁVEL: pedidos antigos apontam para ele. Para "editar",
-- cria-se um novo e desativa-se o antigo (ativo = false). A alternativa seria
-- copiar o endereço para dentro do pedido (desnormalização) — discuta no docs/01.
CREATE TABLE endereco (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id  uuid        NOT NULL REFERENCES cliente (id),
    cep         char(8)     NOT NULL CHECK (cep ~ '^[0-9]{8}$'),
    logradouro  text        NOT NULL,
    numero      text        NOT NULL,
    complemento text,
    cidade      text        NOT NULL,
    uf          char(2)     NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
    ativo       boolean     NOT NULL DEFAULT true,
    criado_em   timestamptz NOT NULL DEFAULT now(),
    -- Alvo da FK composta em pedido: garante que o endereço é DO cliente do pedido.
    UNIQUE (id, cliente_id)
);

-- ---------------------------------------------------------------- vendedores e catálogo relacional
CREATE TABLE vendedor (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    razao_social text        NOT NULL,
    cnpj         char(14)    NOT NULL UNIQUE CHECK (cnpj ~ '^[0-9]{14}$'),
    criado_em    timestamptz NOT NULL DEFAULT now()
);

-- Auto-relacionamento (hierarquia): Eletrônicos > Informática > Notebooks.
-- Consultado com CTE recursiva (docs/02).
CREATE TABLE categoria (
    id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome   text    NOT NULL,
    pai_id integer REFERENCES categoria (id),
    UNIQUE NULLS NOT DISTINCT (pai_id, nome)   -- PG 15+: impede duas raízes com o mesmo nome
);

-- SKU = item vendável (produto + variação + vendedor). Guarda o que precisa de
-- ACID: preço e estoque. A descrição rica do produto vai para o MongoDB na Fase 3
-- (produto_id); não há FK entre bancos diferentes.
CREATE TABLE sku (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id  uuid          NOT NULL REFERENCES vendedor (id),
    categoria_id integer       NOT NULL REFERENCES categoria (id),
    produto_id   text,
    descricao    text          NOT NULL,
    preco        numeric(12,2) NOT NULL CHECK (preco > 0),
    ativo        boolean       NOT NULL DEFAULT true,
    criado_em    timestamptz   NOT NULL DEFAULT now()
);

-- Relação 1:1 com sku, em tabela separada porque o estoque é a linha mais
-- disputada do sistema (locks): separar evita travar a linha do sku inteiro.
CREATE TABLE estoque (
    sku_id        uuid        PRIMARY KEY REFERENCES sku (id),
    quantidade    integer     NOT NULL CHECK (quantidade >= 0),   -- a última linha de defesa contra vender o que não existe
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- pedidos
CREATE TABLE pedido (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id         uuid          NOT NULL REFERENCES cliente (id),
    endereco_id        uuid          NOT NULL,
    status             text          NOT NULL DEFAULT 'PENDENTE'
                       CHECK (status IN ('PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE', 'CANCELADO')),
    -- Atributo DERIVADO (soma dos itens), guardado por desempenho.
    -- Hoje é calculado no checkout; na Fase 2 passa a ser mantido por trigger.
    total              numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    -- Idempotência: o cliente manda o mesmo Idempotency-Key ao repetir a
    -- requisição (ex.: timeout de rede) e não gera um segundo pedido.
    chave_idempotencia uuid          UNIQUE,
    criado_em          timestamptz   NOT NULL DEFAULT now(),
    atualizado_em      timestamptz   NOT NULL DEFAULT now(),
    FOREIGN KEY (endereco_id, cliente_id) REFERENCES endereco (id, cliente_id)
);

-- Entidade FRACA: identificada por (pedido, número do item).
CREATE TABLE item_pedido (
    pedido_id      uuid          NOT NULL REFERENCES pedido (id) ON DELETE CASCADE,
    numero         smallint      NOT NULL CHECK (numero > 0),
    sku_id         uuid          NOT NULL REFERENCES sku (id),
    quantidade     integer       NOT NULL CHECK (quantidade > 0),
    -- Preço NO MOMENTO DA COMPRA. Não é redundância: é outro fato (docs/01).
    preco_unitario numeric(12,2) NOT NULL CHECK (preco_unitario >= 0),
    PRIMARY KEY (pedido_id, numero),
    UNIQUE (pedido_id, sku_id)
);

CREATE TABLE pagamento (
    id        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id uuid          NOT NULL REFERENCES pedido (id),
    metodo    text          NOT NULL CHECK (metodo IN ('PIX', 'CARTAO', 'BOLETO')),
    valor     numeric(12,2) NOT NULL CHECK (valor > 0),
    status    text          NOT NULL CHECK (status IN ('PENDENTE', 'APROVADO', 'RECUSADO', 'ESTORNADO')),
    criado_em timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE estoque IS 'Linha mais disputada do sistema; veja docs/03 (locks e isolamento).';
COMMENT ON COLUMN pedido.total IS 'Derivado: soma de item_pedido.quantidade * preco_unitario.';
COMMENT ON COLUMN item_pedido.preco_unitario IS 'Preço no momento da compra (não acompanha mudanças no sku).';

-- +goose Down
DROP TABLE pagamento;
DROP TABLE item_pedido;
DROP TABLE pedido;
DROP TABLE estoque;
DROP TABLE sku;
DROP TABLE categoria;
DROP TABLE vendedor;
DROP TABLE endereco;
DROP TABLE cliente;
