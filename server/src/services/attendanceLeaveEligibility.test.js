const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  excludeSuperAdminProfiles,
  isSuperAdminProfile
} = require('./attendanceLeaveEligibility')

const admins = [
  { user_id: 'super-by-id', email: 'first@example.com', role: 'super_admin', is_super_admin: false },
  { user_id: null, email: 'Legacy.Super@Example.com', role: 'admin', is_super_admin: true },
  { user_id: 'regular-admin', email: 'admin@example.com', role: 'admin', is_super_admin: false }
]

test('leave eligibility recognizes superadmins by user id and legacy email', () => {
  assert.equal(isSuperAdminProfile({ user_id: 'super-by-id', email: 'other@example.com' }, admins), true)
  assert.equal(isSuperAdminProfile({ user_id: 'legacy-id', email: 'legacy.super@example.com' }, admins), true)
  assert.equal(isSuperAdminProfile({ user_id: 'regular-admin', email: 'admin@example.com' }, admins), false)
})

test('leave balance profiles exclude superadmins but retain regular admins and employees', () => {
  const profiles = [
    { user_id: 'employee', name: 'Employee', email: 'employee@example.com' },
    { user_id: 'super-by-id', name: 'Super by ID', email: 'different@example.com' },
    { user_id: 'legacy-id', name: 'Legacy Super', email: 'LEGACY.SUPER@example.com' },
    { user_id: 'regular-admin', name: 'Regular Admin', email: 'admin@example.com' }
  ]

  assert.deepEqual(
    excludeSuperAdminProfiles(profiles, admins).map(profile => profile.user_id),
    ['employee', 'regular-admin']
  )
})

test('attendance service checks superadmin eligibility before accrual and filters the balance list', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'attendanceService.js'), 'utf8')
  const ledgerInitializer = source.slice(
    source.indexOf('async function ensureFinancialYearLedger'),
    source.indexOf('async function leaveBalanceSummary')
  )
  const balanceList = source.slice(
    source.indexOf('async function listLeaveBalances'),
    source.indexOf('async function adjustLeaveBalance')
  )

  assert.ok(ledgerInitializer.indexOf('isSuperAdminProfile') < ledgerInitializer.indexOf("entry_type:'accrual'"))
  assert.match(balanceList, /excludeSuperAdminProfiles[\s\S]*profiles\.map/)
})
