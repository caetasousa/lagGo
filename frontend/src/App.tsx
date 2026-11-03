import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, type Carrinho } from './api/client'
import { useConta } from './conta'
import { EntrarPage } from './pages/conta/EntrarPage'
import { ContaPage } from './pages/conta/ContaPage'
import { InicioPage } from './pages/loja/InicioPage'
import { CatalogoPage } from './pages/loja/CatalogoPage'
import { ProdutoPage } from './pages/loja/ProdutoPage'
import { CarrinhoPage } from './pages/loja/CarrinhoPage'
import { PedidosPage } from './pages/loja/PedidosPage'
import { PedidoPage } from './pages/loja/PedidoPage'
import { RelatoriosPage } from './pages/RelatoriosPage'
import { LabsPage } from './pages/labs/LabsPage'
import { ConcorrenciaPage } from './pages/labs/ConcorrenciaPage'
import { IndicesPage } from './pages/labs/IndicesPage'
import { IsolamentoPage } from './pages/labs/IsolamentoPage'
import { MvccPage } from './pages/labs/MvccPage'
import { ExpurgoPage } from './pages/labs/ExpurgoPage'
import { ConexoesPage } from './pages/labs/ConexoesPage'
import { CachePage } from './pages/labs/CachePage'
import { ReplicacaoPage } from './pages/labs/ReplicacaoPage'
import { BackupPage } from './pages/labs/BackupPage'
import { HAPage } from './pages/labs/HAPage'
import { ConsistenciaPage } from './pages/labs/ConsistenciaPage'
import { GrafoPage } from './pages/labs/GrafoPage'
import { PainelDBAPage } from './pages/dba/PainelDBAPage'

// O material de estudo (docs/*.md + renderizador) só é baixado quando aberto.
const EstudoPage = lazy(() => import('./pages/estudo/EstudoPage').then((m) => ({ default: m.EstudoPage })))
const DocumentoPage = lazy(() => import('./pages/estudo/DocumentoPage').then((m) => ({ default: m.DocumentoPage })))

export function App() {
  return (
    <>
      <Cabecalho />
      <main>
        <Routes>
          <Route path="/" element={<InicioPage />} />
          <Route path="/loja" element={<CatalogoPage />} />
          <Route path="/loja/produto/:id" element={<ProdutoPage />} />
          <Route path="/carrinho" element={<CarrinhoPage />} />
          <Route path="/entrar" element={<EntrarPage modo="entrar" />} />
          <Route path="/cadastro" element={<EntrarPage modo="cadastro" />} />
          <Route path="/conta" element={<ContaPage />} />
          <Route path="/pedidos" element={<PedidosPage />} />
          <Route path="/pedidos/:id" element={<PedidoPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/lab" element={<ConcorrenciaPage />} />
          <Route path="/indices" element={<IndicesPage />} />
          <Route path="/lab/isolamento" element={<IsolamentoPage />} />
          <Route path="/lab/mvcc" element={<MvccPage />} />
          <Route path="/lab/expurgo" element={<ExpurgoPage />} />
          <Route path="/lab/conexoes" element={<ConexoesPage />} />
          <Route path="/lab/cache" element={<CachePage />} />
          <Route path="/lab/replicacao" element={<ReplicacaoPage />} />
          <Route path="/lab/backup" element={<BackupPage />} />
          <Route path="/lab/ha" element={<HAPage />} />
          <Route path="/lab/consistencia" element={<ConsistenciaPage />} />
          <Route path="/lab/grafo" element={<GrafoPage />} />
          <Route path="/dba" element={<PainelDBAPage />} />
          <Route path="/estudo" element={<Suspense fallback={<p className="muted">Carregando…</p>}><EstudoPage /></Suspense>} />
          <Route path="/estudo/:slug" element={<Suspense fallback={<p className="muted">Carregando…</p>}><DocumentoPage /></Suspense>} />
        </Routes>
      </main>
      <footer className="rodape">
        nosqlGo · loja fictícia para estudar bancos de dados. Marcas, produtos e clientes são inventados.
      </footer>
    </>
  )
}

// Os destinos do menu, em três grupos. `casa` diz quando o destino está
// ATIVO (cenário V3): um laboratório (/lab/mvcc, /indices) acende
// "Laboratórios", não só a página-índice /labs.
type Destino = { para: string; nome: string; casa: (caminho: string) => boolean }
const GRUPOS: { nome: string; destinos: Destino[] }[] = [
  { nome: 'Loja', destinos: [
    { para: '/', nome: 'Início', casa: (c) => c === '/' },
    { para: '/loja', nome: 'Catálogo', casa: (c) => c.startsWith('/loja') || c === '/carrinho' },
    { para: '/pedidos', nome: 'Meus pedidos', casa: (c) => c.startsWith('/pedidos') },
  ] },
  { nome: 'Estudo', destinos: [
    { para: '/estudo', nome: 'Material', casa: (c) => c.startsWith('/estudo') },
    { para: '/labs', nome: 'Laboratórios', casa: (c) => c === '/labs' || c === '/lab' || c.startsWith('/lab/') || c === '/indices' },
    { para: '/relatorios', nome: 'Relatórios', casa: (c) => c.startsWith('/relatorios') },
  ] },
  { nome: 'Operação', destinos: [
    { para: '/dba', nome: 'Painel do DBA', casa: (c) => c.startsWith('/dba') },
  ] },
]

// Tela estreita: a conta simulada sai da linha de busca e entra no menu
// recolhido. Renderiza o seletor UMA vez só (dois "Entrar como" na página
// confundiriam leitor de tela e testes).
const TELA_ESTREITA = '(max-width: 640px)'
function useTelaEstreita() {
  return useSyncExternalStore(
    (avisar) => { const m = matchMedia(TELA_ESTREITA); m.addEventListener('change', avisar); return () => m.removeEventListener('change', avisar) },
    () => matchMedia(TELA_ESTREITA).matches,
  )
}

function Cabecalho() {
  const navegar = useNavigate()
  const { pathname } = useLocation()
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const estreita = useTelaEstreita()
  const carrinho = useQuery({ queryKey: ['carrinho'], queryFn: () => api<Carrinho>('/carrinho') })
  const itens = carrinho.data?.itens.reduce((s, i) => s + i.quantidade, 0) ?? 0

  // Escolher um destino fecha o menu recolhido (cenário V1); Escape também.
  useEffect(() => setAberto(false), [pathname])
  useEffect(() => {
    if (!aberto) return
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', fechar)
    return () => window.removeEventListener('keydown', fechar)
  }, [aberto])

  return (
    <header className="topo">
      <div className="topo-barra">
        <Link to="/" className="marca"><Logo /><span className="nome">nosql<span>Go</span></span></Link>
        <nav aria-label="Principal" id="menu-principal" className={`menu-principal${aberto ? ' aberto' : ''}`}>
          {GRUPOS.map((g) => (
            <div key={g.nome} className="grupo-menu" role="group" aria-label={g.nome}>
              <span className="grupo" aria-hidden="true">{g.nome}</span>
              {g.destinos.map((d) => {
                const ativo = d.casa(pathname)
                return <Link key={d.para} to={d.para} aria-current={ativo ? 'page' : undefined}>{d.nome}</Link>
              })}
            </div>
          ))}
          {estreita && <div className="grupo-menu"><Conta /></div>}
        </nav>
        <NavLink to="/carrinho" className="link-carrinho" aria-label={`Carrinho (${itens})`}>
          <span aria-hidden="true">🛒</span><span className="rotulo" aria-hidden="true">Carrinho</span>
          <span className="contador" aria-hidden="true">{itens}</span>
        </NavLink>
        <button type="button" className="botao-menu" aria-expanded={aberto} aria-controls="menu-principal" onClick={() => setAberto(!aberto)}>
          <span className="barras" aria-hidden="true" />Menu
        </button>
      </div>
      <div className="topo-comandos">
        <form className="busca-topo" role="search" onSubmit={(e) => { e.preventDefault(); navegar(`/loja?busca=${encodeURIComponent(busca)}`) }}>
          <input aria-label="Busca rápida" placeholder="O que você procura? (busca no MongoDB)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button type="submit" aria-label="Buscar na loja">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </form>
        {!estreita && <Conta />}
      </div>
    </header>
  )
}

// Quem está logado (Fase 6): "Entrar" ou "Olá, Nome" levando à conta.
function Conta() {
  const { conta } = useConta()
  const { pathname } = useLocation()
  if (conta === undefined) return <span className="conta" aria-hidden="true">…</span>
  if (!conta) {
    const voltar = ['/entrar', '/cadastro', '/conta'].includes(pathname) ? '' : `?voltar=${encodeURIComponent(pathname)}`
    return <Link to={`/entrar${voltar}`} className="link-conta">Entrar</Link>
  }
  return <Link to="/conta" className="link-conta" aria-label={`Minha conta (${conta.nome})`}>Olá, {conta.nome.split(' ')[0]}</Link>
}

// Planeta com anel: a marca do tema retrofuturista (desenho próprio, decorativo).
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-planeta" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2de2e6" /><stop offset="1" stopColor="#ff4fb8" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="9" fill="url(#logo-planeta)" />
      <ellipse cx="16" cy="16" rx="15" ry="5" fill="none" stroke="#3dff8f" strokeWidth="1.6" transform="rotate(-20 16 16)" />
    </svg>
  )
}
