import { test, expect, cartaoBanco } from './base'

// Fase 5: réplica por streaming (S), backup e PITR (T).
// Serial: os backups e o PITR dividem o mesmo repositório do pgBackRest.
test.describe.configure({ mode: 'serial' })

// Como quebra: a réplica não sobe (clone falhou) ou sobe como banco comum,
// aceitando escrita; o painel mostra "up" para um nó que não é réplica.
test('[S2] a réplica está no ar e em recuperação (só leitura)', async ({ page }) => {
  await page.goto('/dba')
  await expect(cartaoBanco(page, 'PostgreSQL réplica').locator('.card-status')).toHaveText('up')
  await page.goto('/dba?aba=replicacao')
  await expect(page.getByLabel('Estado da réplica')).toContainText('sim (só leitura)')
})

// Como quebra: o painel não lista a réplica, o slot ou o arquivamento; ou o
// archive_command está falhando e ninguém vê (sem WAL arquivado, sem PITR).
test('[S4] [T1] o painel mostra a réplica, o slot e o arquivamento do WAL em dia', async ({ page }) => {
  await page.goto('/dba?aba=replicacao')
  await expect(page.getByRole('table', { name: 'Réplicas conectadas' }).getByRole('row', { name: /replica1/ })).toContainText('streaming')
  await expect(page.getByRole('table', { name: 'Slots de replicação' }).getByRole('row', { name: /replica1/ })).toContainText('sim')
  const arquivamento = page.getByLabel('Arquivamento do WAL')
  await expect(arquivamento).toContainText('arquivando')
  await expect(arquivamento).not.toContainText('FALHANDO')
  await expect(arquivamento).toContainText(/último: 0000/)
})

// Como quebra: o WAL não chega à réplica (S1), ou remote_apply responde antes
// de a réplica aplicar (S5) — a linha recém-gravada não está lá.
test('[S1] [S5] com remote_apply, toda linha gravada no primário já está na réplica logo após o COMMIT', async ({ page }) => {
  await page.goto('/lab/replicacao')
  await page.getByLabel('Transações').fill('20')
  await page.getByRole('radiogroup', { name: 'synchronous_commit' }).getByText('remote_apply', { exact: true }).click()
  await page.getByRole('button', { name: 'Gravar e ler na réplica' }).click()
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText('100% das linhas já estavam na réplica')
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText('sempre')

  // local não espera a réplica — mas tudo chega a ela (nada fica para trás).
  await page.getByRole('radiogroup', { name: 'synchronous_commit' }).getByText('local', { exact: true }).click()
  await page.getByRole('button', { name: 'Gravar e ler na réplica' }).click()
  const linha = page.getByRole('table', { name: 'Resultados da replicação' }).locator('tbody tr').first()
  await expect(linha).toContainText('local')
  await expect(page.getByRole('status', { name: 'Conclusão' })).not.toContainText('nem em 2 s')
})

// Como quebra: a tela relê o relatório da réplica antes de ela aplicar o
// REFRESH e mostra o resumo velho; ou o relatório silenciosamente lê do primário.
test('[S3] o relatório vem da réplica e mostra a compra logo depois do REFRESH', async ({ page, api }) => {
  const resposta = await page.request.get('/api/relatorios/curva-abc?dias=30')
  expect(resposta.headers()['x-origem-leitura']).toBe('replica')

  const antes = (await api.json<{ dia: string; pedidos: number }[]>('/relatorios/receita-diaria?dias=1'))[0]
  const cliente = await api.novaConta()
  const [sku] = await api.skusComEstoque(1)
  await api.comprar(cliente, [{ sku_id: sku.id, quantidade: 1 }])
  await page.goto('/relatorios')
  await expect(page.getByLabel('Origem da leitura')).toContainText('Lido da réplica')
  await page.getByRole('button', { name: 'REFRESH CONCURRENTLY' }).click()
  await expect(page.getByRole('button', { name: 'REFRESH CONCURRENTLY' })).toBeEnabled()
  // Logo depois do REFRESH, a leitura (da réplica) já vê a compra.
  const depois = (await api.json<{ dia: string; pedidos: number }[]>('/relatorios/receita-diaria?dias=1'))[0]
  if (depois.dia === antes.dia) expect(depois.pedidos).toBeGreaterThan(antes.pedidos)
  else expect(depois.pedidos).toBeGreaterThanOrEqual(1)
})

// Como quebra: o backup não aparece na lista; o incremental copia tanto quanto
// o full; ou não registra de quem depende.
test('[T2] full e incremental aparecem no repositório; o incremental copia muito menos e depende do full', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/lab/backup')
  const tipo = page.getByRole('radiogroup', { name: 'Tipo de backup' })
  await tipo.getByText('full', { exact: true }).click()
  await page.getByRole('button', { name: 'Fazer backup full' }).click()
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText(/Backup full .*F: copiou/, { timeout: 120_000 })

  await tipo.getByText('incr', { exact: true }).click()
  await page.getByRole('button', { name: 'Fazer backup incr' }).click()
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText(/Backup incr .*I: copiou/, { timeout: 60_000 })
  await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText('Para restaurar, ele precisa de')

  const info = await (await page.request.get('/api/lab/backup')).json() as { backups: { tipo: string; copiado: number; referencia?: string[] }[] }
  const full = info.backups.filter((b) => b.tipo === 'full').at(-1)!
  const incr = info.backups.filter((b) => b.tipo === 'incr').at(-1)!
  expect(incr.copiado).toBeLessThan(full.copiado / 10)
  expect(incr.referencia?.length).toBeGreaterThan(0)
  await expect(page.getByRole('table', { name: 'Backups no repositório' }).getByRole('row', { name: /incr/ }).first()).toBeVisible()
})

// Como quebra: a recuperação passa do alvo (a tabela volta apagada) ou para
// antes dele (perde linhas que existiam); ou restaura POR CIMA do primário.
test('[T3] [T4] o PITR traz exatamente o que existia no instante-alvo, numa instância à parte', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/lab/backup')
  const conclusao = page.getByRole('status', { name: 'Conclusão' })
  const alvo = page.getByRole('radiogroup', { name: 'Instante-alvo' })

  await alvo.getByText('Alvo: logo antes do DROP', { exact: true }).click()
  await page.getByRole('button', { name: 'Apagar a tabela e recuperar (PITR)' }).click()
  await expect(conclusao).toContainText('Recuperadas 1.500 linhas', { timeout: 120_000 })
  await expect(conclusao).toContainText('No primário a tabela continua apagada')
  await expect(page.getByRole('table', { name: 'Etapas do PITR' })).toContainText('porta 5433')

  await alvo.getByText('Alvo: entre os dois lotes', { exact: true }).click()
  await page.getByRole('button', { name: 'Apagar a tabela e recuperar (PITR)' }).click()
  await expect(conclusao).toContainText('Recuperadas 1.000 linhas', { timeout: 120_000 })
  await expect(conclusao).toContainText('As 500 linhas do lote 2 ficaram de fora')

  // O primário seguiu atendendo a loja normalmente.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Categorias/ })).toBeVisible()
})
