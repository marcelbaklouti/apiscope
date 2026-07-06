import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: { baseURL: 'http://127.0.0.1:4655' },
  webServer: [
    {
      command: 'pnpm build && node e2e/serve.mjs',
      url: 'http://127.0.0.1:4655/health',
      reuseExistingServer: false,
      timeout: 120000
    },
    {
      command: 'node e2e/serve-states.mjs',
      url: 'http://127.0.0.1:4656/health',
      reuseExistingServer: false,
      timeout: 120000
    }
  ]
})
