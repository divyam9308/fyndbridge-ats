export const PAGE_VIEW_DEFAULTS = {
  dashboard: 'everyone',
  candidates: 'everyone',
  applied_candidates: 'everyone',
  assigned_candidates: 'everyone',
  assigned_candidates_manage: 'admin_only',
  assigned_candidates_overall: 'admin_only',
  clients: 'everyone',
  crm: 'everyone',
  mandates: 'everyone',
  performance_review: 'everyone',
  attendance: 'everyone',
  report: 'everyone',
  invoice: 'admin_only',
  user_manual: 'everyone'
}

export const PAGE_VIEW_ROUTES = {
  dashboard: '/dashboard',
  candidates: '/dashboard/candidates',
  applied_candidates: '/dashboard/applied-candidates',
  assigned_candidates: '/dashboard/assigned-candidates',
  clients: '/dashboard/clients',
  crm: '/dashboard/crm',
  mandates: '/dashboard/jobs',
  performance_review: '/dashboard/performance',
  attendance: '/dashboard/attendance',
  report: '/dashboard/reports/consultant',
  invoice: '/invoice',
  user_manual: '/dashboard/user-manual'
}

export const PAGE_VIEW_ITEMS = [
  ['dashboard', 'Dashboard'],
  ['candidates', 'Candidates'],
  ['applied_candidates', 'Applied Candidates'],
  ['assigned_candidates', 'Assigned Candidates'],
  ['clients', 'Clients'],
  ['crm', 'CRM'],
  ['mandates', 'Mandates'],
  ['performance_review', 'PMS / Performance Review'],
  ['attendance', 'Attendance'],
  ['report', 'Report'],
  ['invoice', 'Invoice'],
  ['user_manual', 'User Manual']
]

export const CONSULTANT_ACCESS_ITEMS = [
  ['assigned_candidates_manage', 'Assigned Candidates · New / Delete All'],
  ['assigned_candidates_overall', 'Assigned Candidates · Overall Consultants']
]
export const INDIVIDUAL_ACCESS_KEYS = ['crm', ...CONSULTANT_ACCESS_ITEMS.map(([key]) => key)]

export function canViewPage({ isAdmin = false, isSuperAdmin = false, userId = '' }, permission = 'everyone', allowedUserIds = []) {
  if (userId && allowedUserIds.includes(userId)) return true
  if (permission === 'everyone') return true
  if (permission === 'admin_only') return isAdmin || isSuperAdmin
  return permission === 'super_admin_only' && isSuperAdmin
}

export function firstPermittedPageRoute(access, permissions, excludedKey = '', consultantAccess = {}) {
  return PAGE_VIEW_ITEMS
    .map(([key]) => key)
    .filter(key => key !== excludedKey)
    .map(key => ({ key, route: PAGE_VIEW_ROUTES[key] }))
    .find(({ key }) => canViewPage(access, permissions[key] || PAGE_VIEW_DEFAULTS[key], consultantAccess[key] || []))?.route || '/login'
}
