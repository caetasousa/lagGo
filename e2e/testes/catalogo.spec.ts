import { test, expect, abrirProduto, entrar } from './base'

test('[A1] a busca por texto acha o produto pelo nome', async ({ page }) => {
  await page.goto('/loja')
  await page.getByLabel('Buscar produtos').fill('notebook')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(/^[1-9]\d* produtos$/)
  const cards = page.locator('.card-produto')
  await expect(cards.first()).toBeVisible()
  for (const card of (await cards.all()).slice(0, 6)) await expect(card).toContainText('Notebook')
})

test('[A2] filtrar pela categoria raiz traz as subcategorias (array de ancestrais)', async ({ page }) => {
  await page.goto('/loja')
  await page.getByLabel('Categoria').selectOption({ label: 'Eletrônicos' })
  const facetas = page.getByRole('complementary', { name: 'Filtros' })
  for (const sub of ['Notebooks', 'Monitores', 'Celulares']) {
    await expect(facetas.getByRole('button', { name: new RegExp(`^${sub} \\(\\d+\\)$`) })).toBeVisible()
  }
  await expect(facetas.getByRole('button', { name: /^Ficção/ })).toHaveCount(0)
})

test('[A3] as facetas somam o total de resultados', async ({ page }) => {
  await page.goto('/loja?categoria=1')
  const total = Number((await page.getByRole('status').innerText()).split(' ')[0])
  const somar = async (nomes: string[]) =>
    nomes.map((n) => Number(/\((\d+)\)$/.exec(n)?.[1] ?? 0)).reduce((a, b) => a + b, 0)
  const facetas = page.getByRole('complementary', { name: 'Filtros' })
  const categorias = await facetas.getByRole('button', { name: /^[^R].*\(\d+\)$/ }).allInnerTexts()
  const precos = await facetas.getByRole('button', { name: /R\$.*\(\d+\)$/ }).allInnerTexts()
  expect(total).toBeGreaterThan(0)
  expect(await somar(categorias)).toBe(total)
  expect(await somar(precos)).toBe(total)
})

test('[A4] a página do produto mostra os atributos da categoria', async ({ page, api }) => {
  const [notebook] = await api.produtos('&busca=notebook')
  await abrirProduto(page, notebook.id)
  const attrs = page.getByRole('table', { name: 'Atributos' })
  await expect(attrs).toContainText('ram gb')
  await expect(attrs).toContainText('processador')

  const [livro] = await api.produtos('&busca=modelagem')
  await abrirProduto(page, livro.id)
  await expect(page.getByRole('table', { name: 'Atributos' })).toContainText('autor')
  await expect(page.getByRole('table', { name: 'Atributos' })).toContainText('isbn')
})

test('[A5] estoque da oferta vem do PostgreSQL mesmo com o documento em cache', async ({ page, api }) => {
  const p = await api.produtoComEstoque(10, 1e9, 0)
  await abrirProduto(page, p.id)
  const { selo, estoque } = await abrirProduto(page, p.id) // segunda visita: documento do cache
  await expect(selo).toHaveText('cache HIT')
  const antes = Number(await estoque.innerText())

  const cliente = await api.novaConta()
  await api.comprar(cliente, [{ sku_id: p.oferta.id, quantidade: 2 }])
  await page.reload()
  await expect(selo).toHaveText('cache HIT')
  await expect(estoque).toHaveText(String(antes - 2))
})

test('[A6] a avaliação aparece e move a contagem', async ({ page, api }) => {
  await entrar(page, await api.novaConta())
  const p = await api.produtoComEstoque(1, 1e9, 1)
  await abrirProduto(page, p.id)
  const media = page.locator('.avaliacao-media')
  const qtd = async () => Number(/\((\d+) avaliações\)/.exec(await media.innerText())?.[1] ?? 0)
  const antes = await qtd()

  await page.getByLabel('Nota').selectOption('2')
  await page.getByLabel('Comentário').fill('Avaliação do teste E2E A6')
  await page.getByRole('button', { name: 'Enviar avaliação' }).click()
  await expect(page.getByRole('list', { name: 'Avaliações recentes' }).locator('li').first())
    .toContainText('Avaliação do teste E2E A6')
  await expect.poll(qtd).toBe(antes + 1)
})

test('[A7] avaliação inválida é recusada', async ({ page, api }) => {
  const [p] = await api.produtos()
  const cliente = await api.novaConta()
  const r = await cliente.r.post(`/api/catalogo/produtos/${p.id}/avaliacoes`, { data: { nota: 6, texto: 'nota seis' } })
  expect(r.status()).toBe(422)
  await entrar(page, cliente)

  await abrirProduto(page, p.id)
  await page.getByLabel('Comentário').fill('ok') // menos de 3 caracteres
  await page.getByRole('button', { name: 'Enviar avaliação' }).click()
  await expect(page.getByText('o texto deve ter entre 3 e 1000 caracteres')).toBeVisible()
})

test('[A8] a segunda visita vem do cache e a avaliação nova o invalida', async ({ page, api }) => {
  await entrar(page, await api.novaConta())
  const p = await api.produtoComEstoque(1, 1e9, 2)
  await abrirProduto(page, p.id)
  const { selo } = await abrirProduto(page, p.id)
  await expect(selo).toHaveText('cache HIT')

  await page.getByLabel('Comentário').fill('Invalida o cache (E2E A8)')
  await page.getByRole('button', { name: 'Enviar avaliação' }).click()
  await expect(selo).toHaveText('cache MISS') // refetch depois da invalidação
  await expect(page.getByRole('list', { name: 'Avaliações recentes' })).toContainText('Invalida o cache (E2E A8)')
})
