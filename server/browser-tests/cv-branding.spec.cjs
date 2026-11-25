const { test: base, expect } = require('./fixtures.cjs')
const { fork } = require('node:child_process')
const path = require('node:path')
const { CLIENT, JOB } = require('../test-support/assignedCandidatesSchema.cjs')
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

test('Candidates renders saved ready CVs without a loading flash after refresh and polls only pending CVs', async ({ page, branding }) => {
  const bytes = Buffer.from(await (await fetch(branding.url + '/test/pdf')).arrayBuffer())
  const create = async (name, phone, fileName, buffer) => {
    const form = new FormData()
    for (const [field, value] of Object.entries({ full_name: name, mobile_number: phone, status: 'Interested', client_id: CLIENT, job_id: JOB })) form.append(field, value)
    form.append('cv_files', new Blob([buffer], { type: 'application/pdf' }), fileName)
    const response = await fetch(branding.url + '/api/candidates', { method: 'POST', headers: { 'x-test-user': branding.ADMIN }, body: form })
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(201)
    const state = await (await fetch(branding.url + '/test/state')).json()
    return { ...state.candidates.find(item => item.id === result.candidate_id), candidate_id: result.candidate_id }
  }
  const ready = await create('Ready status candidate', '9912345670', 'Already-ready.pdf', bytes)
  const statusResponse = await fetch(branding.url + '/api/resumes/branding-status', { method: 'POST', headers: { 'x-test-user': branding.ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ type: 'cv', recordId: ready.candidate_id, path: ready.cv_storage_path }] }) })
  expect(statusResponse.status, await statusResponse.text()).toBe(200)
  await expect.poll(async () => (await (await fetch(branding.url + '/test/branding-state')).json()).jobs[0]?.status).toBe('ready')
  const pending = await create('Pending status candidate', '9912345671', 'Still-processing.pdf', Buffer.concat([bytes, Buffer.from('\n% distinct pending fixture\n')]))
  const checkedPaths = []
  await page.route('**/api/resumes/branding-status', route => {
    const items = route.request().postDataJSON().items
    checkedPaths.push(...items.map(item => item.path))
    return route.fulfill({ json: { data: items.map(item => ({ path: item.path, status: 'queued' })) } })
  })
  await page.route('**/api/candidates?*', route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/candidates') return route.fallback()
    return route.continue({ url: branding.url + url.pathname + url.search, headers: { ...route.request().headers(), 'x-test-user': branding.ADMIN } })
  })
  await page.addInitScript(() => {
    window.__readyCvStates = []
    new MutationObserver(() => {
      for (const icon of document.querySelectorAll('[data-cv-branding-status][aria-label*="Already-ready.pdf"]')) window.__readyCvStates.push(icon.dataset.cvBrandingStatus)
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-cv-branding-status'] })
  })
  for (let visit = 0; visit < 2; visit++) {
    if (!visit) await page.goto('/dashboard/candidates')
    else await page.reload()
    const readyIcon = page.locator('[data-cv-branding-status][aria-label*="Already-ready.pdf"]')
    const pendingIcon = page.locator('[data-cv-branding-status][aria-label*="Still-processing.pdf"]')
    await expect(readyIcon).toHaveAttribute('data-cv-branding-status', 'ready')
    await expect(readyIcon.locator('.cv-branding-spinner')).toHaveCount(0)
    await expect(readyIcon).not.toHaveAttribute('aria-disabled', 'true')
    await expect(pendingIcon).toHaveAttribute('data-cv-branding-status', 'queued')
    await expect(pendingIcon).toHaveAttribute('aria-disabled', 'true')
    await expect(pendingIcon.locator('.cv-branding-spinner')).toBeVisible()
    await expect.poll(async () => page.evaluate(() => window.__readyCvStates.length)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__readyCvStates.every(status => status === 'ready'))).toBe(true)
  }
  await expect.poll(() => checkedPaths.length).toBeGreaterThan(0)
  expect(checkedPaths.every(path => path === pending.cv_storage_path)).toBe(true)
})

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
  const pendingSize = await cv.boundingBox()
  await expect(cv.locator('.cv-branding-glyph')).toHaveCSS('width', '15px')
  await expect(cv.locator('.cv-branding-glyph')).toHaveCSS('height', '15px')
  const iconSize = await cv.locator('.cv-branding-document svg').boundingBox()
  expect(pendingSize.width).toBe(iconSize.width + 16) // Existing 8px horizontal padding.
  expect(pendingSize.height).toBe(iconSize.height + 6) // Existing 3px vertical padding.
  let opened = false; page.on('popup', () => { opened = true })
  await cv.dispatchEvent('click'); expect(opened).toBe(false)
  await page.screenshot({ path: info.outputPath('loading-locked.png') })
  await expect(cv).toHaveAttribute('data-cv-branding-status', 'ready', { timeout: 15000 })
  await expect(cv.locator('.cv-branding-spinner')).toHaveCount(0)
  await expect(cv).not.toHaveAttribute('aria-disabled', 'true')
  const readySize = await cv.boundingBox()
  expect(readySize.width).toBe(pendingSize.width)
  expect(readySize.height).toBe(pendingSize.height)
  const state = await (await fetch(branding.url + '/test/branding-state')).json()
  expect(state.jobs.filter(job => job.status === 'ready')).toHaveLength(1)
  expect(state.originals).toHaveLength(0)
  const signed = page.waitForResponse(r => /\/api\/assigned-candidates\/[^/]+\/cv$/.test(new URL(r.url()).pathname))
  await cv.focus()
  await expect(cv).toBeFocused()
  await page.keyboard.press('Enter'); expect((await signed).status()).toBe(200)
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

test('durable transfer waits for completion and leaves a failed transfer recoverable', async ({ page }) => {
  let attempts = 0
  let checks = 0
  await page.route('**/api/assigned-candidates/*/transfer', route => {
    if (route.request().method() === 'POST') {
      attempts += 1
      return route.fulfill({ status: 202, json: { processing: true, status: 'pending' } })
    }
    checks += 1
    return route.fulfill({ json: attempts === 1 ? { status: 'failed', error: 'Synthetic CV processing failure' } : checks < 3 ? { status: 'pending' } : { status: 'complete' } })
  })
  await page.goto('/dashboard/assigned-candidates')
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Test Candidate 321', exact: true }) })
  await row.getByRole('button', { name: 'Add to Candidates', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add Candidate', exact: true })
  await form.getByRole('button', { name: 'Save Candidate', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('Processing CV and adding candidate…')
  await expect(page.getByText(/Candidate Added Successfully/)).toHaveCount(0)
  await expect(form.getByText('Synthetic CV processing failure', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: 'Save Candidate', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('Processing CV and adding candidate…')
  await expect(page.getByText(/Candidate Added Successfully/)).toBeVisible({ timeout: 12000 })
  expect(attempts).toBe(2)
  expect(checks).toBe(3)
})

test('pending transfer survives a page refresh and failed transfer offers authorised retry', async ({ page, branding }) => {
  let status = 'pending'
  let retries = 0
  await page.route('**/api/assigned-candidates?*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/assigned-candidates') return route.fallback()
    const response = await fetch(branding.url + url.pathname + url.search, { headers: { 'x-test-user': branding.ADMIN } })
    const payload = await response.json()
    expect(response.ok, JSON.stringify(payload)).toBe(true)
    payload.data.find(row => row.full_name === 'Test Candidate 321').cv_transfer = { status, last_error: 'Synthetic failure' }
    await route.fulfill({ json: payload })
  })
  await page.route('**/api/assigned-candidates/*/transfer/retry', route => {
    retries += 1; status = 'pending'
    return route.fulfill({ status: 202, json: { processing: true, status } })
  })
  await page.goto('/dashboard/assigned-candidates')
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Test Candidate 321', exact: true }) })
  await expect(row.getByRole('status')).toHaveText('Processing CV…')
  await expect(row.getByRole('button', { name: 'Add to Candidates', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(row.getByRole('status')).toHaveText('Processing CV…')
  status = 'failed'; await page.reload()
  await row.getByRole('button', { name: 'Retry transfer', exact: true }).click()
  await expect(row.getByRole('status')).toHaveText('Processing CV…')
  expect(retries).toBe(1)
  status = 'failed'; await page.reload()
  let reviewedBody
  await page.route('**/api/assigned-candidates/*/transfer', route => {
    if (route.request().method() === 'POST') {
      reviewedBody = route.request().postDataJSON()
      return route.fulfill({ status: 202, json: { processing: true, status: 'pending' } })
    }
    return route.fulfill({ json: { status: 'complete' } })
  })
  await row.getByRole('button', { name: 'Review transfer', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add Candidate', exact: true })
  await form.locator('input[name=name]').fill('Reviewed transfer after conflict')
  await form.getByRole('button', { name: 'Save Candidate', exact: true }).click()
  await expect(page.getByText(/Candidate Added Successfully/)).toBeVisible({ timeout: 10000 })
  expect(reviewedBody.full_name).toBe('Reviewed transfer after conflict')
})

test('compact CV error indicator retains tooltip and keyboard retry on desktop and mobile', async ({ page, branding }, info) => {
  let retried = false
  await page.route('**/api/assigned-candidates?*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/assigned-candidates') return route.fallback()
    const response = await fetch(branding.url + url.pathname + url.search, { headers: { 'x-test-user': branding.ADMIN } })
    const payload = await response.json()
    expect(response.ok, JSON.stringify(payload)).toBe(true)
    payload.data.find(row => row.full_name === 'Test Candidate 321').assigned_candidate_uploads.cv_storage_path = 'branded/fb1/ui-retry.pdf'
    await route.fulfill({ json: payload })
  })
  await page.route('**/api/resumes/branding-status', route => {
    const body = route.request().postDataJSON()
    if (body.retry) retried = true
    return route.fulfill({ json: { data: body.items.map(item => ({ path: item.path, status: retried ? 'ready' : 'failed' })) } })
  })
  await page.goto('/dashboard/assigned-candidates')
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Test Candidate 321', exact: true }) })
  const cv = row.locator('[data-cv-branding-status]')
  await expect(cv).toHaveAttribute('data-cv-branding-status', 'failed')
  await expect(cv).toHaveAttribute('title', 'CV branding could not finish. Click to retry.')
  await expect(cv.locator('.cv-branding-error')).toBeVisible()
  expect((await cv.boundingBox()).width).toBe(31)
  expect((await cv.boundingBox()).height).toBe(21)
  await cv.focus(); await page.keyboard.press('Enter')
  await expect(cv).toHaveAttribute('data-cv-branding-status', 'ready')
  expect(retried).toBe(true)
  await expect(cv.locator('.cv-branding-error')).toHaveCount(0)
  // Reconstruct the previous wrapper dimensions for a reviewable before image.
  const previousStyle = await page.addStyleTag({ content: '.cv-branding-glyph { width: 22px; height: 22px; }' })
  await cv.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
  await page.screenshot({ path: info.outputPath('cv-container-before.png') })
  await previousStyle.evaluate(node => node.remove())
  await page.screenshot({ path: info.outputPath('compact-cv-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await cv.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
  await expect(cv).toBeVisible()
  expect((await cv.boundingBox()).width).toBe(31)
  expect((await cv.boundingBox()).height).toBe(21)
  await page.screenshot({ path: info.outputPath('compact-cv-mobile.png') })
})
