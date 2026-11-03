import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { FontesCurtas, type IdFonte } from './fontes'

// Componentes didáticos usados em todas as telas.

export type NomeBanco = 'PostgreSQL' | 'MongoDB' | 'Redis' | 'PgBouncer' | 'Cassandra' | 'Neo4j'

const BANCOS: Record<NomeBanco, { icone: string; porque: string }> = {
  PostgreSQL: { icone: '🐘', porque: 'Relacional e ACID: dinheiro, estoque e pedidos precisam de transação e integridade.' },
  MongoDB: { icone: '🍃', porque: 'Documentos: cada produto tem atributos diferentes e é lido inteiro de uma vez.' },
  Redis: { icone: '🟥', porque: 'Chave-valor em memória: rápido, com expiração (TTL). Bom para cache, carrinho e rankings.' },
  PgBouncer: { icone: '🔀', porque: 'Pooler: muitos clientes compartilham poucas conexões reais com o PostgreSQL.' },
  Cassandra: { icone: '👁️', porque: 'Wide-column: muita escrita de eventos (Fase 7).' },
  Neo4j: { icone: '🕸️', porque: 'Grafo: relacionamentos como recomendações (Fase 7).' },
}

/** Selo "de onde vem este dado". Sempre com ícone e nome (nunca só cor). */
export function Banco({ nome }: { nome: NomeBanco }) {
  const b = BANCOS[nome]
  return (
    <span className={`banco banco-${nome.toLowerCase()}`} title={`${nome}: ${b.porque}`}>
      <span aria-hidden="true">{b.icone}</span> {nome}
    </span>
  )
}

/**
 * Explicação em duas camadas: uma frase simples sempre visível e o
 * "Por dentro" (SQL, plano, conceito) para quem quer a profundidade.
 */
export function Explicacao({ frase, topico, doc, children }: {
  frase: ReactNode
  topico?: string
  doc?: string
  children?: ReactNode
}) {
  return (
    <div className="explicacao" role="note">
      <p className="frase">{frase}{topico && <span className="topico">{topico}</span>}</p>
      {children && (
        <details>
          <summary>Por dentro</summary>
          <div className="por-dentro">
            {children}
            {doc && <p className="small">Para aprofundar: <LinkDoc doc={doc} /></p>}
          </div>
        </details>
      )}
    </div>
  )
}

/** "docs/03-transacoes-acid.md §9 · docs/fases/fase-3.md": cada documento vira link para o material no app. */
function LinkDoc({ doc }: { doc: string }) {
  return doc.split(' · ').map((parte, i) => {
    const m = /^docs\/(?:fases\/)?([\w-]+)\.md/.exec(parte)
    return <span key={parte}>{i > 0 && ' · '}{m ? <Link to={`/estudo/${m[1]}`}>{parte}</Link> : <code>{parte}</code>}</span>
  })
}

export function Titulo({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="titulo-pagina">
      <h1>{titulo}</h1>
      {children}
    </div>
  )
}

export function Stat({ rotulo, valor, detalhe }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode }) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd>{valor}{detalhe && <> <small>{detalhe}</small></>}</dd>
    </div>
  )
}

/** Conclusão de um laboratório: o que o resultado significa, em linguagem simples. */
export function Conclusao({ tipo, titulo, children }: { tipo: 'boa' | 'ruim' | 'neutra'; titulo: string; children: ReactNode }) {
  return (
    <div className={`conclusao ${tipo}`} role="status" aria-label="Conclusão">
      <strong>{titulo}</strong>
      {children}
    </div>
  )
}

/** Abas guardadas na URL (?aba=...): recarregar ou compartilhar mantém a aba. */
export function useAba(padrao: string): [string, (a: string) => void] {
  const [params, setParams] = useSearchParams()
  const aba = params.get('aba') ?? padrao
  return [aba, (a) => setParams((p) => { p.set('aba', a); return p }, { replace: true })]
}

export function Abas({ abas, atual, mudar }: { abas: [string, string][]; atual: string; mudar: (a: string) => void }) {
  return (
    <div className="abas" role="tablist">
      {abas.map(([id, nome]) => (
        <button key={id} role="tab" aria-selected={atual === id} onClick={() => mudar(id)}>{nome}</button>
      ))}
    </div>
  )
}

export const bytes = (n: number) => {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${u[i]}`
}
export const ms = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 2 : 0 })} ms`
export const inteiro = (n: number) => n.toLocaleString('pt-BR')

/**
 * "Sobre esta opção": o conceito da opção escolhida num laboratório.
 * Sempre a mesma ordem: o que é, analogia, o que o banco executa e o que esperar.
 */
export function SobreOpcao({ titulo, conceito, analogia, comando, espere, fontes = [] }: {
  titulo: string
  conceito: ReactNode
  analogia?: ReactNode
  comando?: string
  espere?: ReactNode
  fontes?: readonly IdFonte[]
}) {
  return (
    <section className="sobre-opcao" aria-label="Sobre esta opção">
      <h3>Sobre esta opção · {titulo}</h3>
      <div className="sobre-grade">
        <div><h4>O que é</h4><div>{conceito}</div></div>
        {analogia && <div><h4>Analogia</h4><div>{analogia}</div></div>}
        {espere && <div><h4>O que esperar</h4><div>{espere}</div></div>}
      </div>
      {comando && <><h4>O que o banco executa</h4><pre className="sql">{comando}</pre></>}
      <FontesCurtas ids={fontes} titulo="Fontes desta opção" />
    </section>
  )
}

/** Bloco "O conceito": explicação aberta (não recolhida) no topo de cada laboratório. */
export function Conceito({ titulo = 'O conceito', children }: { titulo?: string; children: ReactNode }) {
  return (
    <section className="conceito" aria-label={titulo}>
      <h2>{titulo}</h2>
      <div className="conceito-texto">{children}</div>
    </section>
  )
}
