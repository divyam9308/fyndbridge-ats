const { test, expect } = require('./fixtures.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')

// Column order from the six versions before bulk selection was added (ae4b677 and earlier).
const originalColumns = [
  'Candidate Name', 'Applied Public Role', 'Internal Mandate/Role', 'Client Name', 'Client ID', 'Email', 'Mobile',
  'Current Designation', 'Current Organization', 'Experience', 'Current Location', 'Skills', 'Current CTC',
  'Expected CTC', 'Notice Period', 'Open to Relocate', 'Applied On', 'Application Status', 'CV',
  'Assigned Consultant', 'Actions',
]

test('short application lists fit their rows without page overflow or visible scrollbars; all columns stay reachable', async ({ page, app }, testInfo) => {
  app.db.tables.public_applications = app.db.tables.public_applications.slice(0, 5)
  Object.assign(app.db.tables.public_applications[0], {
    full_name: 'Dr. Example Applicant With A Longer Professional Name',
    public_role_name: 'Manager, Senior Manager Business Development & Strategic Partnership',
    internal_job_title_snapshot: 'Manager, Senior Manager Business Development & Strategic Partnership',
    client_name_snapshot: 'Example Consulting and Professional Services Company',
  })
  await page.goto('/dashboard/applied-candidates')
  const table = page.getByRole('table', { name: 'Applied Candidates', exact: true })
  const scroller = page.getByRole('region', { name: 'Applied candidate details', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(5)
  expect((await table.locator('thead th').allTextContents()).slice(1)).toEqual(originalColumns)
  await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(originalColumns.length + 1)
  // Lazy routes may load the shared table CSS after this page's CSS in a production bundle.
  await page.addStyleTag({ path: path.resolve(__dirname, '../../src/styles/Shared.css') })
  const firstCells = table.locator('tbody tr').first().locator('td')
  await expect(firstCells.first()).toHaveCSS('text-overflow', 'clip')
  await expect(firstCells.nth(2)).toHaveCSS('white-space', 'normal')
  await expect(table.locator('.candidate-name-text').first()).toHaveCSS('text-overflow', 'clip')
  expect((await table.locator('.candidate-name-text').first().boundingBox()).height).toBeGreaterThan(32)
  await expect(page.locator('.pagination-results')).toHaveText('Showing 1–5 of 5 results')
  const metrics = []
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await scroller.evaluate(node => { node.scrollLeft = 0 })
    const geometry = await table.evaluate(node => {
      const card = node.closest('.candidates-table-card').getBoundingClientRect()
      const lastRow = node.querySelector('tbody tr:last-child').getBoundingClientRect()
      const pagination = document.querySelector('.pagination-bar').getBoundingClientRect()
      const scroll = node.parentElement
      return {
        viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth,
        blankSpace: card.bottom - lastRow.bottom, paginationGap: pagination.top - lastRow.bottom,
        scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
        scrollbarWidth: getComputedStyle(scroll).scrollbarWidth,
        webkitScrollbar: getComputedStyle(scroll, '::-webkit-scrollbar').display,
      }
    })
    metrics.push({ width, ...geometry })
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1)
    expect(geometry.blankSpace).toBeLessThanOrEqual(2)
    expect(geometry.paginationGap).toBeGreaterThanOrEqual(0)
    expect(geometry.paginationGap).toBeLessThanOrEqual(18)
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
    expect(geometry.scrollbarWidth === 'none' || geometry.webkitScrollbar === 'none').toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await scroller.focus()
  await expect(scroller).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await scroller.evaluate(node => { node.scrollLeft = 0 })
  const nameBefore = await firstCells.nth(1).boundingBox()
  await scroller.evaluate(node => { node.scrollLeft = 600 })
  const nameAfter = await firstCells.nth(1).boundingBox()
  expect(nameBefore.x - nameAfter.x).toBeCloseTo(600, 0)
  await expect(firstCells.nth(1)).not.toBeInViewport()
  for (const label of originalColumns) {
    const header = table.getByRole('columnheader', { name: label, exact: true })
    await header.scrollIntoViewIfNeeded()
    await expect(header).toBeInViewport()
  }
  await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth })
  const lastCell = table.locator('tbody tr').first().locator('td').last()
  const scrollBox = await scroller.boundingBox()
  const cellBox = await lastCell.boundingBox()
  expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 1)
  await expect(lastCell.getByRole('button', { name: 'View Details', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('final-columns.png') })
  await scroller.evaluate(node => { node.scrollLeft = 0 })
  await page.locator('.applied-candidates-page').focus()
  await page.screenshot({ path: testInfo.outputPath('five-applications.png') })

  app.db.tables.public_applications = app.db.tables.public_applications.slice(0, 1)
  await page.reload()
  await expect(table.locator('tbody tr')).toHaveCount(1)
  expect(await table.evaluate(node => node.closest('.candidates-table-card').getBoundingClientRect().bottom - node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(2)
  app.db.tables.public_applications = []
  await page.reload()
  const emptyTitle = page.getByText('No applied candidates found', { exact: true })
  await expect(emptyTitle).toBeInViewport()
  await expect(page.locator('.pagination-results')).toHaveText('Showing 0–0 of 0 results')
  await page.screenshot({ path: testInfo.outputPath('empty-applications.png') })
  expect(app.requestPaths.some(route => route.endsWith('/deletion-failures'))).toBe(false)
  expect(app.consoleErrors).toEqual([])
  await fs.writeFile(testInfo.outputPath('layout-metrics.json'), JSON.stringify(metrics, null, 2))
})
