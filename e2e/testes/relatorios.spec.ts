import { test, expect } from './base'

interface Linha { mes: string | null; uf: string; pedidos: number; nivel: number }
interface Dia { dia: string; pedidos: number }

test('[F1] o total geral do CUBE bate com a soma das UFs e dos meses', async ({ page, api }) => {
  const linhas = await api.json<Linha[]>('/relatorios/vendas-mensais?meses=5')
  const geral = linhas.find((l) => l.nivel === 3)!.pedidos
  const somaUF = linhas.filter((l) => l.nivel === 2).reduce((s, l) => s + l.pedidos, 0)
  const somaMes = linhas.filter((l) => l.nivel === 1).reduce((s, l) => s + l.pedidos, 0)
  expect(geral).toBeGreaterThan(0)
  expect(somaUF).toBe(geral)
  expect(somaMes).toBe(geral)

  await page.goto('/relatorios')
  const tabela = page.locator('table').first()
  for (const uf of ['BA', 'DF', 'MG', 'PE', 'PR', 'RJ', 'RS', 'SP']) {
    await expect(tabela.getByRole('columnheader', { name: uf, exact: true })).toBeVisible()
  }
  await expect(tabela.getByRole('row', { name: /Total da UF/ })).toBeVisible()
})

test('[F2] uma compra nova aparece depois do REFRESH da materialized view', async ({ page, api }) => {
  const antes = (await api.json<Dia[]>('/relatorios/receita-diaria?dias=1'))[0]
  const cliente = await api.novaConta()
  const [sku] = await api.skusComEstoque(1)
  await api.comprar(cliente, [{ sku_id: sku.id, quantidade: 1 }])

  // Sem refresh, a materialized view ainda não viu a compra.
  const semRefresh = (await api.json<Dia[]>('/relatorios/receita-diaria?dias=1'))[0]
  expect(semRefresh).toEqual(antes)

  await page.goto('/relatorios')
  await page.getByRole('button', { name: 'REFRESH CONCURRENTLY' }).click()
  await expect(page.getByRole('button', { name: 'REFRESH CONCURRENTLY' })).toBeEnabled()

  const depois = (await api.json<Dia[]>('/relatorios/receita-diaria?dias=1'))[0]
  if (depois.dia === antes.dia) expect(depois.pedidos).toBeGreaterThan(antes.pedidos)
  else expect(depois.pedidos).toBeGreaterThanOrEqual(1)
})
