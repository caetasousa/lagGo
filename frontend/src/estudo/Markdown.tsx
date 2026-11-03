import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Diagrama } from './Diagrama'
import { porSlug, slugTitulo } from './documentos'

// Renderiza um arquivo de docs/ como o GitHub o mostraria: tabelas (GFM),
// títulos com âncora, diagramas Mermaid e links que funcionam DENTRO do app.

type No = { type: string; value?: string; depth?: number; children?: No[]; data?: { hProperties?: Record<string, string> } }

const textoDe = (n: No): string => n.value ?? (n.children ?? []).map(textoDe).join('')

/**
 * Plugin remark: dá a cada título o id que o GitHub daria (com -1, -2 nos
 * repetidos) e a cada tabela um aria-label com o título da seção.
 */
function remarkAncoras() {
  return (arvore: No) => {
    const usados = new Map<string, number>()
    let secao = 'documento'
    const tabelas = new Map<string, number>()
    const visitar = (n: No) => {
      if (n.type === 'heading') {
        secao = textoDe(n)
        const base = slugTitulo(secao)
        const k = usados.get(base) ?? 0
        usados.set(base, k + 1)
        n.data = { ...n.data, hProperties: { ...n.data?.hProperties, id: k ? `${base}-${k}` : base } }
      }
      if (n.type === 'table') {
        const k = (tabelas.get(secao) ?? 0) + 1
        tabelas.set(secao, k)
        n.data = { ...n.data, hProperties: { 'aria-label': k > 1 ? `${secao} (tabela ${k})` : secao } }
      }
      n.children?.forEach(visitar)
    }
    visitar(arvore)
  }
}

/** docs/fases + "../03-x.md#y" → "docs/03-x.md#y" (sem resolver o que sai do repositório). */
function resolver(origem: string, href: string) {
  const partes = origem.split('/').slice(0, -1)
  for (const p of href.split('/')) {
    if (p === '..') partes.pop()
    else if (p !== '.') partes.push(p)
  }
  return partes.join('/')
}

function Ancora({ href = '', origem, children }: { href?: string; origem: string; children?: ReactNode }) {
  if (/^(https?:|mailto:)/.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  if (href.startsWith('#')) return <a href={href}>{children}</a>
  const caminho = resolver(origem, href)
  const [arquivo, ancora] = caminho.split('#')
  const m = /^docs\/(?:fases\/)?([\w-]+)\.md$/.exec(arquivo)
  if (m && porSlug(m[1])) return <Link to={`/estudo/${m[1]}${ancora ? `#${ancora}` : ''}`}>{children}</Link>
  // Arquivo do repositório (código, configuração, README): não há página no
  // app — mostra o caminho para abrir no editor.
  return <span className="caminho-repo" title={`Arquivo do repositório: ${caminho}`}>{children} <span className="muted small">({arquivo})</span></span>
}

export function Markdown({ texto, origem }: { texto: string; origem: string }) {
  const componentes: Components = {
    a: ({ href, children }) => <Ancora href={href} origem={origem}>{children}</Ancora>,
    pre: ({ node, children }) => {
      const codigo = node?.children[0]
      if (codigo?.type === 'element' && codigo.tagName === 'code' && String(codigo.properties.className ?? '').includes('language-mermaid')) {
        return <Diagrama codigo={codigo.children.map((c) => (c.type === 'text' ? c.value : '')).join('')} />
      }
      return <pre className="sql">{children}</pre>
    },
  }
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkAncoras]} components={componentes}>{texto}</ReactMarkdown>
}
