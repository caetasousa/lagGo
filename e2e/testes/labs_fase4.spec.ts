import { test, expect, type Page } from './base'

// Laboratórios da Fase 4. Mexem em estado compartilhado (schema lab, a
// partição do expurgo, o pool de conexões): este arquivo roda em série.
test.describe.configure({ mode: 'serial' })

async function isolamento(page: Page, roteiro: string, nivel: string) {
  await page.getByRole('button', { name: new RegExp(`^${roteiro}`) }).click()
  await page.getByLabel(nivel, { exact: true }).check()
  await page.getByRole('button', { name: 'Rodar passo a passo' }).click()
  await expect(page.getByRole('button', { name: 'Rodar passo a passo' })).toBeEnabled({ timeout: 20_000 })
  return page.getByRole('status', { name: 'Conclusão' })
}

test('[J1] leitura não repetível: acontece em READ COMMITTED, não em REPEATABLE READ', async ({ page }) => {
  await page.goto('/lab/isolamento')
  await expect(await isolamento(page, 'Leitura não repetível', 'READ COMMITTED (padrão)')).toContainText('A anomalia aconteceu em READ COMMITTED')
  await expect(await isolamento(page, 'Leitura não repetível', 'REPEATABLE READ')).toContainText('A anomalia não aconteceu em REPEATABLE READ')
})

test('[J2] lost update: REPEATABLE READ aborta com 40001', async ({ page }) => {
  await page.goto('/lab/isolamento')
  await expect(await isolamento(page, 'Atualização perdida', 'READ COMMITTED (padrão)')).toContainText('A anomalia aconteceu')
  await expect(await isolamento(page, 'Atualização perdida', 'REPEATABLE READ')).toContainText('impediu a anomalia abortando')
  await expect(page.getByRole('table', { name: 'Passos' })).toContainText('40001')
  await expect(page.getByRole('table', { name: 'Passos' })).toContainText('bloqueado')
})

test('[J3] write skew: só SERIALIZABLE impede', async ({ page }) => {
  await page.goto('/lab/isolamento')
  await expect(await isolamento(page, 'Write skew', 'REPEATABLE READ')).toContainText('A anomalia aconteceu')
  await expect(await isolamento(page, 'Write skew', 'SERIALIZABLE')).toContainText('impediu a anomalia abortando')
})

test('[J4] o deadlock é detectado e uma transação vira vítima', async ({ page }) => {
  await page.goto('/lab/isolamento')
  await expect(await isolamento(page, 'Deadlock', 'READ COMMITTED (padrão)')).toContainText(/Deadlock detectado: T[12] foi a vítima/)
  await expect(page.getByRole('table', { name: 'Passos' })).toContainText('40P01')
})

async function explain(page: Page, experimento: RegExp) {
  await page.getByRole('button', { name: experimento }).click()
  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(page.locator('pre.plano')).toContainText('Execution Time')
  return page.locator('pre.plano').innerText()
}

test('[E3] desligar o Bitmap Scan na sessão muda o plano', async ({ page }) => {
  await page.goto('/indices')
  expect(await explain(page, /Últimos pedidos de um cliente/)).toContain('Bitmap')
  await page.getByLabel('enable_bitmapscan').selectOption('off')
  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(page.locator('pre.plano')).not.toContainText('Bitmap')
  await expect(page.locator('pre.plano')).toContainText('Index Scan')
  await expect(page.getByRole('table').last()).toContainText('enable_bitmapscan=off')
})

test('[E4] filtrar pela coluna de partição lê uma partição; com date_trunc, todas', async ({ page }) => {
  await page.goto('/indices')
  const contar = (plano: string) => plano.split(' on log_').length - 1
  expect(contar(await explain(page, /Auditoria de um mês/))).toBe(1)
  await page.getByRole('button', { name: /O mesmo mês com date_trunc/ }).click()
  await page.getByRole('button', { name: 'EXPLAIN ANALYZE' }).click()
  await expect(page.locator('pre.plano')).toContainText('Execution Time')
  expect(contar(await page.locator('pre.plano').innerText())).toBeGreaterThanOrEqual(12)
})

async function mvcc(page: Page, botao: string) {
  await page.getByRole('button', { name: botao, exact: true }).click()
  const c = page.getByRole('status', { name: 'Conclusão' })
  await expect(page.getByRole('button', { name: botao, exact: true })).toBeEnabled()
  return c
}

test('[H1] [H2] [H3] UPDATE deixa versões mortas; VACUUM limpa, VACUUM FULL encolhe; fillfactor folgado dá HOT', async ({ page }) => {
  await page.goto('/lab/mvcc')
  await expect(await mvcc(page, 'Recriar com fillfactor 100')).toContainText('fillfactor 100%')
  await expect(await mvcc(page, 'UPDATE coluna indexada (10%)')).toContainText('2.000 tuplas mortas novas; 0 foram HOT')
  // Com outros testes rodando em paralelo, uma transação aberta pode segurar o
  // "horizonte" e o VACUUM deixar versões mortas para trás (o laboratório
  // explica isso). Repetir o VACUUM até limpar é o que um DBA faria.
  await expect.poll(async () => {
    await mvcc(page, 'VACUUM')
    return page.getByLabel('Estado da tabela').textContent()
  }, { timeout: 20_000 }).toContain('Tuplas mortas0')
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText('o tamanho continua')
  await expect(await mvcc(page, 'VACUUM FULL')).toContainText('VACUUM FULL: tabela reescrita de')
  await expect(await mvcc(page, 'Recriar com fillfactor 70')).toContainText('fillfactor 70%')
  await expect(await mvcc(page, 'UPDATE coluna sem índice (10%)')).toContainText('2.000 foram HOT')
})

test('[P1] [P2] DROP PARTITION custa muito menos que DELETE e só apaga o mês escolhido', async ({ page }) => {
  await page.goto('/lab/expurgo')
  await page.getByLabel('Linhas').fill('20000')
  await page.getByRole('button', { name: 'Expurgar com DELETE' }).click()
  await expect(page.getByRole('table', { name: 'Resultados do expurgo' })).toContainText('DELETE')
  await page.getByRole('button', { name: 'Expurgar com DROP PARTITION' }).click()
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText(/DROP PARTITION gerou \d+× menos WAL/)
  const linhas = page.getByRole('table', { name: 'Resultados do expurgo' }).locator('tbody tr')
  await expect(linhas.first()).toContainText('20.000') // tuplas mortas do DELETE
  for (const tr of await linhas.all()) {
    const [antes, depois] = (await tr.locator('td').last().innerText()).split(' → ')
    expect(depois, 'outros meses intactos').toBe(antes)
  }
})

async function conexoes(page: Page, botao: string, clientes: number) {
  await page.getByLabel('Clientes simultâneos').fill(String(clientes))
  await page.getByLabel('Segundos').fill('2')
  await page.getByRole('button', { name: botao }).click()
  await expect(page.getByRole('button', { name: botao })).toBeEnabled({ timeout: 20_000 })
  return page.getByRole('status', { name: 'Conclusão' })
}

test('[N1] [N2] pool e PgBouncer superam a conexão nova; o PgBouncer multiplexa', async ({ page }) => {
  await page.goto('/lab/conexoes')
  await conexoes(page, 'Conexão nova no PostgreSQL', 40)
  await expect(await conexoes(page, 'Pool na aplicação', 40)).toContainText(/Pool na aplicação: [\d.,]+× mais consultas por segundo/)
  await expect(await conexoes(page, 'Conexão nova no PgBouncer', 40)).toContainText('o PgBouncer multiplexou')
  const linha = page.getByRole('table', { name: 'Resultados das conexões' }).getByRole('row', { name: /Conexão nova no PgBouncer/ })
  const pico = Number((await linha.locator('td').nth(6).innerText()).split(' ')[0])
  expect(pico, 'processos no PostgreSQL com 40 clientes no PgBouncer').toBeLessThan(40)
})

test('[N3] muitos clientes diretos esbarram no max_connections', async ({ page }) => {
  await page.goto('/lab/conexoes')
  await expect(await conexoes(page, 'Conexão nova no PostgreSQL', 120)).toContainText('conexões recusadas')
})

test('[R1] o cache acerta depois da primeira leitura e é mais rápido', async ({ page }) => {
  await page.goto('/lab/cache')
  await page.getByRole('button', { name: 'Comparar' }).click()
  const c = page.getByRole('status', { name: 'Conclusão' })
  await expect(c).toContainText('1 falha')
  await expect(c).toContainText('199 acertos')
})
