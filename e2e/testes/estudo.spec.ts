import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './base'

// O material de estudo (docs/*.md) renderizado dentro do app. O teste lê os
// MESMOS arquivos .md (o rodar.sh copia docs/ para o container) e confere que
// a tela mostra o que eles têm: assim o app não fica mais raso que o .md.

const DOCS = process.env.E2E_DOCS ?? join(import.meta.dirname, '..', '..', 'docs')

type Documento = { slug: string; titulo: string; secoes: string[]; fontes: string[]; diagramas: number }

// Texto do título como aparece na tela: sem a marcação do Markdown. Dentro
// de `código` nada muda (o "*" de `pg_stat_*` fica).
const limpar = (t: string) => t.split('`')
  .map((parte, i) => (i % 2 ? parte : parte.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '').replace(/\*([^*]+)\*/g, '$1')))
  .join('').trim()

function ler(caminho: string): Documento {
  const linhas = readFileSync(caminho, 'utf8').split('\n')
  let dentroDeCodigo = false
  let emFontes = false
  const d: Documento = { slug: caminho.split('/').pop()!.replace(/\.md$/, ''), titulo: '', secoes: [], fontes: [], diagramas: 0 }
  for (const l of linhas) {
    if (l.startsWith('```mermaid')) d.diagramas++
    if (l.startsWith('```')) { dentroDeCodigo = !dentroDeCodigo; continue }
    if (dentroDeCodigo) continue
    if (l.startsWith('# ') && !d.titulo) d.titulo = limpar(l.slice(2))
    if (l.startsWith('## ')) {
      d.secoes.push(limpar(l.slice(3)))
      emFontes = /^Fontes/.test(limpar(l.slice(3)))
    }
    if (emFontes) for (const m of l.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) d.fontes.push(m[1])
  }
  return d
}

// O nome acessível de um título com `código` pode ganhar um espaço antes da
// pontuação seguinte ("perfil ha )"): o texto tem de bater, os espaços não.
const nomeDoTitulo = (texto: string) =>
  new RegExp('^' + texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ ?(\\?[).,:])/g, '\\s*$1') + '$')

const documentos = [
  ...readdirSync(DOCS).filter((f) => f.endsWith('.md')).map((f) => join(DOCS, f)),
  ...readdirSync(join(DOCS, 'fases')).filter((f) => f.endsWith('.md')).map((f) => join(DOCS, 'fases', f)),
].map(ler)

// Como quebra: um arquivo novo em docs/ não entra no app; o app mostra uma
// versão resumida (sem as seções do .md); as fontes viram texto solto.
test('[M1][M2] cada documento de docs/ aparece no app com todas as seções e fontes do .md', async ({ page }) => {
  expect(documentos.length).toBeGreaterThanOrEqual(16)
  await page.goto('/estudo')
  const indice = page.getByRole('region', { name: 'Material de estudo' })
  for (const d of documentos) await expect(indice.getByRole('link', { name: d.titulo }), d.slug).toBeVisible()

  for (const d of documentos) {
    await page.goto(`/estudo/${d.slug}`)
    const artigo = page.getByRole('article', { name: d.titulo })
    await expect(artigo.getByRole('heading', { level: 1 }), d.slug).toHaveText(d.titulo)
    for (const s of d.secoes) await expect(artigo.getByRole('heading', { level: 2, name: nomeDoTitulo(s) }), `${d.slug}: ${s}`).toBeVisible()
    for (const url of d.fontes) {
      const link = artigo.locator(`a[href="${url}"]`).first()
      await expect(link, `${d.slug}: ${url}`).toBeVisible()
      await expect(link).toHaveAttribute('target', '_blank')
    }
  }
})

// Como quebra: o link relativo do .md (fases/fase-4.md#…) vira um 404 do
// SPA, ou abre o documento certo mas no topo, longe da seção citada.
test('[M3] link entre documentos leva à seção certa', async ({ page }) => {
  await page.goto('/estudo/06-postgresql-admin')
  await page.locator('a[href="/estudo/fase-4#3-resultados-medidos"]').first().click()
  await expect(page).toHaveURL(/\/estudo\/fase-4#3-resultados-medidos$/)
  await expect(page.getByRole('heading', { name: '3. Resultados medidos', exact: true })).toBeInViewport()
})

// Como quebra: sem o plugin de tabelas, a tabela vira texto com "|"; sem o
// Mermaid, o diagrama aparece como código; um diagrama com erro de sintaxe no
// .md (ex.: ";" dentro de uma mensagem do sequenceDiagram, que o Mermaid lê
// como fim de comando) mostra "Syntax error in text" em vez do desenho.
test('[M4] tabelas e TODOS os diagramas dos documentos são desenhados', async ({ page }) => {
  await page.goto('/estudo/03-transacoes-acid')
  await expect(page.getByRole('article', { name: /^03 · Transações/ }).getByRole('table').first()).toBeVisible()

  const comDiagrama = documentos.filter((d) => d.diagramas > 0)
  expect(comDiagrama.length).toBeGreaterThan(0)
  for (const d of comDiagrama) {
    await page.goto(`/estudo/${d.slug}`)
    const artigo = page.getByRole('article', { name: d.titulo })
    await expect(artigo.locator('figure.diagrama svg'), d.slug).toHaveCount(d.diagramas)
    await expect(artigo.locator('.diagrama-erro'), d.slug).toHaveCount(0)
    await expect(artigo.locator('code.language-mermaid'), d.slug).toHaveCount(0)
    await expect(page.getByText('Syntax error in text'), d.slug).toHaveCount(0)
  }
})

// Como quebra: o laboratório perde o link para o material completo, ou ele
// aponta para o documento errado.
test('[M5] cada laboratório leva ao material completo do seu tópico', async ({ page }) => {
  const labs: [string, string][] = [
    ['/lab', '03-transacoes-acid'],
    ['/lab/isolamento', '03-transacoes-acid'],
    ['/indices', '04-indices-otimizacao'],
    ['/lab/mvcc', '06-postgresql-admin'],
    ['/lab/expurgo', '06-postgresql-admin'],
    ['/lab/conexoes', '06-postgresql-admin'],
    ['/lab/cache', '07-nosql'],
    ['/lab/replicacao', '08-replicacao-backup'],
    ['/lab/backup', '08-replicacao-backup'],
    ['/lab/ha', '09-alta-disponibilidade'],
  ]
  for (const [url, slug] of labs) {
    await page.goto(url)
    const link = page.getByRole('region', { name: 'Fontes para pesquisar' }).getByRole('link', { name: /Material completo/ })
    await expect(link, url).toHaveAttribute('href', `/estudo/${slug}`)
  }
  await page.getByRole('region', { name: 'Fontes para pesquisar' }).getByRole('link', { name: /Material completo/ }).click()
  await expect(page.getByRole('article', { name: /^09 · Alta disponibilidade/ })).toBeVisible()
})
