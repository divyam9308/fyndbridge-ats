const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const attendanceService = fs.readFileSync(path.join(root, 'server/src/services/attendanceService.js'), 'utf8')
const attendancePage = fs.readFileSync(path.join(root, 'src/pages/AttendancePage.jsx'), 'utf8')

test('attendance reads persist prior-day open clock-ins as not marked without deleting the clock-in', () => {
  const expiryQuery = attendanceService.match(/supabase\.from\('attendance_records'\)\.update\([^\n]+\.lt\('attendance_date',beforeDate\)/)?.[0] || ''

  assert.match(expiryQuery, /status:'not_marked'/)
  assert.match(expiryQuery, /\.eq\('status','clocked_in'\)/)
  assert.match(expiryQuery, /\.is\('clock_out_at',null\)/)
  assert.doesNotMatch(expiryQuery, /clock_in_at:/)
  assert.ok((attendanceService.match(/await expireOpenClockIns\(/g) || []).length >= 2)
})

test('an open attendance page refreshes personal and team state at the India company-day boundary', () => {
  assert.match(attendancePage, /const COMPANY_TIME_OFFSET_MS=330\*60\*1000/)
  assert.match(attendancePage, /millisecondsUntilCompanyMidnight\(\)\+500/)
  assert.match(attendancePage, /setCurrentNow\(new Date\(\)\)/)
  assert.match(attendancePage, /if\(!isSuperAdmin\)scopes\.push\('personal-attendance'\)/)
  assert.match(attendancePage, /if\(tab==='team'\)scopes\.push\('team'\)/)
})
