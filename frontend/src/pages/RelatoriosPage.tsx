import { UsoSelo } from '../components/usos'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api, apiComOrigem, brl, post,
  type Atualizacao, type Categoria, type ClasseABC, type ReceitaDia, type VendaMensal,
} from '../api/client'
import { Async } from '../components/Async'
import { Explicacao, Titulo } from '../components/ui'

// Fase 2 — relatórios sobre a materialized view relatorio.vendas_por_dia.
// SQL em backend/db/queries/relatorios.sql (CUBE, janelas, CTE recursiva).

const mesFmt = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
const diaFmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')

export function RelatoriosPage() {
  const qc = useQueryClient()
  // A origem vem do cabeçalho X-Origem-Leitura: réplica, ou o primário se ela estiver fora (Fase 5).
  const status = useQuery({ queryKey: ['rel-status'], queryFn: () => apiComOrigem<Atualizacao[]>('/relatorios/atualizacao') })
  const ultima = status.data?.dados[0]
  const atualizar = useMutation({
    mutationFn: () => post<Atualizacao[]>('/relatorios/atualizar', {}),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('rel-') }),
  })

  return (
    <section>
      <Titulo titulo="Relatórios" />
      <Explicacao frase={<>Relatórios somam milhares de pedidos. Em vez de recalcular a cada visita, eles leem uma <strong>tabela de resumo</strong> (materialized view) que é atualizada a cada 10 minutos.</>}
                  topico="8.2 · 8.6" doc="docs/02-sql.md · docs/05-procedures-triggers-views.md">
        <p><strong>CUBE</strong> gera, numa só consulta, as células, os totais por mês, por UF e o total geral. <strong>Funções de janela</strong> (<code>avg() OVER</code>, <code>lag()</code>) comparam cada dia com os anteriores sem subconsultas. A árvore de categorias usa <strong>CTE recursiva</strong>.</p>
        <p>O preço da materialized view: pedidos novos só aparecem depois do <code>REFRESH</code>. <code>CONCURRENTLY</code> deixa os relatórios legíveis durante a atualização (exige um índice único).</p>
        <p><strong>Fase 5:</strong> as consultas vão para a <strong>réplica</strong>; o REFRESH (escrita) vai ao primário. Depois do REFRESH, a API espera a réplica aplicar o WAL dele antes de responder — senão a tela releria o relatório velho (<em>read-your-writes</em>, veja o <a href="/lab/replicacao">Laboratório de Replicação</a>).</p>
      </Explicacao>
      <div className="painel inline">
        <span>
          <UsoSelo id="pg-relatorios" /> Fonte: <code>relatorio.vendas_por_dia</code> (materialized view)
          {ultima && (
            <> · atualizada em {new Date(ultima.atualizado_em).toLocaleString('pt-BR')} ({ultima.duracao_ms} ms)</>
          )}
        </span>
        {status.data && (
          <span aria-label="Origem da leitura">
            {status.data.origem === 'replica'
              ? <><UsoSelo id="pg-replica" /> Lido da réplica (<code>postgres-replica</code>): o primário fica livre para as compras.</>
              : <><UsoSelo id="pg-relatorios" /> Lido do primário (réplica indisponível ou não configurada).</>}
          </span>
        )}
        <button onClick={() => atualizar.mutate()} disabled={atualizar.isPending}>
          {atualizar.isPending ? 'Atualizando…' : 'REFRESH CONCURRENTLY'}
        </button>
        <span className="muted small">A API também atualiza sozinha a cada 10 min. Pedidos novos só aparecem depois do refresh.</span>
      </div>
      <VendasMensais />
      <div className="duas-colunas">
        <ReceitaDiaria />
        <div>
          <CurvaABC />
          <Categorias />
        </div>
      </div>
    </section>
  )
}

function VendasMensais() {
  const q = useQuery({ queryKey: ['rel-mensal'], queryFn: () => api<VendaMensal[]>('/relatorios/vendas-mensais?meses=5') })
  return (
    <>
      <h2>Receita por mês e UF <span className="muted small">GROUP BY CUBE (mes, uf) · cinza = subtotais gerados pelo CUBE</span></h2>
      <Async query={q}>
        {(rows) => {
          // Pivô: nivel 0 = célula, 1 = total do mês, 2 = total da UF, 3 = total geral
          const ufs = [...new Set(rows.filter((r) => r.nivel === 0).map((r) => r.uf))].sort()
          const meses = [...new Set(rows.filter((r) => r.nivel === 0).map((r) => r.mes!))].sort()
          const cel = (mes: string | null, uf: string) =>
            rows.find((r) => r.mes === mes && r.uf === uf)?.receita
          return (
            <table>
              <thead>
                <tr><th>Mês</th>{ufs.map((u) => <th key={u}>{u}</th>)}<th>Total do mês</th></tr>
              </thead>
              <tbody>
                {meses.map((m) => (
                  <tr key={m}>
                    <td>{mesFmt(m)}</td>
                    {ufs.map((u) => <td key={u} className="num">{fmtMil(cel(m, u))}</td>)}
                    <td className="num subtotal">{fmtMil(cel(m, ''))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="subtotal">Total da UF</td>
                  {ufs.map((u) => <td key={u} className="num subtotal">{fmtMil(cel(null, u))}</td>)}
                  <td className="num subtotal"><strong>{fmtMil(cel(null, ''))}</strong></td>
                </tr>
              </tbody>
            </table>
          )
        }}
      </Async>
    </>
  )
}

const fmtMil = (v?: number) => (v == null ? '—' : `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`)

function ReceitaDiaria() {
  const q = useQuery({ queryKey: ['rel-diaria'], queryFn: () => api<ReceitaDia[]>('/relatorios/receita-diaria?dias=21') })
  return (
    <div>
      <h2>Receita diária <span className="muted small">avg() OVER (RANGE 6 days) · lag()</span></h2>
      <Async query={q}>
        {(rows) => (
          <table>
            <thead><tr><th>Dia</th><th>Pedidos</th><th>Receita</th><th>Média móvel 7d</th><th>Variação</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dia}>
                  <td>{diaFmt(r.dia)}</td>
                  <td className="num">{r.pedidos}</td>
                  <td className="num">{brl(r.receita)}</td>
                  <td className="num">{brl(r.media_movel_7d)}</td>
                  <td className={`num ${r.variacao != null && r.variacao < 0 ? 'error' : 'ok'}`}>
                    {r.variacao == null ? '—' : brl(r.variacao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </div>
  )
}

function CurvaABC() {
  const q = useQuery({ queryKey: ['rel-abc'], queryFn: () => api<ClasseABC[]>('/relatorios/curva-abc?dias=365') })
  return (
    <>
      <h2>Curva ABC (12 meses) <span className="muted small">soma acumulada com janela</span></h2>
      <Async query={q}>
        {(rows) => {
          const totSkus = rows.reduce((s, r) => s + r.skus, 0)
          const totRec = rows.reduce((s, r) => s + r.receita, 0)
          return (
            <table>
              <thead><tr><th>Classe</th><th>SKUs</th><th>% SKUs</th><th>% Receita</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.classe}>
                    <td><strong>{r.classe}</strong></td>
                    <td className="num">{r.skus}</td>
                    <td className="num">{((100 * r.skus) / totSkus).toFixed(1)}%</td>
                    <td className="num">{((100 * r.receita) / totRec).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }}
      </Async>
    </>
  )
}

function Categorias() {
  const q = useQuery({ queryKey: ['rel-categorias'], queryFn: () => api<Categoria[]>('/loja/categorias') })
  return (
    <>
      <h2>Árvore de categorias <span className="muted small">WITH RECURSIVE</span></h2>
      <Async query={q}>
        {(rows) => (
          <table>
            <thead><tr><th>Caminho</th><th>SKUs (com subcategorias)</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: `${c.nivel * 0.9}rem` }}>{c.nivel === 1 ? <strong>{c.nome}</strong> : c.caminho}</td>
                  <td className="num">{c.skus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </>
  )
}
