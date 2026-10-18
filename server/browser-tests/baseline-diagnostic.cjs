// Run against an isolated Vite snapshot of the original commit, never production.
const { chromium } = require('@playwright/test')
const { withApp, evidenceDir } = require('./fixtures.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')

async function main() {
  const baseURL = process.argv[2]
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error('Supply the isolated local baseline URL.')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  try {
    await withApp({ page }, async () => {
      await page.goto(`${baseURL}/dashboard/performance`)
      await page.locator('.performance-input.is-self_score').first().waitFor()
      await page.waitForTimeout(600)
      const start = await page.evaluate(() => window.__reactCommits)
      await page.waitForTimeout(1200)
      const idleCommits = await page.evaluate(before => window.__reactCommits - before, start)
      await page.locator('#nav-applied-candidates').click()
      await page.waitForTimeout(5100)
      const afterNavigation = { url: page.url(), pmsVisible: await page.locator('.performance-page').isVisible(), appliedVisible: await page.getByRole('table', { name: 'Applied Candidates', exact: true }).isVisible() }
      await page.screenshot({ path: path.join(evidenceDir, 'original-pms-delayed-navigation.png') })
      let releasedByQuarterClick = null
      if (afterNavigation.pmsVisible) {
        await page.getByRole('button', { name: /^Q4/ }).click()
        await page.getByRole('table', { name: 'Applied Candidates', exact: true }).waitFor({ timeout: 5000 })
        releasedByQuarterClick = true
      }
      const result = { originalCommit: '6356794', idleIntervalMs: 1200, idleCommits, observedAfterNavigationMs: 5100, afterNavigation, releasedByQuarterClick }
      await fs.writeFile(path.join(evidenceDir, 'original-pms-navigation-metrics.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result, null, 2))
    })
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
