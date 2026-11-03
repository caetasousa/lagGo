-- Keyspace e tabelas do Cassandra (docs/07-nosql.md, seção wide-column).
-- SimpleStrategy com RF=1 só serve para um nó de desenvolvimento.
-- Em produção: NetworkTopologyStrategy com RF=3 por datacenter.
CREATE KEYSPACE IF NOT EXISTS marketplace
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

-- No Cassandra modelamos UMA tabela POR CONSULTA.
-- Consulta: "últimos produtos vistos por um usuário em um dia".
-- Partição = (usuario_id, dia) evita partições gigantes; clustering ordena por tempo.
CREATE TABLE IF NOT EXISTS marketplace.eventos_por_usuario (
  usuario_id  uuid,
  dia         date,
  ocorrido_em timeuuid,
  tipo        text,      -- 'visualizou', 'adicionou_carrinho', 'buscou'
  produto_id  text,
  detalhes    map<text, text>,
  PRIMARY KEY ((usuario_id, dia), ocorrido_em)
) WITH CLUSTERING ORDER BY (ocorrido_em DESC)
  AND default_time_to_live = 7776000;  -- 90 dias (retenção — docs/10)
