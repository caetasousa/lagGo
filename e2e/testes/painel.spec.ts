import { test, expect, cartaoBanco, abrirProduto, adicionarAoCarrinho } from './base'

test('[G1] os seis bancos do núcleo no ar, inclusive Cassandra e Neo4j (Fase 7)', async ({ page }) => {
  await page.goto('/dba')
  for (const nome of ['PostgreSQL', 'PostgreSQL réplica', 'MongoDB', 'Redis', 'Cassandra', 'Neo4j']) {
    // O painel relê o health a cada poucos segundos; o Cassandra pode ter
    // acabado de subir (a API conecta nele sob demanda).
    await expect(cartaoBanco(page, nome).locator('.card-status'), nome).toHaveText('up', { timeout: 30_000 })
  }
})

test('[G2] uma compra aparece na auditoria de dados', async ({ page, api }) => {
  const cliente = await api.novaConta()
  const [sku] = await api.skusComEstoque(1)
  const { pedido_id } = await api.comprar(cliente, [{ sku_id: sku.id, quantidade: 1 }])

  await page.goto('/dba?aba=auditoria')
  const auditoria = page.locator('table').filter({ hasText: 'O que mudou' })
  const linhasDoPedido = auditoria.getByRole('row').filter({ hasText: pedido_id.slice(0, 8) })
  await expect(linhasDoPedido.filter({ hasText: 'INSERT' }).first()).toBeVisible()
  await expect(linhasDoPedido.filter({ hasText: 'status: "PENDENTE" → "PAGO"' })).toBeVisible()
})

test('[G3] o painel mostra o Redis (chaves por prefixo) e o MongoDB (coleções e índices)', async ({ page, api }) => {
  const p = await api.produtoComEstoque(5, 1e9, 10)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)

  await page.goto('/dba?aba=nosql')
  const chaves = page.getByRole('table', { name: 'Chaves por prefixo' })
  await expect(chaves.getByRole('row', { name: /carrinho:\*/ })).toContainText('HASH com TTL')
  await expect(chaves.getByRole('row', { name: /cache:\*/ })).toBeVisible()
  await expect(chaves.getByRole('row', { name: /ranking:\*/ })).toBeVisible()

  const colecoes = page.getByRole('table', { name: 'Coleções do MongoDB' })
  const produtos = colecoes.getByRole('row', { name: /^produtos/ })
  await expect(produtos).toContainText('$jsonSchema')
  await expect(produtos).toContainText('busca_texto')
  await expect(produtos).toContainText('sku_unico (único)')
  await expect(page.getByText(/replica set rs0/)).toBeVisible()
})

test('[G4] o painel mostra a saúde das tabelas e os índices', async ({ page }) => {
  await page.goto('/dba?aba=postgres')
  const tabelas = page.getByRole('table', { name: 'Saúde das tabelas' })
  await expect(tabelas.getByRole('row', { name: /auditoria\.log/ })).toContainText('particionada')
  await expect(tabelas.getByRole('row', { name: /public\.estoque/ })).toContainText('fillfactor=80')
  await expect(page.getByRole('table', { name: 'Índices' }).getByRole('row', { name: /idx_pedido_cliente_criado/ })).toBeVisible()
})

test('[G5] o painel mostra o que ocupa o shared_buffers', async ({ page }) => {
  await page.goto('/dba?aba=postgres')
  const cache = page.getByRole('table', { name: 'Cache do PostgreSQL' })
  await expect(cache.locator('tbody tr').first()).toBeVisible()
  await expect(page.getByText(/páginas de 8 KB ocupadas/)).toBeVisible()
})

test('[G6] os gráficos de métricas se movem', async ({ page, api }) => {
  await page.goto('/dba')
  const tps = page.getByRole('figure', { name: 'Transações por segundo' }).getByTestId('valor-atual')
  const cliente = await api.novaConta()
  const [sku] = await api.skusComEstoque(1)
  await expect.poll(async () => {
    await api.comprar(cliente, [{ sku_id: sku.id, quantidade: 1 }])
    return Number((await tps.innerText()).replace(/\./g, '').replace(',', '.')) || 0
  }, { timeout: 15_000 }).toBeGreaterThan(0)
})

test('[G7] o painel mostra os pools do PgBouncer', async ({ page, api }) => {
  // O pool de um banco só nasce na primeira conexão de um cliente.
  const r = await api.post('/lab/conexoes', { modo: 'pgbouncer', clientes: 2, segundos: 1 })
  expect(r.status).toBe(200)
  await page.goto('/dba?aba=pgbouncer')
  const pools = page.getByRole('table', { name: 'Pools do PgBouncer' })
  await expect(pools.getByRole('row', { name: /marketplace/ }).first()).toContainText('transaction')
})
