export const PAGE_VIEW_DEFAULTS = {
  dashboard: 'everyone',
  candidates: 'everyone',
  clients: 'everyone',
  mandates: 'everyone',
  performance_review: 'everyone',
  attendance: 'everyone',
  invoice: 'admin_only',
  user_manual: 'everyone'
}

export const PAGE_VIEW_ROUTES = {
  dashboard: '/dashboard',
  candidates: '/dashboard/candidates',
  clients: '/dashboard/clients',
  mandates: '/dashboard/jobs',
  performance_review: '/dashboard/performance',
  attendance: '/dashboard/attendance',
  invoice: '/invoice',
  user_manual: '/dashboard/user-manual'
}

export const PAGE_VIEW_ITEMS = [
  ['dashboard', 'Dashboard'],
  ['candidates', 'Candidates'],
  ['clients', 'Clients'],
  ['mandates', 'Mandates'],
  ['performance_review', 'PMS / Performance Review'],
  ['attendance', 'Attendance'],
  ['invoice', 'Invoice'],
  ['user_manual', 'User Manual']
]

export function canViewPage({ isAdmin = false, isSuperAdmin = false }, permission = 'everyone') {
  if (permission === 'everyone') return true
  if (permission === 'admin_only') return isAdmin || isSuperAdmin
  return isSuperAdmin
}

export function firstPermittedPageRoute(access, permissions, excludedKey = '') {
  return PAGE_VIEW_ITEMS
    .map(([key]) => key)
    .filter(key => key !== excludedKey)
    .map(key => ({ key, route: PAGE_VIEW_ROUTES[key] }))
    .find(({ key }) => canViewPage(access, permissions[key] || PAGE_VIEW_DEFAULTS[key]))?.route || '/login'
}
