import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { post, type ResultadoConsistencia } from '../../api/client'
import { Fontes, type IdFonte } from '../../components/fontes'
import { IlustracaoAnel } from '../../components/IlustracoesFase7'
import { TutorialConsistencia } from '../../components/tutoriais'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'

// Laboratório de Consistência ajustável (Fase 7, Cassandra, tópico 8.8, docs/07).

type RF = 1 | 3

const SOBRE_RF: Record<RF, { conceito: string; analogia: string; espere: string; fontes: IdFonte[] }> = {
  1: {
    conceito: 'Fator de replicação 1: cada dado tem uma cópia só, no único nó do cluster. ONE, QUORUM (1/2 + 1 = 1) e ALL (1) pedem a mesma coisa — uma réplica — e ela está viva.',
    analogia: 'Um caderno só: perguntar "pelo menos um", "a maioria" ou "todos" dá no mesmo, porque só existe ele.',
    espere: 'Os três níveis escrevem e leem. Mas RF=1 não tem tolerância a falha nenhuma: se esse nó cair, o dado fica inacessível.',
    fontes: ['cass_dynamo', 'cass_consistencia'],
  },
  3: {
    conceito: 'Fator de replicação 3 num cluster de um nó só: para o Cassandra, cada dado deveria ter 3 cópias, mas só 1 das 3 réplicas existe — como se dois nós do anel estivessem fora do ar. QUORUM precisa de 2 e ALL de 3: não há réplicas suficientes.',
    analogia: 'Três cadernos deveriam ter a anotação, mas só um está na sala. "Pelo menos um confirma" funciona; "a maioria confirma" não tem como.',
    espere: 'ONE escreve e lê; QUORUM e ALL falham na hora com Unavailable — o Cassandra prefere recusar a responder sem a garantia pedida.',
    fontes: ['cass_consistencia', 'cass_escolher', 'cap_artigo'],
  },
}

export function ConsistenciaPage() {
  const [rf, setRF] = useState<RF>(3)
  const rodar = useMutation({ mutationFn: () => post<ResultadoConsistencia>('/lab/consistencia', { rf }) })
  const r = rodar.isPending ? undefined : rodar.data

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Consistência ajustável" />
      <Explicacao frase={<>No Cassandra, cada leitura e cada escrita escolhem <strong>quantas réplicas</strong> precisam responder. Mais réplicas = mais garantia, e mais chance de a operação falhar quando faltam nós.</>}
                  topico="8.8" doc="docs/07-nosql.md">
        <p>Para cada nível (ONE, QUORUM, ALL) a API faz um <code>INSERT</code> e um <code>SELECT</code> com aquele nível num keyspace de laboratório, e mostra quem conseguiu. O erro, quando há, é o que o próprio Cassandra devolveu.</p>
      </Explicacao>

      <Conceito>
        <p>O Cassandra copia cada dado em <strong>RF</strong> nós (fator de replicação). Na hora de ler ou escrever, você escolhe quantas dessas cópias precisam confirmar — o <strong>nível de consistência</strong>. Se a leitura e a escrita juntas consultarem mais que RF réplicas, elas sempre se cruzam e a leitura vê a última escrita.</p>
        <p>O outro lado: se não houver réplicas vivas suficientes, a operação <strong>falha</strong>. É a escolha do teorema CAP — consistência ou disponibilidade — feita por consulta.</p>
        <dl>
          <dt>RF</dt><dd>quantas cópias de cada dado existem.</dd>
          <dt>ONE / QUORUM / ALL</dt><dd>1 réplica / a maioria (RF/2 + 1) / todas.</dd>
          <dt>R + W &gt; RF</dt><dd>a regra da consistência forte por quórum.</dd>
          <dt>Unavailable</dt><dd>o erro do Cassandra quando faltam réplicas vivas para o nível pedido.</dd>
        </dl>
      </Conceito>
      <TutorialConsistencia />
      <Ficha usos={['cassandra-consistencia', 'cassandra-vistos']}>
        O laboratório usa os keyspaces <code>lab_rf1</code> e <code>lab_rf3</code> (serviço <code>cassandra</code>), separados do keyspace da loja (<code>marketplace</code>, onde mora "vistos recentemente").
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha o fator de replicação</h3>
          <div className="estrategias" role="radiogroup" aria-label="Fator de replicação">
            {([3, 1] as RF[]).map((v) => (
              <label key={v} className={`estrategia ${rf === v ? 'ativa' : ''}`}>
                <input type="radio" name="rf" checked={rf === v} onChange={() => setRF(v)} />
                <strong>{v === 3 ? 'RF = 3 (só 1 das 3 réplicas existe)' : 'RF = 1 (uma réplica, a que existe)'}</strong>
                <span className="muted small">{v === 3 ? 'como um anel com dois nós fora do ar' : 'o keyspace da loja usa RF = 1'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Rode</h3>
          <button className="primario" disabled={rodar.isPending} onClick={() => rodar.mutate()}>
            {rodar.isPending ? 'Escrevendo e lendo…' : 'Escrever e ler em cada nível'}
          </button> <Banco nome="Cassandra" />
          {rodar.isError && <p className="error">{rodar.error.message}</p>}
        </div>
      </div>

      <SobreOpcao titulo={`RF = ${rf}`} {...SOBRE_RF[rf]}
                  comando={`CREATE KEYSPACE lab_rf${rf} WITH replication =
  {'class': 'SimpleStrategy', 'replication_factor': ${rf}};
CONSISTENCY QUORUM;   -- (no cqlsh; na API, por consulta)
INSERT INTO lab_rf${rf}.contas (id, valor) VALUES (1, 42);
SELECT valor FROM lab_rf${rf}.contas WHERE id = 1;`} />
      <IlustracaoAnel vivos={rf === 3 ? 1 : 3} nivel={rf === 3 ? 'QUORUM' : undefined} />

      {r && (
        <>
          <ConclusaoConsistencia r={r} />
          <table aria-label="Resultado por nível de consistência">
            <thead><tr><th>Nível</th><th>Réplicas necessárias</th><th>Escrita</th><th>Leitura</th><th>Tempo</th><th>Forte (R + W &gt; RF)?</th></tr></thead>
            <tbody>
              {r.tentativas.map((t) => (
                <tr key={t.nivel} className={t.escreveu && t.leu ? undefined : 'ruim'}>
                  <td><code>{t.nivel}</code></td>
                  <td className="num">{t.necessarias} de {r.rf} (vivas: {Math.min(r.replicas_vivas, r.rf)})</td>
                  <td>{t.escreveu ? '✅ gravou' : <>❌ <span className="small">{t.erro_escrita}</span></>}</td>
                  <td>{t.leu ? '✅ leu' : <>❌ <span className="small">{t.erro_leitura}</span></>}</td>
                  <td className="num">{ms(t.ms)}</td>
                  <td>{t.forte_com_ele ? 'sim' : 'não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Com RF=3, por que QUORUM precisa de 2 réplicas? E com RF=5?</li>
        <li>Escrever com ONE e ler com ALL é forte (R + W &gt; RF)? Qual é o risco dessa combinação?</li>
        <li>O Cassandra recusou QUORUM em vez de responder com a única réplica. Que letra do CAP ele priorizou?</li>
        <li>Por que o keyspace da loja usa RF=1 aqui, e o que mudaria num cluster de produção?</li>
        <li>Mesmo com todos os nós no ar, QUORUM é mais lento que ONE. Que parte do PACELC explica isso?</li>
      </ol>

      <Fontes doc="07-nosql" ids={['cass_dynamo', 'cass_consistencia', 'cass_escolher', 'cass_modelagem', 'cass_ttl', 'cass_lsm', 'cass_cqlsh',
        'dynamo_artigo', 'cassandra_artigo', 'cap_artigo', 'pacelc_artigo', 'ddia_modelos']} />
    </section>
  )
}

function ConclusaoConsistencia({ r }: { r: ResultadoConsistencia }) {
  const falharam = r.tentativas.filter((t) => !t.escreveu || !t.leu).map((t) => t.nivel)
  return (
    <Conclusao tipo={falharam.length ? 'neutra' : 'boa'}
               titulo={falharam.length
                 ? `RF = ${r.rf}: ${falharam.join(' e ')} falharam — faltam réplicas vivas para o que eles exigem.`
                 : `RF = ${r.rf}: os três níveis funcionaram.`}>
      {falharam.length
        ? <>Só {Math.min(r.replicas_vivas, r.rf)} das {r.rf} réplicas existe. ONE pede 1 e funciona; QUORUM pede {Math.floor(r.rf / 2) + 1} e ALL pede {r.rf}. O Cassandra <strong>recusou</strong> em vez de responder com menos garantia do que você pediu: escolheu consistência, abrindo mão de disponibilidade. Num cluster de verdade com 3 nós e um fora, QUORUM ainda funcionaria — e só ALL falharia.</>
        : <>Com RF = {r.rf}, todos os níveis pedem {r.rf === 1 ? 'a mesma única réplica' : 'réplicas que estão vivas'}. Agora troque para RF = 3 e veja o que acontece quando faltam nós.</>}
    </Conclusao>
  )
}
