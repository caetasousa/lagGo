import { Link } from 'react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, type EnsaioHA, type EstadoClusterHA, type EstadoHA, type TecnologiaHA } from '../../api/client'
import { Linha } from '../../components/Graficos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { IlustracaoTopologiaHA } from '../../components/Ilustracoes'
import { TutorialHA } from '../../components/tutoriais'
import { Abas, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, ms, useAba } from '../../components/ui'
import { Ficha, UsoSelo, type IdUso } from '../../components/usos'

// Laboratório de Alta Disponibilidade (Fase 5, tópico 8.11, docs/09).

type Acao = EnsaioHA['acao']

const TECS: { id: TecnologiaHA; nome: string; uso: IdUso; garantia: string; semGarantia: string }[] = [
  { id: 'patroni', nome: 'PostgreSQL + Patroni', uso: 'ha-patroni', garantia: 'synchronous_mode ligado', semGarantia: 'replicação assíncrona' },
  { id: 'mongo', nome: 'MongoDB (replica set)', uso: 'ha-mongo', garantia: 'w: "majority"', semGarantia: 'w: 1' },
  { id: 'redis', nome: 'Redis + Sentinel', uso: 'ha-redis', garantia: 'WAIT 1 depois de cada escrita', semGarantia: 'sem WAIT' },
]

const SOBRE: Record<TecnologiaHA, Record<Acao, { titulo: string; conceito: string; analogia: string; comando: string; espere: string; fontes: IdFonte[] }>> = {
  patroni: {
    queda: {
      titulo: 'Queda do líder (Patroni)',
      conceito: 'O laboratório mata o processo do Patroni no nó líder (kill -9) e o nó inteiro cai junto. Ninguém avisa ninguém: a chave de líder no etcd simplesmente para de ser renovada. Quando ela expira (ttl = 20 s), o Patroni da réplica a pega e promove o seu PostgreSQL; o HAProxy percebe pelo /primary e passa a mandar a escrita para ele.',
      analogia: 'O gerente some sem avisar. O crachá de "gerente" vale até o fim do turno; quando vence, o subgerente o pega.',
      comando: `-- no líder, como superusuário (o supervisor do container grava o PID):
COPY (SELECT 1) TO PROGRAM 'kill -9 $(cat /tmp/patroni.pid)';
-- o escritor, enquanto isso, a cada 100 ms:
INSERT INTO ensaio_ha (rodada, n) VALUES ($1, $2);   -- via haproxy:5000`,
      espere: 'Escrita fora por perto de 20 s (o ttl). Nenhuma ou quase nenhuma escrita confirmada perdida; com synchronous_mode, nenhuma — garantido. ~1 min depois o antigo líder volta como réplica.',
      fontes: ['patroni_docs', 'patroni_config', 'patroni_sync', 'haproxy_docs'],
    },
    planejada: {
      titulo: 'Troca planejada (switchover)',
      conceito: 'POST /switchover na API REST do Patroni: o líder para de aceitar escrita, espera a réplica alcançá-lo, entrega a chave e vira réplica. Usado em manutenção e upgrades.',
      analogia: 'O gerente passa o crachá ao subgerente na troca de turno, com tudo anotado.',
      comando: `POST http://patroni1:8008/switchover  {"leader": "patroni1"}`,
      espere: 'Poucos segundos fora (as conexões abertas no antigo líder são derrubadas) e nenhuma escrita perdida.',
      fontes: ['patroni_rest', 'patroni_docs'],
    },
  },
  mongo: {
    queda: {
      titulo: 'Queda do primário (MongoDB)',
      conceito: 'O laboratório desliga o primário à força, sem election handoff: os secundários só percebem pela falta de heartbeats. Depois de electionTimeoutMillis (10 s), um deles pede votos e, com a maioria (2 de 3), vira primário. O driver descobre sozinho e repete a escrita que falhou.',
      analogia: 'A turma percebe que o representante sumiu porque ele parou de responder no grupo; depois de um tempo, vota em outro.',
      comando: `db.adminCommand({ setParameter: 1, enableElectionHandoff: false })
db.adminCommand({ shutdown: 1, force: true, timeoutSecs: 1 })
// o escritor: insertOne({ rodada, n }) com w: 1 ou w: "majority"`,
      espere: 'Escrita fora por ~10 s (o tempo de detecção + eleição). Com w: "majority", nada confirmado se perde. ~30 s depois o antigo primário volta como secundário.',
      fontes: ['mongo_eleicoes', 'mongo_wc', 'mongo_rollback', 'mongo_retry'],
    },
    planejada: {
      titulo: 'Troca planejada (replSetStepDown)',
      conceito: 'replSetStepDown: o primário deixa o posto, espera um secundário alcançá-lo e indica o sucessor (election handoff), que se elege na hora.',
      analogia: 'O representante renuncia e indica o vice, que assume no mesmo minuto.',
      comando: `db.adminCommand({ replSetStepDown: 30 })`,
      espere: 'Uma troca de milissegundos: talvez nenhuma escrita falhe (o driver repete a que falhar).',
      fontes: ['mongo_stepdown', 'mongo_retry'],
    },
  },
  redis: {
    queda: {
      titulo: 'Primário travado (Redis)',
      conceito: 'DEBUG SLEEP 30 congela o primário: ele não responde a ninguém. Depois de 5 s (down-after-milliseconds) cada sentinel o vê fora (SDOWN); com 2 concordando (quórum), vira ODOWN, um sentinel é eleito e promove a réplica. O cliente pergunta aos sentinels quem é o primário e segue. Quando o antigo acorda, os sentinels o transformam em réplica.',
      analogia: 'O caixa congela; três fiscais combinam que ele travou e abrem outro caixa.',
      comando: `DEBUG SLEEP 30                 -- no primário (enable-debug-command yes, só no laboratório)
RPUSH ha:ensaio:<rodada> <n>   -- o escritor, a cada 100 ms (com WAIT 1 0,5 s, se ligado)`,
      espere: 'Escrita fora por ~6–7 s. A replicação é assíncrona: o WAIT 1 reduz o risco de perder o confirmado, mas não o elimina.',
      fontes: ['redis_sentinel', 'redis_replicacao', 'redis_wait', 'jepsen_redis'],
    },
    planejada: {
      titulo: 'Troca planejada (SENTINEL FAILOVER)',
      conceito: 'SENTINEL FAILOVER principal: os sentinels promovem a réplica sem esperar o primário falhar (não precisa de quórum, só de um sentinel).',
      analogia: 'Os fiscais trocam o caixa no fim do turno.',
      comando: `SENTINEL FAILOVER principal`,
      espere: 'Alguns segundos com escritas recusadas enquanto o cliente descobre o novo primário.',
      fontes: ['redis_sentinel'],
    },
  },
}

export function HAPage() {
  const qc = useQueryClient()
  const [aba, mudar] = useAba('patroni')
  const tec = (TECS.find((t) => t.id === aba) ?? TECS[0])
  const [acao, setAcao] = useState<Acao>('queda')
  const [garantia, setGarantia] = useState(true)
  const estado = useQuery({
    queryKey: ['ha'], queryFn: () => api<EstadoHA>('/lab/ha'),
    refetchInterval: (q) => (q.state.data?.ensaio?.rodando ? 1000 : 4000),
  })
  const iniciar = useMutation({
    mutationFn: () => post<EnsaioHA>('/lab/ha', { tecnologia: tec.id, acao, garantia }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ha'] }),
  })
  const cluster = estado.data?.clusters[tec.id]
  const ensaio = estado.data?.ensaio
  const rodando = !!ensaio?.rodando

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Alta Disponibilidade" />
      <Explicacao frase={<>Derrube o <strong>líder</strong> de um cluster enquanto um programa escreve sem parar e veja o cluster <strong>eleger outro</strong> sozinho. Medimos quanto tempo a escrita ficou fora (<strong>RTO</strong>) e se alguma escrita confirmada sumiu (<strong>RPO</strong>).</>}
                  topico="8.11" doc="docs/09-alta-disponibilidade.md">
        <p>Os três clusters são <strong>só de laboratório</strong> (perfil <code>ha</code> do compose, ~600 MB): a loja continua com um primário e uma réplica. Suba-os com <code>make up-ha</code>.</p>
        <p>Cada nó roda sob um supervisor: quando o laboratório derruba o líder, o supervisor espera mais que o tempo de eleição e o sobe de novo — ele volta como réplica, e dá para ver que não há dois líderes.</p>
      </Explicacao>

      <Conceito>
        <p>Um banco com réplicas ainda tem um ponto fraco: quem decide que o líder morreu e quem assume? <strong>Failover automático</strong> é isso: detectar a falha, escolher a réplica mais atualizada, promovê-la e mandar a aplicação para ela.</p>
        <p>O perigo é o <strong>split-brain</strong> — dois nós achando que são o líder. Os três clusters evitam com <strong>quórum</strong>: só quem fala com a maioria pode liderar (etcd no Patroni, os votos no MongoDB, os sentinels no Redis).</p>
        <dl>
          <dt>RTO</dt><dd>quanto tempo a escrita ficou fora (o maior intervalo sem escrita confirmada).</dd>
          <dt>RPO</dt><dd>quanto do que foi confirmado se perdeu na troca.</dd>
          <dt>Queda</dt><dd>o líder some sem avisar; os outros percebem pela falta de sinal.</dd>
          <dt>Troca planejada</dt><dd>o líder entrega o posto de forma ordenada (switchover).</dd>
        </dl>
      </Conceito>
      <TutorialHA />
      <Ficha usos={['ha-patroni', 'ha-mongo', 'ha-redis']}>
        O escritor grava uma linha (ou documento, ou item de lista) a cada 100 ms e anota quais foram confirmadas; no fim, confere quais existem no novo líder.
      </Ficha>

      <Abas abas={TECS.map((t) => [t.id, t.nome])} atual={tec.id} mudar={mudar} />
      <h2>{tec.nome} <UsoSelo id={tec.uso} /></h2>
      <IlustracaoTopologiaHA tec={tec.id} />
      {cluster && <Membros c={cluster} />}

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>O que acontece com o líder</h3>
          <div className="estrategias" role="radiogroup" aria-label="Ação">
            {(['queda', 'planejada'] as Acao[]).map((a) => (
              <label key={a} className={`estrategia ${acao === a ? 'ativa' : ''}`}>
                <input type="radio" name="acao" checked={acao === a} onChange={() => setAcao(a)} />
                <strong>{a === 'queda' ? 'Queda (sem aviso)' : 'Troca planejada'}</strong>
                <span className="muted small">{SOBRE[tec.id][a].analogia}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Garantia e início</h3>
          <label className="inline"><input type="checkbox" checked={garantia} onChange={(e) => setGarantia(e.target.checked)} /> {tec.garantia} (desligado: {tec.semGarantia})</label>
          <div>
            <button className="primario" disabled={rodando || iniciar.isPending || !cluster?.disponivel} onClick={() => iniciar.mutate()}>
              {rodando ? `Ensaio rodando (${ensaio?.fase})…` : 'Iniciar o ensaio'}
            </button>
          </div>
          {iniciar.isError && <p className="error">{iniciar.error.message}</p>}
        </div>
      </div>

      <SobreOpcao titulo={SOBRE[tec.id][acao].titulo} conceito={SOBRE[tec.id][acao].conceito} analogia={SOBRE[tec.id][acao].analogia}
                  comando={SOBRE[tec.id][acao].comando} espere={SOBRE[tec.id][acao].espere} fontes={SOBRE[tec.id][acao].fontes} />

      {ensaio && ensaio.tecnologia === tec.id && <Resultado e={ensaio} />}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Por que o failover do Patroni leva perto de 20 s? O que mudaria com ttl = 5 s — e qual o risco?</li>
        <li>Por que a troca planejada é mais rápida que a queda nas três tecnologias?</li>
        <li>Com 2 nós de etcd em vez de 3, quantas falhas o cluster aguentaria? E com 4?</li>
        <li>O que garante, de verdade, que nenhuma escrita confirmada se perca: synchronous_mode, w: "majority" e WAIT 1 garantem a mesma coisa?</li>
        <li>Quando o antigo líder volta, por que ele não continua sendo líder?</li>
      </ol>

      <Fontes doc="09-alta-disponibilidade" ids={['sre_risco', 'pg_alta_disp', 'ddia_consenso', 'raft', 'raft_site', 'etcd_faq', 'patroni_docs', 'patroni_config',
        'patroni_rest', 'patroni_sync', 'pg_rewind', 'haproxy_docs', 'mongo_eleicoes', 'mongo_stepdown', 'mongo_wc', 'mongo_rollback', 'mongo_retry',
        'mongo_keyfile', 'redis_sentinel', 'redis_replicacao', 'redis_wait', 'jepsen_redis', 'jepsen_mongo']} />
    </section>
  )
}

function Membros({ c }: { c: EstadoClusterHA }) {
  if (!c.disponivel) {
    return (
      <Conclusao tipo="neutra" titulo="Este cluster de laboratório não está no ar.">
        Os clusters de alta disponibilidade ficam fora do dia a dia para poupar memória (~600 MB): suba-os com <code>make up-ha</code> e volte aqui.
        {c.erro && !c.erro.includes('make up-ha') && <> Detalhe: {c.erro}.</>}
      </Conclusao>
    )
  }
  return (
    <>
      <table aria-label="Membros do cluster">
        <thead><tr><th>Membro</th><th>Papel</th><th>Estado</th><th>Atraso</th></tr></thead>
        <tbody>
          {(c.membros ?? []).map((m) => (
            <tr key={m.nome} className={m.papel === 'fora' ? 'bloqueado' : undefined}>
              <td><code>{m.nome}</code></td><td><strong>{m.papel}</strong></td><td className="small">{m.estado}</td>
              <td className="num">{m.atraso == null ? '—' : m.atraso.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.detalhe && <p className="muted small">{c.detalhe}</p>}
    </>
  )
}

function Resultado({ e }: { e: EnsaioHA }) {
  const pontos = (e.pontos ?? []).map((p) => ({ t: `${p.t.toFixed(1)} s`, v: p.ok * 2 }))
  return (
    <>
      <h3>O ensaio {e.rodando && <span className="muted small">— {e.fase}</span>}</h3>
      <Linha titulo="Escritas confirmadas por segundo" unidade="escritas/s" dados={pontos} />
      <ol className="small" aria-label="Eventos do ensaio">
        {(e.eventos ?? []).map((ev, i) => <li key={i}><code>{ev.t.toFixed(1)} s</code> {ev.texto}</li>)}
      </ol>
      {e.erro && <p className="error">{e.erro}</p>}
      {!e.rodando && !e.erro && (
        <Conclusao tipo={e.perdidas === 0 ? 'boa' : 'ruim'}
                   titulo={`${e.lider_antes} → ${e.lider_depois}: a escrita ficou fora por ${ms(e.fora_ms)} e ${e.perdidas === 0 ? 'nenhuma escrita confirmada se perdeu' : `${e.perdidas} escrita(s) confirmada(s) se perderam`}.`}>
          O RTO deste ensaio foi {ms(e.fora_ms)} — {e.acao === 'queda' ? 'o tempo de perceber a falha e eleger outro líder' : 'o tempo da troca ordenada'}.
          {' '}Das {e.confirmadas} escritas confirmadas, {e.confirmadas - e.perdidas} estão no novo líder (RPO = {e.perdidas}).
          {e.acao === 'queda' && <> O antigo líder volta sozinho em cerca de um minuto — como réplica: acompanhe a tabela de membros.</>}
        </Conclusao>
      )}
    </>
  )
}
