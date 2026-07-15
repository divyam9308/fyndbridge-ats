const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const supabase = require('./supabaseAdmin')
const { allowsPageView } = require('./pageViewPermissionPolicy')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')
const { resolveReportAccess } = require('./consultantReportService')
const {
  OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY,
  canViewOverallConsultantReport,
  getOverallConsultantReportAudience,
  setOverallConsultantReportAudience
} = require('./consultantReportAccess')
const adminRouter = require('../routes/admin')
const adminControllerHandlers = require('../controllers/adminController')
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAccessMiddleware')

const root = path.resolve(__dirname, '../../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const app = read('server/src/app.js')
const routes = read('server/src/routes/reports.js')
const middleware = read('server/src/middleware/pageViewAccessMiddleware.js')
const adminAccess = read('server/src/services/adminAccess.js')
const adminController = read('server/src/controllers/adminController.js')
const reportController = read('server/src/controllers/consultantReportController.js')
const reportAttendance = read('server/src/services/consultantReportAttendance.js')
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

test('Overall Consultants visibility follows the saved admin or Super Admin audience', () => {
  const ordinary = { admin: false, superAdmin: false }
  const admin = { admin: true, superAdmin: false }
  const superAdmin = { admin: true, superAdmin: true }

  assert.equal(canViewOverallConsultantReport(ordinary, 'admins'), false)
  assert.equal(canViewOverallConsultantReport(ordinary, 'super_admins'), false)
  assert.equal(canViewOverallConsultantReport(admin, 'admins'), true)
  assert.equal(canViewOverallConsultantReport(admin, 'super_admins'), false)
  assert.equal(canViewOverallConsultantReport(superAdmin, 'admins'), true)
  assert.equal(canViewOverallConsultantReport(superAdmin, 'super_admins'), true)
})

test('direct Overall Consultants requests reject forged ordinary/admin scope and allow the configured audience', () => {
  const directory = [
    { user_id: 'user-1', name: 'One', status: 'active' },
    { user_id: 'user-2', name: 'Two', status: 'on_leave' },
    { user_id: 'user-3', name: 'Three', status: 'inactive' }
  ]

  assert.throws(
    () => resolveReportAccess({
      user: { id: 'user-1' },
      requestedConsultantUserId: 'overall',
      directory,
      overallAudience: 'admins'
    }),
    (error) => error.statusCode === 403 && /permission.*Overall Consultants/i.test(error.message)
  )
  assert.throws(
    () => resolveReportAccess({
      user: { id: 'admin-1' },
      requestedConsultantUserId: 'overall',
      directory,
      admin: true,
      overallAudience: 'super_admins'
    }),
    (error) => error.statusCode === 403 && /permission.*Overall Consultants/i.test(error.message)
  )

  const adminAccess = resolveReportAccess({
    user: { id: 'admin-1' },
    requestedConsultantUserId: 'overall',
    directory,
    admin: true,
    overallAudience: 'admins'
  })
  assert.equal(adminAccess.scope, 'overall')
  assert.equal(adminAccess.target.isOverall, true)
  assert.deepEqual(adminAccess.target.consultants.map((employee) => employee.user_id), ['user-1', 'user-2'])

  const superAdminAccess = resolveReportAccess({
    user: { id: 'super-1' },
    requestedConsultantUserId: 'overall',
    directory,
    admin: true,
    superAdmin: true,
    overallAudience: 'super_admins'
  })
  assert.equal(superAdminAccess.scope, 'overall')
  assert.equal(superAdminAccess.canViewOverall, true)
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

test('Overall Consultants audience is a validated app setting whose PATCH route is Super Admin-only', async () => {
  const calls = []
  let storedValue = 'super_admins'
  const originalFrom = supabase.from
  supabase.from = (table) => {
    calls.push({ operation: 'from', table })
    const query = {
      select(columns) { calls.push({ operation: 'select', columns }); return query },
      eq(column, value) { calls.push({ operation: 'eq', column, value }); return query },
      maybeSingle() {
        calls.push({ operation: 'maybeSingle' })
        return Promise.resolve({ data: storedValue ? { value: storedValue } : null, error: null })
      },
      upsert(row, options) {
        calls.push({ operation: 'upsert', row, options })
        return Promise.resolve({ error: null })
      }
    }
    return query
  }

  try {
    await assert.rejects(
      () => setOverallConsultantReportAudience('everyone'),
      (error) => error.statusCode === 400 && /Invalid Overall Consultants report audience/.test(error.message)
    )
    assert.equal(calls.length, 0, 'invalid audiences must be rejected before accessing the database')

    assert.equal(await getOverallConsultantReportAudience(), 'super_admins')
    storedValue = ''
    assert.equal(await getOverallConsultantReportAudience(), 'admins')
    assert.equal(await setOverallConsultantReportAudience(' admins '), 'admins')
  } finally {
    supabase.from = originalFrom
  }

  assert.deepEqual(
    calls.filter((call) => call.operation === 'from').map((call) => call.table),
    ['app_settings', 'app_settings', 'app_settings']
  )
  assert.deepEqual(
    calls.filter((call) => call.operation === 'eq').map(({ column, value }) => ({ column, value })),
    [
      { column: 'key', value: OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY },
      { column: 'key', value: OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY }
    ]
  )
  const write = calls.find((call) => call.operation === 'upsert')
  assert.equal(write.row.key, OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY)
  assert.equal(write.row.value, 'admins')
  assert.deepEqual(write.options, { onConflict: 'key' })

  const adminGuardPosition = adminRouter.stack.findIndex((layer) => layer.handle === requireAdmin)
  const visibilityRoutePosition = adminRouter.stack.findIndex((layer) => layer.route?.path === '/consultant-report-visibility')
  assert.ok(adminGuardPosition >= 0 && visibilityRoutePosition > adminGuardPosition)
  const visibilityRoute = adminRouter.stack[visibilityRoutePosition].route.stack
  assert.deepEqual(
    visibilityRoute.filter((layer) => layer.method === 'get').map((layer) => layer.handle),
    [adminControllerHandlers.consultantReportVisibility]
  )
  assert.deepEqual(
    visibilityRoute.filter((layer) => layer.method === 'patch').map((layer) => layer.handle),
    [requireSuperAdmin, adminControllerHandlers.consultantReportVisibility]
  )
})

test('consultant options and direct report scopes are derived from authenticated server access', () => {
  assert.match(
    reportService,
    /Promise\.all\(\[[\s\S]*?listEmployeeDirectory\(\)[\s\S]*?isAdmin\(user\)[\s\S]*?isSuperAdmin\(user\)[\s\S]*?getOverallConsultantReportAudience\(\)[\s\S]*?resolveReportAccess\(\{ user, requestedConsultantUserId, directory, admin, superAdmin, overallAudience \}\)/
  )
  assert.match(reportController, /async function options\(req, res\)[\s\S]*?getConsultantOptions\(req\.user\)/)
  assert.doesNotMatch(reportController, /getConsultantOptions\(req\.user\s*,/)
  assert.match(reportService, /async function getConsultantOptions\(user\)[\s\S]*?await reportAccess\(user\)[\s\S]*?access\.isAdmin[\s\S]*?access\.canViewOverall/)
  assert.match(reportService, /async function getConsultantReport\(user, query\)[\s\S]*?parseReportRequest\(query, 'main'\)[\s\S]*?reportAccess\(user, params\.consultantUserId\)/)
  assert.match(reportService, /async function getPaginatedReport\(user, query, kind\)[\s\S]*?parseReportRequest\(query, kind\)[\s\S]*?reportAccess\(user, params\.consultantUserId\)/)
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
  assert.match(reportAttendance, /leaveBalance:\s*\{[\s\S]*?availableBalance/)
  assert.match(reportService, /attendanceService\.leaveBalanceSummary\(/)
  assert.doesNotMatch(reportService, /leaveTypes|leaveCategories|leave_type/)
})

test('overall attendance paginates every potentially large team data read', () => {
  for (const table of ['attendance_records', 'leave_requests', 'attendance_correction_requests']) {
    assert.match(reportService, new RegExp(`fetchEveryPage\\(\\(\\) => supabase[\\s\\S]*?\\.from\\('${table}'\\)`))
  }
})

test('candidate report facts use association ownership and added-date scope independently from mandates', () => {
  assert.match(reportService, /function fetchCandidateAssociations\(startDate, endDate, consultant\)/)
  assert.match(reportService, /\.gte\('created_at', `\$\{queryStart\}T00:00:00\.000Z`\)/)
  assert.match(reportService, /\.lt\('created_at', `\$\{queryEnd\}T00:00:00\.000Z`\)/)
  assert.match(reportService, /queryFactory\(\)\.eq\('consultant_user_id', consultant\.user_id\)/)
  assert.match(reportService, /queryFactory\(\)\.is\('consultant_user_id', null\)/)
  assert.match(reportService, /const factInput\s*=\s*\{[^}]*candidateAssociations[^}]*\}/)
  assert.match(reportService, /buildConsultantReportFacts\(\{\s*\.\.\.factInput,\s*consultant:\s*access\.target\s*\}\)/)
  assert.match(reportService, /candidates: 'candidate_associations\.created_at, attributed by consultant_user_id with a legacy consultant_name fallback;/)
})
