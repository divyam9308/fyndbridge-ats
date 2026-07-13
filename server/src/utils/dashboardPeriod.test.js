const test = require('node:test')
const assert = require('node:assert/strict')
const { applyDashboardPeriod, dashboardPeriodRange } = require('./dashboardPeriod')

function dateParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
}

test('financial year spans April through March', () => {
  const range = dashboardPeriodRange('FY 2026-27')
  assert.deepEqual(dateParts(range.start), [2026, 4, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(range.end), [2027, 3, 31, 23, 59, 59, 999])
})

test('financial-year quarters use April as Q1 and cross the calendar year for Q4', () => {
  const q1 = dashboardPeriodRange('FY 2026-27 Q1')
  const q4 = dashboardPeriodRange('FY 2026-27 Q4')
  assert.deepEqual(dateParts(q1.start), [2026, 4, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(q1.end), [2026, 6, 30, 23, 59, 59, 999])
  assert.deepEqual(dateParts(q4.start), [2027, 1, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(q4.end), [2027, 3, 31, 23, 59, 59, 999])
})

test('month period covers the complete selected month', () => {
  const range = dashboardPeriodRange('Month 2027-02')
  assert.deepEqual(dateParts(range.start), [2027, 2, 1, 0, 0, 0, 0])
  assert.deepEqual(dateParts(range.end), [2027, 2, 28, 23, 59, 59, 999])
})

test('date-only dashboard filtering preserves local financial-year dates', () => {
  const calls = []
  const query = {
    gte(column, value) { calls.push(['gte', column, value]); return this },
    lte(column, value) { calls.push(['lte', column, value]); return this }
  }
  applyDashboardPeriod(query, 'allocation_date', 'FY 2026-27', { dateOnly: true })
  assert.deepEqual(calls, [
    ['gte', 'allocation_date', '2026-04-01'],
    ['lte', 'allocation_date', '2027-03-31']
  ])
})
