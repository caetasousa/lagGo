import { randomUUID } from 'node:crypto'
import { test, expect, abrirProduto, adicionarAoCarrinho, itensNoCarrinho, entrar } from './base'

test('[B1] o carrinho sobrevive a recarregar a página', async ({ page, api }) => {
  const p = await api.produtoComEstoque(5, 1e9, 3)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (1)')
  await page.reload()
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (1)')
  await itensNoCarrinho(page).click()
  await expect(page.getByRole('table', { name: 'Itens do carrinho' }).locator('tbody tr')).toHaveCount(1)
})

test('[B2] alterar a quantidade e remover refletem no total', async ({ page, api }) => {
  const p = await api.produtoComEstoque(5, 1e9, 4)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (1)')
  await page.goto('/carrinho')

  const qtd = page.getByLabel(/^Quantidade de /)
  await qtd.fill('3')
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (3)')
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  await expect(page.locator('.total-carrinho')).toContainText(brl(p.oferta.preco * 3))

  await page.getByRole('button', { name: /^Remover / }).click()
  await expect(page.getByText('Seu carrinho está vazio.')).toBeVisible()
})

test('[B3] o carrinho de uma sessão não aparece em outra', async ({ browser, page, api }) => {
  const p = await api.produtoComEstoque(5, 1e9, 5)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (1)')

  const outro = await browser.newContext() // outro navegador = outra sessão
  const page2 = await outro.newPage()
  await page2.goto('/carrinho')
  await expect(page2.getByText('Seu carrinho está vazio.')).toBeVisible()
  await expect(itensNoCarrinho(page2)).toHaveAccessibleName('Carrinho (0)')
  await outro.close()
})

test('[B4] finalizar com o carrinho vazio não cria pedido', async ({ api }) => {
  const cliente = await api.novaConta()
  const r = await api.carrinho().finalizar(cliente)
  expect(r.status()).toBe(422)
  expect((await r.json()).error).toBe('carrinho vazio')
})

test('[B5] finalizar cria o pedido com os itens do carrinho e esvazia o carrinho', async ({ page, api }) => {
  await entrar(page, await api.novaConta())
  const a = await api.produtoComEstoque(5, 1e9, 6)
  const b = await api.produtoComEstoque(5, 1e9, 7)
  for (const p of [a, b]) {
    await abrirProduto(page, p.id)
    await adicionarAoCarrinho(page)
  }
  await page.goto('/carrinho')
  await page.getByRole('button', { name: 'Finalizar compra' }).click()

  const pedido = page.locator('.painel').filter({ hasText: 'Pedido criado' })
  await expect(pedido).toContainText('PAGO')
  await expect(pedido.locator('ul.carrinho li').filter({ hasText: /^#\d/ })).toHaveCount(2)
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (0)')
})

test('[C1] o pedido mostra itens, total igual à soma e pagamento', async ({ page, api }) => {
  await entrar(page, await api.novaConta())
  const p = await api.produtoComEstoque(5, 1e9, 8)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await page.goto('/carrinho')
  await page.getByLabel(/^Quantidade de /).fill('2')
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (2)')
  await page.getByRole('button', { name: 'Finalizar compra' }).click()

  const pedido = page.locator('.painel').filter({ hasText: 'Pedido criado' })
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  await expect(pedido.locator('li.total')).toContainText(brl(p.oferta.preco * 2))
  await expect(pedido).toContainText(`Pagamento PIX ${brl(p.oferta.preco * 2)}: APROVADO`)
})

test('[B6] pedir mais do que o estoque é recusado e o carrinho fica', async ({ page, api }) => {
  await entrar(page, await api.novaConta())
  const p = await api.produtoComEstoque(1, 60, 0)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await page.goto('/carrinho')
  await page.getByLabel(/^Quantidade de /).fill('99')
  await expect(page.getByText(/só \d+ em estoque/)).toBeVisible()
  await page.getByRole('button', { name: 'Finalizar compra' }).click()
  await expect(page.getByRole('alert')).toHaveText('estoque insuficiente')
  await page.reload()
  await expect(itensNoCarrinho(page)).toHaveAccessibleName('Carrinho (99)')
})

test('[B7] a compra entra no ranking de mais vendidos', async ({ page, api }) => {
  const p = await api.produtoComEstoque(80, 1e9, 0)
  const carrinho = api.carrinho()
  expect((await carrinho.definir(p.oferta.id, 70)).ok()).toBeTruthy() // 70 unidades: passa o topo do seed (~30)
  const cliente = await api.novaConta()
  expect((await carrinho.finalizar(cliente)).status()).toBe(201)

  await page.goto('/')
  const ranking = page.getByLabel('Mais vendidos').locator('article').first()
  await expect(ranking).toContainText(p.nome)
  await expect(ranking).toContainText(/\d+ vendidos/)
})

test('[C2] a mesma Idempotency-Key não cria um segundo pedido', async ({ api }) => {
  const p = await api.produtoComEstoque(5, 1e9, 9)
  const carrinho = api.carrinho()
  await carrinho.definir(p.oferta.id, 1)
  const cliente = await api.novaConta()
  const chave = randomUUID()
  const r1 = await carrinho.finalizar(cliente, chave)
  const r2 = await carrinho.finalizar(cliente, chave)
  expect(r1.status()).toBe(201)
  expect(r2.status()).toBe(200)
  expect((await r2.json()).pedido_id).toBe((await r1.json()).pedido_id)
})
