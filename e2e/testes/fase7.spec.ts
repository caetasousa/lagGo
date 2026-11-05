import { test, expect, abrirProduto, entrar } from './base'

// Fase 7: Cassandra (vistos recentemente, consistência ajustável) e Neo4j
// (recomendações, Grafo × SQL). X2, X4 e Y4 são da integração.

test('[X1] abrir produtos logado alimenta "Vistos recentemente", o mais novo primeiro e sem repetir', async ({ page, api }) => {
  const conta = await api.novaConta('Hugo Navegador')
  const [a, b] = await api.produtos()
  await entrar(page, conta)
  await abrirProduto(page, a.id)
  await abrirProduto(page, b.id)
  await abrirProduto(page, a.id)
  await page.goto('/')
  const vistos = page.getByRole('list', { name: 'Vistos recentemente' })
  await expect(vistos.getByRole('link')).toHaveText([a.nome, b.nome])
  await expect(page.getByRole('heading', { name: /Vistos recentemente/ })).toContainText('Cassandra')

  // Outra pessoa não vê o histórico de Hugo.
  await page.context().clearCookies()
  await entrar(page, await api.novaConta('Iara Outra'))
  await page.goto('/')
  await expect(page.getByText('Abra alguns produtos')).toBeVisible()
})

test('[X3] consistência ajustável: com RF=3 e uma réplica só, ONE funciona e QUORUM/ALL falham', async ({ page }) => {
  await page.goto('/lab/consistencia')
  const rf = page.getByRole('radiogroup', { name: 'Fator de replicação' })
  await rf.getByText('RF = 3 (só 1 das 3 réplicas existe)').click()
  await page.getByRole('button', { name: 'Escrever e ler em cada nível' }).click()
  const tabela = page.getByRole('table', { name: 'Resultado por nível de consistência' })
  await expect(tabela.getByRole('row', { name: /^ONE/ })).toContainText('✅')
  await expect(tabela.getByRole('row', { name: /^QUORUM/ })).toContainText('❌')
  await expect(tabela.getByRole('row', { name: /^ALL/ })).toContainText('❌')

  await rf.getByText('RF = 1 (uma réplica, a que existe)').click()
  await page.getByRole('button', { name: 'Escrever e ler em cada nível' }).click()
  await expect(tabela.getByRole('row', { name: /^ALL/ })).toContainText('✅')
  await expect(tabela).not.toContainText('❌')
})

test('[Y1] [Y2] uma compra entra no grafo e a página do produto recomenda pela força, sem ela mesma', async ({ page, api }) => {
  test.setTimeout(120_000)
  // Com o seed, a recomendação nº 1 de um produto já tem ~80 co-compradores:
  // um par novo não chegaria ao topo. Então Y é a nº 1 de hoje, e o que se
  // confere é que a força dela sobe com as compras novas (o grafo mudou).
  const x = await api.produtoComEstoque(20, 1e9, 20)
  await abrirProduto(page, x.id)
  const recs = page.getByRole('list', { name: 'Quem comprou também comprou' })
  await expect(recs.getByRole('listitem').first()).toBeVisible()
  const itens = recs.getByRole('listitem')
  // A força de um produto é a do seu SKU mais forte: cada cliente novo compra
  // TODOS os SKUs de Y, para a força de cada um (e a do produto) subir 15.
  let y: { id: string; nome: string; forca: number; skus: string[] } | undefined
  for (let i = 0; i < (await itens.count()) && !y; i++) {
    const link = itens.nth(i).getByRole('link')
    const id = (await link.getAttribute('href'))!.split('/').pop()!
    const ofertas = (await api.detalhe(id)).ofertas
    if (ofertas.length > 0 && ofertas.every((o) => o.estoque >= 15)) {
      y = { id, nome: await link.innerText(), forca: Number(await itens.nth(i).getAttribute('data-forca')), skus: ofertas.map((o) => o.id) }
    }
  }
  expect(y, 'uma recomendação com estoque para 15 compras').toBeDefined()

  for (let i = 0; i < 15; i++) {
    await api.comprar(await api.novaConta(), [{ sku_id: x.oferta.id, quantidade: 1 }, ...y!.skus.map((sku_id) => ({ sku_id, quantidade: 1 }))])
  }
  await page.reload()
  const itemY = recs.getByRole('listitem').filter({ has: page.getByRole('link', { name: y!.nome, exact: true }) })
  await expect(itemY).toBeVisible()
  expect(Number(await itemY.getAttribute('data-forca')), '[Y1] 15 clientes novos compraram X e Y').toBeGreaterThanOrEqual(y!.forca + 15)
  await expect(recs.getByRole('link', { name: x.nome, exact: true })).toHaveCount(0)
  const forcas = await recs.locator('[data-forca]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-forca'))))
  expect(forcas, 'ordenado pela força').toEqual([...forcas].sort((p, q) => q - p))
  await expect(page.getByRole('heading', { name: /Quem comprou também comprou/ })).toContainText('Neo4j')
})

test('[Y3] [Y5] Grafo × SQL: as duas consultas dão a mesma resposta, dita com o nome dos produtos (e o grafo se reconstrói dos pedidos)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/lab/grafo')
  await page.getByRole('button', { name: 'Reconstruir o grafo a partir dos pedidos' }).click()
  // "reconstruído em" só aparece quando a reconstrução TERMINA; a contagem
  // sozinha já aparece antes, com o grafo antigo.
  await expect(page.getByRole('status', { name: 'Estado do grafo' })).toContainText(/\d[\d.]* relacionamentos COMPROU — reconstruído em/, { timeout: 150_000 })

  // A opção é "produto · vendedor · N compradores": a resposta repete o SKU sem a contagem.
  const partida = (await page.getByLabel('SKU de partida').locator('option:checked').textContent())!.replace(/ · \d+ compradores$/, '')
  for (const pergunta of ['Quem comprou também comprou (2 saltos)', 'Alcance em 3 saltos']) {
    await page.getByRole('radiogroup', { name: 'Pergunta' }).getByText(pergunta, { exact: true }).click()
    await page.getByRole('button', { name: 'Perguntar aos dois bancos' }).click()
    await expect(page.getByRole('status', { name: 'Conclusão' })).toContainText('mesma resposta', { timeout: 60_000 })

    if (pergunta === 'Quem comprou também comprou (2 saltos)') {
      // Y5: a resposta se lê como recomendação — "quem comprou <produto>
      // também comprou <produto>" —, com o nome do catálogo (MongoDB), e não
      // o id do SKU nem o código da descrição do PostgreSQL.
      const resposta = page.getByRole('figure', { name: 'Quem comprou também comprou' })
      await expect(resposta.getByRole('heading'), '[Y5] o título diz de onde partiu').toHaveText(`Quem comprou ${partida} também comprou…`)
      const itens = resposta.getByRole('list', { name: 'Quem comprou também comprou' }).getByRole('listitem')
      const produtos = await page.getByRole('table', { name: 'Resposta dos dois bancos' }).locator('tbody td.produto').allTextContents()
      expect(produtos.length, '[Y5] há linhas na resposta').toBeGreaterThan(0)
      await expect(itens, '[Y5] uma barra por linha da resposta').toHaveCount(produtos.length)
      for (const [i, p] of produtos.entries()) {
        expect(p, '[Y5] produto e vendedor, não um id').toMatch(/^\S.* · \S/)
        expect(p, '[Y5] não é um pedaço de UUID').not.toMatch(/^[0-9a-f]{8}\b/)
        await expect(itens.nth(i), '[Y5] a barra diz o produto e quantos clientes').toHaveText(new RegExp(`^${escapar(p)}[\\d.]+ clientes?$`))
        await expect(itens.nth(i), '[Y5] a frase inteira na dica').toHaveAttribute('title', new RegExp(`^Quem comprou ${escapar(partida)} também comprou ${escapar(p)} — \\d+ clientes? (levou|levaram) os dois\\.$`))
      }
      await expect(page.getByRole('status', { name: 'Conclusão' }), '[Y5] a conclusão dá o exemplo mais forte').toContainText(`Quem comprou ${partida} também comprou`)
    } else {
      // Y5 no alcance: o total vem desmontado, salto a salto, com os
      // produtos do meio que levam aos clientes novos.
      const resposta = page.getByRole('figure', { name: 'Como o alcance se forma' })
      await expect(resposta.getByRole('heading', { level: 3 }), '[Y5] o título diz o total').toHaveText(new RegExp(`^Quem comprou ${escapar(partida)} alcança, em 3 saltos, [\\d.]+ clientes? novos?$`))
      await expect(resposta.getByRole('list', { name: 'Os três saltos' }).getByRole('listitem'), '[Y5] os três saltos').toHaveText([/^1º salto[\d.]+ clientes?/, /^2º salto[\d.]+ outros? produtos?/, /^3º salto[\d.]+ clientes? novos?/])
      const caminhos = resposta.getByRole('table', { name: 'Caminhos do alcance' }).locator('tbody tr')
      await expect(caminhos.first()).toBeVisible()
      for (const c of await caminhos.all()) {
        await expect(c.locator('td').first(), '[Y5] o produto do meio pelo nome').toHaveText(/^\S.* · \S/)
        await expect(c, '[Y5] cada caminho é uma frase').toHaveAttribute('title', new RegExp(`^Quem comprou ${escapar(partida)} também comprou .+ · .+; e .+ foi comprado por [\\d.]+ clientes? que nunca compraram`))
      }
    }
  }
})

// Texto de produto vira parte de uma RegExp: parênteses ("vol. 5") e pontos são literais.
function escapar(t: string) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
