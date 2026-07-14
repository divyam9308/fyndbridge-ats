const test = require('node:test')
const assert = require('node:assert/strict')

const { buildAttendancePeriodSummary } = require('./attendancePeriodSummary')

test('custom-range attendance preserves present, corrected, half-day, correction and worked-minute semantics', () => {
  const summary = buildAttendancePeriodSummary({
    start: '2026-07-06',
    end: '2026-07-12',
    today: '2026-07-12',
    records: [
      { attendance_date: '2026-07-06', status: 'present', worked_minutes: 480 },
      { attendance_date: '2026-07-07', status: 'corrected', worked_minutes: 450 },
      { attendance_date: '2026-07-08', status: 'correction_pending', worked_minutes: 0 },
      { attendance_date: '2026-07-09', status: 'half_day_leave', worked_minutes: 0 }
    ],
    holidayRows: [{ holiday_date: '2026-07-10', name: 'Company Holiday' }],
    leaveRequests: [{
      start_date: '2026-07-09',
      end_date: '2026-07-09',
      duration_type: 'half_day',
      half_day_session: 'first_half',
      status: 'approved'
    }],
    correctionRequests: [{ attendance_date: '2026-07-08', status: 'pending' }]
  })

  assert.deepEqual(summary.kpis, {
    working_days: 5,
    present: 2,
    leave: 1,
    half_day_leave: 1,
    corrections: 2,
    corrected_attendance: 1,
    pending_corrections: 1,
    unmarked: 1,
    holidays: 1,
    total_minutes: 930,
    attendance_percentage: 40
  })
  assert.equal(summary.days.find((day) => day.date === '2026-07-12').weekly_off, true)
  assert.ok(summary.days.find((day) => day.date === '2026-07-10').holiday)
})

test('Sunday, holidays and future dates are never classified as unmarked absences', () => {
  const summary = buildAttendancePeriodSummary({
    start: '2026-07-06',
    end: '2026-07-13',
    today: '2026-07-10',
    records: [],
    holidayRows: [{ holiday_date: '2026-07-08', name: 'Holiday' }],
    leaveRequests: [],
    correctionRequests: []
  })

  assert.equal(summary.kpis.unmarked, 3)
  assert.deepEqual(
    summary.days.filter((day) => day.future).map((day) => day.date),
    ['2026-07-11', '2026-07-12', '2026-07-13']
  )
  assert.ok(summary.days.filter((day) => day.future).every((day) => (
    day.holiday || day.weekly_off || (!day.record && !day.pending_leave && !day.approved_leave)
  )))
  assert.equal(summary.days.find((day) => day.date === '2026-07-12').weekly_off, true)
  assert.ok(summary.days.find((day) => day.date === '2026-07-08').holiday)
})

test('separate approved leaves around Sunday preserve the existing sandwich-leave rule', () => {
  const summary = buildAttendancePeriodSummary({
    start: '2026-07-11',
    end: '2026-07-13',
    today: '2026-07-13',
    records: [],
    holidayRows: [],
    leaveRequests: [
      { start_date: '2026-07-11', end_date: '2026-07-11', duration_type: 'full_day', status: 'approved' },
      { start_date: '2026-07-13', end_date: '2026-07-13', duration_type: 'full_day', status: 'approved' }
    ],
    correctionRequests: []
  })

  assert.equal(summary.kpis.working_days, 2)
  assert.equal(summary.kpis.leave, 3)
  assert.equal(summary.days.find((day) => day.date === '2026-07-12').approved_leave.sandwich, true)
})

test('attendance percentage has a safe zero denominator', () => {
  const summary = buildAttendancePeriodSummary({
    start: '2026-07-12',
    end: '2026-07-12',
    today: '2026-07-12',
    records: [],
    holidayRows: [],
    leaveRequests: [],
    correctionRequests: []
  })
  assert.equal(summary.kpis.working_days, 0)
  assert.equal(summary.kpis.attendance_percentage, 0)
  assert.ok(Number.isFinite(summary.kpis.attendance_percentage))
})
