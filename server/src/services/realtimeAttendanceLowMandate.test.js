const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const attendancePage = fs.readFileSync(path.join(root, 'src/pages/AttendancePage.jsx'), 'utf8')
const attendanceRealtime = fs.readFileSync(path.join(root, 'src/hooks/useAttendanceRealtime.js'), 'utf8')
const notificationBell = fs.readFileSync(path.join(root, 'src/components/NotificationBell.jsx'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260715091118_attendance_realtime_and_low_mandate_notifications.sql'),
  'utf8'
)

test('attendance uses one scoped debounced Realtime channel without approval polling', () => {
  assert.match(attendanceRealtime, /realtime:attendance-page:/)
  assert.match(attendanceRealtime, /debounceMs = 350/)
  assert.match(attendanceRealtime, /filter: `user_id=eq\.\$\{userId\}`/)
  assert.match(attendanceRealtime, /attendance_records/)
  assert.match(attendanceRealtime, /attendance_correction_requests/)
  assert.match(attendanceRealtime, /leave_requests/)
  assert.match(attendanceRealtime, /leave_ledger/)
  assert.match(attendanceRealtime, /company_holidays/)
  assert.match(attendanceRealtime, /supabase\.removeChannel\(channel\)/)
  assert.doesNotMatch(attendancePage, /useRealtimeRefresh|15000/)
  assert.equal((attendancePage.match(/useAttendanceRealtime\(/g) || []).length, 1)
})

test('attendance events map to targeted data and modal-safe queued refreshes', () => {
  assert.match(attendanceRealtime, /table === 'leave_requests'[\s\S]*scopes\.add\('leave-balance'\)/)
  assert.match(attendanceRealtime, /table === 'attendance_correction_requests'[\s\S]*scopes\.add\('approvals'\)/)
  assert.match(attendanceRealtime, /table === 'attendance_records'[\s\S]*scopes\.add\('personal-attendance'\)/)
  assert.match(attendanceRealtime, /table === 'company_holidays'[\s\S]*scopes\.add\('holidays'\)/)
  assert.match(attendancePage, /pendingRealtimeScopesRef/)
  assert.match(attendancePage, /if\(modalRef\.current\)/)
  assert.match(attendancePage, /pendingRealtimeScopesRef\.current\.clear\(\)/)
  assert.match(attendancePage, /loadPersonalAttendance/)
  assert.match(attendancePage, /loadPersonalRequests/)
  assert.match(attendancePage, /loadApprovals/)
  assert.match(attendancePage, /loadLeaveBalance/)
  assert.match(attendancePage, /loadHolidays/)
})

test('migration publishes only the missing holiday attendance table and preserves RLS', () => {
  const publicationAdds = migration.match(/alter publication supabase_realtime add table public\.[a-z_]+/gi) || []
  assert.deepEqual(publicationAdds, ['alter publication supabase_realtime add table public.company_holidays'])
  assert.match(migration, /pg_publication_tables[\s\S]*tablename = 'company_holidays'/)
  assert.doesNotMatch(migration, /drop policy|create policy/)
})

test('low mandate count is database-side, consultant-only, and serialized per consultant', () => {
  assert.match(migration, /for update;/i)
  assert.match(migration, /from public\.jobs job[\s\S]*job\.mandate_status[\s\S]*= 'ongoing'/i)
  assert.match(migration, /unnest\(coalesce\(job\.consultants/)
  const reconcile = migration.slice(
    migration.indexOf('create or replace function public.reconcile_low_mandate_allocation'),
    migration.indexOf('create or replace function public.reconcile_low_mandates_after_job_change')
  )
  assert.doesNotMatch(reconcile, /team_lead/)
  assert.match(reconcile, /not exists \([\s\S]*from public\.admin_users admin_user/)
  assert.match(migration, /notifications_low_mandate_active_unique_idx/)
  assert.match(migration, /on conflict do nothing/i)
})

test('warning lifecycle updates one episode, resolves it, and preserves read state', () => {
  assert.match(migration, /episode_id/)
  assert.match(migration, /Low mandate allocation/)
  assert.match(migration, /currently has no active mandates assigned/)
  assert.match(migration, /currently has only 1 active mandate assigned/)
  assert.match(migration, /set title = 'Low mandate allocation',[\s\S]*message = case v_active_count/)
  assert.match(migration, /set status = 'read',[\s\S]*cleared_at = coalesce\(cleared_at, now\(\)\)/)
  assert.match(migration, /where action_type = 'low_mandate_allocation'[\s\S]*cleared_at is null/)
  assert.doesNotMatch(
    migration.slice(migration.indexOf('-- Count changes patch'), migration.indexOf('insert into public.notifications', migration.indexOf('-- Count changes patch'))),
    /status = 'pending'|read_at = null|cleared_at = null/
  )
})

test('job and employee changes trigger recalculation and initial evaluation is set-based', () => {
  assert.match(migration, /after insert or delete or update of consultants, mandate_status, status[\s\S]*on public\.jobs/i)
  assert.match(migration, /after insert or update of status[\s\S]*on public\.employee_statuses/i)
  assert.match(migration, /employee_status\.status = 'active'/)
  assert.match(migration, /cross join public\.low_mandate_active_super_admins\(\)/)
  assert.match(migration, /with active_consultants as \([\s\S]*active_counts as \(/)
  assert.match(migration, /active_consultants as \([\s\S]*not exists \([\s\S]*from public\.admin_users admin_user/)
  assert.match(migration, /Admin membership also changes whether this user is eligible/)
  assert.match(migration, /group by consultant\.consultant_user_id/)
})

test('existing notification Realtime delivery remains the only notification UI path', () => {
  assert.match(notificationBell, /channelName = `notifications:\$\{user\.id\}`/)
  assert.match(notificationBell, /table: 'notifications'/)
  assert.match(notificationBell, /payload\.eventType === 'UPDATE'/)
  assert.match(notificationBell, /isVisibleNotification\(payload\.new\)/)
})
