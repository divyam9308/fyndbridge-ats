const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { allowsPageView } = require('./pageViewPermissionPolicy')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')
const { resolveReportAccess } = require('./consultantReportService')

const root = path.resolve(__dirname, '../../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const app = read('server/src/app.js')
const routes = read('server/src/routes/reports.js')
const middleware = read('server/src/middleware/pageViewAccessMiddleware.js')
const adminAccess = read('server/src/services/adminAccess.js')
const adminController = read('server/src/controllers/adminController.js')
const reportService = read('server/src/services/consultantReportService.js')

test('Report page policy handles everyone, admin-only, super-admin-only and invalid values', () => {
  const ordinary = { isAdmin: false, isSuperAdmin: false }
  const admin = { isAdmin: true, isSuperAdmin: false }
  const superAdmin = { isAdmin: true, isSuperAdmin: true }

  for (const access of [ordinary, admin, superAdmin]) assert.equal(allowsPageView('everyone', access), true)
  assert.equal(allowsPageView('admin_only', ordinary), false)
  assert.equal(allowsPageView('admin_only', admin), true)
  assert.equal(allowsPageView('admin_only', superAdmin), true)
  assert.equal(allowsPageView('super_admin_only', ordinary), false)
  assert.equal(allowsPageView('super_admin_only', admin), false)
  assert.equal(allowsPageView('super_admin_only', superAdmin), true)
  assert.equal(allowsPageView('disabled', superAdmin), false)
  assert.equal(allowsPageView(undefined, superAdmin), false)
})

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

async function runPageGuard({ user, permission, admin = false, superAdmin = false }) {
  const calls = []
  const res = responseRecorder()
  const middleware = requirePageViewPermission('report', {
    getPageViewPermission: async (pageKey, options) => { calls.push({ pageKey, options }); return permission },
    isAdmin: async () => admin,
    isSuperAdmin: async () => superAdmin
  })
  let nextCalled = false
  await middleware({ user }, res, (error) => {
    assert.ifError(error)
    nextCalled = true
  })
  return { calls, nextCalled, res }
}

test('Report permission middleware executes unauthenticated, denied and role-gated paths', async () => {
  let result = await runPageGuard({ user: null, permission: 'everyone' })
  assert.equal(result.res.statusCode, 401)
  assert.equal(result.nextCalled, false)
  assert.equal(result.calls.length, 0)

  result = await runPageGuard({ user: { id: 'user-1' }, permission: null })
  assert.equal(result.res.statusCode, 403)
  assert.equal(result.nextCalled, false)
  assert.deepEqual(result.calls, [{ pageKey: 'report', options: { fresh: true } }])

  result = await runPageGuard({ user: { id: 'user-1' }, permission: 'everyone' })
  assert.equal(result.nextCalled, true)

  result = await runPageGuard({ user: { id: 'user-1' }, permission: 'admin_only' })
  assert.equal(result.res.statusCode, 403)
  result = await runPageGuard({ user: { id: 'admin-1' }, permission: 'admin_only', admin: true })
  assert.equal(result.nextCalled, true)

  result = await runPageGuard({ user: { id: 'admin-1' }, permission: 'super_admin_only', admin: true })
  assert.equal(result.res.statusCode, 403)
  result = await runPageGuard({ user: { id: 'super-1' }, permission: 'super_admin_only', admin: true, superAdmin: true })
  assert.equal(result.nextCalled, true)
})

test('consultant access resolution executes self-only, admin and inactive-user rules', () => {
  const directory = [
    { user_id: 'user-1', name: 'One', status: 'active' },
    { user_id: 'user-2', name: 'Two', status: 'on_leave' },
    { user_id: 'user-3', name: 'Three', status: 'inactive' }
  ]
  const user = { id: 'user-1' }

  assert.equal(resolveReportAccess({ user, directory }).target.user_id, 'user-1')
  assert.throws(
    () => resolveReportAccess({ user, requestedConsultantUserId: 'user-2', directory }),
    (error) => error.statusCode === 403 && /only view your own/.test(error.message)
  )
  assert.equal(resolveReportAccess({
    user: { id: 'admin-1' },
    requestedConsultantUserId: 'user-2',
    directory,
    admin: true
  }).target.status, 'on_leave')
  assert.throws(
    () => resolveReportAccess({
      user: { id: 'admin-1' },
      requestedConsultantUserId: 'user-3',
      directory,
      admin: true
    }),
    (error) => error.statusCode === 403 && /Inactive employees/.test(error.message)
  )
})

test('every report endpoint is mounted behind authentication and fresh Report page permission', () => {
  assert.match(app, /app\.use\('\/api\/reports',\s*requireAuth,\s*require\('\.\/routes\/reports'\)\)/)
  assert.match(routes, /router\.use\(requirePageViewPermission\('report'\)\)/)
  const guardPosition = routes.indexOf("router.use(requirePageViewPermission('report'))")
  for (const endpoint of [
    "router.get('/consultant/options'",
    "router.get('/consultant/mandates'",
    "router.get('/consultant/conversions'",
    "router.get('/consultant'"
  ]) {
    assert.ok(routes.indexOf(endpoint) > guardPosition, `${endpoint} must be declared after the Report permission guard`)
  }
  assert.match(middleware, /if \(!req\.user\?\.id\) return res\.status\(401\)/)
  assert.match(middleware, /readPermission\(pageKey, \{ fresh: true \}\)/)
  assert.match(middleware, /if \(!permission\) return res\.status\(403\)/)
  assert.match(middleware, /allowsPageView\(permission, \{ isAdmin: admin, isSuperAdmin: superAdmin \}\)/)
})

test('Report is registered in the existing backend page-view whitelist and admin update path', () => {
  assert.match(adminAccess, /const PAGE_VIEW_DEFAULTS = \{[\s\S]*?report:\s*'everyone'/)
  assert.match(adminAccess, /const PAGE_VIEW_PERMISSION_VALUES = new Set\(\['everyone', 'admin_only', 'super_admin_only'\]\)/)
  assert.match(adminAccess, /async function getPageViewPermission\(pageKey, \{ fresh = false \} = \{\}\)/)
  assert.match(adminAccess, /if \(!Object\.hasOwn\(PAGE_VIEW_DEFAULTS, pageKey\)\) return null/)
  assert.match(adminAccess, /getPageViewPermission,/)
  assert.match(adminController, /Object\.hasOwn\(PAGE_VIEW_DEFAULTS, pageKey\)/)
  assert.match(adminController, /PAGE_VIEW_PERMISSION_VALUES\.has\(viewPermission\)/)
  assert.match(adminController, /\.upsert\(\{ page_key: pageKey, view_permission: viewPermission[\s\S]*?onConflict: 'page_key'/)
})

test('ordinary users are source-enforced as self-only while administrators use the employee directory', () => {
  assert.match(reportService, /listEmployeeDirectory\(\)/)
  assert.match(reportService, /isAdmin\(user\)/)
  assert.match(reportService, /isSuperAdmin\(user\)/)
  assert.match(reportService, /if \(!admin && consultantUserId !== user\?\.id\) throw forbidden\('You can only view your own consultant report\.'\)/)
  assert.match(reportService, /if \(!admin && !currentEmployee\) throw forbidden\('A consultant profile is required to view this report\.'\)/)
  assert.match(reportService, /if \(target\.status === 'inactive'\) throw forbidden/)
  assert.match(reportService, /access\.isAdmin[\s\S]*?access\.directory\.filter\(\(employee\) => employee\.status !== 'inactive'\)/)
})

test('report identity and attendance payload omit mock-only private fields and leave categories', () => {
  assert.match(reportService, /function publicConsultant\(employee\)[\s\S]*?key: employee\.user_id,[\s\S]*?name: employee\.name,[\s\S]*?email: employee\.email[\s\S]*?employeeStatus:/)
  assert.doesNotMatch(reportService, /employeeId|designation|department|reportingManager/)
  assert.doesNotMatch(reportService, /Casual Leave|Sick Leave|Earned Leave|Comp Off|Late Days/)
  assert.match(reportService, /leaveBalance:\s*\{[\s\S]*?availableBalance/)
  assert.match(reportService, /attendanceService\.leaveBalanceSummary\(/)
  assert.doesNotMatch(reportService, /leaveTypes|leaveCategories|leave_type/)
})
