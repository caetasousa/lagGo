import { UsoSelo } from '../../components/usos'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, brl, post, put, type Carrinho, type DetalheProduto } from '../../api/client'
import { Async } from '../../components/Async'
import { Explicacao } from '../../components/ui'
import { ImagemProduto } from '../../components/ImagemProduto'
import { useConta } from '../../conta'

// Página do produto: três bancos na mesma tela, cada bloco com o seu selo.

export function ProdutoPage() {
  const { id } = useParams()
  const detalhe = useQuery({ queryKey: ['produto', id], queryFn: () => api<DetalheProduto>(`/catalogo/produtos/${id}`) })
  return (
    <section>
      <p className="small"><Link to="/loja">← Catálogo</Link></p>
      <Async query={detalhe}>
        {(d) => (
          <>
            <div className="produto">
              <ImagemProduto nome={d.produto.nome} categoria={d.produto.categoria.nome} />
              <div>
                <p className="muted small">{d.produto.categoria.caminho}</p>
                <h1>{d.produto.nome}</h1>
                <p className="muted">
                  {d.produto.marca} · <UsoSelo id="mongo-catalogo" />{' '}
                  <span className={`selo selo-${d.cache}`} title="cache-aside no Redis (cache:produto:id, 5 min)">cache {d.cache.toUpperCase()}</span>{' '}
                  <UsoSelo id="redis-cache" />
                </p>
                <p className="avaliacao-media">
                  {d.produto.qtd_avaliacoes > 0
                    ? `★ ${d.produto.nota_media.toFixed(2)} (${d.produto.qtd_avaliacoes} avaliações)`
                    : 'Ainda sem avaliações'}
                </p>
                <p>{d.produto.descricao}</p>
                <Explicacao frase={<>A descrição veio do <strong>MongoDB</strong>{d.cache === 'hit' ? <> — desta vez, de uma cópia guardada no <strong>Redis</strong> (por isso "cache HIT")</> : <> e foi guardada no <strong>Redis</strong> por 5 minutos para a próxima visita</>}. Preço e estoque das ofertas vêm sempre do <strong>PostgreSQL</strong>: eles não podem estar desatualizados.</>}
                            topico="8.8" doc="docs/fases/fase-3.md §2">
                  <p><strong>Cache-aside:</strong> a aplicação procura <code>cache:produto:{d.produto.id}</code> no Redis; se não acha, lê o MongoDB e grava a cópia com expiração. O banco não sabe que o cache existe.</p>
                  <p><strong>Invalidação:</strong> quando entra uma avaliação, a chave é apagada — a próxima visita é um MISS e lê a versão nova.</p>
                </Explicacao>
              </div>
            </div>
            <div className="duas-colunas">
              <div>
                <h2>Atributos <UsoSelo id="mongo-catalogo" /></h2>
                <table aria-label="Atributos">
                  <tbody>
                    {Object.entries(d.produto.atributos).map(([k, v]) => (
                      <tr key={k}><th>{k.replaceAll('_', ' ')}</th><td>{formatar(v)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Ofertas d={d} />
            </div>
            <Avaliacoes d={d} />
          </>
        )}
      </Async>
    </section>
  )
}

function formatar(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' · ')
  return String(v)
}

function Ofertas({ d }: { d: DetalheProduto }) {
  const qc = useQueryClient()
  const carrinho = useQuery({ queryKey: ['carrinho'], queryFn: () => api<Carrinho>('/carrinho') })
  const adicionar = useMutation({
    mutationFn: (sku: string) => {
      const atual = carrinho.data?.itens.find((i) => i.id === sku)?.quantidade ?? 0
      return put<Carrinho>(`/carrinho/itens/${sku}`, { quantidade: atual + 1 })
    },
    onSuccess: (c) => qc.setQueryData(['carrinho'], c),
  })
  return (
    <section aria-label="Ofertas">
      <h2>Ofertas <UsoSelo id="pg-ofertas" /></h2>
      <p className="muted small">Vários vendedores vendem o mesmo produto. Preço e estoque são lidos agora, sem cache.</p>
      <table aria-label="Ofertas">
        <thead><tr><th>Vendedor</th><th>Preço</th><th>Estoque</th><th></th></tr></thead>
        <tbody>
          {d.ofertas.map((o) => (
            <tr key={o.id}>
              <td>{o.vendedor}</td>
              <td className="num">{brl(o.preco)}</td>
              <td className="num">{o.estoque}</td>
              <td>
                <button className="primario" disabled={!o.ativo || o.estoque === 0 || adicionar.isPending}
                        onClick={() => adicionar.mutate(o.id)}>Adicionar ao carrinho</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adicionar.isSuccess && <p className="ok">Adicionado. <Link to="/carrinho">Ver carrinho</Link> <UsoSelo id="redis-carrinho" /></p>}
      {adicionar.isError && <p className="error">{adicionar.error.message}</p>}
    </section>
  )
}

function Avaliacoes({ d }: { d: DetalheProduto }) {
  const qc = useQueryClient()
  const { conta } = useConta()
  const [nota, setNota] = useState(5)
  const [texto, setTexto] = useState('')
  const avaliar = useMutation({
    mutationFn: () => post(`/catalogo/produtos/${d.produto.id}/avaliacoes`, { nota, texto }),
    onSuccess: () => {
      setTexto('')
      qc.invalidateQueries({ queryKey: ['produto', d.produto.id] })
    },
  })
  return (
    <>
      <h2>Avaliações recentes <UsoSelo id="mongo-avaliacoes" /></h2>
      <p className="muted small">As 3 últimas ficam dentro do documento do produto (padrão Subset); todas ficam na coleção <code>avaliacoes</code>.</p>
      {d.produto.avaliacoes_recentes.length === 0 && <p className="muted">Nenhuma avaliação.</p>}
      <ul className="avaliacoes" aria-label="Avaliações recentes">
        {d.produto.avaliacoes_recentes.map((a, i) => (
          <li key={i}><strong>{'★'.repeat(a.nota)}{'☆'.repeat(5 - a.nota)}</strong> {a.texto} <span className="muted small">— {a.cliente_nome}, {new Date(a.em).toLocaleDateString('pt-BR')}</span></li>
        ))}
      </ul>
      <form className="painel" onSubmit={(e) => { e.preventDefault(); avaliar.mutate() }}>
        <h3>{conta ? <>Avaliar como {conta.nome}</> : <>Avaliar — <Link to={`/entrar?voltar=/loja/produto/${d.produto.id}`}>entre na sua conta</Link> para avaliar</>}</h3>
        <Explicacao frase="Gravar a avaliação e atualizar a média do produto acontece numa transação: ou as duas mudanças entram, ou nenhuma.">
          <p>Transação multi-documento do MongoDB (exige replica set). A média nova é calculada no servidor por um update com pipeline: <code>(média × n + nota) / (n + 1)</code>.</p>
        </Explicacao>
        <label>Nota
          <select value={nota} onChange={(e) => setNota(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Comentário
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} />
        </label>
        {/* Só quem entrou avalia (Fase 6): a avaliação é sempre da conta logada. */}
        <button className="primario" type="submit" disabled={avaliar.isPending || !conta}>Enviar avaliação</button>
        {avaliar.isError && <p className="error">{avaliar.error.message}</p>}
      </form>
    </>
  )
}
