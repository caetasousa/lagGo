import { useEffect, useId, useState } from 'react'

// Diagrama Mermaid de um .md (cenário M4). A biblioteca é grande, então só é
// baixada quando um documento com diagrama é aberto (import dinâmico).

type Mermaid = typeof import('mermaid')['default']
let carregando: Promise<Mermaid> | undefined

function mermaid() {
  carregando ??= import('mermaid').then(({ default: m }) => {
    // strict: o texto do diagrama não executa HTML nem scripts.
    // suppressErrorRendering: sem isto, um erro de sintaxe faz o Mermaid
    // pendurar a "bomba" (Syntax error in text) no fim da página; o erro é
    // mostrado por este componente, no lugar do diagrama.
    // Tema "base" com as cores do tema escuro do app (styles.css): caixas
    // escuras, texto claro, contorno ciano. O Mermaid precisa de cores
    // literais aqui (ele calcula tons derivados), não de var(--…).
    m.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'strict', suppressErrorRendering: true,
      themeVariables: {
        darkMode: true, background: '#161230', fontFamily: 'Inter, system-ui, sans-serif',
        primaryColor: '#1f1945', primaryTextColor: '#ece9ff', primaryBorderColor: '#2de2e6',
        secondaryColor: '#0b3646', tertiaryColor: '#191536', lineColor: '#a7a0d4', textColor: '#ece9ff',
        noteBkgColor: '#3d300a', noteTextColor: '#ece9ff', noteBorderColor: '#ffc94d',
        actorBkg: '#1f1945', actorBorder: '#2de2e6', actorTextColor: '#ece9ff', signalColor: '#ece9ff', signalTextColor: '#ece9ff',
        labelBoxBkgColor: '#1f1945', labelTextColor: '#ece9ff', loopTextColor: '#ece9ff',
        edgeLabelBackground: '#161230', clusterBkg: '#191536', clusterBorder: '#4a3f99',
      },
    })
    return m
  })
  return carregando
}

const TIPOS: [RegExp, string][] = [
  [/^sequenceDiagram/, 'Diagrama de sequência'],
  [/^erDiagram/, 'Diagrama entidade-relacionamento'],
  [/^(flowchart|graph)/, 'Fluxograma'],
  [/^classDiagram/, 'Diagrama de classes'],
  [/^stateDiagram/, 'Diagrama de estados'],
]

export function Diagrama({ codigo }: { codigo: string }) {
  const id = 'diagrama-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string>()
  const [erro, setErro] = useState<string>()
  const tipo = TIPOS.find(([re]) => re.test(codigo.trim()))?.[1] ?? 'Diagrama'

  useEffect(() => {
    let vivo = true
    mermaid()
      // parse primeiro: com erro de sintaxe, lança antes de desenhar qualquer coisa.
      .then(async (m) => { await m.parse(codigo); return m.render(id, codigo) })
      .then((r) => { if (vivo) setSvg(r.svg) })
      .catch((e: unknown) => {
        // O render deixa um elemento temporário (#d<id>) no body quando falha.
        document.getElementById(`d${id}`)?.remove()
        if (vivo) setErro(e instanceof Error ? e.message : String(e))
      })
    return () => { vivo = false }
  }, [id, codigo])

  if (erro) {
    return (
      <figure className="diagrama diagrama-erro" aria-label={`${tipo} com erro de sintaxe`}>
        <p className="error small">Este diagrama do .md tem erro de sintaxe e não pôde ser desenhado (o código aparece abaixo). Mermaid: {erro.split('\n')[0]}</p>
        <pre className="sql">{codigo}</pre>
      </figure>
    )
  }
  return (
    <figure className="diagrama" aria-label={tipo}>
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted small">Desenhando o diagrama…</p>}
    </figure>
  )
}
