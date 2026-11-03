import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Banco, Explicacao, Titulo, type NomeBanco } from '../../components/ui'

// Os laboratórios agrupados pelo SERVIÇO do docker-compose.yml de que dependem
// (cenário K5): fica claro o que cada serviço ensina, o que precisa estar de pé
// e o que ainda falta. Os "em breve" seguem o roadmap do README.md.

type Lab = {
  titulo: string
  frase: string
  topico: string
  para?: string          // sem rota = ainda não existe
  fase?: string          // fase do roadmap em que entra
  usa?: string[]         // outros serviços de que depende
}

type Servico = {
  id: string             // o nome do serviço no docker-compose.yml
  banco: NomeBanco
  perfil?: 'nosql' | 'ha' // só sobe com o perfil (make up-nosql / make up-ha)
  servicos?: string      // quando a seção reúne vários serviços do compose
  papel: ReactNode       // o que este serviço faz na loja
  labs: Lab[]
  semLab?: ReactNode     // quando ainda não há laboratório próprio
  veja: { texto: string; para: string }[]
  material: string[]     // os documentos de docs/ sobre este serviço
}

const SERVICOS: Servico[] = [
  {
    id: 'postgres', material: ['02-sql', '03-transacoes-acid', '04-indices-otimizacao', '05-procedures-triggers-views', '06-postgresql-admin', '08-replicacao-backup', '09-alta-disponibilidade'],
    banco: 'PostgreSQL',
    papel: 'O banco relacional da loja: clientes, SKUs, estoque, pedidos, pagamentos e a trilha de auditoria. Tudo o que precisa de transação.',
    labs: [
      { titulo: 'Concorrência', topico: '8.4', para: '/lab',
        frase: '50 pessoas tentam comprar o último item ao mesmo tempo. Quantas conseguem?' },
      { titulo: 'Isolamento e deadlock', topico: '8.4', para: '/lab/isolamento',
        frase: 'Duas transações, passo a passo, em cada nível de isolamento: leitura suja, fantasma, lost update, write skew e deadlock.' },
      { titulo: 'Índices', topico: '8.5', para: '/indices',
        frase: 'Crie e remova índices e veja o plano de execução mudar: B-tree, parcial, expressão, GIN, BRIN, partição.' },
      { titulo: 'MVCC e VACUUM', topico: '8.7', para: '/lab/mvcc',
        frase: 'Um UPDATE não sobrescreve: cria uma versão nova. Veja as tuplas mortas, o HOT update e a diferença entre VACUUM e VACUUM FULL.' },
      { titulo: 'Particionamento e expurgo', topico: '8.7', para: '/lab/expurgo',
        frase: 'Apagar um mês de auditoria com DELETE ou com DROP PARTITION: compare tempo, WAL e espaço.' },
      { titulo: 'Backup e PITR', topico: '8.10', para: '/lab/backup',
        frase: 'Backups full, diferencial e incremental com pgBackRest; apague uma tabela "sem querer" e recupere-a até o instante anterior numa instância à parte.' },
      { titulo: 'Segurança (RLS)', topico: '8.12', fase: 'Fase 6',
        frase: 'O mesmo SELECT devolve linhas diferentes para cada vendedor: a regra mora no banco.' },
    ],
    veja: [
      { texto: 'Relatórios (materialized view, CUBE)', para: '/relatorios' },
      { texto: 'Painel do DBA → PostgreSQL', para: '/dba?aba=postgres' },
      { texto: 'Painel do DBA → Replicação', para: '/dba?aba=replicacao' },
    ],
  },
  {
    id: 'postgres-replica', material: ['08-replicacao-backup'],
    banco: 'PostgreSQL',
    papel: 'Réplica física por streaming do postgres: recebe o WAL e o reaplica, só leitura. Os relatórios da loja leem daqui.',
    labs: [
      { titulo: 'Replicação', topico: '8.10', para: '/lab/replicacao', usa: ['postgres'],
        frase: 'Grave no primário e leia na réplica com cada synchronous_commit (off, local, remote_write, on, remote_apply): o custo e a garantia de cada um.' },
    ],
    veja: [
      { texto: 'Relatórios (lidos da réplica)', para: '/relatorios' },
      { texto: 'Painel do DBA → Replicação', para: '/dba?aba=replicacao' },
    ],
  },
  {
    id: 'pgbouncer', material: ['06-postgresql-admin'],
    banco: 'PgBouncer',
    papel: 'O pool de conexões entre os clientes e o PostgreSQL, em modo transaction: muitos clientes dividem poucas conexões reais.',
    labs: [
      { titulo: 'Conexões e PgBouncer', topico: '8.7', para: '/lab/conexoes', usa: ['postgres'],
        frase: 'Abrir uma conexão por requisição custa caro. Compare com o PgBouncer e com o pool da aplicação — e esbarre no max_connections.' },
    ],
    veja: [{ texto: 'Painel do DBA → PgBouncer', para: '/dba?aba=pgbouncer' }],
  },
  {
    id: 'mongo', material: ['07-nosql', 'fase-3'],
    banco: 'MongoDB',
    papel: 'O catálogo: um documento por produto, com atributos diferentes por categoria, avaliações e o resumo delas. Replica set rs0 de um nó.',
    labs: [],
    semLab: <>Ainda sem laboratório próprio (o de alta disponibilidade usa um replica set à parte, o <code>mongo-ha</code>). Hoje o MongoDB aparece na <Link to="/loja">loja</Link> (busca textual, facetas, array de ancestrais) e como a fonte que o <Link to="/lab/cache">Laboratório de Cache</Link> evita ler.</>,
    veja: [
      { texto: 'Loja → catálogo', para: '/loja' },
      { texto: 'Painel do DBA → MongoDB e Redis', para: '/dba?aba=nosql' },
    ],
  },
  {
    id: 'redis', material: ['07-nosql', 'fase-3'],
    banco: 'Redis',
    papel: 'Memória: cache do produto, carrinho da sessão, ranking de mais vendidos, limite de requisições e fila de eventos de pedidos.',
    labs: [
      { titulo: 'Cache', topico: '8.8', para: '/lab/cache', usa: ['mongo'],
        frase: 'O mesmo produto lido centenas de vezes do MongoDB e do cache no Redis.' },
    ],
    veja: [
      { texto: 'Carrinho (HASH com TTL)', para: '/carrinho' },
      { texto: 'Painel do DBA → MongoDB e Redis', para: '/dba?aba=nosql' },
    ],
  },
  {
    id: 'patroni', perfil: 'ha', servicos: 'patroni1 · patroni2 · etcd1–3 · haproxy', material: ['09-alta-disponibilidade'],
    banco: 'PostgreSQL',
    papel: 'Cluster de laboratório: dois PostgreSQL com Patroni, que elege o líder por uma chave com validade no etcd; o HAProxy manda a escrita para quem é o líder.',
    labs: [
      { titulo: 'Failover com Patroni', topico: '8.11', para: '/lab/ha?aba=patroni', usa: ['etcd', 'haproxy'],
        frase: 'Derrube o líder durante as escritas: quanto tempo até o outro nó assumir, e alguma escrita confirmada se perde?' },
    ],
    veja: [],
  },
  {
    id: 'mongo-ha', perfil: 'ha', servicos: 'mongo-ha1 · mongo-ha2 · mongo-ha3', material: ['09-alta-disponibilidade'],
    banco: 'MongoDB',
    papel: 'Replica set de laboratório com 3 nós e autenticação: failover nativo por eleição entre os membros.',
    labs: [
      { titulo: 'Eleição no replica set', topico: '8.11', para: '/lab/ha?aba=mongo',
        frase: 'Derrube o primário e veja os outros dois elegerem um novo; compare w: 1 com w: "majority".' },
    ],
    veja: [],
  },
  {
    id: 'redis-ha', perfil: 'ha', servicos: 'redis-ha1 · redis-ha2 · sentinel1–3', material: ['09-alta-disponibilidade'],
    banco: 'Redis',
    papel: 'Primário e réplica de laboratório vigiados por três Sentinels, que promovem a réplica por quórum.',
    labs: [
      { titulo: 'Failover com Sentinel', topico: '8.11', para: '/lab/ha?aba=redis', usa: ['sentinel'],
        frase: 'Congele o primário e veja os sentinels promoverem a réplica; compare com e sem WAIT 1.' },
    ],
    veja: [],
  },
  {
    id: 'cassandra', material: ['07-nosql'],
    banco: 'Cassandra', perfil: 'nosql',
    papel: 'Wide-column: eventos de navegação ("vistos recentemente") com TTL, escritos em grande volume.',
    labs: [
      { titulo: 'Consistência ajustável', topico: '8.8', fase: 'Fase 7',
        frase: 'ONE, QUORUM e ALL com um nó desligado.' },
    ],
    veja: [],
  },
  {
    id: 'neo4j', material: ['07-nosql'],
    banco: 'Neo4j', perfil: 'nosql',
    papel: 'Grafo: Cliente –COMPROU→ Produto, para recomendações.',
    labs: [
      { titulo: 'Grafo × SQL recursivo', topico: '8.8', fase: 'Fase 7', usa: ['postgres'],
        frase: '"Quem comprou também comprou" em Cypher e em SQL, lado a lado.' },
    ],
    veja: [],
  },
]

export function LabsPage() {
  return (
    <section>
      <Titulo titulo="Laboratórios" />
      <Explicacao frase="Cada laboratório é um experimento curto: você ajusta, roda e o resultado vem com a explicação do que aconteceu. Eles estão agrupados pelo serviço do docker compose de que dependem.">
        <p>O nome em <code>código</code> é o do serviço no <code>docker-compose.yml</code>: é ele que precisa estar de pé (<code>docker compose ps</code>) para o laboratório funcionar. "Também usa" lista os outros serviços envolvidos.</p>
        <p>Os laboratórios mexem só em dados próprios (schema <code>lab</code>, uma partição separada da auditoria, o SKU "Console Edição Limitada") — nunca no resto da loja.</p>
      </Explicacao>

      <nav className="form-linha small" aria-label="Serviços">
        {SERVICOS.map((s) => <a key={s.id} href={`#servico-${s.id}`}><code>{s.id}</code></a>)}
      </nav>

      {SERVICOS.map((s) => {
        const prontos = s.labs.filter((l) => l.para).length
        return (
          <section key={s.id} id={`servico-${s.id}`} className="servico" aria-label={`Serviço ${s.id}`}>
            <h2>
              <Banco nome={s.banco} /> <code>{s.id}</code>
              {s.perfil && <span className="topico">perfil {s.perfil} · <code>make up-{s.perfil}</code></span>}
              <span className="topico">{prontos} de {s.labs.length} laboratório(s) prontos</span>
            </h2>
            <p className="muted">{s.papel}</p>
            {s.servicos && <p className="small">Serviços: <code>{s.servicos}</code></p>}
            {s.perfil === 'nosql' && <p className="muted small">Não sobe no dia a dia nem nos testes: o projeto só começa a usá-lo na Fase 7.</p>}
            {s.perfil === 'ha' && <p className="muted small">Fica fora do dia a dia para poupar memória (~600 MB os três clusters): suba com <code>make up-ha</code>. O E2E sobe para testar o failover.</p>}
            {s.semLab && <p className="small">{s.semLab}</p>}
            <div className="grade-labs">
              {s.labs.map((l) => <CartaoLab key={l.titulo} lab={l} />)}
            </div>
            <p className="small">
              📖 Material: {s.material.map((m, i) => <span key={m}>{i > 0 && ' · '}<Link to={`/estudo/${m}`}>{m}</Link></span>)}
              {s.veja.length > 0 && <> — veja também: {s.veja.map((v, i) => <span key={v.para}>{i > 0 && ' · '}<Link to={v.para}>{v.texto}</Link></span>)}</>}
            </p>
          </section>
        )
      })}

      <p className="muted small">
        Os outros serviços do compose não são bancos e não têm laboratório: <code>api</code> (Go) e <code>web</code> (React + nginx);
        no perfil <code>tools</code>, <code>pgadmin</code> e <code>redisinsight</code> (interfaces gráficas). O pgBackRest roda dentro do
        <code>postgres</code> (a imagem do projeto o inclui).
      </p>
    </section>
  )
}

function CartaoLab({ lab: l }: { lab: Lab }) {
  const corpo = (
    <>
      <span>
        <span className="topico">tópico {l.topico}</span>
        {l.fase && <span className="topico">{l.fase}</span>}
        {l.usa && <span className="topico">também usa: {l.usa.join(', ')}</span>}
      </span>
      <h3>{l.titulo}</h3>
      <p className="muted small">{l.frase}</p>
    </>
  )
  return l.para
    ? <Link to={l.para} className="lab-card">{corpo}</Link>
    : <div className="lab-card em-breve" aria-label={`${l.titulo} (em breve, ${l.fase})`}>{corpo}</div>
}
