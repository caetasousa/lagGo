-- Seed de estudo: gera volume suficiente para os experimentos de índices,
-- planos de execução e concorrência. Rodar com:  make seed
--
-- ATENÇÃO: apaga todos os dados das tabelas da loja (TRUNCATE).
--
-- Volume: 4 raízes + 17 categorias, 50 vendedores, 10 mil clientes,
-- ~12 mil endereços, 2 mil SKUs, 100 mil pedidos, ~250 mil itens.
--
-- Técnicas de SQL usadas (docs/02): generate_series, arrays, CTEs,
-- LATERAL, UPDATE ... FROM, hashtext() para "aleatório determinístico".
--
-- Carga em massa SEM triggers (Fase 2): session_replication_role = replica
-- desliga os triggers de usuário (auditoria, total do pedido, atualizado_em)
-- E as verificações de FK (que no PostgreSQL também são triggers internos).
-- É o mesmo recurso que o pg_restore --disable-triggers usa. Exige superusuário
-- e só é aceitável porque os dados gerados aqui são consistentes por construção.

\timing on
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

TRUNCATE pagamento, item_pedido, pedido, estoque, sku, categoria, vendedor, endereco, conta.credencial, cliente,
         auditoria.log
    RESTART IDENTITY;

SELECT setseed(0.42);  -- random() reprodutível (os UUIDs não: gen_random_uuid() ignora a semente)

-- ------------------------------------------------------------ categorias (árvore)
INSERT INTO categoria (nome) VALUES ('Eletrônicos'), ('Casa'), ('Moda'), ('Livros');

INSERT INTO categoria (nome, pai_id)
SELECT f.nome, p.id
  FROM (VALUES ('Informática', 'Eletrônicos'), ('Celulares', 'Eletrônicos'), ('Áudio', 'Eletrônicos'),
               ('Cozinha', 'Casa'), ('Móveis', 'Casa'),
               ('Masculino', 'Moda'), ('Feminino', 'Moda'),
               ('Ficção', 'Livros'), ('Técnicos', 'Livros')) AS f (nome, pai)
  JOIN categoria p ON p.nome = f.pai;

INSERT INTO categoria (nome, pai_id)
SELECT f.nome, p.id
  FROM (VALUES ('Notebooks', 'Informática'), ('Monitores', 'Informática'), ('Periféricos', 'Informática'),
               ('Bancos de Dados', 'Técnicos'), ('Programação', 'Técnicos')) AS f (nome, pai)
  JOIN categoria p ON p.nome = f.pai;

-- ------------------------------------------------------------ vendedores
INSERT INTO vendedor (razao_social, cnpj, criado_em)
SELECT 'Loja ' || (ARRAY['Alfa','Beta','Gama','Delta','Ômega','Sigma','Prime','Nova','Max','Top'])[1 + g % 10]
       || ' ' || g || ' LTDA',
       lpad((g * 7919)::text, 14, '0'),
       now() - random() * interval '3 years'
  FROM generate_series(1, 50) g;

-- ------------------------------------------------------------ clientes e endereços
INSERT INTO cliente (nome, email, criado_em)
SELECT (ARRAY['Ana','Bruno','Carla','Diego','Elisa','Fábio','Gabriela','Hugo','Isabela','João',
              'Karina','Lucas','Mariana','Nicolas','Olívia','Pedro','Rafaela','Samuel','Tatiane','Vitor'])[1 + floor(random() * 20)::int]
       || ' ' ||
       (ARRAY['Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Rodrigues','Almeida','Nascimento'])[1 + floor(random() * 10)::int],
       'cliente' || g || '@exemplo.com',
       now() - random() * interval '2 years'
  FROM generate_series(1, 10000) g;

-- 1 endereço por cliente + um segundo para ~20% deles.
-- A cidade sai de hashtext(id): a mesma posição nos dois arrays mantém cidade e UF coerentes.
INSERT INTO endereco (cliente_id, cep, logradouro, numero, cidade, uf, criado_em)
SELECT c.id,
       lpad((abs(hashtext(c.id::text || n)) % 100000000)::text, 8, '0'),
       'Rua ' || (ARRAY['das Flores','XV de Novembro','Sete de Setembro','do Comércio','Brasil','Paraná'])[1 + abs(hashtext(c.id::text || 'r' || n)) % 6],
       (1 + abs(hashtext(c.id::text || 'n' || n)) % 2000)::text,
       (ARRAY['São Paulo','Rio de Janeiro','Belo Horizonte','Curitiba','Porto Alegre','Salvador','Recife','Brasília'])[1 + abs(hashtext(c.id::text || n)) % 8],
       (ARRAY['SP','RJ','MG','PR','RS','BA','PE','DF'])[1 + abs(hashtext(c.id::text || n)) % 8],
       c.criado_em
  FROM cliente c
 CROSS JOIN LATERAL generate_series(1, CASE WHEN abs(hashtext(c.id::text)) % 5 = 0 THEN 2 ELSE 1 END) n;

-- ------------------------------------------------------------ SKUs e estoque
WITH folhas AS (            -- categorias sem filhas
    SELECT array_agg(id) AS ids FROM categoria c
     WHERE NOT EXISTS (SELECT 1 FROM categoria f WHERE f.pai_id = c.id)
), vendedores AS (
    SELECT array_agg(id) AS ids FROM vendedor
)
INSERT INTO sku (vendedor_id, categoria_id, descricao, preco, criado_em)
SELECT v.ids[1 + floor(random() * cardinality(v.ids))::int],
       f.ids[1 + floor(random() * cardinality(f.ids))::int],
       '',  -- preenchida logo abaixo, com o nome da categoria
       round((10 + random() * 4990)::numeric, 2),
       now() - random() * interval '2 years'
  FROM generate_series(1, 2000) g, folhas f, vendedores v;

UPDATE sku s
   SET descricao = c.nome || ' ' || upper(substr(md5(s.id::text), 1, 6))
  FROM categoria c
 WHERE c.id = s.categoria_id;

-- SKU fixo do Laboratório de Concorrência (docs/03): o "último console" disputado.
INSERT INTO sku (id, vendedor_id, categoria_id, descricao, preco)
SELECT '11111111-1111-1111-1111-111111111111', (SELECT id FROM vendedor ORDER BY cnpj LIMIT 1),
       (SELECT id FROM categoria WHERE nome = 'Periféricos'), 'Console Edição Limitada (laboratório)', 3999.00;

INSERT INTO estoque (sku_id, quantidade)
SELECT id, CASE WHEN id = '11111111-1111-1111-1111-111111111111' THEN 1
                ELSE floor(random() * 500)::int END
  FROM sku;

-- ------------------------------------------------------------ pedidos históricos
-- Estratégia de carga em massa: monta pedidos e itens em tabelas TEMPORÁRIAS,
-- calcula o total, e só então grava cada pedido UMA vez, já com o total.
-- Um "INSERT e depois UPDATE total" reescreveria as 100 mil linhas (MVCC:
-- 100 mil tuplas mortas) e embaralharia a ordem física da tabela.
--
-- ORDER BY criado_em no INSERT final: num sistema real os pedidos chegam em
-- ordem cronológica, então a ordem FÍSICA acompanha criado_em (correlação ≈ 1
-- em pg_stats). É isso que torna um índice BRIN útil (Laboratório de Índices).

-- Sorteia um endereço e usa o cliente DONO dele (respeita a FK composta).
CREATE TEMP TABLE tmp_pedido ON COMMIT DROP AS
WITH enderecos AS (
    SELECT array_agg(id ORDER BY id) AS ids, array_agg(cliente_id ORDER BY id) AS clientes FROM endereco
)
SELECT gen_random_uuid() AS id,
       e.clientes[r.i] AS cliente_id,
       e.ids[r.i]      AS endereco_id,
       CASE WHEN r.s < 0.05 THEN 'CANCELADO'
            WHEN r.s < 0.08 THEN 'PENDENTE'
            WHEN r.s < 0.15 THEN 'PAGO'
            WHEN r.s < 0.25 THEN 'ENVIADO'
            ELSE 'ENTREGUE' END AS status,
       r.quando AS criado_em
  FROM generate_series(1, 100000) g
 CROSS JOIN enderecos e
 -- LATERAL referenciando g: força o sorteio a acontecer por linha
 CROSS JOIN LATERAL (SELECT 1 + floor(random() * cardinality(e.ids))::int + 0 * g AS i,
                            random() AS s,
                            now() - random() * interval '2 years' AS quando) r;

-- 1 a 4 itens por pedido, SKUs distintos dentro do pedido:
-- base + n*7 (mod total) nunca repete para n = 1..4.
CREATE TEMP TABLE tmp_item ON COMMIT DROP AS
WITH skus AS (
    SELECT array_agg(id ORDER BY id) AS ids, array_agg(preco ORDER BY id) AS precos, count(*)::int AS qtd
      FROM sku WHERE id <> '11111111-1111-1111-1111-111111111111'
)
SELECT p.id AS pedido_id,
       n::smallint AS numero,
       s.ids[1 + (abs(hashtext(p.id::text)) + n * 7) % s.qtd] AS sku_id,
       1 + abs(hashtext(p.id::text || 'q' || n)) % 3 AS quantidade,
       -- preço histórico oscila ±10% em relação ao preço atual
       round(s.precos[1 + (abs(hashtext(p.id::text)) + n * 7) % s.qtd]
             * (0.9 + (abs(hashtext(p.id::text || 'p' || n)) % 21) / 100.0), 2) AS preco_unitario
  FROM tmp_pedido p
 CROSS JOIN skus s
 CROSS JOIN LATERAL generate_series(1, 1 + abs(hashtext(p.id::text || 'itens')) % 4) n;

-- Atributo derivado calculado ANTES de gravar (o trigger trg_total_pedido
-- está desligado nesta carga).
INSERT INTO pedido (id, cliente_id, endereco_id, status, total, criado_em, atualizado_em)
SELECT p.id, p.cliente_id, p.endereco_id, p.status, t.soma, p.criado_em, p.criado_em
  FROM tmp_pedido p
  JOIN (SELECT pedido_id, sum(quantidade * preco_unitario) AS soma
          FROM tmp_item GROUP BY pedido_id) t ON t.pedido_id = p.id
 ORDER BY p.criado_em;

INSERT INTO item_pedido (pedido_id, numero, sku_id, quantidade, preco_unitario)
SELECT pedido_id, numero, sku_id, quantidade, preco_unitario FROM tmp_item;

-- ------------------------------------------------------------ auditoria (histórico)
-- 12 meses de histórico SINTÉTICO na auditoria particionada (Fase 4), para o
-- partition pruning e o Laboratório de Expurgo terem volume. Cada linha é
-- marcada usuario = 'historico-sintetico'.
CALL auditoria.garantir_particoes(13, 3);
SELECT sum(auditoria.gerar_historico(now() - make_interval(months => m), 10000)) AS historico_auditoria
  FROM generate_series(1, 12) m;

INSERT INTO pagamento (pedido_id, metodo, valor, status, criado_em)
SELECT id,
       (ARRAY['PIX','CARTAO','BOLETO'])[1 + abs(hashtext(id::text || 'm')) % 3],
       total,
       CASE status WHEN 'CANCELADO' THEN 'ESTORNADO' ELSE 'APROVADO' END,
       criado_em + interval '5 minutes'
  FROM pedido
 WHERE status <> 'PENDENTE';

COMMIT;

-- Fora da transação: VACUUM não roda dentro de BEGIN/COMMIT.
VACUUM ANALYZE;

-- Recalcula a materialized view dos relatórios (procedure da Fase 2).
CALL relatorio.atualizar_vendas_por_dia();

-- Zera as estatísticas para o Painel do DBA não mostrar o próprio seed.
SELECT pg_stat_statements_reset();

SELECT 'clientes' AS tabela, count(*) FROM cliente
UNION ALL SELECT 'enderecos', count(*) FROM endereco
UNION ALL SELECT 'skus', count(*) FROM sku
UNION ALL SELECT 'pedidos', count(*) FROM pedido
UNION ALL SELECT 'itens', count(*) FROM item_pedido
UNION ALL SELECT 'pagamentos', count(*) FROM pagamento
UNION ALL SELECT 'linhas em relatorio.vendas_por_dia', count(*) FROM relatorio.vendas_por_dia
UNION ALL SELECT 'auditoria.log (histórico, particionado)', count(*) FROM auditoria.log;

SELECT 'correlação física de pedido.criado_em (BRIN gosta de ≈1)' AS info, round(correlation::numeric, 3) AS valor
  FROM pg_stats WHERE tablename = 'pedido' AND attname = 'criado_em';
