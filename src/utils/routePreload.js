const preloaders = {
  '/dashboard': () => import('../pages/DashboardHome'),
  '/dashboard/jobs': () => import('../pages/JobsPage'),
  '/dashboard/clients': () => import('../pages/ClientsPage'),
  '/dashboard/candidates': () => import('../pages/CandidatesPage'),
  '/dashboard/performance': () => import('../pages/PerformanceReviewPage'),
  '/dashboard/admin': () => import('../pages/AdminPage'),
  '/invoice': () => import('../pages/InvoicePage')
}

const loaded = new Set()

export function preloadRoute(path) {
  const preload = preloaders[path]
  if (!preload || loaded.has(path)) return
  loaded.add(path)
  preload().catch(() => loaded.delete(path))
}
