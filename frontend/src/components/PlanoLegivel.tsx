// Traduz a saída do EXPLAIN (ANALYZE, BUFFERS) em passos numerados, em
// português simples, NA ORDEM EM QUE ACONTECEM: o plano é uma árvore e o
// PostgreSQL executa de baixo (folhas, que leem dados) para cima.

type No = {
  nome: string
  alvo?: string   // tabela
  indice?: string
  estimadas?: number
  reais?: number
  loops?: number
  detalhes: string[]
  filhos: No[]
  recuo: number
}

const RE_NO = /^(\s*)(?:->\s+)?([A-Z][A-Za-z ]+?)(?:\s+using\s+(\S+))?(?:\s+on\s+(\S+)(?:\s+(\S+))?)?\s+\(cost=[\d.]+\.\.[\d.]+ rows=(\d+) width=\d+\)(?:\s+\(actual time=[\d.]+\.\.[\d.]+ rows=([\d.]+) loops=(\d+)\))?/

export function analisarPlano(linhas: string[]): No | null {
  const pilha: No[] = []
  let raiz: No | null = null
  for (const l of linhas) {
    if (/^(Planning|Execution|JIT)/.test(l.trim())) break
    const m = RE_NO.exec(l)
    if (m) {
      const recuo = l.indexOf('->') >= 0 ? l.indexOf('->') : m[1].length
      const no: No = {
        nome: m[2].trim(), indice: m[3], alvo: m[4],
        estimadas: Number(m[6]), reais: m[7] ? Number(m[7]) : undefined, loops: m[8] ? Number(m[8]) : undefined,
        detalhes: [], filhos: [], recuo,
      }
      while (pilha.length && pilha[pilha.length - 1].recuo >= recuo) pilha.pop()
      if (pilha.length) pilha[pilha.length - 1].filhos.push(no)
      else raiz = no
      pilha.push(no)
    } else if (pilha.length && l.trim()) {
      pilha[pilha.length - 1].detalhes.push(l.trim())
    }
  }
  return raiz
}

function emOrdem(no: No, out: No[] = []): No[] {
  no.filhos.forEach((f) => emOrdem(f, out))
  out.push(no)
  return out
}

const n = (x?: number) => (x ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const detalhe = (no: No, prefixo: string) => no.detalhes.find((d) => d.startsWith(prefixo))?.slice(prefixo.length).trim()

function explicar(no: No): { texto: string; tom?: 'boa' | 'ruim' } {
  const t = no.alvo ? `${no.alvo}` : ''
  const removidas = detalhe(no, 'Rows Removed by Filter:')
  const nome = no.nome
  if (nome.includes('Index Only Scan')) return { texto: `Respondeu usando só o índice ${no.indice}, sem precisar abrir a tabela ${t}.`, tom: 'boa' }
  if (nome.includes('Bitmap Index Scan')) return { texto: `Consultou o índice ${no.alvo} e marcou num "mapa" (bitmap) quais páginas da tabela têm linhas que servem.`, tom: 'boa' }
  if (nome.includes('Bitmap Heap Scan')) return { texto: `Leu na tabela ${t} só as páginas marcadas no mapa, na ordem do disco${detalhe(no, 'Recheck Cond:') ? ', conferindo de novo cada linha (Recheck)' : ''}.`, tom: 'boa' }
  if (nome.includes('Index Scan')) return { texto: `Desceu a árvore do índice ${no.indice} e foi buscar na tabela ${t} cada linha encontrada.`, tom: 'boa' }
  if (nome.includes('Seq Scan')) {
    const par = nome.includes('Parallel') ? ' (dividido entre processos paralelos)' : ''
    return {
      texto: `Leu a tabela ${t} INTEIRA, página por página${par}${removidas ? ` — e jogou fora ${n(Number(removidas))} linhas que não serviam` : ''}.`,
      tom: removidas && Number(removidas) > 1000 ? 'ruim' : undefined,
    }
  }
  if (nome === 'Sort' || nome.includes('Incremental Sort')) {
    const metodo = detalhe(no, 'Sort Method:') ?? ''
    const disco = /external|Disk/.test(metodo)
    return { texto: `Ordenou as linhas ${disco ? 'USANDO O DISCO (não coube na memória — veja work_mem)' : 'na memória'}.`, tom: disco ? 'ruim' : undefined }
  }
  if (nome === 'Limit') return { texto: `Parou depois das primeiras ${n(no.reais)} linhas (LIMIT).` }
  if (nome === 'Hash') {
    const b = /Batches: (\d+)/.exec(no.detalhes.join(' '))?.[1]
    const disco = b && Number(b) > 1
    return { texto: `Montou uma tabela de consulta em memória (hash) com um dos lados${disco ? ` — dividida em ${b} lotes no disco porque não coube na memória` : ''}.`, tom: disco ? 'ruim' : undefined }
  }
  if (nome.includes('Hash Join')) return { texto: 'Juntou as duas tabelas procurando cada linha de um lado na tabela hash do outro (Hash Join).' }
  if (nome.includes('Nested Loop')) return { texto: 'Para cada linha de um lado, buscou as correspondentes do outro (Nested Loop) — ótimo quando um lado tem poucas linhas e o outro tem índice.' }
  if (nome.includes('Merge Join')) return { texto: 'Juntou duas listas já ordenadas, andando nas duas ao mesmo tempo (Merge Join).' }
  if (nome.includes('WindowAgg')) return { texto: 'Calculou a função de janela (soma acumulada, ranking…).' }
  if (nome.includes('Aggregate')) return { texto: `Agregou (count, sum…)${nome.includes('Hash') ? ' agrupando com uma tabela hash' : nome.includes('Group') ? ' sobre linhas já ordenadas' : ''}.` }
  if (nome === 'Append') {
    const removidas = detalhe(no, 'Subplans Removed:')
    return { texto: `Juntou o resultado de ${no.filhos.length} partição(ões)${removidas ? ` — e descartou ${removidas} sem ler (partition pruning)` : ''}.`, tom: removidas ? 'boa' : no.filhos.length > 3 ? 'ruim' : undefined }
  }
  if (nome.startsWith('Gather')) return { texto: 'Juntou o trabalho dos processos paralelos.' }
  if (nome.includes('Subquery Scan')) return { texto: `Leu o resultado da subconsulta ${t}.` }
  if (nome === 'Memoize') return { texto: 'Guardou resultados repetidos para não buscar duas vezes.' }
  if (nome === 'Materialize') return { texto: 'Guardou um resultado intermediário em memória para reler.' }
  if (nome === 'Result') return { texto: 'Calculou o resultado final.' }
  return { texto: nome }
}

export function PlanoLegivel({ plano }: { plano: string[] }) {
  const raiz = analisarPlano(plano)
  if (!raiz) return null
  const passos = emOrdem(raiz)
  return (
    <section aria-label="Leitura do plano">
      <h3>O plano em português <span className="muted small">— na ordem em que o banco executou (de baixo para cima no texto)</span></h3>
      <ol className="leitura-plano">
        {passos.map((no, i) => {
          const e = explicar(no)
          const buf = detalhe(no, 'Buffers:')
          const errou = no.reais != null && no.estimadas != null && no.estimadas > 0 &&
            (no.reais / no.estimadas > 10 || no.estimadas / Math.max(no.reais, 1) > 10)
          return (
            <li key={i} className={e.tom}>
              <div><span className="no">{no.nome}</span> — {e.texto}</div>
              <div className="detalhe">
                {no.reais != null && <>devolveu {n(no.reais * (no.loops ?? 1))} linha(s){no.loops && no.loops > 1 ? ` (${no.loops} repetições)` : ''} · o planejador estimava {n(no.estimadas)}{errou ? ' — estimativa muito errada: rode ANALYZE' : ''}</>}
                {buf && <> · páginas: {buf.replace('shared hit=', 'do cache ').replace('read=', 'do disco ')}</>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
