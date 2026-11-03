import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// O que os testes recebem além da página: `api`, para PREPARAR o cenário pela
// API (criar pedido, ler números) sem passar pela tela — a tela é o que se testa.

/** Uma conta de verdade (Fase 6), com o seu próprio contexto de requisições:
 *  o cookie da sessão mora em `r`, separado das outras contas do teste. */
export interface Conta { id: string; nome: string; email: string; senha: string; endereco_id: string; r: APIRequestContext }

/** CPF com dígitos verificadores válidos (o cadastro confere, cenário Q1). */
export function cpfValido(): string {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
    for (const n of [9, 10]) {
      let soma = 0
      for (let i = 0; i < n; i++) soma += d[i] * (n + 1 - i)
      d.push((soma * 10) % 11 % 10)
    }
    if (new Set(d).size > 1) return d.join('')
  }
}

export function dadosDeCadastro(nome = 'Teste E2E') {
  return {
    nome, email: `e2e-${randomUUID()}@exemplo.com`, senha: 'senha-de-teste-e2e', cpf: cpfValido(),
    endereco: { cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', cidade: 'São Paulo', uf: 'SP' },
  }
}
export interface Sku { id: string; descricao: string; preco: number; estoque: number }

export class Api {
  private readonly contextos: APIRequestContext[] = []
  constructor(private readonly r: APIRequestContext, private readonly novoContexto: () => Promise<APIRequestContext>) {}

  /** Cria uma conta pela API (POST /api/conta/cadastro) num contexto próprio:
   *  as compras e avaliações feitas por ela saem em nome dela (Fase 6). */
  async novaConta(nome = 'Teste E2E'): Promise<Conta> {
    const r = await this.novoContexto()
    this.contextos.push(r)
    const dados = dadosDeCadastro(nome)
    const res = await r.post('/api/conta/cadastro', { data: dados })
    expect(res.status(), `cadastro → ${res.status()} ${await res.text()}`).toBe(201)
    const c = await res.json()
    return { id: c.cliente_id, nome: c.nome, email: dados.email, senha: dados.senha, endereco_id: c.endereco_id, r }
  }

  async descartar() {
    await Promise.all(this.contextos.map((c) => c.dispose()))
  }

  async json<T>(caminho: string): Promise<T> {
    const res = await this.r.get(`/api${caminho}`)
    expect(res.ok(), `GET ${caminho} → ${res.status()}`).toBeTruthy()
    return res.json() as Promise<T>
  }

  async post<T>(caminho: string, corpo: unknown, headers: Record<string, string> = {}): Promise<{ status: number; corpo: T }> {
    const res = await this.r.post(`/api${caminho}`, { data: corpo, headers })
    return { status: res.status(), corpo: (await res.json().catch(() => null)) as T }
  }


  /** SKUs com estoque folgado, fora o do laboratório (que os labs disputam). */
  async skusComEstoque(n = 3): Promise<Sku[]> {
    const skus = await this.json<Sku[]>('/loja/skus?limite=200')
    return skus.filter((s) => s.estoque >= 20 && !s.id.startsWith('11111111')).slice(0, n)
  }

  /** Produtos do catálogo (MongoDB), mais baratos primeiro, sem o SKU do laboratório. */
  async produtos(filtro = ''): Promise<{ id: string; nome: string }[]> {
    const b = await this.json<{ itens: { id: string; nome: string }[] }>(`/catalogo/produtos?ordenar=preco_asc&por_pagina=60${filtro}`)
    return b.itens.filter((p) => p.nome !== 'Console Edição Limitada')
  }

  async detalhe(id: string) {
    return this.json<{ ofertas: { id: string; estoque: number; preco: number }[] }>(`/catalogo/produtos/${id}`)
  }

  /** Um produto cuja oferta mais barata tem estoque dentro da faixa. */
  async produtoComEstoque(min: number, max = 1e9, pular = 0) {
    let achados = 0
    for (const p of await this.produtos()) {
      const d = await this.detalhe(p.id)
      const o = d.ofertas[0]
      if (o && o.estoque >= min && o.estoque <= max && achados++ >= pular) return { ...p, oferta: o }
    }
    throw new Error(`nenhum produto com estoque entre ${min} e ${max}`)
  }

  /** Requisições com uma sessão de carrinho própria (header X-Sessao). */
  carrinho(sessao = randomUUID()) {
    const h = { 'X-Sessao': sessao }
    return {
      sessao,
      definir: (sku: string, quantidade: number) => this.r.put(`/api/carrinho/itens/${sku}`, { data: { quantidade }, headers: h }),
      // Finaliza COMO a conta (o cookie dela) o carrinho desta sessão (X-Sessao).
      finalizar: (conta: Conta, chave = randomUUID()) => conta.r.post('/api/carrinho/finalizar', {
        data: { metodo_pagamento: 'PIX' },
        headers: { ...h, 'Idempotency-Key': chave },
      }),
    }
  }

  /** Checkout direto (Fase 1) como a conta, com uma Idempotency-Key nova. */
  async comprar(conta: Conta, itens: { sku_id: string; quantidade: number }[]) {
    const res = await conta.r.post('/api/checkout', {
      data: { metodo_pagamento: 'PIX', itens }, headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(res.status(), `checkout → ${res.status()} ${await res.text()}`).toBe(201)
    return (await res.json()) as { pedido_id: string; total: number }
  }
}

export const test = base.extend<{ api: Api }>({
  api: async ({ request, playwright, baseURL }, use) => {
    const api = new Api(request, () => playwright.request.newContext({ baseURL }))
    await use(api)
    await api.descartar()
  },
})

/** Entra no navegador com a conta: copia o cookie de sessão do contexto da
 *  conta para a página (o mesmo que o formulário "Entrar" faria). */
export async function entrar(page: Page, conta: Conta) {
  const { cookies } = await conta.r.storageState()
  await page.context().addCookies(cookies)
}

export { expect, type Page }

/** Cartão do Painel do DBA pelo nome do banco. */
export function cartaoBanco(page: Page, nome: string) {
  return page.locator('.card').filter({ has: page.locator('.card-title', { hasText: new RegExp(`^${nome}$`) }) })
}

/** Abre a página do produto e devolve o selo de cache e a primeira oferta. */
export async function abrirProduto(page: Page, id: string) {
  await page.goto(`/loja/produto/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return {
    selo: page.locator('.selo'),
    estoque: page.getByRole('table', { name: 'Ofertas' }).locator('tbody tr').first().locator('td').nth(2),
  }
}

// O ícone 🛒 é decorativo (aria-hidden): o nome acessível do link é "Carrinho (n)".
export const itensNoCarrinho = (page: Page) => page.getByRole('link', { name: /^Carrinho \(\d+\)$/ })

/** Clica em "Adicionar ao carrinho" e ESPERA a confirmação: navegar antes
 *  disso cancelaria o PUT no meio e o item não chegaria ao Redis. */
export async function adicionarAoCarrinho(page: Page) {
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).first().click()
  await expect(page.getByText('Adicionado.')).toBeVisible()
}
