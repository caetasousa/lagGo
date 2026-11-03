import { test, expect } from './base'
import type { Page } from '@playwright/test'

// Navegação e tema (cenários V1–V4). O cabeçalho é o mesmo em todas as
// páginas: se ele quebra, a aplicação inteira parece quebrada.

const DESTINOS = ['Início', 'Catálogo', 'Meus pedidos', 'Material', 'Laboratórios', 'Relatórios', 'Painel do DBA']

const menu = (page: Page) => page.getByRole('navigation', { name: 'Principal' })

test('[V1] no celular o cabeçalho é compacto e o menu recolhido abre, leva à página e fecha', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const cabecalho = page.getByRole('banner')
  await expect(cabecalho).toBeVisible()
  // Marca, carrinho, botão do menu e a busca: no máximo duas faixas.
  expect((await cabecalho.boundingBox())!.height, 'altura do cabeçalho no celular').toBeLessThanOrEqual(140)
  await expect(menu(page).getByRole('link', { name: 'Laboratórios' })).toBeHidden()

  const botao = page.getByRole('button', { name: 'Menu' })
  await expect(botao).toHaveAttribute('aria-expanded', 'false')
  await botao.click()
  await expect(botao).toHaveAttribute('aria-expanded', 'true')
  for (const d of DESTINOS) await expect(menu(page).getByRole('link', { name: d, exact: true }), d).toBeVisible()
  await expect(menu(page).getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()

  await menu(page).getByRole('link', { name: 'Laboratórios', exact: true }).click()
  await expect(page).toHaveURL(/\/labs$/)
  await expect(botao).toHaveAttribute('aria-expanded', 'false')
  await expect(menu(page).getByRole('link', { name: 'Laboratórios', exact: true })).toBeHidden()

  // Escape também fecha.
  await botao.click()
  await page.keyboard.press('Escape')
  await expect(botao).toHaveAttribute('aria-expanded', 'false')
})

test('[V2] no computador todos os destinos cabem numa linha, sem rolagem horizontal', async ({ page }) => {
  for (const largura of [1024, 1280, 1440]) {
    await page.setViewportSize({ width: largura, height: 800 })
    await page.goto('/dba')
    await expect(page.getByRole('button', { name: 'Menu' }), `${largura}px: sem botão de menu`).toBeHidden()
    const alturas = new Set<number>()
    for (const d of DESTINOS) {
      const link = menu(page).getByRole('link', { name: d, exact: true })
      await expect(link, `${largura}px: ${d}`).toBeVisible()
      await expect(link, `${largura}px: ${d} cabe na tela`).toBeInViewport({ ratio: 1 })
      const caixa = (await link.boundingBox())!
      expect(caixa.height, `${largura}px: "${d}" não quebra linha`).toBeLessThan(48)
      alturas.add(Math.round(caixa.y + caixa.height / 2))
    }
    expect(alturas.size, `${largura}px: todos os links na mesma linha`).toBe(1)
    const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(rolagem, `${largura}px: rolagem horizontal`).toBeLessThanOrEqual(0)
  }
})

test('[V3] a seção atual fica marcada no menu, inclusive dentro de um laboratório', async ({ page }) => {
  const casos: [string, string][] = [
    ['/', 'Início'], ['/loja', 'Catálogo'], ['/labs', 'Laboratórios'], ['/lab/mvcc', 'Laboratórios'],
    ['/indices', 'Laboratórios'], ['/lab', 'Laboratórios'], ['/estudo', 'Material'], ['/dba', 'Painel do DBA'],
  ]
  for (const [rota, ativo] of casos) {
    await page.goto(rota)
    await expect(menu(page).getByRole('link', { name: ativo, exact: true }), `${rota} acende ${ativo}`).toHaveAttribute('aria-current', 'page')
    await expect(menu(page).locator('[aria-current=page]'), `${rota}: só um destino aceso`).toHaveCount(1)
  }
})

test('[V4] o tema escuro mantém o contraste do texto, inclusive nas ilustrações', async ({ page }) => {
  await page.goto('/lab/mvcc')
  // Avança pelos passos do tutorial até o primeiro que tem desenho.
  const ilustracao = page.locator('svg.ilustracao').first()
  const passos = page.getByRole('navigation', { name: 'Passos do tutorial' }).getByRole('button')
  for (let k = 0; k < await passos.count() && !(await ilustracao.isVisible()); k++) await passos.nth(k).click()
  await expect(ilustracao).toBeVisible()

  const r = await page.evaluate(() => {
    const rgb = (cor: string) => {
      const m = cor.match(/[\d.]+/g)!.map(Number)
      return m.slice(0, 3)
    }
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contraste = (a: string, b: string) => {
      const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x)
      return (l1 + 0.05) / (l2 + 0.05)
    }
    // Resolve uma variável do tema para rgb() usando um elemento de prova.
    const prova = document.createElement('span')
    document.body.append(prova)
    const tom = (v: string) => { prova.style.color = `var(${v})`; return getComputedStyle(prova).color }

    const tokens: Record<string, number> = {}
    for (const texto of ['--texto', '--texto-2', '--texto-3', '--destaque'])
      for (const fundo of ['--fundo', '--superficie'])
        tokens[`${texto} sobre ${fundo}`] = contraste(tom(texto), tom(fundo))

    // Cada caixa da ilustração: o texto contra o retângulo em que está escrito;
    // texto solto contra o painel em que a ilustração é desenhada.
    const svg = document.querySelector('svg.ilustracao')!
    const painel = tom('--superficie')
    const ilustracao: { texto: string; contraste: number }[] = []
    for (const t of svg.querySelectorAll('text')) {
      const caixa = t.parentElement?.querySelector(':scope > rect')
      const fundo = caixa ? getComputedStyle(caixa).fill : painel
      ilustracao.push({ texto: t.textContent!.slice(0, 40), contraste: contraste(getComputedStyle(t).fill, fundo) })
    }
    prova.remove()
    return { tokens, ilustracao, corDoFundo: getComputedStyle(document.documentElement).backgroundColor }
  })

  // É o tema escuro: o fundo da página é escuro.
  const [rf, gf, bf] = r.corDoFundo.match(/\d+/g)!.map(Number)
  expect(rf + gf + bf, `fundo da página ${r.corDoFundo}`).toBeLessThan(150)
  for (const [par, c] of Object.entries(r.tokens)) expect(c, par).toBeGreaterThanOrEqual(4.5)
  expect(r.ilustracao.length).toBeGreaterThan(0)
  for (const t of r.ilustracao) expect(t.contraste, `ilustração: "${t.texto}"`).toBeGreaterThanOrEqual(4.5)
})
