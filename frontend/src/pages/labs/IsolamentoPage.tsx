import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, post, type ResultadoIsolamento, type Roteiro } from '../../api/client'
import { Async } from '../../components/Async'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { TutorialIsolamento } from '../../components/tutoriais'

// Laboratório de Isolamento e Deadlock (Fase 4, tópico 8.4).

const NIVEIS: [string, string][] = [
  ['read_uncommitted', 'READ UNCOMMITTED'],
  ['read_committed', 'READ COMMITTED (padrão)'],
  ['repeatable_read', 'REPEATABLE READ'],
  ['serializable', 'SERIALIZABLE'],
]

// Como o PostgreSQL implementa cada nível (mostrado ao escolher).
const SOBRE_NIVEL: Record<string, string> = {
  read_uncommitted: 'No padrão SQL deixaria ler dados não confirmados. O PostgreSQL não implementa isso: trata como READ COMMITTED.',
  read_committed: 'Cada COMANDO enxerga o que já estava confirmado no instante em que ELE começou. Dois SELECTs na mesma transação podem ver coisas diferentes. É o padrão do PostgreSQL.',
  repeatable_read: 'A TRANSAÇÃO inteira enxerga uma "fotografia" (snapshot) tirada no primeiro comando. Se tentar alterar uma linha que outra transação mudou depois da fotografia, é abortada (40001).',
  serializable: 'Como o REPEATABLE READ, mais um detector de conflitos (SSI): se o resultado não puder ser explicado por alguma ordem em fila das transações, uma delas é abortada (40001). A aplicação precisa repetir.',
}

// O conceito de cada roteiro (mostrado ao escolher).
const SOBRE_ROTEIRO: Record<string, { conceito: string; analogia: string; espere: string; fontes: IdFonte[] }> = {
  'leitura-suja': {
    conceito: 'Ler um valor que outra transação alterou mas ainda NÃO confirmou. Se ela desistir (ROLLBACK), você usou um valor que nunca existiu.',
    analogia: 'Ver o rascunho de um extrato bancário que o gerente ainda vai jogar fora.',
    espere: 'O PostgreSQL nunca permite: em qualquer nível, T2 lê 100.',
    fontes: ['pg_isolamento', 'berenson'],
  },
  'leitura-nao-repetivel': {
    conceito: 'Ler a MESMA linha duas vezes na mesma transação e receber valores diferentes, porque outra transação alterou e confirmou no meio.',
    analogia: 'Você confere o saldo, vai pegar o cartão e, ao conferir de novo, o saldo mudou.',
    espere: 'Acontece em READ COMMITTED; some a partir de REPEATABLE READ (a transação lê da fotografia).',
    fontes: ['pg_rc', 'pg_rr', 'interdb_concorrencia'],
  },
  fantasma: {
    conceito: 'A mesma CONSULTA (com filtro) devolve um conjunto diferente de linhas, porque outra transação INSERIU uma linha que passa no filtro. A linha nova é o "fantasma".',
    analogia: 'Você conta quantas pessoas estão na sala, olha a lista e, ao recontar, apareceu alguém que entrou pela outra porta.',
    espere: 'Acontece em READ COMMITTED; no PostgreSQL já some em REPEATABLE READ.',
    fontes: ['pg_isolamento', 'pg_rr', 'hermitage'],
  },
  'lost-update': {
    conceito: 'Duas transações leem o mesmo valor, calculam um novo a partir dele e gravam. A segunda sobrescreve a primeira: um dos depósitos some. É o mesmo problema do Laboratório de Concorrência.',
    analogia: 'Duas pessoas editam a mesma planilha a partir da mesma versão; quem salva por último apaga o trabalho do outro.',
    espere: 'READ COMMITTED: saldo final 120 (perdeu +10). REPEATABLE READ e SERIALIZABLE: T2 é abortada (40001) e precisaria repetir.',
    fontes: ['pg_rr', 'berenson', 'ddia_transacoes'],
  },
  'write-skew': {
    conceito: 'Cada transação lê um conjunto de linhas, decide com base nele e altera uma linha DIFERENTE. Nenhuma sobrescreve a outra, nenhum lock conflita — mas juntas quebram uma regra ("ao menos um de plantão").',
    analogia: 'Dois médicos olham a escala ("somos 2"), cada um pede folga ao mesmo tempo, e o hospital fica sem ninguém.',
    espere: 'Acontece até em REPEATABLE READ. Só SERIALIZABLE detecta e aborta uma delas.',
    fontes: ['pg_ser', 'ssi_artigo', 'pg_app_consistencia'],
  },
  deadlock: {
    conceito: 'Duas transações esperando uma pela outra em ciclo: T1 tem A e quer B; T2 tem B e quer A. Ninguém avança. O PostgreSQL detecta o ciclo (depois de deadlock_timeout = 1 s) e aborta uma (erro 40P01).',
    analogia: 'Dois carros num cruzamento estreito, cada um esperando o outro dar ré.',
    espere: 'Uma transação vira vítima, a outra termina. Não depende do nível. A prevenção é pegar os locks sempre na mesma ordem.',
    fontes: ['pg_deadlocks', 'pg_deadlock_timeout'],
  },
}

// O que o PostgreSQL faz em cada nível (docs/03 §4). "possível" = a anomalia acontece.
const TABELA: [string, string, string[]][] = [
  ['leitura-suja', 'Leitura suja', ['não*', 'não', 'não', 'não']],
  ['leitura-nao-repetivel', 'Leitura não repetível', ['possível', 'possível', 'não', 'não']],
  ['fantasma', 'Fantasma', ['possível', 'possível', 'não*', 'não']],
  ['lost-update', 'Lost update', ['possível', 'possível', 'não (aborta)', 'não (aborta)']],
  ['write-skew', 'Write skew', ['possível', 'possível', 'possível', 'não (aborta)']],
]

export function IsolamentoPage() {
  const roteiros = useQuery({ queryKey: ['roteiros'], queryFn: () => api<Roteiro[]>('/lab/isolamento/roteiros') })
  const [roteiro, setRoteiro] = useState('lost-update')
  const [nivel, setNivel] = useState('read_committed')
  const rodar = useMutation({ mutationFn: () => post<ResultadoIsolamento>('/lab/isolamento', { roteiro, nivel }) })
  const atual = roteiros.data?.find((r) => r.id === roteiro)

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Isolamento e Deadlock" />
      <Explicacao frase={<>Duas transações (<span className="t1">T1</span> e <span className="t2">T2</span>) rodam ao mesmo tempo, intercaladas passo a passo. O <strong>nível de isolamento</strong> decide o que uma enxerga da outra — e quais "anomalias" podem acontecer.</>}
                  topico="8.4" doc="docs/03-transacoes-acid.md §3–§7">
        <p>São duas conexões de verdade com o PostgreSQL, como dois terminais <code>psql</code>. Quando um passo fica mais de 400 ms sem resposta, ele está <strong>esperando um lock</strong> da outra transação — o roteiro segue com a outra e volta depois.</p>
        <p>No PostgreSQL, READ UNCOMMITTED se comporta como READ COMMITTED (nunca há leitura suja) e REPEATABLE READ também impede fantasmas (usa um <em>snapshot</em> da transação inteira) — por isso os asteriscos na tabela.</p>
      </Explicacao>

      <Conceito>
        <p>Uma <strong>transação</strong> agrupa comandos que devem acontecer "tudo ou nada". Com muitas transações ao mesmo tempo, surge a pergunta: <strong>o que uma enxerga do trabalho ainda não terminado da outra?</strong></p>
        <p>O <strong>nível de isolamento</strong> é a resposta. Quanto mais alto, menos surpresas (as "anomalias") — e mais transações precisam esperar ou ser abortadas e repetidas. O PostgreSQL implementa isso com <strong>MVCC</strong>: cada linha tem versões, e cada transação lê as versões compatíveis com a sua "fotografia" do banco.</p>
        <p>Aqui você escolhe uma <strong>situação</strong> (uma anomalia clássica ou um deadlock) e um <strong>nível</strong>; o laboratório executa as duas transações intercaladas, passo a passo, e mostra o que cada uma viu.</p>
      </Conceito>
      <TutorialIsolamento />
      <Ficha usos={['pg-lab']}>
        As transações usam duas conexões reais com o PostgreSQL e mexem só em lab.conta (contas A e B, saldo 100) e lab.plantao (Ana e Bruno de plantão), recriadas a cada execução.
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha a situação</h3>
          <Async query={roteiros}>
            {(rs) => (
              <div className="estrategias">
                {rs.map((r) => (
                  <button key={r.id} className={`estrategia ${r.id === roteiro ? 'ativa' : ''}`} onClick={() => setRoteiro(r.id)} aria-pressed={r.id === roteiro}>
                    <strong>{r.titulo}</strong>
                    <span className="muted small">{r.resumo}</span>
                  </button>
                ))}
              </div>
            )}
          </Async>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Escolha o nível e rode</h3>
          <div className="form-linha" role="radiogroup" aria-label="Nível de isolamento">
            {NIVEIS.map(([id, nome]) => (
              <label key={id} className="inline">
                <input type="radio" name="nivel" checked={nivel === id} onChange={() => setNivel(id)} /> {nome}
              </label>
            ))}
          </div>
          {atual && <p className="small"><strong>Observe:</strong> {atual.pergunta}</p>}
          <button className="primario" disabled={rodar.isPending} onClick={() => rodar.mutate()}>
            {rodar.isPending ? 'Rodando…' : 'Rodar passo a passo'}
          </button> <Banco nome="PostgreSQL" />
          {rodar.isError && <p className="error">{rodar.error.message}</p>}
        </div>
      </div>

      {atual && SOBRE_ROTEIRO[roteiro] && (
        <SobreOpcao titulo={`${atual.titulo} em ${NIVEIS.find(([id]) => id === nivel)![1].replace(' (padrão)', '')}`}
                    conceito={SOBRE_ROTEIRO[roteiro].conceito}
                    analogia={SOBRE_ROTEIRO[roteiro].analogia}
                    fontes={SOBRE_ROTEIRO[roteiro].fontes}
                    espere={<>{SOBRE_ROTEIRO[roteiro].espere}<p><strong>Este nível:</strong> {SOBRE_NIVEL[nivel]}</p></>}
                    comando={atual.passos.map((p, i) => `${String(i + 1).padStart(2)}  T${p.t}  ${p.sql === 'BEGIN' ? `BEGIN ISOLATION LEVEL ${NIVEIS.find(([id]) => id === nivel)![1].replace(' (padrão)', '')}` : p.sql}`).join('\n')} />
      )}

      {rodar.data && <Resultado r={rodar.data} roteiro={roteiros.data?.find((x) => x.id === rodar.data.roteiro)} />}

      <h2>A tabela que cai em prova <span className="muted small">(comportamento do PostgreSQL)</span></h2>
      <table aria-label="Anomalias por nível de isolamento">
        <thead><tr><th>Anomalia</th>{NIVEIS.map(([id, n]) => <th key={id}>{n.replace(' (padrão)', '')}</th>)}</tr></thead>
        <tbody>
          {TABELA.map(([id, nome, valores]) => (
            <tr key={id}>
              <td>{nome}</td>
              {valores.map((v, i) => (
                <td key={i} className={rodar.data?.roteiro === id && rodar.data.nivel === NIVEIS[i][0] ? 'subtotal' : undefined}
                    style={{ color: v.startsWith('possível') ? 'var(--erro)' : 'var(--ok)' }}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">* No padrão SQL seria "possível"; o PostgreSQL é mais estrito. Deadlock independe do nível: é sobre a ORDEM em que os locks são pegos.</p>

      <Fontes doc="03-transacoes-acid" ids={['pg_isolamento', 'pg_mvcc', 'pg_rc', 'pg_rr', 'pg_ser', 'pg_deadlocks', 'pg_deadlock_timeout', 'pg_erros', 'pg_app_consistencia',
        'interdb_concorrencia', 'ddia_transacoes', 'elmasri_transacoes', 'berenson', 'ssi_artigo', 'hermitage']} />
    </section>
  )
}

function Resultado({ r, roteiro }: { r: ResultadoIsolamento; roteiro?: Roteiro }) {
  const nivel = NIVEIS.find(([id]) => id === r.nivel)?.[1].replace(' (padrão)', '')
  const abortada = r.passos.find((p) => p.codigo === '40001')
  const vitima = r.passos.find((p) => p.codigo === '40P01')
  return (
    <>
      <h2>{roteiro?.titulo} em {nivel}</h2>
      <table className="roteiro" aria-label="Passos">
        <thead><tr><th>#</th><th>Transação</th><th>Comando</th><th>Resultado</th></tr></thead>
        <tbody>
          {r.passos.map((p) => (
            <tr key={p.numero} className={p.erro ? 'ruim' : p.bloqueou ? 'bloqueado' : undefined}>
              <td>{p.numero}</td>
              <td className={`t${p.t}`}>T{p.t}</td>
              <td><code>{p.sql}</code>{p.nota && <div className="muted small">{p.nota}</div>}</td>
              <td>
                {p.bloqueou && <div className="small">⏳ bloqueado: esperou {ms(p.esperou_ms)} pela outra transação</div>}
                {p.erro ? <span className="error"><strong>{p.codigo}</strong> {p.erro}</span> : <code>{p.resultado}</code>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">Estado final: <code>{r.estado_final}</code></p>
      {r.roteiro === 'deadlock' ? (
        vitima
          ? <Conclusao tipo="neutra" titulo={`Deadlock detectado: T${vitima.t} foi a vítima (erro 40P01).`}>
              Cada transação esperava um lock da outra. Depois de <code>deadlock_timeout</code> (1 s), o PostgreSQL procurou ciclos, achou e abortou uma delas; a outra seguiu.
              A prevenção é pegar os locks <strong>sempre na mesma ordem</strong> — o checkout ordena os itens por SKU por isso.
            </Conclusao>
          : <Conclusao tipo="boa" titulo="Sem deadlock nesta rodada.">As transações não chegaram a formar um ciclo de espera.</Conclusao>
      ) : r.anomalia ? (
        <Conclusao tipo="ruim" titulo={`A anomalia aconteceu em ${nivel}.`}>{roteiro?.resumo}</Conclusao>
      ) : abortada ? (
        <Conclusao tipo="boa" titulo={`${nivel} impediu a anomalia abortando T${abortada.t} (erro 40001).`}>
          O PostgreSQL percebeu que confirmar as duas transações daria um resultado impossível numa execução em fila e abortou uma.
          A aplicação precisa <strong>repetir</strong> a transação abortada — é o que o checkout faz no modo SERIALIZABLE.
        </Conclusao>
      ) : (
        <Conclusao tipo="boa" titulo={`A anomalia não aconteceu em ${nivel}.`}>
          {r.roteiro === 'leitura-suja'
            ? 'O PostgreSQL nunca mostra dados não confirmados — nem em READ UNCOMMITTED.'
            : 'A transação trabalhou com uma "fotografia" (snapshot) do banco tirada no início: o que a outra confirmou depois não aparece.'}
        </Conclusao>
      )}
    </>
  )
}
