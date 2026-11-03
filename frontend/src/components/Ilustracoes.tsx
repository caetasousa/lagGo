import { useId } from 'react'

// Ilustrações (SVG) dos tutoriais "do zero". São desenhos fixos e simples: a
// ideia é o aluno ver a estrutura (linha do tempo de transações, versões na
// página, partições, pool, cache) antes de ver os números do laboratório.

type Tom = 'ok' | 'ruim' | 'espera' | 'neutro' | 'destaque' | 'apagado'

const TOM: Record<Tom, { fundo: string; borda: string; texto: string }> = {
  ok: { fundo: 'var(--il-ok-fundo)', borda: 'var(--il-ok)', texto: 'var(--il-texto)' },
  ruim: { fundo: 'var(--il-ruim-fundo)', borda: 'var(--il-ruim)', texto: 'var(--il-texto)' },
  espera: { fundo: 'var(--il-espera-fundo)', borda: 'var(--il-espera)', texto: 'var(--il-texto)' },
  neutro: { fundo: 'var(--il-fundo)', borda: 'var(--il-borda)', texto: 'var(--il-texto)' },
  destaque: { fundo: 'var(--il-destaque-fundo)', borda: 'var(--il-destaque)', texto: 'var(--il-texto)' },
  apagado: { fundo: 'var(--il-apagado)', borda: 'var(--il-linha)', texto: 'var(--il-texto-3)' },
}

const CINZA = 'var(--il-cinza)'

/** Caixa com texto de várias linhas ("\n" quebra a linha). */
function Caixa({ x, y, w, h, texto, tom = 'neutro', fonte = 11, tracejada }: {
  x: number; y: number; w: number; h: number; texto: string; tom?: Tom; fonte?: number; tracejada?: boolean
}) {
  const c = TOM[tom]
  const linhas = texto.split('\n')
  const alturaLinha = fonte + 3
  const y0 = y + h / 2 - ((linhas.length - 1) * alturaLinha) / 2 + fonte / 3
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" fill={c.fundo} stroke={c.borda} strokeWidth={tom === 'neutro' || tom === 'apagado' ? 1 : 1.6}
            strokeDasharray={tracejada ? '5 3' : undefined} />
      <text x={x + w / 2} y={y0} fontSize={fonte} textAnchor="middle" fill={c.texto}>
        {linhas.map((l, i) => <tspan key={i} x={x + w / 2} dy={i === 0 ? 0 : alturaLinha}>{l}</tspan>)}
      </text>
    </g>
  )
}

/** Marcador de seta com id único por SVG (vários desenhos na mesma página). */
function useSeta(cor = CINZA) {
  const id = `seta-${useId().replace(/:/g, '')}`
  const def = (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={cor} />
      </marker>
    </defs>
  )
  return { def, url: `url(#${id})` }
}

// Quebra as notas em linhas de até ~112 caracteres: a 13 px, é o que cabe nos
// 760 de largura do desenho (o SVG não quebra texto sozinho).
function quebrar(notas: string[] = [], max = 112) {
  return notas.flatMap((n) => {
    const linhas: string[] = []
    let atual = ''
    for (const palavra of n.split(' ')) {
      if (atual && (atual + ' ' + palavra).length > max) { linhas.push(atual); atual = palavra }
      else atual = atual ? atual + ' ' + palavra : palavra
    }
    return [...linhas, atual]
  })
}

function Notas({ y, notas }: { y: number; notas?: string[] }) {
  return <>{quebrar(notas).map((n, i) => <text key={i} x="0" y={y + i * 18} fontSize="13" fill="var(--il-texto)">{n}</text>)}</>
}

// ---------------------------------------------------------------- linha do tempo de transações

export type Evento = { faixa: number; col: number; texto: string; tom?: Tom; span?: number }

/**
 * Linha do tempo: uma faixa por transação (ou sessão), o tempo correndo para a
 * direita. É o desenho clássico dos livros de banco para anomalias e locks.
 */
export function LinhaDoTempo({ rotulo, faixas, colunas, eventos, notas }: {
  rotulo: string; faixas: string[]; colunas: number; eventos: Evento[]; notas?: string[]
}) {
  const seta = useSeta()
  const x0 = 96, largura = 660, alturaFaixa = 62
  const colW = largura / colunas
  const yTempo = 8 + faixas.length * alturaFaixa + 6
  const altura = yTempo + 22 + quebrar(notas).length * 18
  const corFaixa = (i: number) => (faixas[i].startsWith('T1') ? 'var(--serie-1)' : faixas[i].startsWith('T2') ? 'var(--il-laranja)' : CINZA)
  return (
    <svg className="ilustracao" viewBox={`0 0 760 ${altura}`} role="img" aria-label={rotulo}>
      {seta.def}
      {faixas.map((f, i) => (
        <g key={f}>
          <line x1={x0} x2={760} y1={8 + i * alturaFaixa + alturaFaixa / 2} y2={8 + i * alturaFaixa + alturaFaixa / 2} stroke="var(--il-linha)" strokeDasharray="4 4" />
          <text x="0" y={8 + i * alturaFaixa + alturaFaixa / 2 + 5} fontSize="13" fontWeight="700" fill={corFaixa(i)}>{f}</text>
        </g>
      ))}
      {eventos.map((e, k) => (
        <Caixa key={k} x={x0 + e.col * colW + 3} y={8 + e.faixa * alturaFaixa + 6} w={colW * (e.span ?? 1) - 6} h={alturaFaixa - 12}
               texto={e.texto} tom={e.tom} />
      ))}
      <line x1={x0} x2={752} y1={yTempo} y2={yTempo} stroke={CINZA} strokeWidth="1.5" markerEnd={seta.url} />
      <text x="0" y={yTempo + 4} fontSize="12" fill={CINZA}>tempo →</text>
      <Notas y={yTempo + 26} notas={notas} />
    </svg>
  )
}

// ---------------------------------------------------------------- MVCC: versões na página

/**
 * Versões de uma linha dentro das páginas.
 * - versoes: UPDATE criou uma versão nova; a antiga ficou com xmax.
 * - hot: a coluna alterada não tem índice e havia espaço → mesma página, índice intocado.
 * - sem-hot: a coluna tem índice (ou a página estava cheia) → página nova e entrada nova no índice.
 */
export function IlustracaoVersoes({ modo }: { modo: 'versoes' | 'hot' | 'sem-hot' }) {
  const seta = useSeta('var(--il-destaque)')
  const rotulo = {
    versoes: 'Versões de uma linha: o UPDATE grava uma versão nova e marca a antiga com xmax',
    hot: 'HOT update: a versão nova fica na mesma página e o índice continua apontando para a corrente',
    'sem-hot': 'UPDATE sem HOT: a versão nova vai para outra página e o índice ganha uma entrada nova',
  }[modo]
  const pagina = (x: number, titulo: string, cheia = false) => (
    <g>
      <rect x={x} y="40" width="250" height="150" rx="6" fill="var(--il-fundo)" stroke={CINZA} />
      <text x={x + 8} y="58" fontSize="12" fill={CINZA}>{titulo}</text>
      {cheia && <text x={x + 242} y="58" fontSize="11" textAnchor="end" fill="var(--il-ruim)">sem espaço livre</text>}
    </g>
  )
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img" aria-label={rotulo}>
      {seta.def}
      {modo === 'versoes' && (
        <>
          {pagina(20, 'página 0 da tabela (8 KB)')}
          <Caixa x={35} y={70} w={220} h={44} tom="ruim" texto={'(0,1) id=7 valor=10\nxmin=100 · xmax=105 → morta'} />
          <Caixa x={35} y={128} w={220} h={44} tom="ok" texto={'(0,2) id=7 valor=11\nxmin=105 · xmax=0 → viva'} />
          <path d="M 255 92 C 290 92 290 150 258 150" fill="none" stroke="var(--il-destaque)" strokeWidth="2" markerEnd={seta.url} />
          <text x="300" y="80" fontSize="13" fill="var(--il-texto)">UPDATE … SET valor = 11 WHERE id = 7 (transação 105):</text>
          <text x="300" y="100" fontSize="13" fill="var(--il-texto)">1. grava a versão nova (0,2) com xmin = 105;</text>
          <text x="300" y="120" fontSize="13" fill="var(--il-texto)">2. marca a antiga (0,1) com xmax = 105.</text>
          <text x="300" y="150" fontSize="13" fill="var(--il-texto)">Quem tirou a fotografia ANTES de 105 confirmar</text>
          <text x="300" y="168" fontSize="13" fill="var(--il-texto)">continua lendo valor=10 na (0,1), sem esperar ninguém.</text>
          <Notas y={222} notas={['(página, posição) = ctid, o endereço físico. xmin e xmax são colunas ocultas da tupla.', 'Quando nenhuma transação aberta puder mais ver a (0,1), ela é lixo: o VACUUM recolhe.']} />
        </>
      )}
      {modo === 'hot' && (
        <>
          <Caixa x={20} y={70} w={150} h={44} tom="destaque" texto={'índice (indexada)\n7 → (0,1)'} />
          {pagina(230, 'página 0 · fillfactor 70 (30% livre)')}
          <Caixa x={245} y={70} w={220} h={44} tom="ruim" texto={'(0,1) indexada=7 valor=10\nmorta · início da corrente'} />
          <Caixa x={245} y={128} w={220} h={44} tom="ok" texto={'(0,2) indexada=7 valor=11\nviva · "heap-only"'} />
          <line x1="170" y1="92" x2="243" y2="92" stroke="var(--il-destaque)" strokeWidth="2" markerEnd={seta.url} />
          <path d="M 465 92 C 500 92 500 150 468 150" fill="none" stroke="var(--il-destaque)" strokeWidth="2" markerEnd={seta.url} />
          <text x="510" y="96" fontSize="13" fill="var(--il-texto)">corrente HOT:</text>
          <text x="510" y="114" fontSize="13" fill="var(--il-texto)">o banco segue</text>
          <text x="510" y="132" fontSize="13" fill="var(--il-texto)">de (0,1) até (0,2)</text>
          <Notas y={222} notas={['Mudou só "valor" (sem índice) e havia espaço na MESMA página: o índice nem foi tocado.', 'Menos escrita, menos WAL, e a página se limpa sozinha numa próxima leitura (poda).']} />
        </>
      )}
      {modo === 'sem-hot' && (
        <>
          <Caixa x={20} y={70} w={150} h={44} tom="destaque" texto={'índice (indexada)\n7 → (0,1)'} />
          <Caixa x={20} y={128} w={150} h={44} tom="ruim" texto={'índice (indexada)\n8 → (5,3)  ← nova'} />
          {pagina(230, 'página 0 · fillfactor 100', true)}
          <Caixa x={245} y={70} w={220} h={44} tom="ruim" texto={'(0,1) indexada=7\nmorta'} />
          <rect x="500" y="40" width="250" height="150" rx="6" fill="var(--il-fundo)" stroke={CINZA} />
          <text x="508" y="58" fontSize="12" fill={CINZA}>página 5 (no fim da tabela)</text>
          <Caixa x={515} y={128} w={220} h={44} tom="ok" texto={'(5,3) indexada=8\nviva'} />
          <line x1="170" y1="92" x2="243" y2="92" stroke="var(--il-destaque)" strokeWidth="2" markerEnd={seta.url} />
          <path d="M 170 150 C 330 210 450 200 513 155" fill="none" stroke="var(--il-ruim)" strokeWidth="2" markerEnd={seta.url} />
          <Notas y={222} notas={['Mudou uma coluna INDEXADA (ou a página estava cheia): a versão nova vai para outro lugar', 'e CADA índice da tabela ganha uma entrada nova. Mais escrita, mais WAL, a tabela e o índice crescem.']} />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- particionamento

/** A tabela-mãe e as partições por mês; o modo destaca o que cada operação toca. */
export function IlustracaoParticoes({ modo }: { modo: 'estrutura' | 'pruning' | 'delete' | 'drop' }) {
  const seta = useSeta()
  const meses = ['2025-05', '2025-06', '…', '2026-10', '2026-11', '2026-12', 'DEFAULT']
  const rotulo = {
    estrutura: 'Tabela particionada: a tabela-mãe não guarda linhas; cada mês é uma partição',
    pruning: 'Partition pruning: a consulta de um mês lê só a partição daquele mês',
    delete: 'DELETE de um mês: cada linha é marcada como morta e registrada no WAL; o arquivo continua',
    drop: 'DROP da partição: o arquivo do mês inteiro é removido de uma vez',
  }[modo]
  const tom = (k: number): Tom => {
    if (modo === 'pruning') return k === 3 ? 'ok' : 'apagado'
    if (modo === 'delete') return k === 0 ? 'ruim' : 'neutro'
    if (modo === 'drop') return k === 0 ? 'apagado' : 'neutro'
    return k === 6 ? 'espera' : 'neutro'
  }
  const w = 96
  return (
    <svg className="ilustracao" viewBox="0 0 760 290" role="img" aria-label={rotulo}>
      {seta.def}
      <Caixa x={200} y={6} w={360} h={44} tom="destaque" texto={'auditoria.log  (PARTITION BY RANGE (em))\ntabela-mãe: não guarda linhas'} />
      {meses.map((m, k) => {
        const x = 8 + k * (w + 10)
        return (
          <g key={m}>
            <line x1={380} y1={50} x2={x + w / 2} y2={96} stroke="var(--il-linha)" />
            <Caixa x={x} y={96} w={w} h={56} tom={tom(k)} tracejada={modo === 'drop' && k === 0}
                   texto={m === '…' ? '…' : m === 'DEFAULT' ? 'log_padrao\nDEFAULT\n(vazia)' : `log_${m.replace('-', '')}\n~30 mil linhas`} />
          </g>
        )
      })}
      {modo === 'pruning' && (
        <>
          <Caixa x={220} y={168} w={340} h={34} tom="ok" texto="WHERE em >= '2026-10-01' AND em < '2026-11-01'" />
          <line x1={390} y1={168} x2={8 + 3 * 106 + w / 2} y2={154} stroke="var(--il-ok)" strokeWidth="2" markerEnd={seta.url} />
          <Notas y={226} notas={['O planejador compara o filtro com a faixa de cada partição e descarta as que não podem ter a resposta.']} />
        </>
      )}
      {modo === 'delete' && (
        <Notas y={180} notas={['DELETE FROM auditoria.log WHERE em < …: cada uma das ~30 mil linhas ganha xmax e vira um registro no WAL.', 'O arquivo continua do mesmo tamanho até o VACUUM; os índices continuam apontando para as linhas mortas.', 'Em tabela sem partição, é assim que se apaga — e a tabela inteira fica sujeita ao inchaço.']} />
      )}
      {modo === 'drop' && (
        <Notas y={180} notas={['DETACH PARTITION + DROP TABLE auditoria.log_202505: some o arquivo do mês inteiro (e os índices dele).', 'Pouquíssimo WAL, nenhuma tupla morta, nada para o VACUUM. O custo: um lock exclusivo rápido na tabela-mãe.']} />
      )}
      {modo === 'estrutura' && (
        <Notas y={180} notas={['Cada linha vai para a partição cuja faixa contém o seu em (a data da operação) (FROM incluso, TO excluído).', 'Linha sem partição correspondente cai na DEFAULT. Partição é tabela de verdade: tem arquivo e índices próprios.']} />
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- conexões

/** Clientes, (PgBouncer ou pool da aplicação) e processos do PostgreSQL. */
export function IlustracaoConexoes({ modo }: { modo: 'direto' | 'pgbouncer' | 'pool' }) {
  const seta = useSeta()
  const rotulo = {
    direto: 'Sem pool: cada cliente vira um processo no PostgreSQL; acima do limite, o servidor recusa',
    pgbouncer: 'PgBouncer: muitos clientes dividem poucas conexões reais com o PostgreSQL',
    pool: 'Pool na aplicação: a API mantém conexões abertas e as empresta a cada consulta',
  }[modo]
  const clientes = Array.from({ length: 6 }, (_, k) => k)
  const yC = (k: number) => 34 + k * 30
  const processos = modo === 'direto' ? 5 : 2
  const yP = (k: number) => (modo === 'direto' ? yC(k) : 76 + k * 70)
  return (
    <svg className="ilustracao" viewBox="0 0 760 280" role="img" aria-label={rotulo}>
      {seta.def}
      {clientes.map((k) => (
        <Caixa key={k} x={0} y={yC(k)} w={110} h={26} tom={modo === 'direto' && k === 5 ? 'ruim' : 'neutro'}
               texto={modo === 'pool' ? `requisição ${k + 1}` : `cliente ${k + 1}`} />
      ))}
      <rect x="520" y="6" width="236" height="210" rx="8" fill="var(--il-apagado)" stroke={CINZA} />
      <text x="530" y="24" fontSize="12" fill={CINZA}>PostgreSQL · max_connections = 100</text>
      {Array.from({ length: processos }, (_, k) => (
        <Caixa key={k} x={560} y={yP(k)} w={170} h={26} tom="destaque" texto={`processo (backend) ${k + 1}`} />
      ))}
      {modo === 'direto' && (
        <>
          {clientes.slice(0, 5).map((k) => <line key={k} x1={110} y1={yC(k) + 13} x2={558} y2={yP(k) + 13} stroke={CINZA} markerEnd={seta.url} />)}
          <text x="130" y={yC(5) + 18} fontSize="12" fill="var(--il-ruim)">✕ FATAL 53300: too many clients already</text>
          <Notas y={244} notas={['Cada conexão = fork de um processo + autenticação. 1 cliente = 1 processo, e o limite é fixo.']} />
        </>
      )}
      {modo !== 'direto' && (
        <>
          <Caixa x={250} y={86} w={170} h={70} tom="espera"
                 texto={modo === 'pgbouncer' ? 'PgBouncer :6432\npool_mode = transaction\ndefault_pool_size = 20' : 'API (Go) · pgxpool\nMaxConns = 10\nconexões já abertas'} />
          {clientes.map((k) => <line key={k} x1={110} y1={yC(k) + 13} x2={248} y2={121} stroke={CINZA} markerEnd={seta.url} />)}
          {Array.from({ length: processos }, (_, k) => <line key={k} x1={420} y1={121} x2={558} y2={yP(k) + 13} stroke="var(--il-destaque)" strokeWidth="2" markerEnd={seta.url} />)}
          <Notas y={244} notas={[modo === 'pgbouncer'
            ? 'Conectar no PgBouncer é barato (sem processo novo no PostgreSQL). Quem não acha conexão livre espera na fila.'
            : 'Ninguém conecta nem autentica de novo: a consulta pega uma conexão emprestada e devolve ao terminar.']} />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- cache-aside

/** Os caminhos do cache-aside: falha, acerto e invalidação. */
export function IlustracaoCache({ caminho }: { caminho: 'falha' | 'acerto' | 'invalidacao' }) {
  const seta = useSeta()
  const rotulo = {
    falha: 'Cache-aside, falha: a API não acha no Redis, lê no MongoDB e guarda a cópia com TTL',
    acerto: 'Cache-aside, acerto: a API acha a cópia no Redis e nem vai ao MongoDB',
    invalidacao: 'Invalidação: quando o produto muda, a API apaga a cópia do Redis',
  }[caminho]
  const seg = (x1: number, y1: number, x2: number, y2: number, texto: string, tom: 'ok' | 'ruim' | 'neutro' = 'neutro') => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tom === 'ok' ? 'var(--il-ok)' : tom === 'ruim' ? 'var(--il-ruim)' : CINZA} strokeWidth="2" markerEnd={seta.url} />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} fontSize="12" textAnchor="middle" fill="var(--il-texto)">{texto}</text>
    </g>
  )
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img" aria-label={rotulo}>
      {seta.def}
      <Caixa x={10} y={10} w={150} h={210} tom="destaque" texto={'API (Go)\npágina do produto'} fonte={12} />
      <Caixa x={560} y={10} w={190} h={80} tom={caminho === 'acerto' ? 'ok' : 'neutro'} texto={'Redis (memória)\ncache:produto:{id}'} fonte={12} />
      <Caixa x={560} y={150} w={190} h={70} tom={caminho === 'acerto' ? 'apagado' : 'neutro'} texto={'MongoDB\ncatalogo.produtos'} fonte={12} />
      {caminho === 'falha' && (
        <>
          {seg(160, 34, 556, 34, '① GET cache:produto:{id} → (nil)', 'ruim')}
          {seg(160, 74, 556, 74, '③ SET cache:produto:{id} … EX 300')}
          {seg(160, 190, 556, 190, '② findOne({ _id }) → documento')}
          <Notas y={250} notas={['Falha (miss): uma ida ao Redis à toa + a leitura no MongoDB + a gravação da cópia por 5 minutos.']} />
        </>
      )}
      {caminho === 'acerto' && (
        <>
          {seg(160, 50, 556, 50, '① GET cache:produto:{id} → JSON', 'ok')}
          <text x="358" y="190" fontSize="12" textAnchor="middle" fill="var(--il-texto-3)">MongoDB nem é consultado</text>
          <Notas y={250} notas={['Acerto (hit): uma leitura na memória do Redis e pronto.']} />
        </>
      )}
      {caminho === 'invalidacao' && (
        <>
          {seg(160, 190, 556, 190, '① nova avaliação → resumo atualizado')}
          {seg(160, 50, 556, 50, '② DEL cache:produto:{id}', 'ruim')}
          <Notas y={250} notas={['A próxima leitura será uma falha e trará a versão nova. Sem o DEL, a cópia velha valeria até o TTL acabar.']} />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- replicação (Fase 5)

const ETAPAS_WAL = [
  { onde: 'primário', texto: '1. gera o WAL\n(o COMMIT)' },
  { onde: 'primário', texto: '2. grava no\ndisco local' },
  { onde: 'réplica', texto: '3. recebe e\nentrega ao SO' },
  { onde: 'réplica', texto: '4. grava no\ndisco dela' },
  { onde: 'réplica', texto: '5. aplica:\nlinha visível' },
]

export const ESPERA_DO_MODO: Record<string, number> = { off: 1, local: 2, remote_write: 3, on: 4, remote_apply: 5 }

/** O caminho do WAL e até onde o COMMIT espera em cada synchronous_commit. */
export function IlustracaoReplicacao({ modo }: { modo: string }) {
  const seta = useSeta()
  const ate = ESPERA_DO_MODO[modo] ?? 2
  const x = (k: number) => (k < 2 ? 14 + k * 145 : 346 + (k - 2) * 140)
  return (
    <svg className="ilustracao" viewBox="0 0 760 230" role="img"
         aria-label={`synchronous_commit = ${modo}: o COMMIT espera até a etapa ${ate} de 5`}>
      {seta.def}
      <rect x="4" y="22" width="304" height="100" rx="8" fill="var(--il-apagado)" stroke={CINZA} />
      <text x="12" y="16" fontSize="12" fill={CINZA}>primário (postgres)</text>
      <rect x="336" y="22" width="420" height="100" rx="8" fill="var(--il-apagado)" stroke={CINZA} />
      <text x="344" y="16" fontSize="12" fill={CINZA}>réplica (postgres-replica)</text>
      {ETAPAS_WAL.map((e, k) => (
        <Caixa key={k} x={x(k)} y={40} w={130} h={62} texto={e.texto} fonte={12} tom={k < ate ? 'destaque' : 'apagado'} />
      ))}
      {[0, 1, 2, 3].map((k) => (
        <line key={k} x1={x(k) + 130} y1={71} x2={x(k + 1) - 2} y2={71} stroke={k === 1 ? 'var(--il-destaque)' : CINZA} strokeWidth={k === 1 ? 2 : 1.4} markerEnd={seta.url} />
      ))}
      <text x="316" y="62" fontSize="11" fill="var(--il-destaque)">rede</text>
      <path d={`M ${x(0) + 10} 112 V 134 H ${x(ate - 1) + 120} V 112`} fill="none" stroke="var(--il-destaque)" strokeWidth="2" />
      <text x={x(0) + 10} y="150" fontSize="12" fill="var(--il-destaque)">o COMMIT só responde depois da etapa {ate}</text>
      <Notas y={182} notas={[
        {
          off: 'off: responde antes até do disco local. O WAL vai ao disco (e à réplica) pelo WAL writer, em ciclos de ~200 ms.',
          local: 'local (padrão do projeto): durável no primário; a réplica recebe logo depois, sem o COMMIT esperar.',
          remote_write: 'remote_write: a réplica recebeu; se ela cair agora, o dado ainda está no primário.',
          on: 'on: durável no primário E no disco da réplica, mas pode ainda não estar visível para leitura nela.',
          remote_apply: 'remote_apply: a linha já é visível na réplica — ler dela logo depois sempre acha (read-your-writes).',
        }[modo] ?? '',
        'Etapas em cinza acontecem depois, sem o COMMIT esperar.',
      ]} />
    </svg>
  )
}

// ---------------------------------------------------------------- backup e PITR (Fase 5)

const BACKUPS_SEMANA = [
  { dia: 'dom', tipo: 'full', rotulo: 'F', ref: -1 },
  { dia: 'seg', tipo: 'incr', rotulo: 'I', ref: 0 },
  { dia: 'ter', tipo: 'incr', rotulo: 'I', ref: 1 },
  { dia: 'qua', tipo: 'diff', rotulo: 'D', ref: 0 },
  { dia: 'qui', tipo: 'incr', rotulo: 'I', ref: 3 },
]

/**
 * Uma semana de backups. tipos: de quem cada um depende. pitr: o que a
 * restauração usa para voltar a quinta-feira às 14:31 (antes do DROP das 14:32).
 */
export function IlustracaoBackups({ modo }: { modo: 'tipos' | 'pitr' }) {
  const seta = useSeta()
  const w = 120, x = (k: number) => 30 + k * 145
  const cadeia = new Set([0, 3, 4]) // o incremental de quinta precisa do diff de quarta e do full de domingo
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img"
         aria-label={modo === 'tipos' ? 'Backups full, diferencial e incremental: de quem cada um depende' : 'PITR: a cadeia de backups e o WAL até o instante-alvo'}>
      {seta.def}
      {BACKUPS_SEMANA.map((b, k) => {
        const tom: Tom = modo === 'pitr' ? (cadeia.has(k) ? 'ok' : 'apagado') : b.tipo === 'full' ? 'destaque' : b.tipo === 'diff' ? 'espera' : 'neutro'
        return (
          <g key={k}>
            <text x={x(k) + w / 2} y="16" fontSize="12" textAnchor="middle" fill={CINZA}>{b.dia}</text>
            <Caixa x={x(k)} y={60} w={w} h={46} tom={tom} fonte={12}
                   texto={`${b.rotulo} · ${b.tipo}\n${b.tipo === 'full' ? 'tudo' : b.tipo === 'diff' ? 'desde o full' : 'desde o anterior'}`} />
            {b.ref >= 0 && (
              <path d={`M ${x(k) + 20} 60 C ${x(k) + 10} 26, ${x(b.ref) + w - 10} 26, ${x(b.ref) + w - 20} 58`} fill="none"
                    stroke={modo === 'pitr' && cadeia.has(k) && cadeia.has(b.ref) ? 'var(--il-ok)' : 'var(--il-borda)'} strokeWidth="1.6" markerEnd={seta.url} />
            )}
          </g>
        )
      })}
      <rect x="30" y="122" width="700" height="24" rx="4" fill="var(--il-apagado)" stroke={CINZA} />
      {Array.from({ length: 35 }, (_, k) => <line key={k} x1={30 + k * 20} y1="122" x2={30 + k * 20} y2="146" stroke="var(--il-linha)" />)}
      <text x="36" y="139" fontSize="11" fill={CINZA}>WAL arquivado continuamente (segmentos de 16 MB)</text>
      {modo === 'pitr' && (
        <>
          <rect x={x(4)} y="122" width={66} height="24" fill="var(--il-ok-fundo)" stroke="var(--il-ok)" opacity="0.9" />
          <line x1={x(4) + 66} y1="114" x2={x(4) + 66} y2="156" stroke="var(--il-ok)" strokeWidth="2.5" />
          <text x={x(4) + 66} y="172" fontSize="12" textAnchor="middle" fill="var(--il-ok)">alvo 14:31</text>
          <line x1={x(4) + 80} y1="114" x2={x(4) + 80} y2="156" stroke="var(--il-ruim)" strokeWidth="2.5" />
          <text x={x(4) + 92} y="188" fontSize="12" textAnchor="middle" fill="var(--il-ruim)">DROP 14:32</text>
        </>
      )}
      <Notas y={214} notas={modo === 'tipos'
        ? ['Diferencial (D) depende só do full; incremental (I) depende do backup anterior, qualquer que seja.',
           'Incremental é o menor e o mais rápido de fazer — e o que exige a cadeia mais longa para restaurar.']
        : ['Para voltar à quinta às 14:31: o full de domingo + o diff de quarta + o incr de quinta (a cadeia, em verde)',
           'e, por cima, o WAL arquivado desde o incr até o alvo. Seg e ter não são necessários: o diff já os cobre.']} />
    </svg>
  )
}

// ---------------------------------------------------------------- alta disponibilidade (Fase 5)

/** A topologia de cada cluster do Laboratório de Alta Disponibilidade. */
export function IlustracaoTopologiaHA({ tec }: { tec: 'patroni' | 'mongo' | 'redis' }) {
  const seta = useSeta()
  const rotulo = {
    patroni: 'Patroni: a API escreve no HAProxy, que encaminha ao líder; os nós disputam a chave de líder no etcd',
    mongo: 'MongoDB: três membros trocam heartbeats; o driver escreve no primário',
    redis: 'Redis: três sentinels vigiam o primário; o cliente pergunta a eles quem é o primário',
  }[tec]
  const linha = (x1: number, y1: number, x2: number, y2: number, cor = CINZA, tracejada = false) =>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={cor} strokeWidth="1.8" strokeDasharray={tracejada ? '5 4' : undefined} markerEnd={tracejada ? undefined : seta.url} />
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img" aria-label={rotulo}>
      {seta.def}
      <Caixa x={10} y={100} w={110} h={50} tom="destaque" texto={'API (Go)\nescritor'} fonte={12} />
      {tec === 'patroni' && (
        <>
          <Caixa x={180} y={95} w={150} h={60} tom="espera" texto={'HAProxy\n:5000 escrita\n:5001 leitura'} fonte={12} />
          {linha(120, 125, 178, 125)}
          <Caixa x={420} y={30} w={150} h={56} tom="ok" texto={'patroni1\nlíder (PostgreSQL)'} fonte={12} />
          <Caixa x={420} y={160} w={150} h={56} texto={'patroni2\nréplica (streaming)'} fonte={12} />
          {linha(330, 115, 418, 62, 'var(--il-ok)')}
          {linha(330, 140, 418, 185, 'var(--il-linha)', true)}
          {linha(495, 86, 495, 158, 'var(--il-destaque)')}
          <text x="502" y="126" fontSize="11" fill="var(--il-destaque)">WAL</text>
          <Caixa x={620} y={95} w={130} h={60} tom="neutro" texto={'etcd ×3\nchave de líder\n(TTL 20 s)'} fonte={12} />
          {linha(570, 58, 618, 110, 'var(--il-destaque)', true)}
          {linha(570, 188, 618, 140, 'var(--il-destaque)', true)}
          <Notas y={244} notas={['O HAProxy pergunta a cada nó (GET /primary na porta 8008) e só manda a escrita para quem responde 200.']} />
        </>
      )}
      {tec === 'mongo' && (
        <>
          <Caixa x={330} y={20} w={150} h={50} tom="ok" texto={'mongo-ha1\nprimário'} fonte={12} />
          <Caixa x={220} y={170} w={150} h={50} texto={'mongo-ha2\nsecundário'} fonte={12} />
          <Caixa x={450} y={170} w={150} h={50} texto={'mongo-ha3\nsecundário'} fonte={12} />
          {linha(120, 118, 328, 52, 'var(--il-ok)')}
          {linha(380, 70, 310, 168, 'var(--il-linha)', true)}
          {linha(430, 70, 510, 168, 'var(--il-linha)', true)}
          {linha(370, 195, 448, 195, 'var(--il-linha)', true)}
          <text x="610" y="110" fontSize="12" fill={CINZA}>tracejado = heartbeats</text>
          <text x="610" y="128" fontSize="12" fill={CINZA}>a cada 2 s, todos</text>
          <text x="610" y="146" fontSize="12" fill={CINZA}>com todos</text>
          <Notas y={250} notas={['Sem notícias do primário por 10 s, os secundários elegem outro — basta a maioria (2 de 3).']} />
        </>
      )}
      {tec === 'redis' && (
        <>
          {[0, 1, 2].map((k) => <Caixa key={k} x={260 + k * 160} y={10} w={140} h={40} tom="espera" texto={`sentinel${k + 1}`} fonte={12} />)}
          <Caixa x={300} y={170} w={150} h={50} tom="ok" texto={'redis-ha1\nprimário'} fonte={12} />
          <Caixa x={520} y={170} w={150} h={50} texto={'redis-ha2\nréplica'} fonte={12} />
          {[0, 1, 2].map((k) => <g key={k}>{linha(330 + k * 160, 50, 375, 168, 'var(--il-linha)', true)}{linha(330 + k * 160, 50, 595, 168, 'var(--il-linha)', true)}</g>)}
          {linha(450, 195, 518, 195, 'var(--il-destaque)')}
          {linha(120, 112, 258, 34)}
          <text x="130" y="60" fontSize="11" fill={CINZA}>"quem é o primário?"</text>
          {linha(120, 135, 298, 192, 'var(--il-ok)')}
          <Notas y={250} notas={['Primário mudo por 5 s: cada sentinel o vê fora (SDOWN); 2 concordando (quórum) = ODOWN, e a réplica é promovida.']} />
        </>
      )}
    </svg>
  )
}

/** Partição de rede com 3 nós: só o lado com a maioria pode eleger. */
export function IlustracaoQuorum() {
  return (
    <svg className="ilustracao" viewBox="0 0 760 230" role="img" aria-label="Quórum: numa partição, só o lado com 2 de 3 nós elege um líder">
      <rect x="10" y="20" width="240" height="130" rx="8" fill="var(--il-ruim-fundo)" stroke="var(--il-ruim)" />
      <text x="20" y="40" fontSize="12" fill="var(--il-ruim)">lado A: 1 de 3</text>
      <Caixa x={60} y={60} w={140} h={44} tom="ruim" texto={'nó 1 (era o líder)\nperde o posto'} fonte={12} />
      <line x1="300" y1="10" x2="300" y2="160" stroke="var(--il-texto)" strokeWidth="3" strokeDasharray="8 6" />
      <text x="308" y="26" fontSize="12" fill="var(--il-texto)">rede partida</text>
      <rect x="350" y="20" width="400" height="130" rx="8" fill="var(--il-ok-fundo)" stroke="var(--il-ok)" />
      <text x="360" y="40" fontSize="12" fill="var(--il-ok)">lado B: 2 de 3 = maioria</text>
      <Caixa x={380} y={60} w={150} h={44} tom="ok" texto={'nó 2\nnovo líder'} fonte={12} />
      <Caixa x={570} y={60} w={150} h={44} texto={'nó 3\nvotou no nó 2'} fonte={12} />
      <Notas y={180} notas={['Maioria = ⌊N/2⌋ + 1. Com 3 nós, 2; com 5, 3. Só um lado pode ter a maioria: nunca há dois líderes (split-brain).',
        'Com 2 nós, a maioria é 2: qualquer falha para tudo. Por isso o etcd tem 3 membros e o replica set, 3 nós.']} />
    </svg>
  )
}
