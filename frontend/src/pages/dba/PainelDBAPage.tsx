import { useQuery } from '@tanstack/react-query'
import { api, type HealthStatus } from '../../api/client'
import { Async } from '../../components/Async'
import { Abas, Explicacao, Titulo, useAba } from '../../components/ui'
import { Auditoria, Manutencao, PainelMongo, PainelRedis, REFRESH_MS } from './secoes'
import { PainelReplicacao } from './replicacao'
import { CacheBuffers, Consultas, Indices, Metricas, PgBouncerPainel, Sessoes, Tabelas, VisaoGeralPG } from './postgres'

// Painel do DBA: o que acontece DENTRO dos bancos, por abas (a aba fica na URL).

const ABAS: [string, string][] = [
  ['geral', 'Visão geral'],
  ['postgres', 'PostgreSQL'],
  ['nosql', 'MongoDB e Redis'],
  ['pgbouncer', 'PgBouncer'],
  ['replicacao', 'Replicação'],
  ['auditoria', 'Auditoria'],
  ['manutencao', 'Manutenção'],
]

export function PainelDBAPage() {
  const [aba, mudar] = useAba('geral')
  return (
    <section>
      <Titulo titulo="Painel do DBA" />
      <Explicacao frase="O que um administrador de banco olha no dia a dia: se tudo está no ar, quanto trabalho os bancos estão fazendo, onde está o espaço, o que está travado e quem mudou o quê."
                  topico="8.7" doc="docs/06-postgresql-admin.md">
        <p>Tudo aqui vem de consultas às visões internas de cada banco: <code>pg_stat_*</code> e extensões no PostgreSQL, <code>INFO</code>/<code>SCAN</code> no Redis, <code>serverStatus</code>/<code>$collStats</code> no MongoDB, <code>SHOW POOLS</code> no PgBouncer.</p>
      </Explicacao>
      <Abas abas={ABAS} atual={aba} mudar={mudar} />
      {aba === 'geral' && <><Saude /><h2>PostgreSQL</h2><VisaoGeralPG /><Metricas /></>}
      {aba === 'postgres' && <><Tabelas /><Indices /><CacheBuffers /><Consultas /><Sessoes /></>}
      {aba === 'nosql' && <><PainelRedis /><PainelMongo /></>}
      {aba === 'pgbouncer' && <PgBouncerPainel />}
      {aba === 'replicacao' && <PainelReplicacao />}
      {aba === 'auditoria' && <Auditoria />}
      {aba === 'manutencao' && <Manutencao />}
    </section>
  )
}

function Saude() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<HealthStatus[]>('/health'), refetchInterval: REFRESH_MS })
  return (
    <>
      <h2>Bancos de dados</h2>
      <Async query={health}>
        {(items) => (
          <div className="cards">
            {items.map((h) => (
              <div key={h.name} className={`card status-${h.status}`}>
                <div className="card-title">{h.name}</div>
                <div className="muted small">{h.model}</div>
                <div className="card-status">{h.status}</div>
                {h.version && <div className="small">v{h.version}</div>}
                {h.status === 'up' && <div className="muted small">{h.latency_ms.toFixed(1)} ms</div>}
                {h.error && <div className="muted small">{h.error}</div>}
              </div>
            ))}
          </div>
        )}
      </Async>
    </>
  )
}
