const { test, expect } = require('./fixtures.cjs')
const fs = require('node:fs/promises')

test('short application lists fit their rows without page overflow or visible scrollbars; all columns stay reachable', async ({ page, app }, testInfo) => {
  app.db.tables.public_applications = app.db.tables.public_applications.slice(0, 5)
  await page.goto('/dashboard/applied-candidates')
  const table = page.getByRole('table', { name: 'Applied Candidates', exact: true })
  const scroller = page.getByRole('region', { name: 'Applied candidate details', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(5)
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
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth })
  const lastCell = table.locator('tbody tr').first().locator('td').last()
  const scrollBox = await scroller.boundingBox()
  const cellBox = await lastCell.boundingBox()
  expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 1)
  await expect(lastCell.getByRole('button', { name: 'View Details', exact: true })).toBeInViewport()
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
