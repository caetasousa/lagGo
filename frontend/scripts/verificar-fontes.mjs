// Confere os links do catálogo de fontes (src/components/fontes.tsx):
// cada URL precisa responder 2xx e, se tiver #âncora, a âncora precisa
// existir na página. Uso: `make links` (precisa de internet).
//
// Alguns sites recusam robôs (o DOI da ACM devolve 403 para qualquer cliente
// que não seja navegador): esses entram como AVISO, não como falha.
import { readFileSync } from 'node:fs'

const arquivo = new URL('../src/components/fontes.tsx', import.meta.url)
const fonte = readFileSync(arquivo, 'utf8')
const PG = /const PG = '([^']+)'/.exec(fonte)[1]
const urls = [...fonte.matchAll(/url: (?:`\$\{PG\}([^`]+)`|'([^']+)')/g)].map((m) => (m[1] ? PG + m[1] : m[2]))
const unicas = [...new Set(urls)]
const SO_AVISO = [/^https:\/\/doi\.org\/10\.1145\//]

const paginas = new Map()
// Uma tentativa com prazo de 20 s; falha de REDE (status 0) ganha uma segunda
// chance — a internet do WSL às vezes derruba uma conexão no meio.
function tentar(url) {
  return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000),
                      headers: { 'user-agent': 'Mozilla/5.0 (verificador de fontes nosqlGo)' } })
    .then(async (r) => ({ status: r.status, corpo: r.ok ? await r.text() : '' }))
    .catch((e) => ({ status: 0, corpo: '', erro: e.message }))
}
async function baixar(url) {
  if (!paginas.has(url)) {
    paginas.set(url, tentar(url).then((r) => (r.status === 0 ? tentar(url) : r)))
  }
  return paginas.get(url)
}

let falhas = 0
for (const url of unicas) {
  const [base, ancora] = url.split('#')
  const r = await baixar(base)
  let problema = ''
  if (r.status < 200 || r.status >= 300) problema = `HTTP ${r.status}${r.erro ? ` (${r.erro})` : ''}`
  else if (ancora && !new RegExp(`id=["']${ancora}["']`, 'i').test(r.corpo)) problema = `âncora #${ancora} não encontrada`
  if (!problema) { console.log(`ok     ${url}`); continue }
  if (SO_AVISO.some((re) => re.test(url))) { console.log(`aviso  ${url} — ${problema} (site recusa robôs; confira no navegador)`); continue }
  console.log(`FALHA  ${url} — ${problema}`)
  falhas++
}
console.log(`\n${unicas.length} links, ${falhas} falha(s).`)
process.exit(falhas ? 1 : 0)
