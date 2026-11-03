import { test, expect, abrirProduto, adicionarAoCarrinho, itensNoCarrinho, entrar } from './base'

test('[L1] a página inicial mostra as categorias e os mais vendidos', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Categorias/ })).toContainText('PostgreSQL')
  await expect(page.locator('.grade-categorias a').first()).toBeVisible()
  expect(await page.locator('.grade-categorias a').count()).toBeGreaterThan(5)
  await expect(page.getByRole('heading', { name: /Mais vendidos/ })).toContainText('Redis')
  await expect(page.getByLabel('Mais vendidos').locator('article').first()).toContainText(/\d+ vendidos/)
})

test('[L2] [L3] a compra e "Meus pedidos" são da conta logada', async ({ page, api }) => {
  const [a, b] = [await api.novaConta('Ana Primeira'), await api.novaConta('Bruno Segundo')]
  const p = await api.produtoComEstoque(5, 1e9, 11)

  await entrar(page, b)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await page.goto('/carrinho')
  await expect(page.getByText(`Comprando como ${b.nome}`)).toBeVisible()
  await page.getByRole('button', { name: 'Finalizar compra' }).click()
  const card = page.locator('.painel').filter({ hasText: 'Pedido criado' })
  await expect(card).toContainText(b.nome)
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (0)')
  const href = await card.getByRole('link', { name: 'Ver o pedido' }).getAttribute('href')
  const pedido = href!.split('/').pop()!

  await page.goto('/pedidos')
  await expect(page.getByRole('table', { name: 'Meus pedidos' }).getByRole('link', { name: pedido.slice(0, 8) })).toBeVisible()

  // Outra conta: o pedido de b não aparece, nem abrindo pelo endereço (Q5).
  await page.context().clearCookies()
  await entrar(page, a)
  await page.goto('/pedidos')
  await expect(page.getByText(`de ${a.nome}`)).toBeVisible()
  await expect(page.getByRole('link', { name: pedido.slice(0, 8) })).toHaveCount(0)
  await page.goto(`/pedidos/${pedido}`)
  await expect(page.getByText('pedido não encontrado')).toBeVisible()
})

test('[L4] a página do pedido mostra situação, itens e total', async ({ page, api }) => {
  const cliente = await api.novaConta()
  const p = await api.produtoComEstoque(5, 1e9, 12)
  const { pedido_id, total } = await api.comprar(cliente, [{ sku_id: p.oferta.id, quantidade: 2 }])
  await entrar(page, cliente)
  await page.goto(`/pedidos/${pedido_id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Pedido ${pedido_id.slice(0, 8)}`)
  await expect(page.getByLabel('Situação do pedido').locator('.feito')).toHaveText(['PENDENTE', 'PAGO'])
  const itens = page.getByRole('table', { name: 'Itens do pedido' })
  await expect(itens.locator('tbody tr')).toHaveCount(2) // 1 item + linha do total
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  await expect(itens).toContainText(brl(total))
  await expect(page.getByText(/PIX · .* · APROVADO/)).toBeVisible()
})

test('[L5] cada bloco da página do produto mostra o banco de onde veio', async ({ page, api }) => {
  const [p] = await api.produtos('&busca=notebook')
  await abrirProduto(page, p.id)
  const ofertas = page.getByRole('heading', { name: /^Ofertas/ })
  await expect(ofertas.locator('.banco')).toHaveText(/PostgreSQL/)
  await expect(page.getByRole('heading', { name: /^Atributos/ }).locator('.banco')).toHaveText(/MongoDB/)
  await expect(page.getByRole('heading', { name: /^Avaliações recentes/ }).locator('.banco')).toHaveText(/MongoDB/)
  await expect(page.locator('.selo')).toHaveText(/cache (HIT|MISS)/)
})
