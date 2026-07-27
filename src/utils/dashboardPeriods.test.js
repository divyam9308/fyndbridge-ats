import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DASHBOARD_PERIOD,
  dashboardFinancialYearForDate,
  dashboardPeriodDateRange
} from './dashboardPeriods.js'

test('frontend dashboard defaults to the current financial year', () => {
  assert.equal(DEFAULT_DASHBOARD_PERIOD, dashboardFinancialYearForDate(new Date()))
})

test('January through March belong to the financial year that started the previous April', () => {
  assert.equal(dashboardFinancialYearForDate(new Date(2026, 0, 1)), 'FY 2025-26')
  assert.equal(dashboardFinancialYearForDate(new Date(2026, 2, 31)), 'FY 2025-26')
})

test('April starts the next financial year', () => {
  assert.equal(dashboardFinancialYearForDate(new Date(2026, 3, 1)), 'FY 2026-27')
})

test('current financial-year range is capped at today', () => {
  assert.deepEqual(
    dashboardPeriodDateRange('FY 2026-27', new Date(2026, 6, 27)),
    { startDate: '2026-04-01', endDate: '2026-07-27' }
  )
})
