import { test, expect } from './base'

// Fase 5, perfil ha: os clusters de laboratório de alta disponibilidade.
// Serial: um ensaio por vez (o laboratório recusa dois ao mesmo tempo).
// U6 (perfil desligado) não cabe aqui — o stack de E2E sobe o perfil — e é
// coberto pelo teste de unidade em backend/internal/laboratorio/aplicacao/ha_test.go.
test.describe.configure({ mode: 'serial' })

const tituloConclusao = /^(\S+) → (\S+): a escrita ficou fora por/

async function ensaiar(page: import('@playwright/test').Page, aba: string) {
  await page.goto(`/lab/ha?aba=${aba}`)
  const membros = page.getByRole('table', { name: 'Membros do cluster' })
  // Logo depois da subida, o cluster pode ainda estar elegendo o primeiro líder.
  await expect(membros.getByRole('row', { name: /líder|primário/ })).toHaveCount(1, { timeout: 90_000 })
  await page.getByRole('radiogroup', { name: 'Ação' }).getByText('Queda (sem aviso)').click()
  await expect(page.getByRole('checkbox')).toBeChecked() // a garantia vem ligada
  await page.getByRole('button', { name: 'Iniciar o ensaio' }).click()
  const conclusao = page.getByRole('status', { name: 'Conclusão' })
  await expect(conclusao).toContainText('a escrita ficou fora por', { timeout: 120_000 })
  const [, antes, depois] = tituloConclusao.exec(await conclusao.innerText())!
  return { membros, conclusao, antes, depois }
}

// Como quebra: o líder cai e ninguém assume (a escrita pelo HAProxy não
// volta — U1); com synchronous_mode, uma escrita confirmada some (U2); o
// antigo líder volta como um segundo líder (split-brain — U3).
test('[U1] [U2] [U3] Patroni: o líder cai, a réplica assume sem perder o confirmado e o antigo volta como réplica', async ({ page }) => {
  test.setTimeout(300_000)
  const { membros, conclusao, antes, depois } = await ensaiar(page, 'patroni')
  expect(depois).not.toBe(antes)
  await expect(conclusao).toContainText('nenhuma escrita confirmada se perdeu')

  // O supervisor do nó derrubado espera 45 s e sobe o Patroni de novo.
  await expect.poll(async () => membros.getByRole('row', { name: new RegExp(antes) }).innerText(),
    { timeout: 150_000, intervals: [3_000] }).toMatch(/réplica/)
  await expect(membros.getByRole('row', { name: /líder/ })).toHaveCount(1)
})

// Como quebra: o primário cai e os outros dois não elegem ninguém, ou a
// escrita com w: "majority" não volta / perde o que foi confirmado.
test('[U4] MongoDB: o primário cai, a maioria elege outro e w: "majority" não perde nada', async ({ page }) => {
  test.setTimeout(240_000)
  const { membros, conclusao, antes, depois } = await ensaiar(page, 'mongo')
  expect(depois).not.toBe(antes)
  await expect(conclusao).toContainText('nenhuma escrita confirmada se perdeu')
  await expect.poll(async () => membros.getByRole('row', { name: new RegExp(antes) }).innerText(),
    { timeout: 120_000, intervals: [3_000] }).toMatch(/secundário/)
})

// Como quebra: os sentinels não promovem a réplica, ou o cliente continua
// tentando o primário congelado e a escrita nunca volta.
test('[U5] Redis: o primário trava e os sentinels promovem a réplica', async ({ page }) => {
  test.setTimeout(240_000)
  const { conclusao, antes, depois } = await ensaiar(page, 'redis')
  expect(depois).not.toBe(antes)
  await expect(conclusao).toContainText('escrita ficou fora por')
})
