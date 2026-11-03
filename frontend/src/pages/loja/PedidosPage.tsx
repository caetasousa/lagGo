import { UsoSelo } from '../../components/usos'
import { Link, Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, brl, type PedidoResumo } from '../../api/client'
import { Async } from '../../components/Async'
import { Explicacao, Titulo } from '../../components/ui'
import { useConta } from '../../conta'

export function PedidosPage() {
  const { conta } = useConta()
  const pedidos = useQuery({
    queryKey: ['meus-pedidos', conta?.cliente_id],
    queryFn: () => api<PedidoResumo[]>('/conta/pedidos?limite=30'),
    enabled: !!conta,
  })
  if (conta === null) return <Navigate to="/entrar?voltar=/pedidos" replace />
  return (
    <section>
      <Titulo titulo="Meus pedidos">
        <p className="muted">de <strong>{conta?.nome ?? '…'}</strong> <UsoSelo id="pg-pedidos" /> <UsoSelo id="pg-rls" /></p>
      </Titulo>
      <Explicacao frase="Os pedidos de um cliente, do mais novo para o mais antigo. Parece simples — e só é rápido porque existe um índice certo para esta pergunta."
                  topico="8.5" doc="docs/04-indices-otimizacao.md">
        <p>Consulta: <code>WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 30</code>.</p>
        <p><strong>Fase 6 — Row-Level Security:</strong> a consulta roda com o papel <code>loja_cliente</code> e o banco sabe quem é você (<code>set_config('app.cliente_id', …)</code>). Uma <em>policy</em> só libera os seus pedidos: mesmo que o <code>WHERE</code> sumisse do código, o PostgreSQL não devolveria o pedido de outra pessoa.</p>
        <p>O índice composto <code>(cliente_id, criado_em DESC)</code> encontra as linhas do cliente <em>já na ordem</em>: sem ele, o PostgreSQL leria os 100 mil pedidos (Seq Scan). Veja o experimento 1 do <Link to="/indices">Laboratório de Índices</Link>.</p>
      </Explicacao>
      <Async query={pedidos}>
        {(ps) => ps.length === 0 ? <p className="muted">Nenhum pedido ainda.</p> : (
          <table aria-label="Meus pedidos">
            <thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Situação</th></tr></thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/pedidos/${p.id}`}><code>{p.id.slice(0, 8)}</code></Link></td>
                  <td>{new Date(p.criado_em).toLocaleString('pt-BR')}</td>
                  <td className="num">{p.itens}</td>
                  <td className="num">{brl(p.total)}</td>
                  <td><span className={`etiqueta ${p.status.toLowerCase()}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>
    </section>
  )
}
