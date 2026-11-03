import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { post, type ModoSync, type ResultadoReplicacao } from '../../api/client'
import { Barras } from '../../components/Graficos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { IlustracaoReplicacao } from '../../components/Ilustracoes'
import { TutorialReplicacao } from '../../components/tutoriais'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, bytes, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'

// Laboratório de Replicação (Fase 5, tópico 8.10, docs/08).

const MODOS: { id: ModoSync; espera: string }[] = [
  { id: 'off', espera: 'nada' },
  { id: 'local', espera: 'o disco local' },
  { id: 'remote_write', espera: 'a réplica receber' },
  { id: 'on', espera: 'o disco da réplica' },
  { id: 'remote_apply', espera: 'a réplica aplicar' },
]

const SOBRE_MODO: Record<ModoSync, { conceito: string; analogia: string; espere: string; fontes: IdFonte[] }> = {
  off: {
    conceito: 'O COMMIT responde antes até de o WAL ir para o disco do primário. O WAL writer o grava em ciclos (wal_writer_delay = 200 ms) — e a réplica só recebe WAL já gravado. Um crash do servidor pode perder a última fração de segundo de COMMITs "confirmados" (mas nunca corrompe o banco).',
    analogia: 'Dizer "anotado!" ao cliente e só escrever no caderno daqui a pouco.',
    espere: 'O COMMIT mais rápido de todos; a linha leva ~200 ms para aparecer na réplica.',
    fontes: ['pg_sync_commit', 'pg_wal_writer', 'pg_wal'],
  },
  local: {
    conceito: 'O COMMIT espera o WAL estar no disco do PRIMÁRIO (durável lá) e não espera a réplica: ela recebe logo depois. É o padrão deste projeto e o comportamento de qualquer replicação assíncrona.',
    analogia: 'Anotar no seu caderno antes de responder; o colega copia do seu caderno logo em seguida.',
    espere: 'COMMIT de poucos ms; a linha quase nunca está na réplica no instante seguinte, mas aparece em poucos ms. Com carga, demora mais.',
    fontes: ['pg_sync_commit', 'pg_streaming', 'ddia_replicacao'],
  },
  remote_write: {
    conceito: 'O COMMIT espera a réplica RECEBER o WAL e entregá-lo ao sistema operacional dela (ainda não no disco, ainda não aplicado). Protege contra a queda do primário, não contra a queda simultânea dos dois.',
    analogia: 'Esperar o colega dizer "recebi o recado" — ele ainda não anotou nem fez nada com ele.',
    espere: 'Um pouco mais lento que local; a linha ainda pode não estar visível na réplica.',
    fontes: ['pg_sync_commit', 'pg_sync_rep', 'pg_stat_replicacao'],
  },
  on: {
    conceito: 'Com uma réplica síncrona configurada, "on" espera o WAL estar no DISCO da réplica (flush). O dado está durável em dois servidores — mas a réplica ainda pode não ter aplicado: uma leitura nela pode não achar a linha.',
    analogia: 'Esperar o colega anotar no caderno dele — mas ele ainda não arrumou a prateleira.',
    espere: 'COMMIT mais lento; quase sempre a linha já está visível, mas não há garantia.',
    fontes: ['pg_sync_commit', 'pg_sync_rep', 'pg_sync_nomes'],
  },
  remote_apply: {
    conceito: 'O COMMIT espera a réplica APLICAR o WAL: quando ele responde, a linha já é visível lá. É o único modo que garante "ler na réplica o que acabei de gravar" (read-your-writes). Custo: o COMMIT espera a réplica aplicar TUDO o que veio antes — sob carga, sente primeiro.',
    analogia: 'Esperar o colega anotar E colocar o produto na prateleira dele antes de dizer ao cliente que está pronto.',
    espere: 'Todas as linhas visíveis na réplica logo após o COMMIT; o COMMIT mais lento, principalmente com carga.',
    fontes: ['pg_sync_commit', 'pg_sync_rep', 'ddia_replicacao'],
  },
}

export function ReplicacaoPage() {
  const [modo, setModo] = useState<ModoSync>('local')
  const [transacoes, setTransacoes] = useState(50)
  const [comCarga, setComCarga] = useState(false)
  const [resultados, setResultados] = useState<ResultadoReplicacao[]>([])
  const rodar = useMutation({
    mutationFn: () => post<ResultadoReplicacao>('/lab/replicacao', { modo, transacoes, com_carga: comCarga }),
    onSuccess: (r) => setResultados((h) => [r, ...h].slice(0, 20)),
  })
  const ultimo = resultados[0]
  // Para o gráfico: o último resultado de cada modo, nas mesmas condições (com ou sem carga) do último.
  const comparaveis = MODOS.map((m) => resultados.find((r) => r.modo === m.id && r.com_carga === ultimo?.com_carga)).filter((r) => r !== undefined)

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Replicação" />
      <Explicacao frase={<>Uma <strong>réplica</strong> é uma cópia do banco que recebe o diário de alterações (WAL) do primário e o reaplica. Ela fica sempre <strong>um pouco atrás</strong> — e o <code>synchronous_commit</code> decide quanto o COMMIT espera por ela.</>}
                  topico="8.10" doc="docs/08-replicacao-backup.md §3.1">
        <p>Cada transação grava uma linha no primário (<code>postgres</code>) com o modo escolhido e, logo depois do COMMIT, a API procura a mesma linha na réplica (<code>postgres-replica</code>). Medimos quanto o COMMIT demorou e se a linha já estava lá.</p>
        <p>A "carga" é outra conexão gravando muito WAL ao mesmo tempo: a réplica fica ocupada e o atraso aparece.</p>
      </Explicacao>

      <Conceito>
        <p>Replicar é manter uma <strong>cópia</strong> do banco em outro servidor. No PostgreSQL, a réplica recebe o <strong>WAL</strong> — o diário onde toda alteração é escrita primeiro — e o reaplica, ficando idêntica ao primário com um pequeno <strong>atraso</strong>.</p>
        <p>Por padrão o COMMIT não espera a réplica (replicação <strong>assíncrona</strong>): é rápido, mas uma leitura na réplica logo depois pode não achar o que acabou de ser gravado. Com <code>synchronous_commit</code> dá para escolher, a cada transação, até onde o COMMIT espera — trocando velocidade por garantia.</p>
        <dl>
          <dt>WAL</dt><dd>o diário de alterações do PostgreSQL; a réplica vive dele.</dd>
          <dt>LSN</dt><dd>uma posição no WAL (ex.: <code>0/2901CD48</code>). "A réplica aplicou até o LSN X."</dd>
          <dt>Atraso (lag)</dt><dd>quanto a réplica está para trás, em bytes de WAL ou em tempo.</dd>
          <dt>Read-your-writes</dt><dd>a garantia de ler o que você mesmo acabou de gravar.</dd>
        </dl>
      </Conceito>
      <TutorialReplicacao />
      <Ficha usos={['pg-replica', 'pg-lab']}>
        As transações gravam em <code>lab.replicacao</code> no primário e leem a mesma tabela na réplica (serviço <code>postgres-replica</code>, slot <code>replica1</code>). A cada rodada a tabela é limpa.
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha o synchronous_commit</h3>
          <div className="estrategias" role="radiogroup" aria-label="synchronous_commit">
            {MODOS.map((m) => (
              <label key={m.id} className={`estrategia ${modo === m.id ? 'ativa' : ''}`}>
                <input type="radio" name="modo" checked={modo === m.id} onChange={() => setModo(m.id)} />
                <strong>{m.id}</strong>
                <span className="muted small">o COMMIT espera {m.espera}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Rode</h3>
          <div className="form-linha">
            <label>Transações <input type="number" min={1} max={200} value={transacoes} onChange={(e) => setTransacoes(Number(e.target.value))} /></label>
            <label className="inline"><input type="checkbox" checked={comCarga} onChange={(e) => setComCarga(e.target.checked)} /> com carga de escrita ao mesmo tempo</label>
          </div>
          <button className="primario" disabled={rodar.isPending} onClick={() => rodar.mutate()}>
            {rodar.isPending ? 'Gravando e lendo…' : 'Gravar e ler na réplica'}
          </button> <Banco nome="PostgreSQL" />
          {rodar.isError && <p className="error">{rodar.error.message}</p>}
        </div>
      </div>

      <SobreOpcao titulo={`synchronous_commit = ${modo}`} {...SOBRE_MODO[modo]}
                  comando={`BEGIN;
SET LOCAL synchronous_commit = ${modo};
INSERT INTO lab.replicacao (rodada, modo, carga) VALUES (…) RETURNING id;
COMMIT;                          -- medido
-- logo em seguida, NA RÉPLICA:
SELECT EXISTS (SELECT 1 FROM lab.replicacao WHERE id = $1);`} />
      <IlustracaoReplicacao modo={modo} />

      {ultimo && <ConclusaoReplicacao r={ultimo} />}

      {comparaveis.length > 0 && (
        <>
          <div className="graficos">
            <Barras titulo={`COMMIT p50 por modo (ms)${ultimo.com_carga ? ', com carga' : ''}`} unidade="ms"
                    dados={comparaveis.map((r) => ({ nome: r.modo, v: r.commit_p50_ms, cor: 'var(--serie-1)' }))} />
            <Barras titulo="Visíveis na réplica logo após o COMMIT (%)" unidade="%"
                    dados={comparaveis.map((r) => ({ nome: r.modo, v: Math.round((100 * r.visiveis_na_hora) / r.transacoes), cor: 'var(--serie-3)' }))} />
          </div>
          <table aria-label="Resultados da replicação">
            <thead><tr><th>Modo</th><th>Carga</th><th>COMMIT p50</th><th>COMMIT p95</th><th>Visíveis na hora</th><th>Até aparecer (p50 / máx.)</th><th>Atraso máx.</th></tr></thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i}>
                  <td><code>{r.modo}</code></td><td>{r.com_carga ? 'sim' : 'não'}</td>
                  <td className="num">{ms(r.commit_p50_ms)}</td><td className="num">{ms(r.commit_p95_ms)}</td>
                  <td className="num">{r.visiveis_na_hora} de {r.transacoes}</td>
                  <td className="num">{r.visiveis_na_hora === r.transacoes ? '—' : `${ms(r.ate_aparecer_p50_ms)} / ${ms(r.ate_aparecer_max_ms)}`}</td>
                  <td className="num">{bytes(r.atraso_max_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Por que só <code>remote_apply</code> garante achar a linha na réplica? O que <code>on</code> garante e o que não garante?</li>
        <li>Com <code>off</code>, a linha leva ~200 ms para chegar à réplica. De onde vem esse número?</li>
        <li>Com carga, o p95 do COMMIT em <code>remote_apply</code> sobe muito mais que em <code>local</code>. Por quê?</li>
        <li>Se a única réplica síncrona cair, o que acontece com um COMMIT em <code>remote_apply</code>? Como evitar isso em produção?</li>
        <li>Os relatórios da loja leem da réplica. Como a API evita mostrar um relatório velho depois do "Atualizar"?</li>
      </ol>

      <Fontes doc="08-replicacao-backup" ids={['pg_alta_disp', 'pg_streaming', 'pg_slots', 'pg_max_slot_wal', 'pg_sync_rep', 'pg_sync_commit', 'pg_sync_nomes',
        'pg_wal_writer', 'pg_hot_standby', 'pg_hs_feedback', 'pg_basebackup', 'pg_stat_replicacao', 'pg_stat_receptor', 'pg_funcoes_recuperacao',
        'pg_funcoes_backup', 'pg_wal', 'ddia_replicacao', 'interdb_streaming']} />
    </section>
  )
}

function ConclusaoReplicacao({ r }: { r: ResultadoReplicacao }) {
  const pct = Math.round((100 * r.visiveis_na_hora) / r.transacoes)
  const tudo = r.visiveis_na_hora === r.transacoes
  return (
    <Conclusao tipo={tudo ? 'boa' : 'neutra'}
               titulo={`${r.modo}: COMMIT em ${ms(r.commit_p50_ms)} (p50) e ${pct}% das linhas já estavam na réplica logo depois.`}>
      {r.modo === 'remote_apply'
        ? <>O COMMIT só respondeu depois de a réplica aplicar a linha: ler dela em seguida <strong>sempre</strong> acha. O preço é o tempo do COMMIT{r.com_carga ? ' — com carga, ele espera a réplica aplicar todo o WAL que veio antes' : ''}.</>
        : tudo
          ? <>Desta vez todas apareceram na hora, mas <code>{r.modo}</code> não garante isso: a réplica foi mais rápida que a leitura. Rode com carga para ver a diferença.</>
          : <>As outras apareceram depois de {ms(r.ate_aparecer_p50_ms)} (p50; o pior caso foi {ms(r.ate_aparecer_max_ms)}){r.nao_apareceram ? `, e ${r.nao_apareceram} nem em 2 s` : ''}. Uma tela que lesse da réplica logo após gravar mostraria o dado velho: é o <em>read-your-writes</em> quebrado.</>}
      {r.atraso_max_bytes > 0 && <> O maior atraso visto foi de {bytes(r.atraso_max_bytes)} de WAL ainda não aplicado.</>}
    </Conclusao>
  )
}
