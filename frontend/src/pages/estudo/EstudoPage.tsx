import { Link } from 'react-router'
import { Explicacao, Titulo } from '../../components/ui'
import { DOCUMENTOS, type Documento } from '../../estudo/documentos'

// Índice do material de estudo: os arquivos de docs/, por tópico do edital e
// pelo diário de cada fase (cenário M1).

export function EstudoPage() {
  const grupo = (g: Documento['grupo']) => DOCUMENTOS.filter((d) => d.grupo === g)
  return (
    <section>
      <Titulo titulo="Material de estudo" />
      <Explicacao frase={<>O texto completo de cada tópico: conceito, onde ele aparece no código, exemplos em SQL e as <strong>fontes para pesquisa</strong>. É o mesmo conteúdo da pasta <code>docs/</code> do repositório — o app lê os arquivos, não uma cópia.</>}>
        <p>Os laboratórios mostram o conceito em ação; aqui está a teoria inteira, com as tabelas e diagramas. Os <strong>diários das fases</strong> trazem os resultados medidos de verdade e os exercícios.</p>
        <p>Links para arquivos de código aparecem com o caminho no repositório (abra no seu editor).</p>
      </Explicacao>
      <section className="conceito" aria-label="Material de estudo">
        <h2>Tópicos do edital</h2>
        <Lista docs={grupo('topico')} />
        <h2>Diário das fases</h2>
        <Lista docs={grupo('fase')} />
      </section>
    </section>
  )
}

function Lista({ docs }: { docs: Documento[] }) {
  return (
    <ul className="lista-docs">
      {docs.map((d) => (
        <li key={d.slug}>
          <Link to={`/estudo/${d.slug}`}>{d.titulo}</Link>
          <div className="muted small">{d.resumo}</div>
        </li>
      ))}
    </ul>
  )
}
