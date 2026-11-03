import { useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { DOCUMENTOS, porSlug, secoes } from '../../estudo/documentos'
import { Markdown } from '../../estudo/Markdown'

// Um arquivo de docs/ renderizado (cenários M1–M4).

export function DocumentoPage() {
  const { slug = '' } = useParams()
  const { hash } = useLocation()
  const doc = porSlug(slug)

  // O React Router não rola até a âncora: um link "fase-4#3-resultados-medidos"
  // precisa levar à seção, não ao topo (cenário M3).
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return }
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
  }, [slug, hash])

  if (!doc) {
    return <section><p className="error">Documento "{slug}" não existe.</p><p><Link to="/estudo">← Material de estudo</Link></p></section>
  }
  const i = DOCUMENTOS.indexOf(doc)
  const anterior = DOCUMENTOS[i - 1]
  const proximo = DOCUMENTOS[i + 1]
  const sumario = secoes(doc.texto)

  return (
    <section className="documento-pagina">
      <p className="small"><Link to="/estudo">← Material de estudo</Link> · arquivo <code>{doc.caminho}</code></p>
      <div className="documento-grade">
        {sumario.length > 0 && (
          <nav className="sumario small" aria-label="Neste documento">
            <strong>Neste documento</strong>
            {sumario.map((s) => <a key={s.id} href={`#${s.id}`}>{s.texto}</a>)}
          </nav>
        )}
        <article className="documento" aria-label={doc.titulo}>
          <Markdown texto={doc.texto} origem={doc.caminho} />
        </article>
      </div>
      <nav className="form-linha" aria-label="Outros documentos">
        {anterior && <Link to={`/estudo/${anterior.slug}`}>← {anterior.titulo}</Link>}
        {proximo && <Link to={`/estudo/${proximo.slug}`}>{proximo.titulo} →</Link>}
      </nav>
    </section>
  )
}
