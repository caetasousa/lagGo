import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, sessao } from './api/client'

// A conta logada (Fase 6). O token da sessão mora num cookie HttpOnly que o
// JavaScript NÃO lê (um XSS não rouba a sessão): para saber quem está logado,
// a página pergunta à API (GET /api/conta/eu). 401 = ninguém logado.

export type Conta = {
  cliente_id: string
  nome: string
  email: string
  email_mascarado: string
  cpf_mascarado?: string
  endereco_id: string
  cidade: string
  uf: string
}

export type Cadastro = {
  nome: string; email: string; senha: string; cpf: string
  endereco: { cep: string; logradouro: string; numero: string; complemento?: string; cidade: string; uf: string }
}

async function quemSou(): Promise<Conta | null> {
  const res = await fetch('/api/conta/eu', { headers: { 'X-Sessao': sessao } })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** conta: undefined enquanto carrega, null se ninguém entrou. */
export function useConta(): { conta: Conta | null | undefined } {
  const q = useQuery({ queryKey: ['conta'], queryFn: quemSou, staleTime: 60_000 })
  return { conta: q.data }
}

/** Entrar, cadastrar e sair: ao terminar, tudo que depende de quem está logado é relido. */
export function useAcoesDaConta() {
  const qc = useQueryClient()
  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['conta'] })
    qc.invalidateQueries({ queryKey: ['meus-pedidos'] })
    qc.removeQueries({ queryKey: ['pedido'] })
  }
  return {
    entrar: useMutation({ mutationFn: (d: { email: string; senha: string }) => post<Conta>('/conta/entrar', d), onSuccess: recarregar }),
    cadastrar: useMutation({ mutationFn: (d: Cadastro) => post<Conta>('/conta/cadastro', d), onSuccess: recarregar }),
    sair: useMutation({ mutationFn: () => post<null>('/conta/sair', {}), onSuccess: recarregar }),
    excluir: useMutation({ mutationFn: () => api<null>('/conta', { method: 'DELETE' }), onSuccess: recarregar }),
  }
}
