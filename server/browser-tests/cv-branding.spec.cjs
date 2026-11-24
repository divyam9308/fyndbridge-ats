const { test: base, expect } = require('./fixtures.cjs')
const { fork } = require('node:child_process')
const path = require('node:path')
const test = base.extend({ branding: [async ({ page, context, app }, use) => {
  const child = fork(path.resolve(__dirname, '../test-support/assignedCandidatesServer.cjs'), { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const ready = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`Fixture exited ${code}`))) })
  const url = `http://127.0.0.1:${ready.port}`
  app.superAdmin = true
  app.staff = [{ id: ready.ADMIN, name: 'Test Admin', status: 'active' }, { id: ready.CONSULTANT, name: 'Test Consultant', status: 'active' }]
  await page.route('**/api/**', route => {
    const r = route.request(), u = new URL(r.url())
    if (u.pathname.startsWith('/api/assigned-candidates') || u.pathname.startsWith('/api/resumes') || ['/api/clients', '/api/jobs', '/api/candidates/next-display-id'].includes(u.pathname)) {
      return route.continue({ url: url + u.pathname + u.search, headers: { ...r.headers(), 'x-test-user': ready.ADMIN } })
    }
    return route.fallback()
  })
  await context.route('https://example.test/protected/**', async route => {
    const cvPath = decodeURIComponent(new URL(route.request().url()).pathname.replace('/protected/', ''))
    const response = await fetch(url + '/test/cv-object?' + new URLSearchParams({ path: cvPath }))
    await route.fulfill({ status: response.status, contentType: 'application/pdf', body: Buffer.from(await response.arrayBuffer()) })
  })
  try { await use({ url, ...ready }) }
  finally { child.send('close'); await new Promise(resolve => child.once('exit', resolve)) }
}, { auto: true }] })

test('uploaded CV stays locked with an overlaid spinner, opens branded after completion, and is deleted with its record', async ({ page, context, branding }, info) => {
  await page.goto('/dashboard/assigned-candidates')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const wizard = page.getByRole('dialog', { name: 'Assign New Candidates' })
  const bytes = Buffer.from(await (await fetch(branding.url + '/test/pdf')).arrayBuffer())
  await page.getByLabel('Upload CVs').setInputFiles({ name: 'Branding-browser-test.pdf', mimeType: 'application/pdf', buffer: bytes })
  await wizard.getByRole('button', { name: 'Next', exact: true }).click()
  await wizard.getByLabel('Name', { exact: true }).fill('CV Branding Browser Test')
  for (const [label, option] of [['Client', 'Example Client'], ['Mandate', 'Finance Manager'], ['Assign to Consultant', 'Test Consultant']]) {
    await wizard.getByRole('combobox', { name: label, exact: true }).click()
    await wizard.getByRole('option', { name: new RegExp(option) }).click()
  }
  await wizard.getByRole('button', { name: 'Save', exact: true }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'CV Branding Browser Test', exact: true }) })
  const cv = row.locator('[data-cv-branding-status]')
  await expect(cv).toHaveAttribute('aria-busy', 'true')
  await expect(cv.locator('.cv-branding-spinner')).toBeVisible()
  let opened = false; page.on('popup', () => { opened = true })
  await cv.dispatchEvent('click'); expect(opened).toBe(false)
  await page.screenshot({ path: info.outputPath('loading-locked.png') })
  await expect(cv).toHaveAttribute('data-cv-branding-status', 'ready', { timeout: 15000 })
  await expect(cv.locator('.cv-branding-spinner')).toHaveCount(0)
  await expect(cv).not.toHaveAttribute('aria-disabled', 'true')
  const state = await (await fetch(branding.url + '/test/branding-state')).json()
  expect(state.jobs.filter(job => job.status === 'ready')).toHaveLength(1)
  expect(state.originals).toHaveLength(0)
  const signed = page.waitForResponse(r => /\/api\/assigned-candidates\/[^/]+\/cv$/.test(new URL(r.url()).pathname))
  await cv.click(); expect((await signed).status()).toBe(200)
  await page.screenshot({ path: info.outputPath('ready-clickable.png') })
  for (const popup of context.pages().filter(p => p !== page)) await popup.close()
  await row.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Delete selected/ }).click()
  await page.getByRole('button', { name: 'Yes, Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
  const removed = await (await fetch(branding.url + '/test/branding-state')).json()
  expect(removed.originals).toHaveLength(0); expect(removed.branded).toHaveLength(0)
  expect(removed.jobs[0].status).toBe('cancelled')
  await page.screenshot({ path: info.outputPath('test-record-deleted.png') })
})
