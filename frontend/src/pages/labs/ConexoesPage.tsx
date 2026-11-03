import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, post, type EstadoPgBouncer, type ResultadoConexoes } from '../../api/client'
import { Barras } from '../../components/Graficos'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, inteiro, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { TutorialConexoes } from '../../components/tutoriais'

const SOBRE_MODO: Record<'direto' | 'pgbouncer' | 'pool', { conceito: string; analogia: string; comando: string; espere: string; fontes: IdFonte[] }> = {
  direto: {
    conceito: 'A cada consulta, o cliente abre uma conexão TCP com o PostgreSQL, que cria um PROCESSO novo, autentica a senha (SCRAM: milhares de cálculos de hash), roda a consulta e encerra tudo. É o que acontece em aplicações sem pool (PHP clássico, funções serverless).',
    analogia: 'Contratar um funcionário para cada cliente que entra na loja e demiti-lo quando o cliente sai.',
    comando: `conectar(postgres:5432) → autenticar → SELECT preco FROM sku WHERE id = $1 → desconectar
(em loop, por cliente, durante N segundos)`,
    espere: 'A consulta leva ~1 ms, mas cada volta custa dezenas de ms por causa da conexão. Com mais clientes que max_connections, o servidor recusa (53300).',
    fontes: ['pg_conexao', 'pg_scram', 'pg_max_conexoes', 'freund_conexoes'],
  },
  pgbouncer: {
    conceito: 'O cliente abre a conexão no PgBouncer (barato: só um socket, sem processo novo no PostgreSQL). O PgBouncer mantém até 20 conexões REAIS abertas com o PostgreSQL e empresta uma a cada transação (modo transaction).',
    analogia: 'Uma recepção: muitos clientes chegam, mas só 20 atendentes trabalham; quem chega espera na fila por um atendente livre.',
    comando: `conectar(pgbouncer:6432) → SELECT … → desconectar
PgBouncer: pega uma das 20 conexões já abertas → executa → devolve ao pool`,
    espere: 'Mais consultas por segundo que o direto e o PostgreSQL vendo no máximo 20 processos, mesmo com 120 clientes.',
    fontes: ['pgbouncer_uso', 'pgbouncer_config', 'pgbouncer_recursos'],
  },
  pool: {
    conceito: 'A própria aplicação mantém 10 conexões abertas (pgxpool) e as empresta a cada consulta. Ninguém conecta nem autentica de novo: é o que a API da loja faz.',
    analogia: 'Uma equipe fixa de 10 funcionários atendendo todos os clientes.',
    comando: `(uma vez) abrir 10 conexões
pool.QueryRow("SELECT preco FROM sku WHERE id = $1")  -- empresta, usa, devolve`,
    espere: 'Dezenas de vezes mais rápido que abrir conexão a cada consulta; 10 processos no PostgreSQL.',
    fontes: ['pgxpool'],
  },
}

// Laboratório de Conexões e PgBouncer (Fase 4, tópico 8.7).

type Modo = ResultadoConexoes['modo']
const MODOS: { id: Modo; nome: string; frase: string; cor: string }[] = [
  { id: 'direto', nome: 'Conexão nova no PostgreSQL', cor: 'var(--serie-1)', frase: 'Cada requisição abre e fecha uma conexão: um processo novo no servidor e uma autenticação a cada vez.' },
  { id: 'pgbouncer', nome: 'Conexão nova no PgBouncer', cor: 'var(--serie-2)', frase: 'Abre e fecha no PgBouncer, que reaproveita poucas conexões já abertas com o PostgreSQL.' },
  { id: 'pool', nome: 'Pool na aplicação', cor: 'var(--serie-3)', frase: 'A aplicação mantém 10 conexões abertas e as empresta (é o que a API da loja faz).' },
]

export function ConexoesPage() {
  const [clientes, setClientes] = useState(50)
  const [segundos, setSegundos] = useState(3)
  const [ultimos, setUltimos] = useState<Partial<Record<Modo, ResultadoConexoes>>>({})
  const [ultimo, setUltimo] = useState<ResultadoConexoes | null>(null)
  const rodar = useMutation({
    mutationFn: (modo: Modo) => post<ResultadoConexoes>('/lab/conexoes', { modo, clientes, segundos }),
    onSuccess: (r) => { setUltimos((u) => ({ ...u, [r.modo]: r })); setUltimo(r) },
  })
  const bouncer = useQuery({
    queryKey: ['pgbouncer'], queryFn: () => api<EstadoPgBouncer>('/dba/pgbouncer'),
    refetchInterval: rodar.isPending ? 500 : 3000, retry: false,
  })
  const pool = bouncer.data?.POOLS?.find((p) => p.database === 'marketplace')
  const feitos = MODOS.filter((m) => ultimos[m.id])

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Conexões e PgBouncer" />
      <Explicacao frase={<>Para o PostgreSQL, <strong>cada conexão é um processo</strong>. Abrir uma custa caro (criar o processo, autenticar) e o servidor aceita um número limitado (<code>max_connections</code>). Por isso existem os <strong>poolers</strong>.</>}
                  topico="8.7" doc="docs/06-postgresql-admin.md §5">
        <p>Cada "cliente" é uma goroutine fazendo, em loop, uma consulta curta durante alguns segundos. Medimos quantas consultas saíram por segundo, a latência e o pico de processos no PostgreSQL.</p>
        <p><strong>PgBouncer em modo transaction:</strong> a conexão real com o PostgreSQL é emprestada ao cliente só durante uma transação. Mil clientes podem dividir 20 conexões. O preço: nada de estado de sessão (<code>SET</code>, <code>LISTEN</code>, advisory lock de sessão) entre transações.</p>
        <p>Experimente 120 clientes no modo direto: o servidor recusa com <code>53300 too many clients</code>. No PgBouncer, os excedentes esperam na fila (<code>cl_waiting</code>).</p>
      </Explicacao>

      <Conceito>
        <p>Para conversar com o PostgreSQL, a aplicação abre uma <strong>conexão</strong>. Do lado do servidor, cada conexão é um <strong>processo</strong> do sistema operacional, com a sua memória. Abrir uma custa caro (criar o processo, negociar, autenticar a senha) e o servidor aceita um número limitado delas (<code>max_connections</code>, aqui 100).</p>
        <p>A solução é <strong>reaproveitar conexões abertas</strong> — um <strong>pool</strong>. Ele pode morar dentro da aplicação (pgxpool) ou num programa à parte entre a aplicação e o banco (<strong>PgBouncer</strong>), útil quando há muitas aplicações ou instâncias.</p>
        <dl>
          <dt>p50 / p95</dt><dd>a latência que metade / 95% das consultas não ultrapassou. O p95 mostra a "cauda": os usuários com pior experiência.</dd>
          <dt>Pico de processos</dt><dd>quantas conexões do experimento o PostgreSQL chegou a ter ao mesmo tempo (as da própria API não contam).</dd>
          <dt>53300</dt><dd>código de erro "too many clients": o servidor bateu no <code>max_connections</code>.</dd>
        </dl>
      </Conceito>
      <TutorialConexoes />
      <Ficha usos={['pgbouncer-pool', 'pg-ofertas']}>
        Cada "cliente" consulta, em loop, o preço do SKU "Console Edição Limitada" — uma consulta de ~1 ms, para que o custo medido seja quase só o da conexão.
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Quantos clientes, por quanto tempo</h3>
          <div className="form-linha">
            <label>Clientes simultâneos <input type="number" min={1} max={150} value={clientes} onChange={(e) => setClientes(Number(e.target.value))} /></label>
            <label>Segundos <input type="number" min={1} max={10} value={segundos} onChange={(e) => setSegundos(Number(e.target.value))} /></label>
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Rode cada modo</h3>
          <div className="form-linha">
            {MODOS.map((m) => (
              <button key={m.id} disabled={rodar.isPending} onClick={() => rodar.mutate(m.id)} title={m.frase}>{m.nome}</button>
            ))}
          </div>
          {rodar.isPending && <p className="muted small">Rodando por {segundos} s…</p>}
          {rodar.isError && <p className="error">{rodar.error.message}</p>}
        </div>
      </div>

      <div className="estrategias" aria-label="Os três modos">
        {MODOS.map((m) => (
          <div key={m.id} className="estrategia" style={{ cursor: 'default' }}>
            <strong>{m.nome}</strong>
            <span className="muted small">{m.frase}</span>
          </div>
        ))}
      </div>
      {(() => {
        const m = ultimo?.modo ?? 'direto'
        return <SobreOpcao titulo={MODOS.find((x) => x.id === m)!.nome} {...SOBRE_MODO[m]} />
      })()}

      {ultimo && <ConclusaoConexoes r={ultimo} ultimos={ultimos} />}

      {feitos.length > 0 && (
        <>
          <div className="legenda">{feitos.map((m) => <span key={m.id}><i style={{ background: m.cor }} />{m.nome}</span>)}</div>
          <div className="graficos">
            <Barras titulo="Consultas por segundo (maior é melhor)" unidade="ops/s"
                    dados={feitos.map((m) => ({ nome: m.id, v: ultimos[m.id]!.ops_por_segundo, cor: m.cor }))} />
            <Barras titulo="Latência p95 (menor é melhor)" unidade="ms"
                    dados={feitos.map((m) => ({ nome: m.id, v: ultimos[m.id]!.p95_ms, cor: m.cor }))} />
            <Barras titulo="Pico de processos no PostgreSQL" unidade="conexões"
                    dados={feitos.map((m) => ({ nome: m.id, v: ultimos[m.id]!.max_conexoes_postgres, cor: m.cor }))} />
          </div>
          <table aria-label="Resultados das conexões">
            <thead><tr><th>Modo</th><th>Clientes</th><th>Consultas</th><th>Por segundo</th><th>p50</th><th>p95</th><th>Pico no PostgreSQL</th><th>Erros</th></tr></thead>
            <tbody>
              {feitos.map((m) => {
                const r = ultimos[m.id]!
                return (
                  <tr key={m.id} className={r.erros ? 'ruim' : undefined}>
                    <td>{m.nome}</td><td className="num">{r.clientes}</td><td className="num">{inteiro(r.operacoes)}</td>
                    <td className="num">{inteiro(Math.round(r.ops_por_segundo))}</td><td className="num">{ms(r.p50_ms)}</td><td className="num">{ms(r.p95_ms)}</td>
                    <td className="num">{r.max_conexoes_postgres} de {r.max_connections}</td>
                    <td className="num" title={r.primeiro_erro}>{r.erros}{r.primeiro_erro && <div className="small error">{r.primeiro_erro}</div>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      <h2>PgBouncer agora <Banco nome="PgBouncer" /></h2>
      {bouncer.isError ? <p className="error">{bouncer.error.message}</p> : pool ? (
        <dl className="stats" aria-label="Pool do PgBouncer">
          <div><dt>Clientes ativos</dt><dd>{String(pool.cl_active)}</dd></div>
          <div><dt>Clientes na fila</dt><dd>{String(pool.cl_waiting)}</dd></div>
          <div><dt>Conexões reais em uso</dt><dd>{String(pool.sv_active)}</dd></div>
          <div><dt>Conexões reais ociosas</dt><dd>{String(pool.sv_idle)}</dd></div>
          <div><dt>Modo</dt><dd>{String(pool.pool_mode)}</dd></div>
        </dl>
      ) : <p className="muted">Sem dados do PgBouncer.</p>}

      <Fontes doc="06-postgresql-admin" ids={['pg_conexao', 'pg_max_conexoes', 'pg_scram', 'pg_erros', 'pg_pgbench', 'pgbouncer_uso', 'pgbouncer_config', 'pgbouncer_recursos', 'pgxpool', 'freund_conexoes']} />
    </section>
  )
}

function ConclusaoConexoes({ r, ultimos }: { r: ResultadoConexoes; ultimos: Partial<Record<Modo, ResultadoConexoes>> }) {
  if (r.erros && r.primeiro_erro?.startsWith('53300')) {
    return <Conclusao tipo="ruim" titulo={`${r.erros} conexões recusadas: o PostgreSQL chegou ao limite de ${r.max_connections}.`}>
      Com {r.clientes} clientes abrindo conexões diretas, o servidor esgotou o <code>max_connections</code> (pico de {r.max_conexoes_postgres} processos). Rode o mesmo número de clientes no PgBouncer.
    </Conclusao>
  }
  const direto = ultimos.direto
  if (r.modo !== 'direto' && direto && direto.ops_por_segundo > 0) {
    const x = r.ops_por_segundo / direto.ops_por_segundo
    return <Conclusao tipo="boa" titulo={`${r.modo === 'pool' ? 'Pool na aplicação' : 'PgBouncer'}: ${x.toFixed(1)}× mais consultas por segundo que abrir conexão direta.`}>
      O PostgreSQL atendeu {r.clientes} clientes com no máximo {r.max_conexoes_postgres} processos{r.modo === 'pgbouncer' ? ' (o PgBouncer multiplexou as conexões)' : ''}.
    </Conclusao>
  }
  return <Conclusao tipo="neutra" titulo={`${inteiro(Math.round(r.ops_por_segundo))} consultas/s, p95 de ${ms(r.p95_ms)}, pico de ${r.max_conexoes_postgres} processos no PostgreSQL.`}>
    Agora rode os outros modos com o mesmo número de clientes para comparar.
  </Conclusao>
}
