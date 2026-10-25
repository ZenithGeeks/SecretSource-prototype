import { defineConfig, devices } from '@playwright/test'

/** End-to-end tests against a running gateway and worker (e2e/README.md). Vite is started
 * here with login off and its /api proxy pointed at the e2e stack, so a normal `npm run dev`
 * on 5173 and the everyday gateway on 8080 are left alone. */
const gateway = process.env.E2E_GATEWAY_URL ?? 'http://127.0.0.1:8090'
const port = Number(process.env.E2E_PORT ?? 5179)

export default defineConfig({
  testDir: './e2e',
  // One stack, one anonymous owner: tests share its data, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A Re-check runs on the worker, which is slower than any UI step.
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Process env wins over the repo-root .env that Vite also reads: blank Supabase turns
    // login off, and GATEWAY_URL_HTTP is the proxy target vite.config.ts reads first.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', GATEWAY_URL_HTTP: gateway, GATEWAY_URL: gateway },
  },
})
