const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const control = fs.readFileSync(path.join(root, 'src/components/dashboard/DashboardAttendanceButton.jsx'), 'utf8')
const strip = fs.readFileSync(path.join(root, 'src/components/dashboard/OnlineUsersStrip.jsx'), 'utf8')
const stripStyles = fs.readFileSync(path.join(root, 'src/components/dashboard/OnlineUsersStrip.css'), 'utf8')
const dashboard = fs.readFileSync(path.join(root, 'src/pages/DashboardHome.jsx'), 'utf8')
const attendanceApi = fs.readFileSync(path.join(root, 'src/services/attendanceApi.js'), 'utf8')

test('dashboard renders the attendance shortcut at the end of the active-users strip', () => {
  assert.match(strip, /<DashboardAttendanceButton \/>/)
  assert.match(strip, /showAttendance = false/)
  assert.match(dashboard, /showAttendance=\{!isSuperAdmin\}/)
  assert.match(stripStyles, /\.ats-online-users-list \{[\s\S]*flex: 1 1 auto;/)
  assert.match(stripStyles, /\.dashboard-attendance-control \{[\s\S]*flex: 0 0 auto;/)
})

test('dashboard attendance performs one initial read and one action per guarded click', () => {
  assert.equal((control.match(/getTodayAttendance\(/g) || []).length, 1)
  assert.match(control, /requestInFlightRef\.current/)
  assert.match(control, /view\.action === 'clock-out' \? await clockOut\(\) : await clockIn\(\)/)
  assert.match(control, /setRecord\(nextRecord\)/)
  assert.doesNotMatch(control, /setInterval|supabase|attendance_records/)
  assert.match(attendanceApi, /ATTENDANCE_TODAY_CHANGED_EVENT/)
  assert.match(attendanceApi, /notifyTodayChanged\(value\)/)
})

test('CI and CO reminders pulse every three seconds without overriding reduced-motion settings', () => {
  assert.match(control, /view\.reminder/)
  assert.match(stripStyles, /animation: dashboard-attendance-reminder 3s ease-out infinite/)
  assert.match(stripStyles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(stripStyles, /\.dashboard-attendance-button\.is-reminder::after,[\s\S]*animation: none/)
})

test('completed attendance is disabled and clock state resets at company midnight', () => {
  assert.match(control, /view\.mode === 'complete'/)
  assert.match(control, /millisecondsUntilCompanyMidnight\(\)/)
  assert.match(control, /scheduleMidnightRefresh/)
  assert.match(control, /window\.clearTimeout\(midnightTimer\)/)
})
