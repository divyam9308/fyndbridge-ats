const test = require('node:test')
const assert = require('node:assert/strict')
const { applyDashboardPeriod, currentDashboardFinancialYear, dashboardPeriodRange } = require('./dashboardPeriod')
const NOW = new Date(2026, 6, 13, 12, 0, 0, 0)

function dateParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
}

test('current financial year starts in April and ends today', () => {
  const range = dashboardPeriodRange('FY 2026-27', NOW)
  assert.deepEqual(dateParts(range.start), [2026, 4, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(range.end), [2026, 7, 13, 23, 59, 59, 999])
})

test('backend default financial year handles January through March and the April boundary', () => {
  assert.equal(currentDashboardFinancialYear(new Date('2026-01-01T12:00:00+05:30')), 'FY 2025-26')
  assert.equal(currentDashboardFinancialYear(new Date('2026-03-31T12:00:00+05:30')), 'FY 2025-26')
  assert.equal(currentDashboardFinancialYear(new Date('2026-04-01T12:00:00+05:30')), 'FY 2026-27')
})

test('January through March financial-year range starts in the previous calendar year', () => {
  const range = dashboardPeriodRange('FY 2025-26', new Date(2026, 2, 31, 12))
  assert.deepEqual(dateParts(range.start), [2025, 4, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(range.end), [2026, 3, 31, 23, 59, 59, 999])
})

test('completed quarters keep their end date and the current quarter ends today', () => {
  const q1 = dashboardPeriodRange('FY 2026-27 Q1', NOW)
  const q2 = dashboardPeriodRange('FY 2026-27 Q2', NOW)
  assert.deepEqual(dateParts(q1.start), [2026, 4, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(q1.end), [2026, 6, 30, 23, 59, 59, 999])
  assert.deepEqual(dateParts(q2.start), [2026, 7, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(q2.end), [2026, 7, 13, 23, 59, 59, 999])
})

test('current month ends today while a completed month keeps its calendar end', () => {
  const current = dashboardPeriodRange('Month 2026-07', NOW)
  const completed = dashboardPeriodRange('Month 2026-06', NOW)
  assert.deepEqual(dateParts(current.start), [2026, 7, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(current.end), [2026, 7, 13, 23, 59, 59, 999])
  assert.deepEqual(dateParts(completed.end), [2026, 6, 30, 23, 59, 59, 999])
})

test('a wholly future month has an end before its start so it returns no data', () => {
  const range = dashboardPeriodRange('Month 2026-08', NOW)
  assert.deepEqual(dateParts(range.start), [2026, 8, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(range.end), [2026, 7, 13, 23, 59, 59, 999])
})

test('date-only dashboard filtering preserves local financial-year dates', () => {
  const calls = []
  const query = {
    gte(column, value) { calls.push(['gte', column, value]); return this },
    lte(column, value) { calls.push(['lte', column, value]); return this }
  }
  applyDashboardPeriod(query, 'allocation_date', 'FY 2026-27', { dateOnly: true, now: NOW })
  assert.deepEqual(calls, [
    ['gte', 'allocation_date', '2026-04-01'],
    ['lte', 'allocation_date', '2026-07-13']
  ])
})
