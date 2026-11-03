import { UsoSelo } from './usos'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, brl, type PedidoDetalhe } from '../api/client'
import { Async } from './Async'


// Pedido lido de volta do PostgreSQL depois do checkout.
export function PedidoCard({ id }: { id: string }) {
  const pedido = useQuery({ queryKey: ['pedido', id], queryFn: () => api<PedidoDetalhe>(`/conta/pedidos/${id}`) })
  return (
    <div className="painel">
      <h2>Pedido criado <UsoSelo id="pg-pedidos" /></h2>
      <Async query={pedido}>
        {(p) => (
          <>
            <p><span className={`etiqueta ${p.status.toLowerCase()}`}>{p.status}</span> · {p.cliente} · {p.cidade}/{p.uf}</p>
            <ul className="carrinho">
              {p.itens.map((i) => (
                <li key={i.numero}><span>#{i.numero} {i.quantidade}× {i.descricao}</span><span>{brl(i.subtotal)}</span></li>
              ))}
              <li className="total"><span>Total</span><span>{brl(p.total)}</span></li>
            </ul>
            {p.pagamentos.map((pg) => (
              <p key={pg.id} className="muted small">Pagamento {pg.metodo} {brl(pg.valor)}: {pg.status}</p>
            ))}
            <p className="small"><Link to={`/pedidos/${p.id}`}>Ver o pedido</Link> · <Link to="/pedidos">Meus pedidos</Link></p>
          </>
        )}
      </Async>
    </div>
  )
}
