const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const auth = fs.readFileSync(path.join(root, 'src/context/AuthContext.jsx'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src/utils/routePreload.js'), 'utf8')
const apiClient = fs.readFileSync(path.join(root, 'src/services/apiClient.js'), 'utf8')

test('authenticated reload shares one shell loader between preload and React lazy', () => {
  assert.match(preload, /export function loadAuthenticatedShell\(\)/)
  assert.match(app, /const AuthenticatedShell = lazy\(loadAuthenticatedShell\)/)
})

test('authorization keeps the initial skeleton mounted until its route modules are ready', () => {
  assert.match(auth, /preloadAuthenticatedRoute\(initialRouteRef\.current\)/)
  assert.match(auth, /pageViews\.loading \|\| !initialRouteReady/)
})

test('initial route preload covers dashboard, detail, settings, and invoice routes', () => {
  for (const route of [
    '/dashboard',
    '/dashboard/clients/:clientId',
    '/dashboard/clients/:clientId/jobs/:jobId/candidates',
    '/dashboard/settings',
    '/dashboard/profile',
    '/invoice',
    '/invoice/entities/:entityId'
  ]) assert.ok(preload.includes(`'${route}'`), `missing preloader for ${route}`)
})

test('public open roles tree is structurally outside authenticated providers and shell', () => {
  const rootRoutes = app.slice(app.indexOf('function App()'))
  const publicRouteIndex = rootRoutes.indexOf('<Route path="/open-roles"')
  const authenticatedFallbackIndex = rootRoutes.indexOf('<Route path="*" element={<AuthenticatedRoutes')
  assert.ok(publicRouteIndex >= 0, 'missing public open roles route')
  assert.ok(authenticatedFallbackIndex > publicRouteIndex, 'authenticated fallback must follow the public route')
  assert.doesNotMatch(rootRoutes.slice(publicRouteIndex, authenticatedFallbackIndex), /AuthProvider|RequireAuth|AuthenticatedShell|DashboardLayout/)
  assert.match(app, /const AuthProvider = lazy\(\(\) => loadAuthModule\(\)/)
  assert.match(app, /const PublicLayout = lazy\(\(\) => import\('\.\/components\/public\/PublicLayout'\)\)/)
})

test('public boot does not statically initialize Supabase or attach authenticated API headers', () => {
  assert.doesNotMatch(apiClient, /^import .*supabaseClient/m)
  assert.match(apiClient, /await import\('\.\/supabaseClient'\)/)
  assert.match(apiClient, /text === '\/api\/public' \|\| text\.startsWith\('\/api\/public\/'\)/)
})

test('public routes are not internally preloaded while Applied Candidates remains protected and preloadable', () => {
  assert.ok(!preload.includes("'/open-roles'"), 'public roles must not enter authenticated route preloaders')
  assert.ok(preload.includes("'/dashboard/applied-candidates'"), 'missing Applied Candidates preloader')
  assert.match(app, /path="applied-candidates" element={<PageViewGuard pageKey="applied_candidates"><AppliedCandidatesPage \/><\/PageViewGuard>}/)
})
