import { test, expect, type Page } from './base'

// Os dois laboratórios mexem em estado global (o estoque do SKU disputado e
// os índices): este arquivo roda em série.
test.describe.configure({ mode: 'serial' })

const COL = { vendidos: 4, vendasAMais: 9 } // colunas da tabela de resultados

async function correr(page: Page, estrategia: string, atrasoMs: number) {
  await page.getByText(estrategia, { exact: true }).click()
  await page.getByLabel('Compradores').fill('50')
  await page.getByLabel('Estoque inicial').fill('5')
  await page.getByLabel(/Atraso entre ler e gravar/).fill(String(atrasoMs))
  await page.getByRole('button', { name: 'Iniciar corrida' }).click()
  await expect(page.getByRole('button', { name: 'Iniciar corrida' })).toBeEnabled({ timeout: 30_000 })
  const linha = page.locator('tbody tr').first()
  await expect(linha.locator('td').first()).toHaveText(estrategia)
  return {
    vendidos: Number(await linha.locator('td').nth(COL.vendidos).innerText()),
    vendasAMais: Number(await linha.locator('td').nth(COL.vendasAMais).innerText()),
  }
}

test('[D1] a estratégia ingênua vende além do estoque (lost update)', async ({ page }) => {
  await page.goto('/lab')
  const r = await correr(page, 'Ingênua (com bug)', 50)
  expect(r.vendidos).toBeGreaterThan(5)
  expect(r.vendasAMais).toBeGreaterThan(0)
  await expect(page.locator('tbody tr').first()).toHaveClass(/blocked/) // linha marcada como inconsistente
})

test('[D2] as estratégias corretas nunca vendem além do estoque', async ({ page }) => {
  await page.goto('/lab')
  for (const estrategia of ['SELECT FOR UPDATE', 'UPDATE condicional', 'SERIALIZABLE + retry']) {
    const r = await correr(page, estrategia, 20)
    expect(r.vendasAMais, estrategia).toBe(0)
    expect(r.vendidos, estrategia).toBeLessThanOrEqual(5)
    if (estrategia !== 'SERIALIZABLE + retry') expect(r.vendidos, estrategia).toBe(5)
  }
})

const INDICE = 'idx_lab_cliente_lower_nome'

test('[E1] criar o índice de expressão troca o Seq Scan pelo índice', async ({ page, request }) => {
  await request.delete(`/api/dba/indices/${INDICE}`) // estado inicial conhecido
  await page.goto('/indices')
  await page.getByRole('button', { name: /Busca por nome ignorando maiúsculas/ }).click()
  const plano = page.locator('pre.plano')

  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(plano).toContainText('Seq Scan on cliente')

  const cartao = page.locator('.card').filter({ hasText: `${INDICE} ON cliente` })
  await cartao.getByRole('button', { name: 'CREATE INDEX' }).click()
  await expect(cartao.locator('.card-status')).toHaveText('existe')

  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(plano).toContainText(INDICE)
  await expect(plano).not.toContainText('Seq Scan on cliente')

  await cartao.getByRole('button', { name: 'DROP INDEX' }).click()
  await expect(cartao.locator('.card-status')).toHaveText('ausente')
  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(plano).toContainText('Seq Scan on cliente')
})

test('[E2] CREATE e DROP INDEX do laboratório ficam na auditoria de esquema', async ({ page, request }) => {
  const nome = 'idx_lab_cliente_email_trgm'
  expect((await request.post(`/api/dba/indices/${nome}`)).ok()).toBeTruthy()
  expect((await request.delete(`/api/dba/indices/${nome}`)).ok()).toBeTruthy()

  await page.goto('/dba?aba=auditoria')
  const ddl = page.locator('section').locator('table').filter({ hasText: 'Comando' })
  await expect(ddl.getByRole('row').filter({ hasText: 'CREATE INDEX' }).filter({ hasText: nome }).first()).toBeVisible()
  await expect(ddl.getByRole('row').filter({ hasText: 'DROP INDEX' }).filter({ hasText: nome }).first()).toBeVisible()
})

test('[E5] o plano vem em português e o quadro antes × depois compara as páginas lidas', async ({ page, request }) => {
  await request.delete(`/api/dba/indices/${INDICE}`)
  await page.goto('/indices')
  await page.getByRole('button', { name: /Busca por nome ignorando maiúsculas/ }).click()
  const leitura = page.getByRole('region', { name: 'Leitura do plano' })

  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(leitura).toContainText('Leu a tabela cliente INTEIRA')
  await expect(leitura).toContainText('jogou fora')

  const cartao = page.locator('.card').filter({ hasText: `${INDICE} ON cliente` })
  await cartao.getByRole('button', { name: 'CREATE INDEX' }).click()
  await expect(cartao.locator('.card-status')).toHaveText('existe')
  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(leitura).toContainText(`Consultou o índice ${INDICE}`)
  await expect(page.getByRole('region', { name: 'Antes e depois' })).toContainText(/\d+× menos páginas lidas/)

  await cartao.getByRole('button', { name: 'DROP INDEX' }).click()
  await expect(cartao.locator('.card-status')).toHaveText('ausente')
})
