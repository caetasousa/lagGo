import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, type EstadoReplicacao } from '../../api/client'
import { Async } from '../../components/Async'
import { Explicacao, Stat, bytes, ms } from '../../components/ui'
import { UsoSelo } from '../../components/usos'

// Painel do DBA → Replicação (Fase 5, cenários S4 e T1): as duas pontas da
// replicação e o arquivamento do WAL.

export function PainelReplicacao() {
  const q = useQuery({ queryKey: ['replicacao'], queryFn: () => api<EstadoReplicacao>('/dba/replicacao'), refetchInterval: 2000 })
  return (
    <>
      <h2>Replicação e arquivamento <UsoSelo id="pg-replica" /></h2>
      <Explicacao frase="O primário envia o WAL para a réplica (streaming) e para o repositório de backup (arquivamento). Aqui se vê se os dois caminhos estão em dia."
                  topico="8.10" doc="docs/08-replicacao-backup.md §3">
        <p>Os quatro LSNs da réplica são os estágios do WAL: <strong>enviado</strong> pelo primário → <strong>gravado</strong> (entregue ao sistema da réplica) → <strong>durável</strong> (no disco dela) → <strong>aplicado</strong> (visível para leitura). Os atrasos são de <code>pg_stat_replication</code>; ficam vazios quando não há tráfego (nada a esperar).</p>
        <p>Laboratórios: <Link to="/lab/replicacao">Replicação</Link> e <Link to="/lab/backup">Backup e PITR</Link>.</p>
      </Explicacao>
      <Async query={q}>{(e) => <Estado e={e} />}</Async>
    </>
  )
}

const atraso = (v: number | null) => (v === null ? 'em dia' : ms(v))

function Estado({ e }: { e: EstadoReplicacao }) {
  const replicas = e.replicas ?? []
  const a = e.arquivamento
  return (
    <>
      <h3>Visto do primário</h3>
      <dl className="stats">
        <Stat rotulo="LSN atual do primário" valor={<code>{e.lsn_atual}</code>} />
        <Stat rotulo="Réplicas conectadas" valor={String(replicas.length)} detalhe={replicas.length ? replicas.map((r) => `${r.nome}: ${r.estado}`).join(', ') : 'nenhuma — a réplica está fora?'} />
        <Stat rotulo="Réplicas síncronas" valor={<code>{e.synchronous_standby_names || '—'}</code>} detalhe={`padrão do servidor: synchronous_commit = ${e.synchronous_commit}`} />
      </dl>
      <table aria-label="Réplicas conectadas">
        <thead><tr><th>Réplica</th><th>Estado</th><th>Sincronismo</th><th>Enviado</th><th>Gravado</th><th>Durável</th><th>Aplicado</th><th>Falta aplicar</th><th>Atraso de aplicação</th></tr></thead>
        <tbody>
          {replicas.map((r) => (
            <tr key={r.nome}>
              <td><code>{r.nome}</code> <span className="muted small">{r.endereco}</span></td>
              <td>{r.estado}</td>
              <td title="sync = candidata síncrona; o COMMIT só espera por ela se a transação pedir (synchronous_commit)">{r.sincronismo}</td>
              <td><code>{r.enviado_lsn}</code></td><td><code>{r.gravado_lsn}</code></td><td><code>{r.duravel_lsn}</code></td><td><code>{r.aplicado_lsn}</code></td>
              <td className="num">{bytes(r.atraso_bytes)}</td><td className="num">{atraso(r.atraso_aplicacao_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table aria-label="Slots de replicação">
        <thead><tr><th>Slot</th><th>Ativo</th><th>Estado do WAL</th><th>WAL retido no primário</th></tr></thead>
        <tbody>
          {(e.slots ?? []).map((s) => (
            <tr key={s.nome} className={s.ativo ? undefined : 'bloqueado'}>
              <td><code>{s.nome}</code></td><td>{s.ativo ? 'sim' : 'não — a réplica não está consumindo'}</td>
              <td>{s.estado_wal}{s.invalidado && ` (invalidado: ${s.invalidado})`}</td><td className="num">{bytes(s.retido_bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Visto da réplica</h3>
      {e.replica ? (
        <dl className="stats" aria-label="Estado da réplica">
          <Stat rotulo="Em recuperação" valor={e.replica.em_recuperacao ? 'sim (só leitura)' : 'NÃO — aceita escrita!'} />
          <Stat rotulo="Receptor do WAL" valor={e.replica.receptor} detalhe={`de ${e.replica.origem || '?'} pelo slot ${e.replica.slot_usado || '—'}`} />
          <Stat rotulo="Recebido / aplicado" valor={<code>{e.replica.aplicado_lsn}</code>} detalhe={`recebido até ${e.replica.recebido_lsn}`} />
          <Stat rotulo="Última transação aplicada" valor={e.replica.ultima_transacao_aplicada || '—'}
                detalhe="sem escrita no primário, este horário fica parado — não é atraso" />
        </dl>
      ) : <p className="error">Réplica inacessível: {e.replica_erro}</p>}

      <h3>Arquivamento do WAL (pgBackRest)</h3>
      <dl className="stats" aria-label="Arquivamento do WAL">
        <Stat rotulo="archive_mode" valor={a.modo} />
        <Stat rotulo="Segmentos arquivados" valor={String(a.arquivados)} detalhe={a.ultimo_wal ? `último: ${a.ultimo_wal} às ${a.ultimo_em}` : 'nenhum ainda'} />
        <Stat rotulo="Situação" valor={a.ultima_falha ? 'FALHANDO' : 'arquivando'}
              detalhe={a.ultima_falha ? `última falha: ${a.ultima_falha}` : `${a.falhas} falha(s) desde que o servidor subiu, todas já superadas`} />
      </dl>
    </>
  )
}
