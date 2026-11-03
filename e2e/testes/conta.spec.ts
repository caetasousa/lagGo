import { test, expect, abrirProduto, adicionarAoCarrinho, dadosDeCadastro, entrar } from './base'

// Cadastro, login e conta (Fase 6, cenários Q). Q7 e W1–W3 (o que fica no
// banco e no Redis) são da integração: a tela não vê hash nem policy.

test('[Q1] [Q2] criar conta pela tela entra na conta; sair encerra a sessão', async ({ page }) => {
  const d = dadosDeCadastro('Carla Cadastro')
  await page.goto('/cadastro')
  const form = page.getByRole('form', { name: 'Criar conta' })
  await form.getByLabel('Nome completo').fill(d.nome)
  await form.getByLabel('E-mail').fill(d.email)
  await form.getByLabel(/^Senha/).fill('curta')
  await form.getByLabel(/^CPF/).fill(d.cpf)
  await form.getByLabel('CEP').fill(d.endereco.cep)
  await form.getByLabel('Logradouro').fill(d.endereco.logradouro)
  await form.getByLabel('Número').fill(d.endereco.numero)
  await form.getByLabel('Cidade').fill(d.endereco.cidade)
  // Q1: senha curta — o navegador barra (minLength) e o servidor também.
  await form.getByRole('button', { name: 'Criar minha conta' }).click()
  await expect(page).toHaveURL(/\/cadastro$/)
  await form.getByLabel(/^Senha/).fill(d.senha)
  await form.getByRole('button', { name: 'Criar minha conta' }).click()

  // Q2: entrou — o cabeçalho reconhece e a conta mostra os dados MASCARADOS (Q6).
  await expect(page).toHaveURL(/\/conta$/)
  await expect(page.getByRole('link', { name: 'Minha conta (Carla Cadastro)' })).toBeVisible()
  const dados = page.getByLabel('Meus dados')
  await expect(dados).toContainText(`***.***.***-${d.cpf.slice(-2)}`)
  await expect(dados).not.toContainText(d.cpf)
  await expect(dados).toContainText(/e\*\*\*@exemplo\.com/)

  // Q1: o mesmo e-mail não cria outra conta.
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()
  await page.goto('/conta')
  await expect(page).toHaveURL(/\/entrar\?voltar=(%2F|\/)conta$/)
  await page.goto('/cadastro')
  await form.getByLabel('Nome completo').fill('Outra Pessoa')
  await form.getByLabel('E-mail').fill(d.email.toUpperCase())
  await form.getByLabel(/^Senha/).fill(d.senha)
  await form.getByLabel(/^CPF/).fill(dadosDeCadastro().cpf)
  await form.getByLabel('CEP').fill(d.endereco.cep)
  await form.getByLabel('Logradouro').fill('Rua B')
  await form.getByLabel('Número').fill('1')
  await form.getByLabel('Cidade').fill('Recife')
  await form.getByRole('button', { name: 'Criar minha conta' }).click()
  await expect(form.getByRole('alert')).toHaveText('este e-mail já tem uma conta')
})

test('[Q3] senha errada e e-mail sem conta dão a mesma mensagem; a certa entra', async ({ page, api }) => {
  const conta = await api.novaConta('Diego Login')
  await page.goto('/entrar')
  const form = page.getByRole('form', { name: 'Entrar' })
  const tentar = async (email: string, senha: string) => {
    await form.getByLabel('E-mail').fill(email)
    await form.getByLabel('Senha').fill(senha)
    await form.getByRole('button', { name: 'Entrar na conta' }).click()
  }
  await tentar(conta.email, 'senha errada errada')
  const erro = form.getByRole('alert')
  await expect(erro).toBeVisible()
  const mensagem = await erro.innerText()
  await tentar(`ninguem-${conta.email}`, 'senha errada errada')
  await expect(erro).toHaveText(mensagem)
  await expect(erro).toHaveText('e-mail ou senha incorretos')

  await tentar(conta.email, conta.senha)
  await expect(page.getByRole('link', { name: 'Minha conta (Diego Login)' })).toBeVisible()
})

test('[Q4] sem login dá para montar o carrinho, mas finalizar pede para entrar e volta ao carrinho', async ({ page, api }) => {
  const conta = await api.novaConta('Eva Carrinho')
  const p = await api.produtoComEstoque(5, 1e9, 13)
  await abrirProduto(page, p.id)
  await adicionarAoCarrinho(page)
  await page.goto('/carrinho')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
  await page.getByRole('link', { name: 'entre na sua conta' }).click()

  const form = page.getByRole('form', { name: 'Entrar' })
  await form.getByLabel('E-mail').fill(conta.email)
  await form.getByLabel('Senha').fill(conta.senha)
  await form.getByRole('button', { name: 'Entrar na conta' }).click()
  await expect(page).toHaveURL(/\/carrinho$/)
  await expect(page.getByText('Comprando como Eva Carrinho')).toBeVisible()
  await page.getByRole('button', { name: 'Finalizar compra' }).click()
  await expect(page.locator('.painel').filter({ hasText: 'Pedido criado' })).toContainText('Eva Carrinho')

  // Q4 pela API: comprar mandando o cliente_id de OUTRA pessoa é recusado.
  const outra = await api.novaConta('Fabio Terceiro')
  const r = await conta.r.post('/api/checkout', { data: { cliente_id: outra.id, metodo_pagamento: 'PIX',
    itens: [{ sku_id: p.oferta.id, quantidade: 1 }] } })
  expect(r.status()).toBe(422)
})

test('[Q5] a lista pública de clientes e o pedido aberto por id não existem mais', async ({ api }) => {
  const conta = await api.novaConta()
  expect((await conta.r.get('/api/loja/clientes?limite=5')).status()).toBe(404)
  expect((await conta.r.get(`/api/loja/clientes/${conta.id}/pedidos`)).status()).toBe(404)
})

test('[Q6] excluir a conta tira o nome da avaliação e impede entrar de novo', async ({ page, api }) => {
  const conta = await api.novaConta('Gabi Esquecida')
  const p = await api.produtoComEstoque(1, 1e9, 3)
  await entrar(page, conta)
  await abrirProduto(page, p.id)
  await page.getByLabel('Comentário').fill('Avaliação que vai ficar anônima (Q6)')
  await page.getByRole('button', { name: 'Enviar avaliação' }).click()
  const recentes = page.getByRole('list', { name: 'Avaliações recentes' })
  await expect(recentes.locator('li').first()).toContainText('Gabi E.')

  await page.goto('/conta')
  const excluir = page.getByRole('button', { name: 'Excluir minha conta' })
  await expect(excluir).toBeDisabled()
  await page.getByLabel('Entendo que não dá para desfazer').check()
  await excluir.click()
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()

  await abrirProduto(page, p.id)
  await expect(recentes.locator('li').filter({ hasText: 'Avaliação que vai ficar anônima (Q6)' })).toContainText('Cliente removido')
  const r = await api.post('/conta/entrar', { email: conta.email, senha: conta.senha })
  expect(r.status).toBe(401)
})
