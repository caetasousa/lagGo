import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, del, kb, post, type ExperimentoLab, type ExplainResultado, type IndiceLab } from '../../api/client'
import { Async } from '../../components/Async'
import { PlanoLegivel } from '../../components/PlanoLegivel'
import { TutorialIndices } from '../../components/TutorialIndices'
import { Ficha } from '../../components/usos'
import { Fontes, FontesCurtas, type IdFonte } from '../../components/fontes'
import { Explicacao, Titulo, inteiro, ms } from '../../components/ui'

// Laboratório de Índices (Fases 2 e 4, docs/04-indices-otimizacao.md).
// Cada experimento roda EXPLAIN (ANALYZE, BUFFERS) numa transação READ ONLY.

const WORK_MEM = ['', '64kB', '1MB', '4MB', '16MB', '64MB']

// Ajustes de sessão (SET LOCAL) que a API aceita — só parâmetros do planejador.
const AJUSTES: [string, string, string[]][] = [
  ['enable_seqscan', 'Seq Scan', ['on', 'off']],
  ['enable_bitmapscan', 'Bitmap Scan', ['on', 'off']],
  ['enable_indexscan', 'Index Scan', ['on', 'off']],
  ['enable_partition_pruning', 'Partition pruning', ['on', 'off']],
  ['random_page_cost', 'random_page_cost', ['4', '1.1']],
]

// De onde vem a explicação de cada experimento (cenário K3).
const FONTES_EXPERIMENTO: Record<string, IdFonte[]> = {
  'pedidos-do-cliente': ['pg_multicoluna', 'utl_composto', 'pg_explain'],
  'vendas-do-sku': ['pg_juncoes', 'utl_juncoes', 'pg_estatisticas'],
  'faixa-de-datas': ['pg_multicoluna', 'pg_brin', 'utl_composto'],
  pendentes: ['pg_parcial', 'utl_parcial', 'pg_estatisticas'],
  'nome-sem-caixa': ['pg_expressao', 'utl_funcoes'],
  'trecho-email': ['pg_trgm', 'pg_gin', 'utl_like'],
  'curva-abc': ['pg_work_mem', 'pg_explain', 'pg_examinar'],
  'auditoria-um-mes': ['pg_pruning', 'pg_particionamento'],
  'auditoria-mes-com-funcao': ['pg_pruning', 'utl_funcoes'],
}

export function IndicesPage() {
  const experimentos = useQuery({ queryKey: ['experimentos'], queryFn: () => api<ExperimentoLab[]>('/dba/indices/experimentos') })
  const [selecionado, setSelecionado] = useState('pedidos-do-cliente')
  const [historico, setHistorico] = useState<ExplainResultado[]>([])

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Índices" />
      <Explicacao frase={<>Um índice é como o índice remissivo de um livro: em vez de ler a tabela inteira, o banco vai direto às linhas que interessam. Se o assunto sempre foi confuso, comece pelo <strong>"Índices do zero"</strong> logo abaixo — são 8 passos curtos.</>}
                  topico="8.5 · 8.7" doc="docs/04-indices-otimizacao.md" />
      <TutorialIndices />
      <Ficha usos={['pg-pedidos', 'pg-auditoria']}>
        Os experimentos consultam as tabelas da loja (100 mil pedidos, 250 mil itens, 10 mil clientes) e a auditoria particionada. Nada é alterado: o EXPLAIN roda numa transação somente leitura e desfeita no fim; só os índices do catálogo são criados ou removidos.
      </Ficha>

      <h2>Os experimentos</h2>
      <Async query={experimentos}>
        {(lista) => {
          const exp = lista.find((e) => e.id === selecionado) ?? lista[0]
          return (
            <div className="lab-indices">
              <nav className="lista-experimentos">
                {lista.map((e, i) => (
                  <button key={e.id} className={e.id === exp.id ? 'ativo' : undefined} onClick={() => setSelecionado(e.id)}>
                    <span className="muted small">{i + 1}. {e.conceito}</span>
                    {e.titulo}
                  </button>
                ))}
              </nav>
              <Experimento key={exp.id} exp={exp} historico={historico.filter((h) => h.experimento === exp.id)}
                           onResultado={(r) => setHistorico((h) => [r, ...h].slice(0, 40))} />
            </div>
          )
        }}
      </Async>

      {historico.length > 0 && (
        <>
          <h2>Histórico de execuções</h2>
          <table aria-label="Histórico de execuções">
            <thead>
              <tr><th>Experimento</th><th>Índices presentes</th><th>Ajustes</th><th>Execução</th><th>Páginas (cache)</th><th>Páginas (disco)</th><th>Nó principal</th></tr>
            </thead>
            <tbody>
              {historico.map((r, i) => (
                <tr key={i}>
                  <td>{r.experimento}</td>
                  <td>{r.indices_presentes?.join(', ') || <span className="error">nenhum</span>}</td>
                  <td>work_mem={r.work_mem}{Object.entries(r.ajustes ?? {}).map(([k, v]) => ` ${k}=${v}`)}</td>
                  <td className="num">{r.execucao_ms.toFixed(2)} ms</td>
                  <td className="num">{r.buffers_hit}</td>
                  <td className="num">{r.buffers_read}</td>
                  <td><code>{principaisNos(r.plano)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Fontes doc="04-indices-otimizacao" ids={['pg_indices', 'pg_tipos_indice', 'pg_btree', 'pg_multicoluna', 'pg_parcial', 'pg_expressao', 'pg_index_only', 'pg_gin', 'pg_trgm', 'pg_brin',
        'pg_explain', 'pg_examinar', 'pg_estatisticas', 'pg_planejador_cfg', 'pg_work_mem', 'pg_juncoes', 'pg_pruning', 'pg_pagina',
        'utl_anatomia', 'utl_composto', 'utl_funcoes', 'utl_like', 'utl_parcial', 'utl_explain', 'utl_juncoes', 'interdb_planejador', 'ddia_indices',
        'bayer_btree', 'comer_btree', 'dalibo']} />
    </section>
  )
}

function Experimento({ exp, historico, onResultado }: {
  exp: ExperimentoLab; historico: ExplainResultado[]; onResultado: (r: ExplainResultado) => void
}) {
  const [workMem, setWorkMem] = useState('')
  const [ajustes, setAjustes] = useState<Record<string, string>>({})
  const explain = useMutation({
    mutationFn: () => post<ExplainResultado>(`/dba/indices/experimentos/${exp.id}/explain`, { work_mem: workMem, ajustes }),
    onSuccess: onResultado,
  })

  return (
    <div className="experimento">
      <h2>{exp.titulo}</h2>
      <section className="sobre-opcao" aria-label="O experimento">
        <div className="sobre-grade">
          <div><h4>A pergunta</h4><div>{exp.pergunta}</div></div>
          <div><h4>Sem índice, o banco…</h4><div>{exp.sem_indice}</div></div>
          <div><h4>Com o índice…</h4><div>{exp.com_indice}</div></div>
          <div><h4>O que observar</h4><div>{exp.observe}</div></div>
        </div>
        <h4>A consulta</h4>
        <pre className="sql">{exp.sql}</pre>
        <FontesCurtas ids={FONTES_EXPERIMENTO[exp.id] ?? []} titulo="Fontes deste experimento" />
        {exp.parametro_sql && <p className="muted small">O valor de <code>$1</code> é escolhido por <code>{exp.parametro_sql}</code> (sempre o mesmo, para antes e depois serem comparáveis).</p>}
      </section>

      {exp.indices.length > 0 && (
        <>
          <h3>Os índices deste experimento</h3>
          <div className="indices">
            {exp.indices.map((i) => <IndiceCard key={i.nome} indice={i} />)}
          </div>
        </>
      )}

      <details className="small">
        <summary>Ajustes de sessão (para ver o "plano B" do planejador)</summary>
        <p className="muted">Desligar um tipo de plano (<code>off</code>) não o proíbe, só o torna caríssimo: o planejador mostra o melhor caminho <em>sem</em> ele. <code>random_page_cost</code> = custo de ler uma página fora de ordem (4 = disco giratório; 1,1 = SSD). <code>work_mem</code> = memória para ordenar e juntar.</p>
      </details>
      <div className="form-linha">
        <label>work_mem
          <select value={workMem} onChange={(e) => setWorkMem(e.target.value)}>
            {WORK_MEM.map((w) => <option key={w} value={w}>{w || 'padrão do servidor'}</option>)}
          </select>
        </label>
        {AJUSTES.map(([nome, rotulo, valores]) => (
          <label key={nome}>{rotulo}
            <select aria-label={nome} value={ajustes[nome] ?? valores[0]}
                    onChange={(e) => setAjustes((a) => {
                      const n = { ...a }
                      if (e.target.value === valores[0]) delete n[nome]
                      else n[nome] = e.target.value
                      return n
                    })}>
              {valores.map((v) => <option key={v} value={v}>{v}{v === valores[0] ? ' (padrão)' : ''}</option>)}
            </select>
          </label>
        ))}
        <button className="primario" onClick={() => explain.mutate()} disabled={explain.isPending}>
          {explain.isPending ? 'Executando…' : 'EXPLAIN ANALYZE'}
        </button>
      </div>
      {explain.isError && <p className="error">{explain.error.message}</p>}

      <AntesDepois historico={historico} />

      {explain.data && (
        <>
          <dl className="stats">
            <div><dt>Tempo de execução</dt><dd>{ms(explain.data.execucao_ms)}</dd></div>
            <div><dt>Páginas lidas da memória</dt><dd>{inteiro(explain.data.buffers_hit)}</dd></div>
            <div><dt>Páginas lidas do disco</dt><dd>{inteiro(explain.data.buffers_read)}</dd></div>
            <div><dt>Planejamento</dt><dd>{ms(explain.data.planejamento_ms)}</dd></div>
          </dl>
          {explain.data.parametro && <p className="muted small">$1 = <code>{explain.data.parametro}</code></p>}
          <PlanoLegivel plano={explain.data.plano} />
          <h3>O plano original</h3>
          <pre className="plano">
            {explain.data.plano.map((l, i) => <div key={i} className={classeLinha(l)}>{l}</div>)}
          </pre>
        </>
      )}
    </div>
  )
}

/** Compara a última execução SEM índices com a última COM algum índice deste experimento. */
function AntesDepois({ historico }: { historico: ExplainResultado[] }) {
  const sem = historico.find((h) => !h.indices_presentes?.length && !Object.keys(h.ajustes ?? {}).length)
  const com = historico.find((h) => h.indices_presentes?.length && !Object.keys(h.ajustes ?? {}).length)
  if (!sem || !com) {
    return historico.length > 0
      ? <p className="muted small">Para o quadro <strong>antes × depois</strong>, rode este experimento uma vez sem os índices e uma vez com um deles.</p>
      : null
  }
  const pagSem = sem.buffers_hit + sem.buffers_read, pagCom = com.buffers_hit + com.buffers_read
  const x = pagSem / Math.max(pagCom, 1)
  const t = sem.execucao_ms / Math.max(com.execucao_ms, 0.001)
  return (
    <section className="conclusao boa" aria-label="Antes e depois">
      <strong>Antes × depois: {x >= 1.5 ? `${x.toFixed(x < 10 ? 1 : 0)}× menos páginas lidas` : 'quase as mesmas páginas lidas'} e {t >= 1.5 ? `${t.toFixed(t < 10 ? 1 : 0)}× mais rápido` : 'tempo parecido'} com {com.indices_presentes!.join(', ')}</strong>
      <div className="comparacao">
        <div><h4>Sem índice</h4>{inteiro(pagSem)} páginas · {ms(sem.execucao_ms)}<div className="small muted">{principaisNos(sem.plano)}</div></div>
        <div><h4>Com {com.indices_presentes!.join(', ')}</h4>{inteiro(pagCom)} páginas · {ms(com.execucao_ms)}<div className="small muted">{principaisNos(com.plano)}</div></div>
      </div>
    </section>
  )
}

function IndiceCard({ indice }: { indice: IndiceLab }) {
  const qc = useQueryClient()
  const alternar = useMutation({
    mutationFn: () => (indice.existe ? del(`/dba/indices/${indice.nome}`) : post(`/dba/indices/${indice.nome}`, {})),
    onSettled: () => qc.invalidateQueries({ queryKey: ['experimentos'] }),
  })
  return (
    <div className={`card ${indice.existe ? 'status-up' : 'status-disabled'}`}>
      <div className="card-title">{indice.tipo}{indice.da_migracao && <span className="muted small"> · migração 00004</span>}</div>
      <code className="small">{indice.criar.replace('CREATE INDEX CONCURRENTLY IF NOT EXISTS ', '')}</code>
      <p className="small" style={{ margin: 0 }}>{indice.explicacao}</p>
      <div className="card-status">{indice.existe ? (indice.valido ? 'existe' : 'INVÁLIDO') : 'ausente'}</div>
      {indice.existe && <div className="muted small">{kb(indice.bytes)} · usado {indice.usos}×</div>}
      <button onClick={() => alternar.mutate()} disabled={alternar.isPending}>
        {alternar.isPending ? '…' : indice.existe ? 'DROP INDEX' : 'CREATE INDEX'}
      </button>
      {alternar.isError && <div className="error small">{alternar.error.message}</div>}
    </div>
  )
}

function classeLinha(l: string) {
  if (/Seq Scan/.test(l)) return 'plano-seq'
  if (/Index (Only )?Scan|Bitmap Index Scan/.test(l)) return 'plano-idx'
  if (/Disk|external|Batches: [2-9]|Batches: \d\d/.test(l)) return 'plano-disco'
  if (/Time:/.test(l)) return 'plano-tempo'
  return undefined
}

function principaisNos(plano: string[]) {
  return plano
    .filter((l) => /Scan/.test(l))
    .map((l) => l.replace(/\s+\(cost.*/, '').replace(/^\s*->\s*/, '').trim())
    .join(' · ')
}
