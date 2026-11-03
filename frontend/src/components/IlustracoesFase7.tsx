import { Caixa, CINZA, useSeta, type Tom } from './Ilustracoes'

// Ilustrações dos tutoriais da Fase 7 (Cassandra e Neo4j). Mesmas regras das
// outras: cores só por variável do tema (--il-*), texto claro sobre caixa escura.

/** O anel do Cassandra com RF=3: cada dado mora em 3 nós vizinhos no anel. */
export function IlustracaoAnel({ vivos = 3, nivel }: { vivos?: 1 | 3; nivel?: 'ONE' | 'QUORUM' | 'ALL' }) {
  const seta = useSeta('var(--il-destaque)')
  const nos = [
    { x: 330, y: 20, nome: 'nó A' }, { x: 520, y: 100, nome: 'nó B' }, { x: 470, y: 230, nome: 'nó C' },
    { x: 190, y: 230, nome: 'nó D' }, { x: 140, y: 100, nome: 'nó E' },
  ]
  const replicas = [0, 1, 2] // a chave cai no A; RF=3 copia em A, B e C
  const precisa = nivel === 'ONE' ? 1 : nivel === 'QUORUM' ? 2 : nivel === 'ALL' ? 3 : 0
  const ok = nivel ? Math.min(vivos, 3) >= precisa : true
  const rotulo = nivel
    ? `Anel com RF=3 e ${vivos} réplica(s) viva(s): ${nivel} precisa de ${precisa} — ${ok ? 'funciona' : 'falha (Unavailable)'}`
    : 'Anel do Cassandra: a chave cai num nó e o fator de replicação 3 copia nos dois vizinhos'
  return (
    <svg className="ilustracao" viewBox="0 0 760 330" role="img" aria-label={rotulo}>
      {seta.def}
      <ellipse cx="355" cy="150" rx="230" ry="125" fill="none" stroke="var(--il-linha)" strokeWidth="2" strokeDasharray="6 4" />
      {nos.map((n, i) => {
        const replica = replicas.includes(i)
        const fora = replica && i >= vivos
        const tom: Tom = fora ? 'ruim' : replica ? 'destaque' : 'apagado'
        return <Caixa key={n.nome} x={n.x - 50} y={n.y} w={100} h={46} tom={tom} tracejada={fora}
                      texto={`${n.nome}\n${fora ? 'fora do ar' : replica ? 'réplica' : '—'}`} />
      })}
      <Caixa x={600} y={250} w={150} h={58} tom={nivel ? (ok ? 'ok' : 'ruim') : 'neutro'} fonte={12}
             texto={nivel ? `${nivel}: precisa de ${precisa}\n${ok ? 'responderam: OK' : `só ${Math.min(vivos, 3)} viva(s): falha`}` : 'RF = 3\n3 cópias de cada dado'} />
      <text x="0" y="325" fontSize="13" fill="var(--il-texto)">A chave da partição (cliente_id) vira um token: ele cai no nó A, e as cópias vão para os próximos nós do anel.</text>
    </svg>
  )
}

/** Uma partição do Cassandra: as linhas de um cliente juntas, em ordem. */
export function IlustracaoParticao() {
  const linhas = ['22:41 · Notebook Aurora', '22:39 · Mouse Zênite', '22:35 · Notebook Aurora', '21:02 · Livro de SQL']
  return (
    <svg className="ilustracao" viewBox="0 0 760 250" role="img" aria-label="Uma partição: todas as visitas de um cliente juntas, da mais nova para a mais antiga">
      <Caixa x={0} y={20} w={200} h={60} tom="destaque" fonte={12} texto={'partição\ncliente_id = ana'} />
      {linhas.map((l, i) => (
        <Caixa key={i} x={240} y={10 + i * 46} w={300} h={38} tom={i === 0 ? 'ok' : 'neutro'} texto={`visto_em ↓ ${l}`} />
      ))}
      <Caixa x={570} y={20} w={180} h={60} tom="espera" texto={'cada linha:\nTTL de 30 dias'} />
      <text x="0" y="215" fontSize="13" fill="var(--il-texto)">SELECT … WHERE cliente_id = 'ana' LIMIT 48 lê UMA partição, já em ordem: sem JOIN, sem ORDER BY, sem varrer o cluster.</text>
      <text x="0" y="235" fontSize="13" fill={CINZA}>O "Notebook Aurora" aparece duas vezes: a tabela guarda cada visita; quem tira as repetições é a API.</text>
    </svg>
  )
}

/** O grafo de compras: dois saltos a partir de um SKU. */
export function IlustracaoGrafoCompras({ saltos = 2 }: { saltos?: 2 | 3 }) {
  const seta = useSeta()
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img"
         aria-label={saltos === 2 ? 'Quem comprou X também comprou: X ← clientes → outros SKUs' : 'Alcance em 3 saltos: X ← clientes → SKUs ← outros clientes'}>
      {seta.def}
      <Caixa x={0} y={105} w={110} h={46} tom="destaque" fonte={12} texto={'Sku X'} />
      {['Ana', 'Bia', 'Caio'].map((n, i) => (
        <g key={n}>
          <line x1={210} y1={40 + i * 75 + 20} x2={112} y2={128} stroke={CINZA} strokeWidth="1.5" markerEnd={seta.url} />
          <Caixa x={210} y={40 + i * 75} w={100} h={40} tom="neutro" texto={`Cliente ${n}`} />
        </g>
      ))}
      {[['Sku Y', 'ok'], ['Sku Z', 'neutro']].map(([s, tom], i) => (
        <g key={s}>
          <line x1={312} y1={60 + i * 75} x2={420} y2={78 + i * 90} stroke={CINZA} strokeWidth="1.5" markerEnd={seta.url} />
          <line x1={312} y1={135} x2={420} y2={78 + i * 90} stroke={CINZA} strokeWidth="1.5" markerEnd={seta.url} />
          <Caixa x={422} y={58 + i * 90} w={110} h={40} tom={tom as Tom} texto={`${s}\nforça ${2 - i}`} />
        </g>
      ))}
      {saltos === 3 && (
        <g>
          <line x1={640} y1={78} x2={534} y2={78} stroke="var(--il-destaque)" strokeWidth="1.5" markerEnd={seta.url} />
          <Caixa x={640} y={58} w={110} h={40} tom="espera" texto={'Cliente Davi\n(não comprou X)'} />
        </g>
      )}
      <text x="0" y="240" fontSize="13" fill="var(--il-texto)">
        {saltos === 2 ? 'Força de Y = quantos clientes distintos compraram X e Y (aqui, 2). Cada seta é um relacionamento COMPROU.' : 'Terceiro salto: quem comprou Y mas não comprou X — alcançado pelos vizinhos dos vizinhos.'}
      </text>
    </svg>
  )
}

/** O mesmo caminho no SQL: cada salto são dois JOINs, e as linhas se multiplicam. */
export function IlustracaoJoins() {
  const seta = useSeta()
  const etapas: [string, string, Tom][] = [
    ['item_pedido\n(sku = X)', '~125 linhas', 'destaque'],
    ['pedido p1\n(compradores)', '~125', 'neutro'],
    ['pedido p2\n(todos os pedidos deles)', '~1.250', 'espera'],
    ['item_pedido i2\n(itens desses pedidos)', '~3.000', 'ruim'],
  ]
  return (
    <svg className="ilustracao" viewBox="0 0 760 200" role="img" aria-label="No SQL, cada salto do grafo vira dois JOINs e as linhas intermediárias se multiplicam">
      {seta.def}
      {etapas.map(([t, n, tom], i) => (
        <g key={t}>
          {i > 0 && <line x1={i * 190 - 12} y1={45} x2={i * 190} y2={45} stroke={CINZA} strokeWidth="1.5" markerEnd={seta.url} />}
          <Caixa x={i * 190} y={10} w={170} h={70} tom={tom} texto={`${t}\n${n}`} />
        </g>
      ))}
      <text x="0" y="115" fontSize="13" fill="var(--il-texto)">Números aproximados do seed (100 mil pedidos): o GROUP BY no fim agrupa ~3 mil linhas para devolver 10.</text>
      <text x="0" y="135" fontSize="13" fill="var(--il-texto)">Mais um salto (o alcance) multiplica de novo: o custo cresce com o tamanho das tabelas que o JOIN cruza.</text>
      <text x="0" y="155" fontSize="13" fill={CINZA}>No grafo, cada nó já aponta para os seus vizinhos: o custo depende de quantos vizinhos há, não do tamanho do banco.</text>
    </svg>
  )
}
