import { UsoSelo } from '../../components/usos'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, brl, type Busca, type Categoria } from '../../api/client'
import { Async } from '../../components/Async'
import { Explicacao, Titulo } from '../../components/ui'
import { ImagemProduto } from '../../components/ImagemProduto'

// Catálogo lido do MongoDB: busca textual ($text), filtro por categoria via
// array de ancestrais e facetas ($facet) numa só agregação. Os filtros moram
// na URL: recarregar ou compartilhar o link mantém a busca.

const ORDENS = [
  ['', 'Relevância / avaliação'],
  ['preco_asc', 'Menor preço'],
  ['preco_desc', 'Maior preço'],
  ['avaliacao', 'Melhor avaliados'],
]

export function CatalogoPage() {
  const [params, setParams] = useSearchParams()
  const [texto, setTexto] = useState(params.get('busca') ?? '')
  useEffect(() => setTexto(params.get('busca') ?? ''), [params])
  const pagina = Number(params.get('pagina') ?? 1)

  const mudar = (mudancas: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (!('pagina' in mudancas)) p.delete('pagina')
    setParams(p)
  }

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<Categoria[]>('/loja/categorias') })
  const busca = useQuery({
    queryKey: ['busca', params.toString()],
    queryFn: () => {
      const q = new URLSearchParams(params)
      const [de, ate] = (params.get('preco') ?? '').split('-')
      q.delete('preco')
      if (de) q.set('preco_de', de)
      if (ate) q.set('preco_ate', ate)
      return api<Busca>(`/catalogo/produtos?${q}`)
    },
  })

  return (
    <section>
      <Titulo titulo="Catálogo" />
      <Explicacao frase={<>Cada produto é <strong>um documento</strong> no MongoDB, com atributos que mudam por categoria (notebook tem RAM, livro tem autor). A lista, o total e os filtros da esquerda saem de <strong>uma única consulta</strong>.</>}
                  topico="8.8" doc="docs/07-nosql.md · docs/fases/fase-3.md">
        <p><strong>Busca por texto:</strong> índice de texto com pesos (o nome vale mais que a descrição) e radicais em português — "notebooks" acha "notebook".</p>
        <p><strong>Categoria:</strong> o documento guarda <code>categorias: [raiz, …, folha]</code> (array de ancestrais). Filtrar por "Eletrônicos" acha notebooks sem consulta recursiva.</p>
        <p><strong>Filtros com contagem:</strong> o estágio <code>$facet</code> calcula a página, o total e as contagens na mesma passada. O pipeline exato está no fim da página.</p>
      </Explicacao>

      <form className="filtros" onSubmit={(e) => { e.preventDefault(); mudar({ busca: texto }) }}>
        <input className="busca" aria-label="Buscar produtos" placeholder="Buscar produtos…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit">Buscar</button>
        <select aria-label="Categoria" value={params.get('categoria') ?? ''} onChange={(e) => mudar({ categoria: e.target.value })}>
          <option value="">Todas as categorias</option>
          {categorias.data?.map((c) => (
            <option key={c.id} value={c.id}>{'  '.repeat(c.nivel - 1)}{c.nome}</option>
          ))}
        </select>
        <select aria-label="Ordenar" value={params.get('ordenar') ?? ''} onChange={(e) => mudar({ ordenar: e.target.value })}>
          {ORDENS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <UsoSelo id="mongo-catalogo" />
      </form>

      <Async query={busca}>
        {(b) => (
          <div className="catalogo">
            <aside className="facetas" aria-label="Filtros">
              <h3>Categorias</h3>
              {b.facetas_categorias.map((f) => (
                <button key={f.id} className={params.get('categoria') === String(f.id) ? 'ativo' : undefined}
                        onClick={() => mudar({ categoria: String(f.id) })}>
                  {f.nome} ({f.total})
                </button>
              ))}
              <h3>Preço</h3>
              {b.facetas_preco.map((f) => {
                const valor = `${f.de}-${f.ate || ''}`
                return (
                  <button key={f.de} className={params.get('preco') === valor ? 'ativo' : undefined}
                          onClick={() => mudar({ preco: params.get('preco') === valor ? null : valor })}>
                    {f.ate ? `${brl(f.de)} a ${brl(f.ate)}` : `acima de ${brl(f.de)}`} ({f.total})
                  </button>
                )
              })}
              {params.toString() && <button className="limpar" onClick={() => { setTexto(''); setParams({}) }}>Limpar filtros</button>}
            </aside>
            <div>
              <p className="muted" role="status">{b.total} produtos</p>
              <div className="grade">
                {b.itens.map((p) => (
                  <article key={p.id} className="card-produto">
                    <ImagemProduto nome={p.nome} categoria={p.categoria.nome} />
                    <div className="corpo">
                      <Link to={`/loja/produto/${p.id}`}>{p.nome}</Link>
                      <span className="muted small">{p.categoria.nome} · {p.marca}</span>
                      <span className="small muted">a partir de</span>
                      <span className="preco">{brl(p.preco_min)}</span>
                      <span className="small">{p.qtd_avaliacoes > 0 ? `★ ${p.nota_media.toFixed(1)} (${p.qtd_avaliacoes})` : 'sem avaliações'} · {p.qtd_ofertas} oferta(s)</span>
                    </div>
                  </article>
                ))}
              </div>
              <div className="paginacao">
                <button disabled={pagina <= 1} onClick={() => mudar({ pagina: String(pagina - 1) })}>← Anterior</button>
                <span>página {pagina} de {Math.max(1, Math.ceil(b.total / b.por_pagina))}</span>
                <button disabled={pagina * b.por_pagina >= b.total} onClick={() => mudar({ pagina: String(pagina + 1) })}>Próxima →</button>
              </div>
              <details>
                <summary className="muted small">Ver o pipeline de agregação que rodou no MongoDB</summary>
                <pre className="sql">{JSON.stringify(b.pipeline, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </Async>
    </section>
  )
}
