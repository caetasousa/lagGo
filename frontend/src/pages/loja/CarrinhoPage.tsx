import { UsoSelo } from '../../components/usos'
import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, brl, del, novoUUID, post, put, sessao, type Carrinho, type CheckoutResultado } from '../../api/client'
import { Async } from '../../components/Async'
import { PedidoCard } from '../../components/PedidoCard'
import { Explicacao, Titulo } from '../../components/ui'
import { useConta } from '../../conta'

// Carrinho no Redis (HASH carrinho:{sessao}, TTL de 7 dias). Os preços exibidos
// são os vigentes (PostgreSQL); o total definitivo é calculado no checkout.

export function CarrinhoPage() {
  const qc = useQueryClient()
  const carrinho = useQuery({ queryKey: ['carrinho'], queryFn: () => api<Carrinho>('/carrinho') })
  const [pedidoId, setPedidoId] = useState<string | null>(null)

  const definir = useMutation({
    mutationFn: ({ sku, quantidade }: { sku: string; quantidade: number }) =>
      put<Carrinho>(`/carrinho/itens/${sku}`, { quantidade }),
    onSuccess: (c) => qc.setQueryData(['carrinho'], c),
  })
  const esvaziar = useMutation({
    mutationFn: () => del('/carrinho'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carrinho'] }),
  })

  return (
    <section>
      <Titulo titulo="Carrinho" />
      <Explicacao frase={<>O carrinho mora no <strong>Redis</strong>: é rápido, é temporário (some sozinho em 7 dias sem uso) e não precisa de transação. Ao finalizar, o pedido vai para o <strong>PostgreSQL</strong>, numa transação ACID.</>}
                  topico="8.8 · 8.4" doc="docs/fases/fase-3.md §2">
        <p>Chave <code>carrinho:{sessao}</code>, um HASH <code>sku → quantidade</code>. Cada alteração renova o TTL.</p>
        <p>Ao finalizar: (1) o PostgreSQL grava pedido, itens, pagamento e baixa o estoque numa transação; (2) <em>só depois do COMMIT</em>, o Redis esvazia o carrinho, soma o ranking e publica no stream de pedidos. Não existe transação entre bancos diferentes — se o Redis falhar no passo 2, o pedido continua válido.</p>
        <p>A <code>Idempotency-Key</code> garante que um duplo clique não vire duas compras.</p>
      </Explicacao>
      <Async query={carrinho}>
        {(c) => c.itens.length === 0 ? (
          <>
            <p>Seu carrinho está vazio. <Link to="/loja">Ir para o catálogo</Link></p>
            {pedidoId && <PedidoCard id={pedidoId} />}
          </>
        ) : (
          <div className="loja">
            <div>
              <h2>Itens <UsoSelo id="redis-carrinho" /> <span className="muted small">preços e estoque:</span> <UsoSelo id="pg-ofertas" /></h2>
              <table aria-label="Itens do carrinho">
                <thead><tr><th>Item</th><th>Vendedor</th><th>Preço</th><th>Quantidade</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                  {c.itens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.produto_id ? <Link to={`/loja/produto/${i.produto_id}`}>{i.descricao}</Link> : i.descricao}</td>
                      <td>{i.vendedor}</td>
                      <td className="num">{brl(i.preco)}</td>
                      <td>
                        <input type="number" min={0} max={99} value={i.quantidade} aria-label={`Quantidade de ${i.descricao}`}
                               onChange={(e) => definir.mutate({ sku: i.id, quantidade: Number(e.target.value) })} />
                        {i.quantidade > i.estoque && <span className="error small"> só {i.estoque} em estoque</span>}
                      </td>
                      <td className="num">{brl(i.preco * i.quantidade)}</td>
                      <td><button className="perigo" onClick={() => definir.mutate({ sku: i.id, quantidade: 0 })} aria-label={`Remover ${i.descricao}`}>Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="total-carrinho">Total estimado: <strong>{brl(c.itens.reduce((s, i) => s + i.preco * i.quantidade, 0))}</strong></p>
              <p className="muted small">
                Expira em {Math.round(c.ttl_segundos / 86400)} dia(s) sem alterações.{' '}
                <button onClick={() => esvaziar.mutate()}>Esvaziar carrinho</button>
              </p>
            </div>
            <aside>
              <Finalizar onPedido={setPedidoId} />
              {pedidoId && <PedidoCard id={pedidoId} />}
            </aside>
          </div>
        )}
      </Async>
    </section>
  )
}

function Finalizar({ onPedido }: { onPedido: (id: string) => void }) {
  const qc = useQueryClient()
  const { conta } = useConta()
  const [metodo, setMetodo] = useState('PIX')
  // Uma chave por intenção de compra: duplo clique ou nova tentativa após
  // timeout reaproveitam o mesmo pedido. Trocada só depois do sucesso.
  const [chave, setChave] = useState(() => novoUUID())

  const finalizar = useMutation({
    mutationFn: () => post<CheckoutResultado>('/carrinho/finalizar',
      { metodo_pagamento: metodo }, { 'Idempotency-Key': chave }),
    onSuccess: (r) => {
      onPedido(r.pedido_id)
      setChave(novoUUID())
      qc.invalidateQueries({ queryKey: ['carrinho'] })
      qc.invalidateQueries({ queryKey: ['mais-vendidos'] })
      qc.invalidateQueries({ queryKey: ['produto'] })
      qc.invalidateQueries({ queryKey: ['meus-pedidos'] })
    },
  })
  return (
    <div className="painel">
      <h2>Finalizar</h2>
      {conta === null
        ? <p className="small">Para finalizar, <Link to="/entrar?voltar=/carrinho">entre na sua conta</Link> ou <Link to="/cadastro?voltar=/carrinho">crie uma</Link>. O carrinho fica guardado. <UsoSelo id="redis-sessao" /></p>
        : <p className="small">Comprando como <strong>{conta?.nome ?? '…'}</strong> · entrega em {conta?.cidade}/{conta?.uf}</p>}
      <label>Pagamento
        <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          <option>PIX</option><option>CARTAO</option><option>BOLETO</option>
        </select>
      </label>
      <p className="muted small">Idempotency-Key: <code>{chave}</code></p>
      <button className="primario" disabled={!conta || finalizar.isPending} onClick={() => finalizar.mutate()}>
        {finalizar.isPending ? 'Processando…' : 'Finalizar compra'}
      </button>
      {finalizar.isError && <p className="error" role="alert">{finalizar.error.message}</p>}
    </div>
  )
}
