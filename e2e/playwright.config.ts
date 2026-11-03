import { defineConfig } from '@playwright/test'

// Os testes rodam contra o stack isolado que `make e2e` sobe (projeto compose
// nosqlgo-e2e). E2E_BASE_URL aponta para outro lugar só quando alguém quer
// rodar contra um stack já de pé.
export default defineConfig({
  testDir: './testes',
  outputDir: './relatorio/artefatos',
  fullyParallel: false,
  // Os laboratórios mexem em estado global (estoque do SKU disputado, índices):
  // 2 workers, e os arquivos dos laboratórios rodam em série.
  workers: 2,
  // Sem nova tentativa: um teste que passa na segunda vez esconde exatamente a
  // intermitência que o E2E existe para mostrar.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './relatorio/html', open: 'never' }],
    ['json', { outputFile: './relatorio/resultados.json' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:23000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
    // Todo teste termina com um print: é o que torna o relatório conferível
    // por quem não rodou a suíte.
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
})
