const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')
const app = read('src/App.jsx')
const main = read('src/main.jsx')
const errorBoundary = read('src/components/AppErrorBoundary.jsx')
const notificationBell = read('src/components/NotificationBell.jsx')
const adminPage = read('src/pages/AdminPage.jsx')
const dashboardAccess = read('server/src/services/dashboardAccess.js')
const migration = read('supabase/migrations/20260715091118_attendance_realtime_and_low_mandate_notifications.sql')

test('invalid and legacy notification routes cannot leave the ATS on a blank page', () => {
  assert.equal((migration.match(/['"]\/dashboard\/mandates['"]/g) || []).length, 1)
  assert.match(migration, /set action_url = '\/dashboard\/jobs'/)
  assert.match(notificationBell, /replace\(\/\^\\\/dashboard\\\/mandates/)
  assert.match(app, /path="mandates"[\s\S]*Navigate to="\/dashboard\/jobs"/)
  assert.match(app, /path="\*"[\s\S]*Navigate to="\/dashboard"/)
})

test('render and stale-asset failures show recovery UI instead of a white screen', () => {
  assert.match(main, /<AppErrorBoundary>/)
  assert.match(errorBoundary, /getDerivedStateFromError/)
  assert.match(errorBoundary, /Failed to fetch dynamically imported module/)
  assert.match(errorBoundary, /window\.location\.replace\(recoveryUrl\(\)\)/)
  assert.match(errorBoundary, /Reload ATS/)
})

test('low-mandate audience supports everyone, admins and super admins with a database default', () => {
  assert.match(migration, /low_mandate_notification_audience', '"super_admins"'::jsonb/)
  assert.match(migration, /in \('everyone', 'admins', 'super_admins'\)/)
  assert.match(migration, /create or replace function public\.low_mandate_notification_recipients\(\)/)
  assert.match(migration, /app_settings_reconcile_low_mandate_audience/)
  assert.match(migration, /not exists \([\s\S]*low_mandate_notification_recipients\(\)/)
  assert.match(dashboardAccess, /LOW_MANDATE_AUDIENCES = new Set\(\['everyone', 'admins', 'super_admins'\]\)/)
})

test('admin panel reuses the existing three-option permission control for the audience', () => {
  assert.match(adminPage, /Less than 5 mandates notifications/)
  assert.match(adminPage, /LOW_MANDATE_AUDIENCE_OPTIONS/)
  assert.match(adminPage, /<AdminPermissionPicker value=\{lowMandateAudience\}/)
  assert.match(adminPage, /lowMandateAudienceDirty/)
  assert.match(adminPage, /updateDashboardVisibility\(\{ restrictNonAdminToSelf: dashboardRestricted, lowMandateNotificationAudience: lowMandateAudience \}\)/)
})
