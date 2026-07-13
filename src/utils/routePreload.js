const preloaders = {
  '/dashboard': () => import('../pages/DashboardHome'),
  '/dashboard/jobs': () => import('../pages/JobsPage'),
  '/dashboard/clients': () => import('../pages/ClientsPage'),
  '/dashboard/clients/:clientId': () => import('../pages/ClientDetailPage'),
  '/dashboard/clients/:clientId/jobs/:jobId/candidates': () => import('../pages/ClientJobCandidatesPage'),
  '/dashboard/candidates': () => import('../pages/CandidatesPage'),
  '/dashboard/performance': () => import('../pages/PerformanceReviewPage'),
  '/dashboard/attendance': () => import('../pages/AttendancePage'),
  '/dashboard/user-manual': () => import('../pages/UserManualPage'),
  '/dashboard/admin': () => import('../pages/AdminPage'),
  '/dashboard/settings': () => import('../pages/SettingsPage'),
  '/dashboard/profile': () => import('../pages/ProfileSettingsPage'),
  '/invoice': () => import('../pages/InvoicePage'),
  '/invoice/entities/:entityId': () => import('../pages/InvoiceEntityDetailPage')
}

const routeRequests = new Map()
let authenticatedShellRequest = null

function normalizedPath(path) {
  return String(path || '').split(/[?#]/)[0].replace(/\/$/, '') || '/'
}

function routeKey(path) {
  const value = normalizedPath(path)
  if (/^\/dashboard\/clients\/[^/]+\/jobs\/[^/]+\/candidates$/.test(value)) return '/dashboard/clients/:clientId/jobs/:jobId/candidates'
  if (/^\/dashboard\/clients\/[^/]+$/.test(value)) return '/dashboard/clients/:clientId'
  if (/^\/invoice\/entities\/[^/]+$/.test(value)) return '/invoice/entities/:entityId'
  return value
}

export function loadAuthenticatedShell() {
  if (authenticatedShellRequest) return authenticatedShellRequest
  authenticatedShellRequest = import('../pages/AuthenticatedShell').catch(error => {
    authenticatedShellRequest = null
    throw error
  })
  return authenticatedShellRequest
}

export function preloadRoute(path) {
  const key = routeKey(path)
  const preload = preloaders[key]
  if (!preload) return Promise.resolve(null)
  if (routeRequests.has(key)) return routeRequests.get(key)
  const request = preload().catch(() => {
    routeRequests.delete(key)
    return null
  })
  routeRequests.set(key, request)
  return request
}

export function preloadAuthenticatedRoute(path) {
  return Promise.allSettled([loadAuthenticatedShell(), preloadRoute(path)])
}
