import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attendanceTime,
  dashboardAttendanceView,
  millisecondsUntilCompanyMidnight
} from './dashboardAttendanceState.js'

test('dashboard attendance starts with a repeating clock-in reminder', () => {
  assert.deepEqual(dashboardAttendanceView(null), {
    mode: 'clock-in',
    action: 'clock-in',
    label: 'CI',
    reminder: true,
    status: 'Not clocked in',
    ariaLabel: 'Clock in'
  })
})

test('an open attendance row switches the control to clock-out', () => {
  const view = dashboardAttendanceView({ clock_in_at: '2026-07-27T04:12:00.000Z', clock_out_at: null })
  assert.equal(view.mode, 'clock-out')
  assert.equal(view.action, 'clock-out')
  assert.equal(view.label, 'CO')
  assert.equal(view.reminder, true)
  assert.equal(view.status, 'In 09:42')
  assert.match(view.ariaLabel, /Clock out/)
})

test('a completed attendance row stops reminders and exposes no further action', () => {
  const view = dashboardAttendanceView({
    clock_in_at: '2026-07-27T04:12:00.000Z',
    clock_out_at: '2026-07-27T12:41:00.000Z'
  })
  assert.equal(view.mode, 'complete')
  assert.equal(view.action, null)
  assert.equal(view.reminder, false)
  assert.equal(view.status, 'Out 18:11')
  assert.equal(view.ariaLabel, 'Clocked out at 18:11')
})

test('attendance time and midnight reset use the company timezone', () => {
  assert.equal(attendanceTime('2026-07-27T18:29:00.000Z'), '23:59')
  assert.equal(
    millisecondsUntilCompanyMidnight(Date.parse('2026-07-27T18:29:30.000Z')),
    30_000
  )
  assert.equal(
    millisecondsUntilCompanyMidnight(Date.parse('2026-07-27T18:30:00.000Z')),
    86_400_000
  )
})
