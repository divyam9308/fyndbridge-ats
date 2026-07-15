const test = require('node:test')
const assert = require('node:assert/strict')

const { aggregateAttendance } = require('./consultantReportAttendance')

function attendanceRow(consultant, kpis = {}, balance = {}) {
  return {
    consultant,
    period: { kpis },
    balance
  }
}

function metricsByKey(result) {
  return Object.fromEntries(result.metrics.map((metric) => [metric.key, metric]))
}

test('overall attendance sums KPIs and leave balances with a weighted attendance percentage', () => {
  const result = aggregateAttendance([
    attendanceRow(
      { user_id: 'zoya', name: 'Zoya Khan' },
      {
        working_days: 10,
        present: 9,
        leave: 1,
        half_day_leave: 0,
        unmarked: 0,
        corrected_attendance: 2,
        pending_corrections: 1,
        total_minutes: 510,
        attendance_percentage: 90
      },
      {
        financial_year: '2026-27',
        annual_entitlement: 18,
        opening_carry_forward: 2,
        accrued_leave: 8,
        used_leave: 3,
        pending_leave: 1,
        available_balance: 7,
        projected_balance: 6,
        loss_of_pay_exposure: 0
      }
    ),
    attendanceRow(
      { user_id: 'asha', name: 'Asha Rao' },
      {
        working_days: 20,
        present: 10,
        leave: 4,
        half_day_leave: 2,
        unmarked: 4,
        corrected_attendance: 1,
        pending_corrections: 3,
        total_minutes: 900,
        attendance_percentage: 50
      },
      {
        financial_year: '2026-27',
        annual_entitlement: 20,
        opening_carry_forward: 1,
        accrued_leave: 10,
        used_leave: 5,
        pending_leave: 2,
        available_balance: 4,
        projected_balance: 3,
        loss_of_pay_exposure: 1
      }
    )
  ])
  const metrics = metricsByKey(result)

  assert.deepEqual(
    Object.fromEntries([
      'workingDays',
      'presentDays',
      'leaveDays',
      'halfDayLeave',
      'unmarkedDays',
      'correctedAttendance',
      'pendingCorrections'
    ].map((key) => [key, metrics[key].value])),
    {
      workingDays: 30,
      presentDays: 19,
      leaveDays: 5,
      halfDayLeave: 2,
      unmarkedDays: 4,
      correctedAttendance: 3,
      pendingCorrections: 4
    }
  )
  assert.deepEqual(
    { value: metrics.workedTime.value, numericValue: metrics.workedTime.numericValue },
    { value: '23h 30m', numericValue: 1410 }
  )
  assert.deepEqual(
    { value: metrics.attendancePercentage.value, numericValue: metrics.attendancePercentage.numericValue },
    { value: '63%', numericValue: 63 }
  )
  assert.deepEqual(result.leaveBalance, {
    financialYear: '2026-27',
    annualEntitlement: 38,
    openingCarryForward: 3,
    accruedLeave: 18,
    usedLeave: 8,
    pendingLeave: 3,
    availableBalance: 11,
    projectedBalance: 9,
    lossOfPayExposure: 1
  })
  assert.deepEqual(
    { value: metrics.leaveBalance.value, numericValue: metrics.leaveBalance.numericValue },
    { value: '11 days', numericValue: 11 }
  )
})

test('consultant attendance rows sort by name and preserve input order for equivalent names', () => {
  const result = aggregateAttendance([
    attendanceRow({ user_id: 'zoya', name: 'Zoya Khan' }),
    attendanceRow({ user_id: 'asha-lower', name: 'asha rao' }),
    attendanceRow({ user_id: 'asha-title', name: 'Asha Rao' }),
    attendanceRow({ user_id: 'bina', name: 'Bina Shah' })
  ])

  assert.deepEqual(result.consultants.map((row) => row.consultant.user_id), [
    'asha-lower',
    'asha-title',
    'bina',
    'zoya'
  ])
})

test('overall attendance returns a complete zero summary when there are no consultant rows', () => {
  const result = aggregateAttendance([])
  const metrics = metricsByKey(result)

  assert.equal(result.available, true)
  assert.deepEqual(result.consultants, [])
  assert.deepEqual(
    Object.fromEntries(result.metrics.map((metric) => [metric.key, metric.numericValue ?? metric.value])),
    {
      workingDays: 0,
      presentDays: 0,
      leaveDays: 0,
      halfDayLeave: 0,
      unmarkedDays: 0,
      correctedAttendance: 0,
      pendingCorrections: 0,
      workedTime: 0,
      leaveBalance: 0,
      attendancePercentage: 0
    }
  )
  assert.equal(metrics.workedTime.value, '0h 0m')
  assert.equal(metrics.leaveBalance.value, '0 days')
  assert.equal(metrics.attendancePercentage.value, '0%')
  assert.deepEqual(result.leaveBalance, {
    financialYear: '',
    annualEntitlement: 0,
    openingCarryForward: 0,
    accruedLeave: 0,
    usedLeave: 0,
    pendingLeave: 0,
    availableBalance: 0,
    projectedBalance: 0,
    lossOfPayExposure: 0
  })
})
