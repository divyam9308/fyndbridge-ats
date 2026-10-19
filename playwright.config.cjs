const { defineConfig, devices } = require('@playwright/test')
const testProductionBuild = process.env.FYNDBRIDGE_TEST_BUILD === '1'

module.exports = defineConfig({
  testDir: './server/browser-tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '/tmp/fyndbridge-playwright-results.json' }]],
  outputDir: '/tmp/fyndbridge-playwright-artifacts',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 960 }, ...(process.env.FYNDBRIDGE_FIREFOX_EXECUTABLE ? { launchOptions: { executablePath: process.env.FYNDBRIDGE_FIREFOX_EXECUTABLE } } : {}) } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 960 } } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js ${testProductionBuild ? 'preview' : ''} --config server/browser-tests/vite.config.mjs --host 127.0.0.1 --port 4173 --strictPort`,
    url: 'http://127.0.0.1:4173',
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'synthetic-browser-test-key' },
    reuseExistingServer: false,
  },
})
