import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api, post,
  type EstadoCachePG, type EstadoPgBouncer, type MetricasPG, type PgActivity, type PgLock, type PgOverview,
  type PgTopQuery, type SaudeIndice, type SaudeTabela,
} from '../../api/client'
import { Async } from '../../components/Async'
import { Linha, type Ponto } from '../../components/Graficos'
import { Banco, Explicacao, Stat, bytes, inteiro } from '../../components/ui'
import { REFRESH_MS, hitRatio } from './secoes'

// Seções do PostgreSQL no Painel do DBA (Fases 0–4).

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—')

export function VisaoGeralPG() {
  const o = useQuery({ queryKey: ['pg-overview'], queryFn: () => api<PgOverview>('/dba/postgres/overview'), refetchInterval: REFRESH_MS })
  return (
    <Async query={o}>
      {(o) => (
        <dl className="stats" aria-label="PostgreSQL visão geral">
          <Stat rotulo="Papel" valor={o.in_recovery ? 'réplica' : 'primário'} />
          <Stat rotulo="Tamanho do banco" valor={bytes(o.database_bytes)} />
          <Stat rotulo="Conexões" valor={`${o.connections} / ${o.max_connections}`} />
          <Stat rotulo="Leituras do cache" valor={o.cache_hit_ratio == null ? '—' : `${o.cache_hit_ratio.toFixed(2)}%`} />
          <Stat rotulo="No ar desde" valor={<span className="small">{new Date(o.started_at).toLocaleString('pt-BR')}</span>} />
        </dl>
      )}
    </Async>
  )
}

/** Métricas ao vivo: o servidor devolve contadores acumulados; a taxa é a diferença entre duas leituras. */
export function Metricas() {
  const [series, setSeries] = useState<{ tps: Ponto[]; escritas: Ponto[]; conexoes: Ponto[] }>({ tps: [], escritas: [], conexoes: [] })
  const anterior = useRef<MetricasPG | null>(null)
  const m = useQuery({ queryKey: ['pg-metricas'], queryFn: () => api<MetricasPG>('/dba/postgres/metricas'), refetchInterval: 2000 })
  useEffect(() => {
    const atual = m.data
    if (!atual) return
    const ant = anterior.current
    anterior.current = atual
    if (!ant || ant.em === atual.em) return
    const dt = (new Date(atual.em).getTime() - new Date(ant.em).getTime()) / 1000
    const t = new Date(atual.em).toLocaleTimeString('pt-BR')
    const mais = (xs: Ponto[], v: number) => [...xs, { t, v: Math.max(0, v) }].slice(-60)
    setSeries((s) => ({
      tps: mais(s.tps, (atual.commits + atual.rollbacks - ant.commits - ant.rollbacks) / dt),
      escritas: mais(s.escritas, (atual.tuplas_escritas - ant.tuplas_escritas) / dt),
      conexoes: mais(s.conexoes, atual.conexoes_total),
    }))
  }, [m.data])
  return (
    <>
      <h2>Ao vivo <Banco nome="PostgreSQL" /> <span className="muted small">pg_stat_database a cada 2 s · últimos 2 minutos</span></h2>
      <div className="graficos" aria-label="Métricas ao vivo">
        <Linha titulo="Transações por segundo" unidade="tx/s" dados={series.tps} />
        <Linha titulo="Linhas escritas por segundo" unidade="linhas/s" dados={series.escritas} />
        <Linha titulo="Conexões abertas" unidade="conexões" dados={series.conexoes} />
      </div>
      <p className="muted small">Faça compras ou rode um laboratório em outra aba e veja as curvas mudarem.</p>
    </>
  )
}

export function Tabelas() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['pg-tabelas'], queryFn: () => api<SaudeTabela[]>('/dba/postgres/tabelas'), refetchInterval: REFRESH_MS })
  const manut = useMutation({
    mutationFn: (b: { acao: string; tabela: string }) => post<{ duracao_ms: number }>('/dba/postgres/manutencao', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pg-tabelas'] }),
  })
  return (
    <>
      <h2>Saúde das tabelas <Banco nome="PostgreSQL" /></h2>
      <Explicacao frase="Quanto espaço cada tabela ocupa, quantas versões mortas acumulou (MVCC) e quando o autovacuum passou por ela. Tuplas mortas demais = tabela inchada e consultas mais lentas.">
        <p><strong>HOT</strong>: % dos UPDATEs que ficaram na mesma página sem tocar os índices (bom). <strong>Seq/Idx scans</strong>: quantas vezes a tabela foi lida inteira × por índice. Tabela particionada aparece uma vez, somando as partições.</p>
        <p>Fonte: <code>pg_stat_user_tables</code>, <code>pg_relation_size</code>, <code>pg_partition_tree</code>. As contagens são estatísticas (aproximadas e com alguns segundos de atraso).</p>
      </Explicacao>
      <Async query={q}>
        {(ts) => (
          <table aria-label="Saúde das tabelas">
            <thead><tr><th>Tabela</th><th>Total</th><th>Índices</th><th>Vivas</th><th>Mortas</th><th>HOT</th><th>Seq / Idx scans</th><th>Último (auto)vacuum</th><th>Opções</th><th></th></tr></thead>
            <tbody>
              {ts.map((t) => {
                const pctMortas = t.tuplas_vivas + t.tuplas_mortas > 0 ? (100 * t.tuplas_mortas) / (t.tuplas_vivas + t.tuplas_mortas) : 0
                return (
                  <tr key={t.nome} className={pctMortas > 20 ? 'ruim' : undefined}>
                    <td><code>{t.nome}</code>{t.particionada && <div className="small muted">particionada · {t.particoes} partições</div>}</td>
                    <td className="num">{bytes(t.bytes_total)}</td>
                    <td className="num">{bytes(t.bytes_indices)}</td>
                    <td className="num">{inteiro(t.tuplas_vivas)}</td>
                    <td className="num">{inteiro(t.tuplas_mortas)}{pctMortas > 1 && <div className="small muted">{pctMortas.toFixed(0)}%</div>}</td>
                    <td className="num">{t.updates > 0 ? `${((100 * t.updates_hot) / t.updates).toFixed(0)}%` : '—'}</td>
                    <td className="num">{inteiro(t.seq_scans)} / {inteiro(t.idx_scans)}</td>
                    <td className="small">{quando(t.ultimo_autovacuum ?? t.ultimo_vacuum)}{t.autovacuums > 0 && <div className="muted">{t.autovacuums}× autovacuum</div>}</td>
                    <td className="small"><code>{t.opcoes.join(' ')}</code></td>
                    <td>
                      <button disabled={manut.isPending} onClick={() => manut.mutate({ acao: 'vacuum', tabela: t.nome })} title="VACUUM (ANALYZE)">VACUUM</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Async>
      {manut.isSuccess && <p className="ok small">Feito em {manut.data.duracao_ms} ms.</p>}
      {manut.isError && <p className="error small">{manut.error.message}</p>}
    </>
  )
}

export function Indices() {
  const q = useQuery({ queryKey: ['pg-indices'], queryFn: () => api<SaudeIndice[]>('/dba/postgres/indices') })
  return (
    <>
      <h2>Índices <Banco nome="PostgreSQL" /></h2>
      <Explicacao frase="Índice que nunca é usado só custa: ocupa espaço e deixa cada INSERT/UPDATE mais lento. Os marcados são candidatos a remoção.">
        <p>"Nunca usado" = <code>idx_scan = 0</code> desde o último reset das estatísticas. Índices de chave primária e únicos nunca são candidatos: eles garantem unicidade mesmo sem ser lidos. Antes de remover, confira se a estatística cobre um período representativo (fechamento de mês, relatórios anuais…).</p>
      </Explicacao>
      <Async query={q}>
        {(is) => (
          <table aria-label="Índices">
            <thead><tr><th>Índice</th><th>Tabela</th><th>Usos</th><th>Tamanho</th><th>Tipo</th><th></th></tr></thead>
            <tbody>
              {is.map((i) => (
                <tr key={i.nome}>
                  <td><code>{i.nome}</code></td><td><code>{i.tabela}</code></td>
                  <td className="num">{inteiro(i.usos)}</td><td className="num">{bytes(i.bytes)}</td>
                  <td className="small">{i.primario ? 'chave primária' : i.unico ? 'único' : 'comum'}</td>
                  <td>{i.candidato_remocao && <span className="etiqueta pendente">nunca usado</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </>
  )
}

export function CacheBuffers() {
  const q = useQuery({ queryKey: ['pg-cache'], queryFn: () => api<EstadoCachePG>('/dba/postgres/cache'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>O que está na memória (shared_buffers) <Banco nome="PostgreSQL" /></h2>
      <Explicacao frase="O PostgreSQL guarda as páginas mais usadas em memória. Esta lista mostra quais tabelas e índices ocupam essa memória agora.">
        <p>Fonte: extensão <code>pg_buffercache</code>. "Sujos" = páginas alteradas em memória que ainda não foram gravadas no disco (o checkpoint grava). "Uso médio" (0–5) = quão disputada é a página — as de uso baixo saem primeiro quando falta espaço.</p>
        <p><code>shared_buffers</code> só muda reiniciando o servidor (veja <code>infra/postgres/postgresql.conf</code>).</p>
      </Explicacao>
      <Async query={q}>
        {(c) => (
          <>
            <p className="small">{inteiro(c.usados)} de {inteiro(c.total_buffers)} páginas de 8 KB ocupadas ({bytes(c.usados * 8192)} de {bytes(c.total_buffers * 8192)}).</p>
            <table aria-label="Cache do PostgreSQL">
              <thead><tr><th>Objeto</th><th>Tipo</th><th>Páginas</th><th>% do cache</th><th>Sujas</th><th>Uso médio</th></tr></thead>
              <tbody>
                {c.relacoes.map((r) => (
                  <tr key={r.nome}><td><code>{r.nome}</code></td><td>{r.tipo}</td><td className="num">{inteiro(r.buffers)}</td>
                    <td className="num">{r.pct_do_cache.toFixed(1)}%</td><td className="num">{inteiro(r.sujos)}</td><td className="num">{r.uso_medio}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Async>
    </>
  )
}

export function Consultas() {
  const top = useQuery({ queryKey: ['pg-top'], queryFn: () => api<PgTopQuery[]>('/dba/postgres/top-queries?limit=10'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>Consultas mais custosas <span className="muted small">pg_stat_statements</span></h2>
      <Async query={top}>
        {(rows) => (
          <table aria-label="Consultas mais custosas">
            <thead><tr><th>Consulta</th><th>Chamadas</th><th>Total (ms)</th><th>Média (ms)</th><th>Linhas</th><th>Cache hit</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.query_id}>
                  <td><code>{q.query}</code></td><td className="num">{q.calls}</td><td className="num">{q.total_exec_ms.toFixed(1)}</td>
                  <td className="num">{q.mean_exec_ms.toFixed(2)}</td><td className="num">{q.rows}</td><td className="num">{hitRatio(q)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </>
  )
}

export function Sessoes() {
  const locks = useQuery({ queryKey: ['pg-locks'], queryFn: () => api<PgLock[]>('/dba/postgres/locks'), refetchInterval: 1000 })
  const activity = useQuery({ queryKey: ['pg-activity'], queryFn: () => api<PgActivity[]>('/dba/postgres/activity'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>Locks <span className="muted small">pg_locks · a cada 1 s · rode o Laboratório de Concorrência com atraso alto</span></h2>
      <Async query={locks}>
        {(rows) => rows.length === 0 ? <p className="muted">Nenhum lock relevante agora.</p> : (
          <table aria-label="Locks">
            <thead><tr><th>PID</th><th>Tipo</th><th>Modo</th><th>Concedido</th><th>Objeto</th><th>Esperando (ms)</th><th>Bloqueado por</th><th>Consulta</th></tr></thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={i} className={l.granted ? undefined : 'blocked'}>
                  <td>{l.pid}</td><td>{l.locktype}</td><td>{l.mode}</td><td>{l.granted ? 'sim' : 'NÃO'}</td>
                  <td>{l.relation ?? (l.transaction_id ? `xid ${l.transaction_id}` : '—')}</td>
                  <td>{l.wait_ms?.toFixed(0) ?? '—'}</td><td>{l.blocked_by.join(', ') || '—'}</td><td><code>{l.query}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
      <h2>Sessões <span className="muted small">pg_stat_activity</span></h2>
      <Async query={activity}>
        {(rows) => (
          <table aria-label="Sessões">
            <thead><tr><th>PID</th><th>Usuário</th><th>Estado</th><th>Espera</th><th>Duração (ms)</th><th>Bloqueado por</th><th>Consulta</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.pid} className={a.blocked_by.length ? 'blocked' : undefined}>
                  <td>{a.pid}</td><td>{a.user ?? '—'}</td><td>{a.state ?? '—'}</td>
                  <td>{a.wait_event_type ? `${a.wait_event_type}:${a.wait_event}` : '—'}</td>
                  <td>{a.duration_ms?.toFixed(0) ?? '—'}</td><td>{a.blocked_by.join(', ') || '—'}</td><td><code>{a.query}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </>
  )
}

export function PgBouncerPainel() {
  const q = useQuery({ queryKey: ['pgbouncer'], queryFn: () => api<EstadoPgBouncer>('/dba/pgbouncer'), refetchInterval: 2000, retry: false })
  const tabela = (linhas: Record<string, string | number>[] | null | undefined, colunas: string[], rotulo: string) => (
    <table aria-label={rotulo}>
      <thead><tr>{colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{linhas?.map((l, i) => <tr key={i}>{colunas.map((c) => <td key={c}>{String(l[c] ?? '')}</td>)}</tr>)}</tbody>
    </table>
  )
  return (
    <>
      <h2>PgBouncer <Banco nome="PgBouncer" /></h2>
      <Explicacao frase="Os clientes falam com o PgBouncer, que empresta uma conexão real com o PostgreSQL só durante cada transação (modo transaction).">
        <p><code>cl_active</code> clientes usando uma conexão agora · <code>cl_waiting</code> clientes na fila esperando uma conexão livre · <code>sv_active</code>/<code>sv_idle</code> conexões reais com o PostgreSQL em uso/ociosas. Console: <code>psql -h pgbouncer -p 6432 -U marketplace pgbouncer</code>, comandos <code>SHOW POOLS</code>, <code>SHOW STATS</code>.</p>
      </Explicacao>
      {q.isError ? <p className="error">{q.error.message}</p> : (
        <>
          {q.data && !q.data.POOLS?.some((p) => p.database === 'marketplace') && (
            <p className="muted small">Nenhum cliente usou o PgBouncer ainda: o pool de um banco nasce na primeira conexão. Rode o <a href="/lab/conexoes">Laboratório de Conexões</a>.</p>
          )}
          {tabela(q.data?.POOLS, ['database', 'user', 'cl_active', 'cl_waiting', 'sv_active', 'sv_idle', 'sv_used', 'maxwait', 'pool_mode'], 'Pools do PgBouncer')}
          <h3>Estatísticas</h3>
          {tabela(q.data?.STATS, ['database', 'total_xact_count', 'total_query_count', 'avg_xact_time', 'avg_wait_time'], 'Estatísticas do PgBouncer')}
          <h3>Configuração</h3>
          {tabela(q.data?.CONFIG, ['key', 'value'], 'Configuração do PgBouncer')}
        </>
      )}
    </>
  )
}
