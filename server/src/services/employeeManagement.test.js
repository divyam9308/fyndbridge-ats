const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { activeEmployeeOptions, normalizeEmploymentStatus, validateEmploymentStatus } = require('./employeeStatusUtils')

const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/20260713082653_employee_management_backend.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
const adminRoutes = fs.readFileSync(path.resolve(__dirname, '../routes/admin.js'), 'utf8')
const requireAuth = fs.readFileSync(path.resolve(__dirname, '../middleware/requireAuth.js'), 'utf8')
const authContext = fs.readFileSync(path.resolve(__dirname, '../../../src/context/AuthContext.jsx'), 'utf8')
const staffDirectory = fs.readFileSync(path.resolve(__dirname, '../../../src/hooks/useStaffDirectory.js'), 'utf8')
const employeeManagementUi = fs.readFileSync(path.resolve(__dirname, '../../../src/features/employee-management/EmployeeManagement.jsx'), 'utf8')

test('employment status accepts exactly the supported values', () => {
  assert.equal(validateEmploymentStatus('active'), 'active')
  assert.equal(validateEmploymentStatus('on_leave'), 'on_leave')
  assert.equal(validateEmploymentStatus('inactive'), 'inactive')
  assert.throws(() => validateEmploymentStatus('away'), /active, on_leave or inactive/)
  assert.equal(normalizeEmploymentStatus(null), 'active')
})

test('new assignment options include only Active employees', () => {
  const employees = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'on_leave' },
    { id: 'c', status: 'inactive' }
  ]
  assert.deepEqual(activeEmployeeOptions(employees).map((employee) => employee.id), ['a'])
})

test('On Leave and Inactive employees are excluded from future assignments', () => {
  const employees = [
    { id: 'active', status: 'active' },
    { id: 'leave', status: 'on_leave' },
    { id: 'former', status: 'inactive' }
  ]
  assert.deepEqual(activeEmployeeOptions(employees), [employees[0]])
  assert.equal(employees[1].status, 'on_leave')
  assert.equal(employees[2].status, 'inactive')
})

test('migration backfills without overwriting and creates status after profile naming', () => {
  assert.match(migration, /alter table public\.clients[\s\S]*add column if not exists consultant_user_id uuid/i)
  assert.match(migration, /alter table public\.candidate_associations[\s\S]*add column if not exists consultant_user_id uuid/i)
  assert.match(migration, /on conflict \(user_id\) do nothing/i)
  assert.match(migration, /after insert or update of name on public\.user_profiles/i)
  assert.match(migration, /nullif\(btrim\(new\.name\), ''\) is not null/i)
})

test('migration enables RLS, authenticated reads and only the required Realtime table', () => {
  assert.match(migration, /alter table public\.employee_statuses enable row level security/i)
  assert.match(migration, /grant select on public\.employee_statuses to authenticated/i)
  assert.match(migration, /create or replace function public\.is_current_employee_active\(\)/i)
  assert.match(migration, /using \(public\.is_current_employee_active\(\)\)/i)
  assert.match(migration, /alter publication supabase_realtime add table public\.employee_statuses/i)
  assert.equal((migration.match(/alter publication supabase_realtime add table/gi) || []).length, 1)
})

test('reassignment is one Super Admin-only database function with destination validation and mandate deduplication', () => {
  assert.match(migration, /create or replace function public\.reassign_employee_assignments/i)
  assert.match(migration, /admin_user\.role = 'super_admin'/i)
  assert.match(migration, /Super Admin access required/i)
  assert.match(migration, /destination_status <> 'active'/i)
  assert.match(migration, /distinct on \(lower\(btrim\(replaced\.value\)\)\)/i)
  assert.match(migration, /revoke all on function public\.reassign_employee_assignments[\s\S]*from public, anon, authenticated/i)
})

test('employee previews are bounded and list counts are aggregated', () => {
  assert.match(migration, /limit greatest\(1, least\(coalesce\(p_preview_limit, 4\), 10\)\)/i)
  assert.match(migration, /client_counts as[\s\S]*mandate_counts as[\s\S]*candidate_counts as/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(clients|jobs|candidates|candidate_associations|user_profiles)/i)
})

test('reassignment runs atomically inside Postgres and preserves existing rows', () => {
  assert.match(migration, /language plpgsql[\s\S]*begin[\s\S]*update public\.clients[\s\S]*update public\.jobs[\s\S]*update public\.candidate_associations[\s\S]*end;/i)
  assert.doesNotMatch(migration, /truncate|drop table|delete from/i)
})

test('employee-management reads remain Admin-visible while mutations require Super Admin', () => {
  const guardPosition = adminRoutes.indexOf('router.use(requireAdmin)')
  const employeePosition = adminRoutes.indexOf("router.get('/employees'")
  assert.ok(guardPosition >= 0 && employeePosition > guardPosition)
  assert.match(adminRoutes, /router\.patch\('\/employees\/:employeeId\/status', requireSuperAdmin, employeeController\.updateStatus\)/)
  assert.match(adminRoutes, /router\.post\('\/employees\/:employeeId\/reassign', requireSuperAdmin, employeeController\.reassign\)/)
  assert.match(employeeManagementUi, /isSuperAdmin = false/)
  assert.match(employeeManagementUi, /disabled=\{!isSuperAdmin \|\| statusSaving\}/)
  assert.match(employeeManagementUi, /disabled=\{!isSuperAdmin\}/)
})

test('inactive accounts are rejected centrally while On Leave remains authorized', () => {
  assert.match(requireAuth, /employment\?\.status === 'inactive'/)
  assert.match(requireAuth, /status\(403\)/)
  assert.match(requireAuth, /ACCOUNT_INACTIVE/)
  assert.doesNotMatch(requireAuth, /employment\?\.status === 'on_leave'/)
})

test('frontend performs one initial status check and uses one event-driven status channel', () => {
  assert.equal((authContext.match(/\/api\/auth\/employment-status/g) || []).length, 1)
  assert.equal((authContext.match(/\.channel\(channelName\)/g) || []).length, 1)
  assert.equal((authContext.match(/global:employee-statuses/g) || []).length, 1)
  assert.doesNotMatch(authContext, /setInterval|visibilitychange|document\.hasFocus/)
  assert.match(authContext, /supabase\.removeChannel\(channel\)/)
})

test('shared staff directory exposes all historical assignees and Active-only choices', () => {
  assert.match(staffDirectory, /staff: mergedStaff, selectableStaff/)
  assert.match(staffDirectory, /employee\.status === 'active'/)
})
