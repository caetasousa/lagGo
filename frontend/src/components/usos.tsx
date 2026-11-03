import type { ReactNode } from 'react'
import type { NomeBanco } from './ui'

// Catálogo de USOS: o que cada banco faz NESTE projeto. "Redis" sozinho não
// ensina nada — o Redis aqui é ao mesmo tempo cache, carrinho, ranking, limite
// de requisições e fila de eventos, cada um com uma estrutura e uma chave.

export type IdUso =
  | 'pg-pedidos' | 'pg-estoque' | 'pg-ofertas' | 'pg-categorias' | 'pg-relatorios' | 'pg-auditoria' | 'pg-lab'
  | 'pg-replica' | 'pg-backup' | 'pg-contas' | 'pg-rls'
  | 'ha-patroni' | 'ha-mongo' | 'ha-redis'
  | 'mongo-catalogo' | 'mongo-avaliacoes'
  | 'redis-cache' | 'redis-carrinho' | 'redis-ranking' | 'redis-rate-limit' | 'redis-stream' | 'redis-sessao'
  | 'pgbouncer-pool'

export type Uso = {
  banco: NomeBanco
  rotulo: string     // curto, vai no selo
  estrutura: string  // tabela, coleção ou tipo de dado do Redis
  chave: string      // nome da tabela/coleção/chave
  porque: string     // por que este banco para este dado
  comandos?: string  // os comandos que fazem o trabalho
}

export const USOS: Record<IdUso, Uso> = {
  'pg-pedidos': { banco: 'PostgreSQL', rotulo: 'pedidos e pagamentos', estrutura: 'tabelas relacionais ligadas por chave estrangeira',
    chave: 'pedido · item_pedido · pagamento', porque: 'dinheiro exige transação ACID: ou o pedido inteiro entra, ou nada entra.',
    comandos: 'BEGIN … INSERT … UPDATE estoque … COMMIT' },
  'pg-estoque': { banco: 'PostgreSQL', rotulo: 'estoque', estrutura: 'tabela com uma linha por SKU e CHECK (quantidade >= 0)',
    chave: 'estoque', porque: 'é a linha mais disputada da loja: precisa de locks e transação para não vender o que não existe.',
    comandos: 'UPDATE estoque SET quantidade = quantidade - 1 WHERE … AND quantidade >= 1' },
  'pg-ofertas': { banco: 'PostgreSQL', rotulo: 'preço e estoque das ofertas', estrutura: 'tabelas sku + estoque + vendedor',
    chave: 'sku · estoque', porque: 'preço e estoque não podem estar desatualizados: são lidos a cada visita, nunca do cache.',
    comandos: 'SELECT … FROM sku JOIN estoque … WHERE sku.id = ANY($1)' },
  'pg-categorias': { banco: 'PostgreSQL', rotulo: 'árvore de categorias', estrutura: 'tabela que aponta para si mesma (pai_id)',
    chave: 'categoria', porque: 'hierarquia de profundidade variável, lida com uma consulta recursiva.',
    comandos: 'WITH RECURSIVE arvore AS (…)' },
  'pg-relatorios': { banco: 'PostgreSQL', rotulo: 'resumo de vendas', estrutura: 'materialized view (resultado guardado em disco)',
    chave: 'relatorio.vendas_por_dia', porque: 'somar 100 mil pedidos a cada visita seria lento; o resumo é recalculado a cada 10 min.',
    comandos: 'REFRESH MATERIALIZED VIEW CONCURRENTLY …' },
  'pg-auditoria': { banco: 'PostgreSQL', rotulo: 'auditoria particionada', estrutura: 'tabela particionada: uma partição por mês',
    chave: 'auditoria.log (log_AAAAMM)', porque: 'só cresce; separar por mês deixa consultar um período e apagar meses antigos baratos.',
    comandos: 'ALTER TABLE … DETACH PARTITION … ; DROP TABLE …' },
  'pg-lab': { banco: 'PostgreSQL', rotulo: 'tabelas do laboratório', estrutura: 'schema próprio, separado da loja',
    chave: 'lab.conta · lab.plantao · lab.inchaco', porque: 'os experimentos podem estragar à vontade sem tocar nos dados da loja.' },
  'pg-replica': { banco: 'PostgreSQL', rotulo: 'réplica de leitura', estrutura: 'cópia física do cluster inteiro, só leitura, alimentada pelo WAL',
    chave: 'serviço postgres-replica (slot replica1)', porque: 'relatórios toleram milissegundos de atraso: lendo da réplica, tiram carga do primário, que fica livre para as compras.',
    comandos: 'pg_basebackup -R -S replica1 · streaming do WAL' },
  'pg-backup': { banco: 'PostgreSQL', rotulo: 'backup e WAL arquivado', estrutura: 'backups físicos (full, diff, incr) + segmentos de WAL de 16 MB',
    chave: 'repositório do pgBackRest, stanza main', porque: 'réplica não é backup: um DROP TABLE é replicado na hora. Backup + WAL arquivado voltam o banco a qualquer instante (PITR).',
    comandos: 'archive_command = pgbackrest archive-push %p · pgbackrest backup · restore --type=time' },
  'ha-patroni': { banco: 'PostgreSQL', rotulo: 'cluster Patroni (laboratório)', estrutura: '2 nós PostgreSQL + Patroni; chave de líder no etcd (3); HAProxy na frente',
    chave: 'patroni1 · patroni2 · etcd1–3 · haproxy (perfil ha)', porque: 'o PostgreSQL não faz failover sozinho: o Patroni elege o líder pelo etcd e o HAProxy manda a escrita para ele.',
    comandos: 'GET /cluster · POST /switchover · INSERT via haproxy:5000' },
  'ha-mongo': { banco: 'MongoDB', rotulo: 'replica set de 3 nós (laboratório)', estrutura: 'replica set rsha: 1 primário + 2 secundários, com autenticação por keyfile',
    chave: 'mongo-ha1 · mongo-ha2 · mongo-ha3 (perfil ha)', porque: 'failover nativo: os membros se vigiam por heartbeats e elegem outro primário por maioria.',
    comandos: 'insertOne com w: 1 ou w: "majority" · replSetStepDown · shutdown' },
  'ha-redis': { banco: 'Redis', rotulo: 'Redis com Sentinel (laboratório)', estrutura: 'primário + réplica, vigiados por 3 sentinels (quórum 2)',
    chave: 'redis-ha1 · redis-ha2 · sentinel1–3, primário "principal" (perfil ha)', porque: 'os sentinels detectam o primário fora, concordam por quórum e promovem a réplica; o cliente pergunta a eles quem é o primário.',
    comandos: 'RPUSH (+ WAIT 1) · DEBUG SLEEP · SENTINEL FAILOVER' },
  'pg-contas': { banco: 'PostgreSQL', rotulo: 'contas e senhas', estrutura: 'tabela conta.credencial (hash argon2id) + cliente com CPF cifrado',
    chave: 'cliente · endereco · conta.credencial', porque: 'cadastro é dado que não pode se perder nem duplicar: UNIQUE no e-mail e no CPF, e cliente + endereço + senha gravados numa transação.',
    comandos: 'INSERT … pgp_sym_encrypt(cpf, chave), hmac(cpf, chave) · CHECK (senha_hash LIKE \'$argon2id$%\')' },
  'pg-rls': { banco: 'PostgreSQL', rotulo: 'só os seus pedidos (RLS)', estrutura: 'Row-Level Security: policies por papel nas tabelas de pedido',
    chave: 'pedido · item_pedido · pagamento, papel loja_cliente', porque: 'quem filtra "só os pedidos de quem está logado" é o próprio banco: mesmo uma consulta sem WHERE não devolve o pedido de outra pessoa.',
    comandos: 'SET LOCAL ROLE loja_cliente · set_config(\'app.cliente_id\', …) · CREATE POLICY … USING (cliente_id = …)' },
  'mongo-catalogo': { banco: 'MongoDB', rotulo: 'catálogo de produtos', estrutura: 'coleção de documentos (um por produto)',
    chave: 'produtos', porque: 'cada categoria tem atributos diferentes (notebook tem RAM, livro tem autor) e a página lê o produto inteiro de uma vez.',
    comandos: 'db.produtos.findOne({ _id }) · aggregate([$match, $facet])' },
  'mongo-avaliacoes': { banco: 'MongoDB', rotulo: 'avaliações', estrutura: 'coleção avaliacoes + resumo dentro do produto',
    chave: 'avaliacoes · produtos.avaliacoes_recentes', porque: 'as 3 últimas e a média ficam no produto (lidas junto); todas ficam numa coleção à parte.',
    comandos: 'insertOne + updateOne numa transação' },
  'redis-cache': { banco: 'Redis', rotulo: 'cache do produto', estrutura: 'STRING com o JSON do documento, expira em 5 min (TTL)',
    chave: 'cache:produto:{id}', porque: 'a página do produto é muito lida e pouco alterada; guardar uma cópia na memória evita ir ao MongoDB toda vez.',
    comandos: 'GET → (se não existe) SET … EX 300 · DEL ao entrar avaliação' },
  'redis-carrinho': { banco: 'Redis', rotulo: 'carrinho da sessão', estrutura: 'HASH (sku → quantidade), expira em 7 dias sem uso',
    chave: 'carrinho:{sessao}', porque: 'é temporário, por visitante, e não precisa de transação; some sozinho se abandonado.',
    comandos: 'HSET · HGETALL · HDEL · EXPIRE' },
  'redis-ranking': { banco: 'Redis', rotulo: 'ranking de mais vendidos', estrutura: 'SORTED SET (membro = SKU, pontos = unidades vendidas)',
    chave: 'ranking:mais_vendidos', porque: 'manter um placar ordenado é nativo no sorted set: somar e ler o topo custam quase nada.',
    comandos: 'ZINCRBY ao vender · ZREVRANGE 0 5 na vitrine' },
  'redis-rate-limit': { banco: 'Redis', rotulo: 'limite de requisições', estrutura: 'contador (STRING + INCR) por IP e minuto, expira em 2 min',
    chave: 'rl:{rota}:{ip}:{minuto}', porque: 'contar requisições de muitos clientes precisa ser atômico e rápido; o TTL limpa sozinho.',
    comandos: 'INCR · EXPIRE NX' },
  'redis-sessao': { banco: 'Redis', rotulo: 'sessão de login', estrutura: 'STRING (cliente) com TTL de 7 dias, renovado a cada uso',
    chave: 'sessao:{sha256 do token}', porque: 'toda requisição pergunta "quem é?": precisa ser rápido, e a sessão deve vencer sozinha. A chave é o HASH do token: quem lê o Redis não entra na conta de ninguém.',
    comandos: 'SET … EX 604800 · GETEX … EX (renova) · GETDEL ao sair' },
  'redis-stream': { banco: 'Redis', rotulo: 'fila de eventos de pedidos', estrutura: 'STREAM (log só de acréscimo, guarda as últimas ~1000)',
    chave: 'stream:pedidos', porque: 'avisa outros sistemas que um pedido foi pago sem acoplar ao checkout (consumidores chegam na Fase 7).',
    comandos: 'XADD … MAXLEN ~ 1000 · XREVRANGE' },
  'pgbouncer-pool': { banco: 'PgBouncer', rotulo: 'pool de conexões', estrutura: 'modo transaction, até 20 conexões reais por banco',
    chave: 'pgbouncer:6432 → postgres:5432', porque: 'muitos clientes dividem poucas conexões reais com o PostgreSQL.',
    comandos: 'SHOW POOLS · SHOW STATS' },
}

/** Selo com banco E uso: "🟥 Redis · cache do produto". O detalhe vai no tooltip. */
export function UsoSelo({ id }: { id: IdUso }) {
  const u = USOS[id]
  return (
    <span className={`banco banco-${u.banco.toLowerCase()}`} title={`${u.estrutura} — ${u.chave}. ${u.porque}`}>
      <span aria-hidden="true">{ICONE[u.banco]}</span> {u.banco} · {u.rotulo}
    </span>
  )
}

const ICONE: Record<NomeBanco, string> = { PostgreSQL: '🐘', MongoDB: '🍃', Redis: '🟥', PgBouncer: '🔀', Cassandra: '👁️', Neo4j: '🕸️' }

/** Ficha "O que este laboratório usa": banco, uso, estrutura, chave e o porquê. */
export function Ficha({ usos, titulo = 'O que este laboratório usa', children }: { usos: IdUso[]; titulo?: string; children?: ReactNode }) {
  return (
    <section className="ficha" aria-label={titulo}>
      <h2>{titulo}</h2>
      {children && <p className="muted small">{children}</p>}
      <div className="ficha-grade">
        {usos.map((id) => {
          const u = USOS[id]
          return (
            <div key={id} className={`ficha-item borda-${u.banco.toLowerCase()}`}>
              <UsoSelo id={id} />
              <dl>
                <dt>Estrutura</dt><dd>{u.estrutura}</dd>
                <dt>Onde</dt><dd><code>{u.chave}</code></dd>
                <dt>Por quê</dt><dd>{u.porque}</dd>
                {u.comandos && <><dt>Comandos</dt><dd><code>{u.comandos}</code></dd></>}
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}
