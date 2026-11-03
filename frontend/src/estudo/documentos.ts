// O material de estudo é o próprio docs/ do repositório, embutido no build:
// o app mostra EXATAMENTE os arquivos .md (cenário M1), sem uma segunda cópia
// que pudesse divergir. No Docker, o compose entrega docs/ ao build do web
// como contexto extra ("additional_contexts") e o Dockerfile o copia para
// /docs — o mesmo caminho relativo que no repositório.

const arquivos = import.meta.glob('../../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export type Documento = {
  slug: string              // nome do arquivo sem .md: "03-transacoes-acid", "fase-4"
  caminho: string           // "docs/03-transacoes-acid.md"
  grupo: 'topico' | 'fase'
  titulo: string            // a linha "# …"
  resumo: string            // o primeiro parágrafo, sem marcação
  texto: string
}

function primeiroParagrafo(texto: string) {
  const blocos = texto.split(/\n\s*\n/).map((b) => b.trim())
  const p = blocos.find((b) => b && !/^(#|```|\||>|-|\*|\d+\.|<)/.test(b)) ?? ''
  return p.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ')
}

export const DOCUMENTOS: Documento[] = Object.entries(arquivos)
  .map(([chave, texto]) => {
    const caminho = 'docs/' + chave.split('/docs/')[1]
    return {
      slug: caminho.split('/').pop()!.replace(/\.md$/, ''),
      caminho,
      grupo: caminho.startsWith('docs/fases/') ? 'fase' as const : 'topico' as const,
      titulo: /^# (.+)$/m.exec(texto)?.[1].trim() ?? caminho,
      resumo: primeiroParagrafo(texto.replace(/^# .+$/m, '')),
      texto,
    }
  })
  .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR', { numeric: true }))

export const porSlug = (slug: string) => DOCUMENTOS.find((d) => d.slug === slug)

/**
 * O "id" de um título, igual ao que o GitHub gera — é o que os links do .md
 * usam (fases/fase-4.md#3-resultados-medidos): minúsculas, sem pontuação,
 * espaço vira hífen, acentos ficam.
 */
export function slugTitulo(texto: string) {
  return texto.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
}

/** Os títulos "## " do documento (fora de blocos de código), para o sumário. */
export function secoes(texto: string) {
  let codigo = false
  const r: { texto: string; id: string }[] = []
  for (const linha of texto.split('\n')) {
    if (linha.startsWith('```')) codigo = !codigo
    else if (!codigo && linha.startsWith('## ')) {
      const t = linha.slice(3).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`]/g, '').replace(/\*\*/g, '').trim()
      r.push({ texto: t, id: slugTitulo(t) })
    }
  }
  return r
}
