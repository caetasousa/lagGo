import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useAcoesDaConta, useConta, type Cadastro } from '../../conta'
import { UsoSelo } from '../../components/usos'
import { Explicacao, Titulo } from '../../components/ui'

// Entrar e criar conta (Fase 6, cenários Q1–Q3). Depois de entrar, volta para
// onde a pessoa estava (?voltar=/carrinho, por exemplo).

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

export function EntrarPage({ modo }: { modo: 'entrar' | 'cadastro' }) {
  const { conta } = useConta()
  const [params] = useSearchParams()
  const voltar = params.get('voltar')?.startsWith('/') ? params.get('voltar')! : '/conta'
  if (conta) return <Navigate to={voltar} replace />
  const sufixo = params.get('voltar') ? `?voltar=${encodeURIComponent(voltar)}` : ''
  return (
    <section className="conta-pagina">
      <Titulo titulo={modo === 'entrar' ? 'Entrar' : 'Criar conta'}>
        <p className="muted">
          {modo === 'entrar'
            ? <>Ainda não tem conta? <Link to={`/cadastro${sufixo}`}>Criar conta</Link></>
            : <>Já tem conta? <Link to={`/entrar${sufixo}`}>Entrar</Link></>}
        </p>
      </Titulo>
      <Explicacao frase={<>Sua senha nunca é guardada: o banco recebe só um <strong>hash argon2id</strong>, e o login vira uma <strong>sessão no Redis</strong> que vence sozinha em 7 dias.</>}
                  topico="8.12" doc="docs/10-seguranca-governanca.md">
        <p><strong>Senha:</strong> a API calcula o argon2id (lento de propósito, gasta 19 MiB por tentativa — caro de atacar em massa) com um sal aleatório. A tabela <code>conta.credencial</code> tem uma <code>CHECK</code> que recusa qualquer coisa que não seja esse hash. <UsoSelo id="pg-contas" /></p>
        <p><strong>Sessão:</strong> um token aleatório de 256 bits vai num cookie <code>HttpOnly</code> (o JavaScript da página não o lê) e <code>SameSite=Lax</code> (outro site não o usa). O Redis guarda o <em>hash</em> do token, com TTL. <UsoSelo id="redis-sessao" /></p>
        <p><strong>Login errado:</strong> e-mail inexistente e senha errada dão a mesma mensagem e levam o mesmo tempo — senão a tela contaria quem é cliente.</p>
      </Explicacao>
      {modo === 'entrar' ? <FormEntrar voltar={voltar} /> : <FormCadastro voltar={voltar} />}
    </section>
  )
}

function FormEntrar({ voltar }: { voltar: string }) {
  const { entrar } = useAcoesDaConta()
  const navegar = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    entrar.mutate({ email, senha }, { onSuccess: () => navegar(voltar) })
  }
  return (
    <form className="painel form-conta" onSubmit={enviar} aria-label="Entrar">
      <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Senha<input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
      <button type="submit" className="primario" disabled={entrar.isPending}>{entrar.isPending ? 'Entrando…' : 'Entrar na conta'}</button>
      {entrar.isError && <p className="error" role="alert">{entrar.error.message}</p>}
    </form>
  )
}

function FormCadastro({ voltar }: { voltar: string }) {
  const { cadastrar } = useAcoesDaConta()
  const navegar = useNavigate()
  const [d, setD] = useState<Cadastro>({ nome: '', email: '', senha: '', cpf: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', cidade: '', uf: 'SP' } })
  const campo = (k: 'nome' | 'email' | 'senha' | 'cpf') => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  const end = (k: keyof Cadastro['endereco']) => (e: { target: { value: string } }) => setD({ ...d, endereco: { ...d.endereco, [k]: e.target.value } })
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    cadastrar.mutate(d, { onSuccess: () => navegar(voltar) })
  }
  return (
    <form className="painel form-conta" onSubmit={enviar} aria-label="Criar conta">
      <fieldset>
        <legend>Você</legend>
        <label>Nome completo<input autoComplete="name" required value={d.nome} onChange={campo('nome')} /></label>
        <label>E-mail<input type="email" autoComplete="email" required value={d.email} onChange={campo('email')} /></label>
        <label>Senha <span className="muted small">(mínimo 10 caracteres)</span>
          <input type="password" autoComplete="new-password" required minLength={10} value={d.senha} onChange={campo('senha')} /></label>
        <label>CPF <span className="muted small">(guardado cifrado; a tela só mostra os 2 últimos dígitos)</span>
          <input inputMode="numeric" required placeholder="000.000.000-00" value={d.cpf} onChange={campo('cpf')} /></label>
      </fieldset>
      <fieldset>
        <legend>Endereço de entrega</legend>
        <label>CEP<input inputMode="numeric" autoComplete="postal-code" required placeholder="00000-000" value={d.endereco.cep} onChange={end('cep')} /></label>
        <label>Logradouro<input autoComplete="address-line1" required value={d.endereco.logradouro} onChange={end('logradouro')} /></label>
        <div className="form-linha">
          <label>Número<input required value={d.endereco.numero} onChange={end('numero')} /></label>
          <label>Complemento<input value={d.endereco.complemento} onChange={end('complemento')} /></label>
        </div>
        <div className="form-linha">
          <label>Cidade<input autoComplete="address-level2" required value={d.endereco.cidade} onChange={end('cidade')} /></label>
          <label>UF<select value={d.endereco.uf} onChange={end('uf')}>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        </div>
      </fieldset>
      <p className="muted small">Dados fictícios bastam: é uma loja de estudo. O CPF precisa ter dígitos verificadores válidos.</p>
      <button type="submit" className="primario" disabled={cadastrar.isPending}>{cadastrar.isPending ? 'Criando…' : 'Criar minha conta'}</button>
      {cadastrar.isError && <p className="error" role="alert">{cadastrar.error.message}</p>}
    </form>
  )
}
