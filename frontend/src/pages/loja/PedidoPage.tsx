import { UsoSelo } from '../../components/usos'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, brl, type PedidoDetalhe } from '../../api/client'
import { Async } from '../../components/Async'
import { Explicacao, Titulo } from '../../components/ui'

const ETAPAS = ['PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE']

export function PedidoPage() {
  const { id } = useParams()
  const pedido = useQuery({ queryKey: ['pedido', id], queryFn: () => api<PedidoDetalhe>(`/conta/pedidos/${id}`) })
  return (
    <section>
      <p className="small"><Link to="/pedidos">← Meus pedidos</Link></p>
      <Async query={pedido}>
        {(p) => {
          const etapa = ETAPAS.indexOf(p.status)
          return (
            <>
              <Titulo titulo={`Pedido ${p.id.slice(0, 8)}`}>
                <p className="muted">{new Date(p.criado_em).toLocaleString('pt-BR')} · {p.cliente} · entrega em {p.cidade}/{p.uf} <UsoSelo id="pg-pedidos" /></p>
              </Titulo>
              {p.status === 'CANCELADO'
                ? <p><span className="etiqueta cancelado">CANCELADO</span></p>
                : (
                  <div className="linha-do-tempo" aria-label="Situação do pedido">
                    {ETAPAS.map((e, i) => <div key={e} className={i <= etapa ? 'feito' : undefined}>{e}</div>)}
                  </div>
                )}
              <Explicacao frase="Pedido, itens e pagamento são linhas de três tabelas ligadas por chave estrangeira. O preço de cada item é o do momento da compra — se o vendedor mudar o preço amanhã, este pedido não muda.">
                <p>O total é um atributo derivado (soma dos itens), mantido por um <em>trigger</em> a cada item gravado. Toda mudança neste pedido fica na auditoria (Painel do DBA → Auditoria).</p>
              </Explicacao>
              <table aria-label="Itens do pedido">
                <thead><tr><th>#</th><th>Item</th><th>Qtd.</th><th>Preço na compra</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {p.itens.map((i) => (
                    <tr key={i.numero}>
                      <td>{i.numero}</td><td>{i.descricao}</td><td className="num">{i.quantidade}</td>
                      <td className="num">{brl(i.preco_unitario)}</td><td className="num">{brl(i.subtotal)}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={4} className="subtotal">Total</td><td className="num subtotal">{brl(p.total)}</td></tr>
                </tbody>
              </table>
              <h2>Pagamento</h2>
              {p.pagamentos.length === 0 && <p className="muted">Sem pagamento registrado.</p>}
              {p.pagamentos.map((pg) => <p key={pg.id}>{pg.metodo} · {brl(pg.valor)} · <strong>{pg.status}</strong></p>)}
            </>
          )
        }}
      </Async>
    </section>
  )
}
