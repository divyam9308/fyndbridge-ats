const { test, expect, USER_ID } = require('./fixtures.cjs')
const fs = require('node:fs/promises')
const preferenceKey = 'appliedCandidatesTableColumns'
const appliedUrl = '/dashboard/applied-candidates'
const openColumns = page => page.getByRole('button', { name: 'Columns', exact: true }).click()
const chooser = page => page.locator('.candidate-columns-dropdown')
const tableHeaders = page => page.getByRole('table', { name: 'Applied Candidates', exact: true }).locator('thead th')
const sampleMotion = async (trigger, selector) => {
  const node = document.querySelector(selector)
  const read = time => {
    const style = getComputedStyle(node)
    return { time, y: new DOMMatrixReadOnly(style.transform).m42, opacity: Number(style.opacity) }
  }
  const frames = [read(0)]
  trigger.click()
  const start = performance.now()
  await new Promise(resolve => {
    const frame = now => { frames.push(read(now - start)); if (now - start < 500) requestAnimationFrame(frame); else resolve() }
    requestAnimationFrame(frame)
  })
  return frames
}
const assertEntrance = samples => {
  expect(samples[0].y).toBeGreaterThan(50)
  expect(samples.some(frame => frame.y > 10 && frame.opacity > 0 && frame.opacity < 1)).toBe(true)
  expect(samples.at(-1).y).toBeCloseTo(0, 1)
  expect(samples.at(-1).opacity).toBe(1)
  for (let index = 1; index < samples.length; index++) {
    expect(samples[index].y).toBeLessThanOrEqual(samples[index - 1].y + 0.25)
    expect(samples[index].opacity).toBeGreaterThanOrEqual(samples[index - 1].opacity - 0.01)
  }
}

test('column controls replace every filter and keep Proceed, saved preferences, reset and all-column behavior', async ({ page, app }, testInfo) => {
  app.db.tables.public_applications = app.db.tables.public_applications.slice(0, 5)
  const listQueries = []
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/applied-candidates') listQueries.push([...url.searchParams.keys()]) })
  await page.goto(appliedUrl)
  await expect(tableHeaders(page)).toHaveCount(22)
  await expect(page.locator('.applied-filter-bar, .applied-search, .applied-date-filter')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear Filters', exact: true })).toHaveCount(0)
  await openColumns(page)
  await expect(chooser(page).getByRole('checkbox')).toHaveCount(21)
  await chooser(page).getByRole('button', { name: 'Clear All', exact: true }).click()
  for (const name of ['Candidate Name', 'Email', 'CV', 'Actions']) await chooser(page).getByRole('checkbox', { name, exact: true }).check()
  // Changes remain pending until Proceed, matching Candidates and Clients.
  await expect(tableHeaders(page)).toHaveCount(22)
  await chooser(page).getByRole('button', { name: 'Save Preference', exact: true }).click()
  await expect.poll(() => app.db.tables.user_preferences[0]?.value).toEqual(['name', 'email', 'cv', 'actions'])
  await chooser(page).getByRole('checkbox', { name: 'Client Name', exact: true }).check()
  await chooser(page).getByRole('button', { name: 'Reset to Saved Preference', exact: true }).click()
  await expect(chooser(page).getByRole('checkbox', { name: 'Client Name', exact: true })).not.toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('column-picker.png') })
  await page.getByRole('button', { name: 'Proceed', exact: true }).click()
  expect(await tableHeaders(page).allTextContents()).toEqual(['', 'Candidate Name', 'Email', 'CV', 'Actions'])
  await expect(page.locator('tbody tr').first().locator('td')).toHaveCount(5)
  await page.screenshot({ path: testInfo.outputPath('selected-columns.png') })
  await page.evaluate(key => localStorage.removeItem(key), preferenceKey)
  await page.reload()
  // This reload must read the saved value from the real preference controller.
  await expect(tableHeaders(page)).toHaveCount(5)
  expect(app.preferenceSaves).toHaveLength(1)
  app.failPreferenceSaves = true
  await openColumns(page)
  await chooser(page).getByRole('checkbox', { name: 'CV', exact: true }).uncheck()
  await chooser(page).getByRole('button', { name: 'Save Preference', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic preference save failure')
  await chooser(page).getByRole('button', { name: 'Reset to Saved Preference', exact: true }).click()
  await expect(chooser(page).getByRole('checkbox', { name: 'CV', exact: true })).toBeChecked()
  await chooser(page).getByRole('button', { name: 'Select All', exact: true }).click()
  await page.getByRole('button', { name: 'Proceed', exact: true }).click()
  await expect(tableHeaders(page)).toHaveCount(22)
  await openColumns(page)
  await chooser(page).getByRole('button', { name: 'Clear All', exact: true }).click()
  await page.getByRole('button', { name: 'Proceed', exact: true }).click()
  await expect(tableHeaders(page)).toHaveCount(22)
  expect(listQueries.every(keys => keys.every(key => ['page', 'limit', 'sortField', 'sortDirection'].includes(key)))).toBe(true)
  expect(app.consoleErrors).toEqual([])
})

test('malformed or stale stored column keys fall back safely and only valid selected columns render', async ({ page, app }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{bad json'), preferenceKey)
  await page.goto(appliedUrl)
  await expect(tableHeaders(page)).toHaveCount(22)
  app.db.tables.user_preferences.push({ user_id: USER_ID, preference_key: preferenceKey, value: ['missing-field', 'email', 'name', 'email'] })
  await page.reload()
  await expect(tableHeaders(page)).toHaveCount(3)
  expect(await tableHeaders(page).allTextContents()).toEqual(['', 'Candidate Name', 'Email'])
  await expect(page.locator('tbody tr').first().locator('td')).toHaveCount(3)
})

test('Applied Candidates uses the same rendered column picker UI as Candidates and Clients', async ({ page, app }, testInfo) => {
  const styles = []
  const readStyle = node => { const style = getComputedStyle(node); return { width: style.width, height: style.height, background: style.backgroundImage, color: style.color, radius: style.borderRadius, border: style.border, font: style.font, shadow: style.boxShadow } }
  for (const route of [appliedUrl, '/dashboard/candidates', '/dashboard/clients']) {
    // Compare the same resting state; a pointer retained over Columns can change hover styles.
    await page.mouse.move(0, 0)
    await page.goto(route)
    const button = page.getByRole('button', { name: 'Columns', exact: true })
    await expect(button).toBeVisible()
    const buttons = { columns: await button.evaluate(readStyle), proceed: await page.getByRole('button', { name: 'Proceed', exact: true }).evaluate(readStyle) }
    await button.click()
    await expect(chooser(page)).toBeVisible()
    styles.push({ ...buttons, action: await chooser(page).getByRole('button', { name: 'Save Preference', exact: true }).evaluate(readStyle), checkbox: await chooser(page).getByRole('checkbox').first().evaluate(node => ({ width: getComputedStyle(node).width, accent: getComputedStyle(node).accentColor })) })
  }
  expect(styles[0]).toEqual(styles[1])
  expect(styles[0]).toEqual(styles[2])
  expect(app.consoleErrors).toEqual([])
  await fs.writeFile(testInfo.outputPath('column-ui-comparison.json'), JSON.stringify({ applied: styles[0], candidates: styles[1], clients: styles[2] }, null, 2))
})

test('bulk selection enters from below without moving the table or shifting it when confirmation locks scrolling', async ({ page, app }, testInfo) => {
  app.db.tables.public_applications = app.db.tables.public_applications.slice(0, 5)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 720 })
  await page.goto('/dashboard/applied-candidates')
  const table = page.getByRole('table', { name: 'Applied Candidates', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(5)
  const geometry = () => page.locator('.applied-candidates-page .candidates-table-card').evaluate(node => ({
    x: node.getBoundingClientRect().x, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width,
    topbarRight: document.querySelector('.topbar-right').getBoundingClientRect().right,
  }))
  const before = await geometry()
  const samples = await table.locator('tbody input[type="checkbox"]').first().evaluate(sampleMotion, '.applied-selection-dock')
  await fs.writeFile(testInfo.outputPath('selection-entrance.json'), JSON.stringify(samples, null, 2))
  assertEntrance(samples)
  const afterSelection = await geometry()
  expect(afterSelection.x).toBeCloseTo(before.x, 1)
  expect(afterSelection.right).toBeCloseTo(before.right, 1)
  expect(afterSelection.topbarRight).toBeCloseTo(before.topbarRight, 1)
  await page.screenshot({ path: testInfo.outputPath('bulk-delete-bar.png') })
  const selectionDock = page.locator('.applied-selection-dock')
  await selectionDock.getByRole('button', { name: /Delete selected/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const duringConfirmation = await geometry()
  expect(duringConfirmation.x).toBeCloseTo(before.x, 1)
  expect(duringConfirmation.right).toBeCloseTo(before.right, 1)
  expect(duringConfirmation.topbarRight).toBeCloseTo(before.topbarRight, 1)
  const scrollBeforeWheel = await page.evaluate(() => scrollY)
  await page.mouse.move(1400, 650)
  await page.mouse.wheel(0, 400)
  expect(await page.evaluate(() => scrollY)).toBe(scrollBeforeWheel)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await geometry()).right).toBeCloseTo(before.right, 1)
  await fs.writeFile(testInfo.outputPath('layout-stability.json'), JSON.stringify({ before, afterSelection, duringConfirmation, afterCancel: await geometry() }, null, 2))
  expect(app.deleteRequests).toHaveLength(0)
  const motionStyles = node => { const s = getComputedStyle(node); return { name: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction, transition: s.transition } }
  const appliedStyles = await selectionDock.evaluate(motionStyles)
  await page.goto('/dashboard/admin')
  const setting = page.getByRole('switch', { name: 'Restrict dashboard to own consultant data for non-admin users', exact: true })
  await expect(setting).toBeEnabled()
  const adminSamples = await setting.evaluate(sampleMotion, '.admin-unsaved-dock')
  assertEntrance(adminSamples)
  expect(await page.locator('.admin-unsaved-dock').evaluate(motionStyles)).toEqual(appliedStyles)
  await fs.writeFile(testInfo.outputPath('admin-entrance.json'), JSON.stringify(adminSamples, null, 2))
})

test('confirmation freezes a scrolled application page and restores its position and body styles on cancel', async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 720 })
  await page.goto(appliedUrl)
  await expect(page.getByRole('table', { name: 'Applied Candidates', exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select application from Test Applicant 001', exact: true }).check()
  await page.evaluate(() => scrollTo(0, 700))
  const before = await page.locator('.candidates-table-card').evaluate(node => ({ y: node.getBoundingClientRect().y, scrollY, position: document.body.style.position, overflow: document.body.style.overflow }))
  expect(before.scrollY).toBeGreaterThan(300)
  await page.locator('.applied-selection-dock').getByRole('button', { name: /Delete selected/ }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  expect(await page.locator('.candidates-table-card').evaluate(node => node.getBoundingClientRect().y)).toBeCloseTo(before.y, 1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(await page.evaluate(() => scrollY)).toBe(before.scrollY)
  expect(await page.evaluate(() => document.body.style.position)).toBe(before.position)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(before.overflow)
  expect(app.deleteRequests).toHaveLength(0)
})
