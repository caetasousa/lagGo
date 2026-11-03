import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAcoesDaConta, useConta } from '../../conta'
import { UsoSelo } from '../../components/usos'
import { Conclusao, Explicacao, Titulo } from '../../components/ui'

// Minha conta (Fase 6, cenário Q6): dados mascarados, sair e o "direito ao
// esquecimento" da LGPD.

export function ContaPage() {
  const { conta } = useConta()
  const { sair, excluir } = useAcoesDaConta()
  const navegar = useNavigate()
  const [confirmar, setConfirmar] = useState(false)
  if (conta === null) return <Navigate to="/entrar?voltar=/conta" replace />
  if (!conta) return <p className="muted">Carregando…</p>
  return (
    <section className="conta-pagina">
      <Titulo titulo="Minha conta">
        <p className="muted">Olá, <strong>{conta.nome}</strong>. <Link to="/pedidos">Ver meus pedidos</Link></p>
      </Titulo>
      <Explicacao frase="A tela da conta recebe seus dados já mascarados: nem o e-mail inteiro nem o CPF saem do banco para cá."
                  topico="8.12" doc="docs/10-seguranca-governanca.md">
        <p>O CPF está cifrado na coluna <code>cliente.cpf_cifrado</code> (<code>pgp_sym_encrypt</code>, do pgcrypto); só a API, com a chave, o decifra. Para saber se um CPF já tem conta existe um <code>HMAC</code> do CPF com <code>UNIQUE</code> — compara sem decifrar ninguém. Esta tela lê a visão <code>conta.v_cliente_mascarado</code>. <UsoSelo id="pg-contas" /></p>
      </Explicacao>

      <dl className="stats" aria-label="Meus dados">
        <div><dt>E-mail</dt><dd>{conta.email_mascarado}</dd></div>
        <div><dt>CPF</dt><dd>{conta.cpf_mascarado || '—'}</dd></div>
        <div><dt>Entrega em</dt><dd>{conta.cidade}/{conta.uf}</dd></div>
      </dl>

      <div className="form-linha">
        <button onClick={() => sair.mutate(undefined, { onSuccess: () => navegar('/') })} disabled={sair.isPending}>Sair da conta</button>
      </div>

      <h2>Excluir minha conta <UsoSelo id="pg-contas" /></h2>
      <Explicacao frase="A LGPD dá o direito de pedir a eliminação dos seus dados. Os pedidos ficam (a lei fiscal manda guardar), mas deixam de apontar para você."
                  topico="8.12" doc="docs/10-seguranca-governanca.md">
        <p>Uma <em>procedure</em> (<code>conta.esquecer_cliente</code>) troca nome, e-mail e CPF por valores anônimos, apaga o endereço de entrega e a senha — tudo numa transação. Depois a API encerra todas as suas sessões no Redis e troca seu nome nas avaliações do MongoDB por "Cliente removido". Não existe transação entre os três bancos: a ordem foi pensada para, se algo falhar no meio, ninguém conseguir mais entrar na conta.</p>
      </Explicacao>
      <div className="painel">
        <label className="inline"><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
          Entendo que não dá para desfazer</label>
        <button className="perigo" disabled={!confirmar || excluir.isPending}
                onClick={() => excluir.mutate(undefined, { onSuccess: () => navegar('/') })}>Excluir minha conta</button>
        {excluir.isError && <p className="error" role="alert">{excluir.error.message}</p>}
      </div>
      <Conclusao tipo="neutra" titulo="O que fica e o que some">
        Some: nome, e-mail, CPF, endereço, senha, sessões e seu nome nas avaliações. Fica: os pedidos (valores, itens, cidade/UF) ligados a um "Cliente removido" — sem identificar ninguém.
      </Conclusao>
    </section>
  )
}
