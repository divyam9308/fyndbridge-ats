const test = require('node:test')
const assert = require('node:assert/strict')
const { inactiveFrom, employmentAsOf, periodEmployeeProfiles } = require('./employmentRoster')
const { buildAttendancePeriodSummary } = require('./attendancePeriodSummary')

const statuses = [{ user_id: 'former', status: 'inactive', updated_at: '2026-10-09T20:00:00Z' }, { user_id: 'leave', status: 'on_leave' }]
const profiles = ['active', 'former', 'leave', 'super'].map(user_id => ({ user_id, name: user_id }))
const admins = [{ user_id: 'super', role: 'super_admin' }]
const population = options => periodEmployeeProfiles(profiles, statuses, admins, { today: '2026-10-18', ...options }).map(p => p.user_id)

test('inactivation uses the company date and caps accrual before departure', () => {
  assert.equal(inactiveFrom(statuses[0]), '2026-10-10')
  assert.equal(inactiveFrom({ status: 'active' }), null)
  assert.equal(inactiveFrom({ status: 'inactive' }, '2026-10-18'), '2026-10-18')
  assert.equal(employmentAsOf(statuses[0], '2026-11-01'), '2026-10-09')
  assert.equal(employmentAsOf(statuses[0], '2026-09-30'), '2026-09-30')
})

test('current and future rosters omit inactive staff and preserve On Leave staff', () => {
  assert.deepEqual(population({ start: '2026-10-01', end: '2026-10-31' }), ['active', 'leave'])
  assert.deepEqual(population({ start: '2026-11-01', end: '2026-11-30', includeInactive: true }), ['active', 'leave'])
})

test('past periods and explicit partial-period history retain former staff only before departure', () => {
  assert.deepEqual(population({ start: '2026-09-01', end: '2026-09-30' }), ['active', 'former', 'leave'])
  assert.deepEqual(population({ start: '2026-10-01', end: '2026-10-31', includeInactive: true }), ['active', 'former', 'leave'])
  assert.deepEqual(population({ start: '2026-10-10', end: '2026-10-17' }), ['active', 'leave'])
  assert.equal(periodEmployeeProfiles(profiles, statuses, admins, { today: '2026-10-18', start: '2026-10-01', end: '2026-10-31', includeInactive: true })[1].inactive_from, '2026-10-10')
})

test('departure stops expected attendance and unmarked counts without discarding stored records', () => {
  const records = [{ attendance_date: '2026-10-05', status: 'present', worked_minutes: 480 }, { attendance_date: '2026-10-12', status: 'on_leave' }]
  const before = structuredClone(records)
  const summary = buildAttendancePeriodSummary({ start: '2026-10-01', end: '2026-10-31', today: '2026-10-18', inactiveFrom: '2026-10-10', records })
  assert.equal(summary.kpis.working_days, 8)
  assert.equal(summary.kpis.unmarked, 7)
  assert.equal(summary.kpis.present, 1)
  assert.equal(summary.kpis.total_minutes, 480)
  assert.equal(summary.kpis.leave, 0)
  assert.deepEqual(summary.records, before)
  assert.deepEqual(records, before)
  assert.equal(summary.days.find(day => day.date === '2026-10-10').inactive, true)
  assert.equal(summary.days.find(day => day.date === '2026-10-09').inactive, false)
})
