import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  api, post, kb,
  type PgTopQuery, type EstadoMongo, type EstadoRedis, type RegistroAuditoria, type RegistroDDL,
} from '../../api/client'
import { Async } from '../../components/Async'
import { Banco } from '../../components/ui'
import { UsoSelo, type IdUso } from '../../components/usos'

// Seções do Painel do DBA para os bancos NoSQL, auditoria e manutenção.

export const REFRESH_MS = 5000

export function PainelRedis() {
  const q = useQuery({ queryKey: ['dba-redis'], queryFn: () => api<EstadoRedis>('/dba/redis'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>Redis <Banco nome="Redis" /> <span className="muted small">INFO · SCAN por prefixo · stream de pedidos</span></h2>
      <Async query={q}>
        {(r) => (
          <>
            <dl className="stats" aria-label="Estado do Redis">
              <div><dt>Memória usada</dt><dd>{r.info.used_memory_human} / {r.info.maxmemory_human}</dd></div>
              <div><dt>Política</dt><dd>{r.info.maxmemory_policy}</dd></div>
              <div><dt>Acertos de cache</dt><dd>{r.hit_ratio == null ? '—' : `${r.hit_ratio.toFixed(1)}%`}</dd></div>
              <div><dt>Chaves expiradas / despejadas</dt><dd>{r.info.expired_keys} / {r.info.evicted_keys}</dd></div>
              <div><dt>AOF</dt><dd>{r.info.aof_enabled === '1' ? 'ligado' : 'desligado'}</dd></div>
            </dl>
            <table aria-label="Chaves por prefixo">
              <thead><tr><th>Prefixo</th><th>Chaves</th><th>Estrutura</th><th>Uso no projeto</th></tr></thead>
              <tbody>
                {Object.entries(r.chaves_por_prefixo).sort().map(([p, n]) => (
                  <tr key={p}><td><code>{p}:*</code></td><td className="num">{n}</td><td>{ESTRUTURA[p] ?? '—'}</td><td>{USO_PREFIXO[p] ? <UsoSelo id={USO_PREFIXO[p]} /> : '—'}</td></tr>
                ))}
              </tbody>
            </table>
            {r.stream_pedidos && (
              <p className="muted small">stream:pedidos ({r.tamanho_stream}): {r.stream_pedidos.map((m) => `${m.id} → ${String(m.pedido_id).slice(0, 8)} R$ ${m.total}`).join(' · ')}</p>
            )}
          </>
        )}
      </Async>
    </>
  )
}

const USO_PREFIXO: Record<string, IdUso> = {
  carrinho: 'redis-carrinho', cache: 'redis-cache', ranking: 'redis-ranking', rl: 'redis-rate-limit', stream: 'redis-stream', sessao: 'redis-sessao',
}

const ESTRUTURA: Record<string, string> = {
  carrinho: 'HASH com TTL (7 dias)',
  cache: 'STRING (JSON) com TTL (5 min)',
  ranking: 'SORTED SET',
  rl: 'STRING + INCR (rate limit, 2 min)',
  stream: 'STREAM',
  sessao: 'STRING com TTL (7 dias) + SET por cliente',
}

export function PainelMongo() {
  const q = useQuery({ queryKey: ['dba-mongo'], queryFn: () => api<EstadoMongo>('/dba/mongo'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>MongoDB <Banco nome="MongoDB" /> <span className="muted small">serverStatus · $collStats · replica set</span></h2>
      <Async query={q}>
        {(m) => (
          <>
            <p className="muted small">v{m.versao} · replica set <code>{m.replica_set}</code>: {m.membros?.join(', ')} · {m.conexoes} conexões</p>
            <table aria-label="Coleções do MongoDB">
              <thead><tr><th>Coleção</th><th>Documentos</th><th>Média por doc</th><th>Dados / em disco</th><th>Validação</th><th>Índices</th></tr></thead>
              <tbody>
                {m.colecoes.map((c) => (
                  <tr key={c.nome}>
                    <td>{c.nome}</td>
                    <td className="num">{c.documentos}</td>
                    <td className="num">{c.bytes_por_documento} B</td>
                    <td className="num">{kb(c.bytes_dados)} / {kb(c.bytes_armazenados)}</td>
                    <td>{c.tem_validacao ? '$jsonSchema' : '—'}</td>
                    <td><code className="small">{c.indices.map((i) => `${i.nome}${i.unico ? ' (único)' : ''} ${kb(i.bytes)}`).join(' · ')}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Async>
    </>
  )
}

export function Manutencao() {
  const [idadeHoras, setIdadeHoras] = useState(48)
  const cancelar = useMutation({
    mutationFn: () => post<{ cancelados: number; lotes: number; duracao_ms: number }>(
      '/dba/manutencao/cancelar-expirados', { idade_horas: idadeHoras, lote: 1000 }),
  })
  return (
    <>
      <h2>Manutenção <span className="muted small">(procedures)</span></h2>
      <div className="painel inline">
        <span><code>CALL cancelar_pedidos_expirados()</code>: cancela pedidos PENDENTES antigos e devolve o estoque, com COMMIT a cada lote de 1000.</span>
        <label className="inline">mais antigos que
          <input type="number" min={1} value={idadeHoras} onChange={(e) => setIdadeHoras(Number(e.target.value))} /> h
        </label>
        <button onClick={() => cancelar.mutate()} disabled={cancelar.isPending}>Executar</button>
        {cancelar.data && <span className="ok">{cancelar.data.cancelados} cancelados em {cancelar.data.lotes} lote(s), {cancelar.data.duracao_ms} ms</span>}
        {cancelar.isError && <span className="error">{cancelar.error.message}</span>}
      </div>
    </>
  )
}

export function Auditoria() {
  const dml = useQuery({ queryKey: ['auditoria'], queryFn: () => api<RegistroAuditoria[]>('/dba/auditoria?limite=15'), refetchInterval: REFRESH_MS })
  const ddl = useQuery({ queryKey: ['auditoria-ddl'], queryFn: () => api<RegistroDDL[]>('/dba/auditoria/ddl?limite=10'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>Auditoria de dados <span className="muted small">(trigger auditoria.registrar · pedido, pagamento, sku)</span></h2>
      <Async query={dml}>
        {(rows) => rows.length === 0 ? <p className="muted">Nada ainda: faça uma compra na Loja.</p> : (
          <table>
            <thead><tr><th>#</th><th>Quando</th><th>Transação</th><th>Tabela</th><th>Operação</th><th>Chave</th><th>O que mudou</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{new Date(r.em).toLocaleTimeString('pt-BR')}</td>
                  <td>{r.transacao}</td>
                  <td>{r.tabela}</td>
                  <td>{r.operacao}</td>
                  <td><code className="small">{r.chave?.slice(0, 8)}</code></td>
                  <td><code className="small">{diferenca(r)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>

      <h2>Auditoria de esquema <span className="muted small">(EVENT TRIGGER · inclui os índices do Laboratório)</span></h2>
      <Async query={ddl}>
        {(rows) => (
          <table>
            <thead><tr><th>Quando</th><th>Usuário</th><th>Comando</th><th>Objeto</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.em).toLocaleString('pt-BR')}</td>
                  <td>{r.usuario}</td>
                  <td>{r.comando}</td>
                  <td><code>{r.objeto}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </>
  )
}

// Para UPDATE mostra só os campos alterados; para INSERT/DELETE, a linha inteira resumida.
function diferenca(r: RegistroAuditoria) {
  if (r.operacao === 'UPDATE' && r.antes && r.depois) {
    return Object.keys(r.depois)
      .filter((k) => k !== 'atualizado_em' && JSON.stringify(r.antes![k]) !== JSON.stringify(r.depois![k]))
      .map((k) => `${k}: ${JSON.stringify(r.antes![k])} → ${JSON.stringify(r.depois![k])}`)
      .join('  ')
  }
  const linha = r.depois ?? r.antes ?? {}
  return Object.entries(linha).filter(([k]) => !k.endsWith('_em')).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ').slice(0, 160)
}

export function formatBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1)} ${units[i]}`
}

export function hitRatio(q: PgTopQuery) {
  const total = q.shared_blks_hit + q.shared_blks_read
  return total === 0 ? '—' : `${((100 * q.shared_blks_hit) / total).toFixed(1)}%`
}
