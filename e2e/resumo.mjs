// Gera relatorio/resumo.md a partir do resultados.json do Playwright.
//
// O resumo é o artefato que se confere sem rodar nada: cada id do CENARIOS.md
// com o resultado do teste que o cobre e o print do estado final, mais o
// commit e as imagens exatas da execução. Um id sem teste aparece como lacuna.
// Roda dentro do container do Playwright: commit e imagens chegam por
// variável de ambiente (E2E_COMMIT, E2E_IMAGENS), calculados pelo rodar.sh.

import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

const resultados = JSON.parse(readFileSync('relatorio/resultados.json', 'utf8'))

const cenarios = []
for (const linha of readFileSync('CENARIOS.md', 'utf8').split('\n')) {
  const m = /^\| ([A-Z]\d+) \| (.+?) \| (.+?) \|$/.exec(linha)
  if (m) cenarios.push({ id: m[1], quebra: m[2] })
}

const limpar = (msg) => {
  const linhas = msg.replace(/\u001b\[\d+m/g, '').split('\n').map((l) => l.trim())
  const alvo = linhas.find((l) => /^(Locator|Expected|Received):/.test(l))
  return [linhas[0], alvo].filter(Boolean).join(' — ')
}

const testes = []
function percorrer(suite) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const r = t.results.at(-1) ?? {}
      const print = (r.attachments ?? []).find((a) => a.name === 'screenshot' && a.path)
      testes.push({
        // Um teste pode cobrir vários cenários: "[L2] [L3] …" conta para os dois.
        ids: [...spec.title.matchAll(/\[([A-Z]\d+)\]/g)].map((m) => m[1]),
        titulo: spec.title.replace(/^(\[[A-Z]\d+\]\s*)+/, ''),
        arquivo: spec.file,
        estado: t.status === 'expected' ? 'passou' : t.status === 'skipped' ? 'pulado' : 'FALHOU',
        erro: limpar(r.error?.message ?? ''),
        print: print ? relative('relatorio', print.path) : '',
      })
    }
  }
  for (const s of suite.suites ?? []) percorrer(s)
}
for (const s of resultados.suites) percorrer(s)

const passou = testes.filter((t) => t.estado === 'passou').length
const falhou = testes.filter((t) => t.estado === 'FALHOU')
const cobre = (t, id) => t.ids.includes(id)
// Cenário que o catálogo diz ser coberto fora do navegador (integração,
// unidade, verificação manual) não é lacuna do E2E: aparece como tal.
const foraDoE2E = (c) => /\((integração|unidade|verificação manual)/.test(c.quebra)
const semTeste = cenarios.filter((c) => !testes.some((t) => cobre(t, c.id)) && !foraDoE2E(c))
const semId = testes.filter((t) => !t.ids.length || !t.ids.some((id) => cenarios.some((c) => c.id === id)))
const imagens = (process.env.E2E_IMAGENS ?? '').split('\n').filter(Boolean)
  .map((l) => { const [s, i] = l.split(' '); return `| ${s} | \`${i}\` |` })

const linhas = [
  '# Resultado da suíte E2E',
  '',
  `- quando: ${new Date(resultados.stats.startTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  `- commit: ${process.env.E2E_COMMIT || '?'}`,
  `- duração: ${(resultados.stats.duration / 1000).toFixed(1)} s`,
  `- **${passou} de ${testes.length} passaram**${falhou.length ? `, ${falhou.length} falharam` : ''}`,
  '',
  'Refazer: `make e2e` (sobe o mesmo stack do zero e roda tudo de novo).',
  '',
  '## Por cenário',
  '',
  '| id | como quebra | resultado | print |',
  '|---|---|---|---|',
  ...cenarios.map((c) => {
    const ts = testes.filter((x) => cobre(x, c.id))
    if (!ts.length) return `| ${c.id} | ${c.quebra} | ${foraDoE2E(c) ? 'fora do E2E (veja a linha)' : 'sem teste'} | |`
    const estado = ts.some((t) => t.estado === 'FALHOU') ? 'FALHOU' : ts.every((t) => t.estado === 'passou') ? 'passou' : 'pulado'
    const prints = ts.filter((t) => t.print).map((t, i) => `[print${ts.length > 1 ? ` ${i + 1}` : ''}](${t.print})`).join(' ')
    return `| ${c.id} | ${c.quebra} | ${estado} | ${prints} |`
  }),
  '',
]
if (falhou.length) {
  linhas.push('## Falhas', '')
  for (const t of falhou) linhas.push(`- **[${t.ids.join('] [')}] ${t.titulo}** (${t.arquivo}): ${t.erro}`)
  linhas.push('', 'O relatório HTML (`html/index.html`) tem o trace de cada falha.', '')
}
if (semTeste.length) linhas.push('## Lacunas', '', ...semTeste.map((c) => `- ${c.id}: ${c.quebra}`), '')
if (semId.length) linhas.push('## Testes sem cenário no catálogo', '', ...semId.map((t) => `- ${t.titulo}`), '')
if (imagens.length) linhas.push('## Imagens usadas', '', '| serviço | imagem |', '|---|---|', ...imagens, '')

writeFileSync('relatorio/resumo.md', linhas.join('\n'))
console.log(`resumo: ${passou}/${testes.length} passaram${falhou.length ? ` — falharam: ${falhou.map((t) => t.ids.join('+')).join(', ')}` : ''}`)
