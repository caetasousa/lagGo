import { UsoSelo } from '../../components/usos'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, brl, type Busca, type Categoria, type MaisVendido, type Visto } from '../../api/client'
import { useConta } from '../../conta'
import { Explicacao } from '../../components/ui'
import { ImagemProduto, iconeCategoria } from '../../components/ImagemProduto'

// Vitrine: cada bloco diz de qual banco veio — é a página que apresenta a ideia
// do projeto (persistência poliglota).

export function InicioPage() {
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<Categoria[]>('/loja/categorias') })
  const maisVendidos = useQuery({ queryKey: ['mais-vendidos'], queryFn: () => api<MaisVendido[]>('/catalogo/mais-vendidos?limite=6') })
  const avaliados = useQuery({ queryKey: ['bem-avaliados'], queryFn: () => api<Busca>('/catalogo/produtos?ordenar=avaliacao&por_pagina=6') })

  return (
    <>
      <section className="hero">
        <div>
          <h1>Uma loja para estudar bancos de dados</h1>
          <p>
            Navegue e compre como numa loja de verdade. Cada parte da tela vem do banco mais adequado ao problema —
            os selos mostram qual. Os <Link to="/labs">laboratórios</Link> mostram o que acontece por dentro.
          </p>
        </div>
        <div className="mapa-bancos" aria-label="Quem guarda o quê">
          <div><strong>🐘 PostgreSQL</strong><span>pedidos, estoque, pagamentos — precisam de transação (ACID)</span></div>
          <div><strong>🍃 MongoDB</strong><span>catálogo: cada produto tem atributos diferentes</span></div>
          <div><strong>🟥 Redis</strong><span>carrinho, cache e ranking — rápido e temporário</span></div>
          <div><strong>👁️ 🕸️ Cassandra e Neo4j</strong><span>eventos e recomendações (em breve)</span></div>
        </div>
      </section>

      <h2>Categorias <UsoSelo id="pg-categorias" /></h2>
      <Explicacao frase="A árvore de categorias é uma tabela que aponta para si mesma (pai_id). Uma consulta recursiva monta os caminhos e soma os produtos das subcategorias.">
        <p><code>WITH RECURSIVE arvore AS (… UNION ALL …)</code> em <code>db/queries/relatorios.sql</code> (ArvoreCategorias).</p>
      </Explicacao>
      <div className="grade-categorias">
        {categorias.data?.filter((c) => c.nivel === 2).map((c) => (
          <Link key={c.id} to={`/loja?categoria=${c.id}`} className="categoria">
            <span className="icone" aria-hidden="true">{iconeCategoria(c.nome === 'Informática' ? 'Notebooks' : c.nome === 'Técnicos' ? 'Bancos de Dados' : c.nome === 'Masculino' ? 'Masculino' : c.nome)}</span>
            <strong>{c.nome}</strong>
            <span className="muted small">{c.caminho.split(' > ')[0]} · {c.skus} ofertas</span>
          </Link>
        ))}
      </div>

      <VistosRecentes />

      <h2>Mais vendidos <UsoSelo id="redis-ranking" /></h2>
      <p className="muted small">Um <em>sorted set</em>: cada compra soma pontos ao produto (ZINCRBY); a vitrine lê os maiores (ZREVRANGE).</p>
      <div className="carrossel" aria-label="Mais vendidos">
        {maisVendidos.data?.map((m) => (
          <article key={m.sku_id} className="card-produto">
            <ImagemProduto nome={m.nome} categoria="" />
            <div className="corpo">
              <Link to={`/loja/produto/${m.produto_id}`}>{m.nome}</Link>
              <span className="muted small">{m.vendidos} vendidos</span>
            </div>
          </article>
        ))}
      </div>

      <h2>Mais bem avaliados <UsoSelo id="mongo-catalogo" /></h2>
      <p className="muted small">A média fica guardada <em>dentro</em> do documento do produto (padrão Computed): ordenar por ela não exige ler as avaliações.</p>
      <div className="carrossel">
        {avaliados.data?.itens.map((p) => (
          <article key={p.id} className="card-produto">
            <ImagemProduto nome={p.nome} categoria={p.categoria.nome} />
            <div className="corpo">
              <Link to={`/loja/produto/${p.id}`}>{p.nome}</Link>
              <span className="preco">{brl(p.preco_min)}</span>
              <span className="small">★ {p.nota_media.toFixed(1)} ({p.qtd_avaliacoes})</span>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

// "Vistos recentemente" (Fase 7, Cassandra): só para quem entrou. Cada produto
// aberto é um evento numa partição do cliente, com TTL de 30 dias.
function VistosRecentes() {
  const { conta } = useConta()
  const q = useQuery({ queryKey: ['vistos', conta?.cliente_id], queryFn: () => api<Visto[]>('/conta/vistos'), enabled: !!conta, retry: false })
  if (!conta) return null
  return (
    <>
      <h2>Vistos recentemente <UsoSelo id="cassandra-vistos" /></h2>
      <p className="muted small">Uma partição do Cassandra por cliente, já em ordem (mais novo primeiro); cada visita some sozinha em 30 dias (TTL).</p>
      {q.isError && <p className="muted small">Histórico indisponível agora ({q.error.message}).</p>}
      {q.data && q.data.length === 0 && <p className="muted small">Abra alguns produtos: eles aparecem aqui.</p>}
      {q.data && q.data.length > 0 && (
        <ul className="carrossel lista-limpa" aria-label="Vistos recentemente">
          {q.data.map((v) => (
            <li key={v.produto_id} className="card-produto">
              <ImagemProduto nome={v.nome} categoria="" />
              <div className="corpo">
                <Link to={`/loja/produto/${v.produto_id}`}>{v.nome}</Link>
                <span className="muted small">visto em {new Date(v.em).toLocaleString('pt-BR')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
