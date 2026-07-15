const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { buildActiveProfiles, buildTodayAttendanceSummary } = require('./teamAttendanceToday')

const profile = (userId, name = userId) => ({ user_id: userId, name, email: `${userId}@example.com` })

test('team attendance population includes only active named employees and excludes super admins', () => {
  const profiles = [profile('active'), profile('on-leave'), profile('inactive'), profile('super'), { user_id: 'nameless', name: '', email: 'nameless@example.com' }]
  const result = buildActiveProfiles(profiles, [
    { user_id: 'on-leave', status: 'on_leave' },
    { user_id: 'inactive', status: 'inactive' }
  ], [{ user_id: 'super', email: 'super@example.com', role: 'super_admin' }])
  assert.deepEqual(result.map(row => row.user_id), ['active'])
})

test('today summary creates three mutually exclusive effective attendance categories', () => {
  const profiles = ['present', 'corrected', 'leave', 'half', 'unmarked', 'pending-present', 'pending-unmarked', 'clocked-in'].map(id => profile(id))
  const summary = buildTodayAttendanceSummary({
    date: '2026-07-13',
    profiles,
    attendanceRecords: [
      { user_id: 'present', status: 'present' },
      { user_id: 'corrected', status: 'corrected' },
      { user_id: 'leave', status: 'on_leave' },
      { user_id: 'half', status: 'half_day_leave' },
      { user_id: 'pending-present', status: 'correction_pending' },
      { user_id: 'pending-unmarked', status: 'correction_pending' },
      { user_id: 'clocked-in', status: 'clocked_in' }
    ],
    approvedLeaves: [
      { user_id: 'leave', status: 'approved', duration_type: 'full_day' },
      { user_id: 'half', status: 'approved', duration_type: 'half_day' },
      { user_id: 'unmarked', status: 'pending', duration_type: 'full_day' }
    ],
    pendingCorrections: [
      { user_id: 'pending-present', existing_clock_in_at: '2026-07-13T04:00:00Z', existing_clock_out_at: '2026-07-13T12:00:00Z' },
      { user_id: 'pending-unmarked', existing_clock_in_at: null, existing_clock_out_at: null }
    ]
  })

  assert.deepEqual(summary.present.map(row => row.user_id), ['present', 'corrected', 'pending-present', 'clocked-in'])
  assert.deepEqual(summary.leave.map(row => [row.user_id, row.status]), [['leave', 'Leave'], ['half', 'Half Day Leave']])
  assert.deepEqual(summary.unmarked.map(row => row.user_id), ['unmarked', 'pending-unmarked'])
  const allIds = [...summary.present, ...summary.leave, ...summary.unmarked].map(row => row.user_id)
  assert.equal(new Set(allIds).size, allIds.length)
  assert.ok(allIds.includes('clocked-in'))
})

test('holiday and weekly off are never classified as unmarked', () => {
  const profiles = [profile('employee')]
  const holiday = buildTodayAttendanceSummary({ date: '2026-07-13', profiles, holidays: [{ holiday_date: '2026-07-13' }] })
  const weeklyOff = buildTodayAttendanceSummary({ date: '2026-07-12', profiles })
  assert.equal(holiday.unmarked.length, 0)
  assert.equal(weeklyOff.unmarked.length, 0)
})

test('attendance status aliases share the centralized semantic palette', async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../../src/features/attendance/attendanceStatus.js')).href
  const { attendanceStatusTone } = await import(moduleUrl)
  assert.equal(attendanceStatusTone('present'), 'present')
  assert.equal(attendanceStatusTone('Half Day Leave'), 'leave')
  assert.equal(attendanceStatusTone('half_day_leave'), 'leave')
  assert.equal(attendanceStatusTone('Leave Pending Approval'), 'pending')
  assert.equal(attendanceStatusTone('Pending Correction'), 'pending')
  assert.equal(attendanceStatusTone('Holiday'), 'holiday')
  assert.equal(attendanceStatusTone('Leave Rejected'), 'future')
  assert.equal(attendanceStatusTone('Not Marked'), 'unmarked')
  assert.equal(attendanceStatusTone('Unmarked'), 'unmarked')
})

test('bulk resume upload parses five files concurrently', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../controllers/resumeController.js'), 'utf8')
  assert.match(source, /runLimited\(files,\s*5,\s*parseOne\)/)
})
