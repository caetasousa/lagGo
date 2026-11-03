import { test, expect, abrirProduto, adicionarAoCarrinho } from './base'

test('[L6] os selos dizem o banco E o uso (cache, carrinho, ranking…)', async ({ page, api }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Mais vendidos/ }).locator('.banco')).toHaveText(/Redis · ranking de mais vendidos/)
  await expect(page.getByRole('heading', { name: /Categorias/ }).locator('.banco')).toHaveText(/PostgreSQL · árvore de categorias/)

  const p = await api.produtoComEstoque(5, 1e9, 13)
  await abrirProduto(page, p.id)
  await expect(page.getByRole('heading', { name: /^Ofertas/ }).locator('.banco')).toHaveText(/PostgreSQL · preço e estoque das ofertas/)
  await expect(page.locator('.banco', { hasText: 'cache do produto' })).toHaveText(/Redis · cache do produto/)
  await adicionarAoCarrinho(page)
  await page.goto('/carrinho')
  await expect(page.getByRole('heading', { name: /^Itens/ }).locator('.banco').first()).toHaveText(/Redis · carrinho da sessão/)

  await page.goto('/dba?aba=nosql')
  await expect(page.getByRole('table', { name: 'Chaves por prefixo' }).getByRole('row', { name: /carrinho:\*/ })).toContainText('carrinho da sessão')
})

test('[K1] escolher uma opção mostra a explicação daquela opção', async ({ page }) => {
  await page.goto('/lab')
  const sobre = page.getByRole('region', { name: 'Sobre esta opção' })
  await page.getByText('SELECT FOR UPDATE', { exact: true }).click()
  await expect(sobre).toContainText('Lock pessimista')
  await expect(sobre).toContainText('FOR UPDATE')
  await page.getByText('UPDATE condicional', { exact: true }).click()
  await expect(sobre).toContainText('UM comando')

  await page.goto('/lab/isolamento')
  await page.getByRole('button', { name: /^Write skew/ }).click()
  await page.getByLabel('SERIALIZABLE', { exact: true }).check()
  await expect(sobre).toContainText('plantão')
  await expect(sobre).toContainText('detector de conflitos')
  await expect(sobre).toContainText('BEGIN ISOLATION LEVEL SERIALIZABLE')
})

test('[K2] cada laboratório diz que recurso usa', async ({ page }) => {
  const esperado: [string, RegExp][] = [
    ['/lab', /PostgreSQL · estoque/],
    ['/lab/isolamento', /PostgreSQL · tabelas do laboratório/],
    ['/lab/mvcc', /PostgreSQL · tabelas do laboratório/],
    ['/lab/expurgo', /PostgreSQL · auditoria particionada/],
    ['/lab/conexoes', /PgBouncer · pool de conexões/],
    ['/lab/cache', /Redis · cache do produto/],
    ['/indices', /PostgreSQL · pedidos e pagamentos/],
    ['/lab/replicacao', /PostgreSQL · réplica de leitura/],
    ['/lab/backup', /PostgreSQL · backup e WAL arquivado/],
    ['/lab/ha', /PostgreSQL · cluster Patroni/],
  ]
  for (const [url, uso] of esperado) {
    await page.goto(url)
    const ficha = page.getByRole('region', { name: 'O que este laboratório usa' })
    await expect(ficha, url).toContainText(uso)
    await expect(ficha, url).toContainText('Estrutura')
    await expect(page.getByRole('region', { name: 'O conceito' }).or(page.getByRole('region', { name: 'Índices do zero' })), url).toBeVisible()
  }
  await page.goto('/lab/cache')
  await expect(page.getByRole('region', { name: 'O Redis neste projeto: 5 usos diferentes' })).toContainText('fila de eventos de pedidos')
})

test('[E6] cada experimento de índice diz a pergunta, o sem e o com índice', async ({ page }) => {
  await page.goto('/indices')
  await page.getByRole('button', { name: /Busca por nome ignorando maiúsculas/ }).click()
  const exp = page.getByRole('region', { name: 'O experimento' })
  for (const parte of ['A pergunta', 'Sem índice, o banco…', 'Com o índice…', 'O que observar']) await expect(exp).toContainText(parte)
  await expect(exp).toContainText('Ana Silva')
  await expect(page.locator('.card').filter({ hasText: 'idx_lab_cliente_lower_nome ON cliente' })).toContainText('RESULTADO de lower(nome)')
  await page.getByRole('button', { name: '2. O índice' }).click()
  await expect(page.getByRole('img', { name: /B-tree/ })).toBeVisible()
})

// Como quebra: um laboratório novo (ou reescrito) volta a ter só o texto
// corrido, sem o passo a passo; um passo novo entra sem dizer de onde veio;
// o componente de tutorial perde a navegação e só o primeiro passo aparece.
test('[K4] todo laboratório tem o tutorial "do zero", com ilustração e fontes em cada passo', async ({ page }) => {
  const labs: [string, string][] = [
    ['/lab', 'Concorrência do zero'],
    ['/lab/isolamento', 'Isolamento do zero'],
    ['/lab/mvcc', 'MVCC e VACUUM do zero'],
    ['/lab/expurgo', 'Particionamento do zero'],
    ['/lab/conexoes', 'Conexões do zero'],
    ['/lab/cache', 'Cache do zero'],
    ['/indices', 'Índices do zero'],
    ['/lab/replicacao', 'Replicação do zero'],
    ['/lab/backup', 'Backup e PITR do zero'],
    ['/lab/ha', 'Alta disponibilidade do zero'],
  ]
  for (const [url, nome] of labs) {
    await page.goto(url)
    const tutorial = page.getByRole('region', { name: nome })
    const passos = tutorial.getByRole('navigation', { name: 'Passos do tutorial' }).getByRole('button')
    await expect(passos.first(), url).toBeVisible()
    const n = await passos.count()
    expect(n, `${url}: passos`).toBeGreaterThanOrEqual(6)
    let ilustracoes = 0
    for (let i = 0; i < n; i++) {
      await passos.nth(i).click()
      await expect(passos.nth(i)).toHaveAttribute('aria-current', 'true')
      const fontes = tutorial.getByRole('region', { name: 'Fontes deste passo' }).getByRole('link')
      await expect(fontes.first(), `${url} passo ${i + 1} sem fontes`).toBeVisible()
      ilustracoes += await tutorial.getByRole('img').count()
    }
    expect(ilustracoes, `${url}: nenhuma ilustração`).toBeGreaterThan(0)
  }
})

// Como quebra: a opção escolhida, o experimento ou a página inteira perdem a
// lista de fontes; um link vira texto solto (sem href) ou abre na mesma aba
// e tira o aluno do laboratório.
test('[K3] cada opção, experimento e laboratório diz de onde veio', async ({ page }) => {
  await page.goto('/lab')
  await page.getByText('SELECT FOR UPDATE', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sobre esta opção' }).getByRole('region', { name: 'Fontes desta opção' }))
    .toContainText('Explicit Locking: Row-Level Locks')

  await page.goto('/lab/isolamento')
  await page.getByRole('button', { name: /^Write skew/ }).click()
  await expect(page.getByRole('region', { name: 'Sobre esta opção' }).getByRole('link', { name: /Serializable Snapshot Isolation/ }))
    .toHaveAttribute('href', 'https://drkp.net/papers/ssi-vldb12.pdf')

  await page.goto('/indices')
  await page.getByRole('button', { name: /Busca por nome ignorando maiúsculas/ }).click()
  await expect(page.getByRole('region', { name: 'O experimento' }).getByRole('region', { name: 'Fontes deste experimento' }))
    .toContainText('Indexes on Expressions')

  for (const url of ['/lab', '/lab/isolamento', '/lab/mvcc', '/lab/expurgo', '/lab/conexoes', '/lab/cache', '/indices', '/lab/replicacao', '/lab/backup', '/lab/ha']) {
    await page.goto(url)
    if (url !== '/indices') {
      await expect(page.getByRole('region', { name: 'Sobre esta opção' }).first()
        .getByRole('region', { name: 'Fontes desta opção' }).getByRole('link').first(), url).toBeVisible()
    }
    const lista = page.getByRole('region', { name: 'Fontes para pesquisar' })
    await expect(lista, url).toContainText('documentação oficial')
    await expect(lista, url).toContainText('Confirma:')
    // Só os itens da lista: o link "Material completo do tópico" é interno ([M5]).
    const links = lista.getByRole('listitem').getByRole('link')
    expect(await links.count(), `${url}: fontes`).toBeGreaterThanOrEqual(5)
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('href', /^https:\/\//)
      await expect(link).toHaveAttribute('target', '_blank')
    }
  }
})

// Como quebra: a lista volta a ser uma grade única; um laboratório vai para o
// serviço errado (Conexões em "postgres", Cache em "mongo"); um serviço sem
// laboratório (mongo) ou só de perfil (cassandra, neo4j) some da página.
test('[K5] os laboratórios aparecem agrupados pelos serviços do docker compose', async ({ page }) => {
  await page.goto('/labs')
  const servico = (nome: string) => page.getByRole('region', { name: `Serviço ${nome}`, exact: true })
  const esperado: [string, RegExp[]][] = [
    ['postgres', [/Concorrência/, /Isolamento e deadlock/, /Índices/, /MVCC e VACUUM/, /Particionamento e expurgo/, /Backup e PITR/]],
    ['postgres-replica', [/Replicação/]],
    ['pgbouncer', [/Conexões e PgBouncer/]],
    ['redis', [/Cache/]],
    ['patroni', [/Failover com Patroni/]],
    ['mongo-ha', [/Eleição no replica set/]],
    ['redis-ha', [/Failover com Sentinel/]],
  ]
  for (const [nome, labs] of esperado) {
    for (const lab of labs) await expect(servico(nome).locator('.grade-labs').getByRole('link', { name: lab }), `${nome}: ${lab}`).toBeVisible()
  }
  await expect(servico('postgres').locator('.grade-labs').getByRole('link', { name: /Conexões/ })).toHaveCount(0)
  await expect(servico('mongo')).toContainText('Ainda sem laboratório próprio')
  await expect(servico('mongo').getByRole('link', { name: 'Laboratório de Cache' })).toBeVisible()
  for (const nome of ['cassandra', 'neo4j']) {
    await expect(servico(nome), nome).toContainText('perfil nosql')
    await expect(servico(nome), nome).toContainText('Fase 7')
  }
  await servico('pgbouncer').getByRole('link', { name: /Conexões e PgBouncer/ }).click()
  await expect(page).toHaveURL(/\/lab\/conexoes$/)
})
