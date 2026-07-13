const ROUTES = {
  clients: '/dashboard/clients',
  candidates: '/dashboard/candidates',
  mandates: '/dashboard/jobs'
}

const FILTER_KEYS = ['consultant', 'teamLead', 'status', 'clientName', 'role', 'period']

export function buildDashboardDrilldownUrl(entityType, filters = {}) {
  const params = new URLSearchParams()
  FILTER_KEYS.forEach(key => {
    const value = String(filters[key] ?? '').trim()
    if (value && value !== 'All' && value !== 'Overall (All Consultants)') params.set(key, value)
  })
  params.set('source', 'dashboard')
  return `${ROUTES[entityType]}?${params.toString()}`
}

export function parseDashboardFiltersFromUrl(search = '') {
  const params = new URLSearchParams(search)
  if (params.get('source') !== 'dashboard') return null
  return Object.fromEntries(FILTER_KEYS.map(key => [key, params.get(key)?.trim() || '']))
}

export function clearDashboardFilters(search = '') {
  const params = new URLSearchParams(search)
  FILTER_KEYS.forEach(key => params.delete(key))
  params.delete('source')
  return params.toString()
}

function dashboardPeriodDisplay(value) {
  const month = String(value || '').match(/^Month (\d{4})-(0[1-9]|1[0-2])$/)
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const quarter = String(value || '').match(/^(FY \d{4}-\d{2}) (Q[1-4])$/)
  return quarter ? `${quarter[2]} · ${quarter[1]}` : value
}

export const dashboardFilterEntries = (filters) => [
  ['Consultant', filters?.consultant],
  ['Team Lead', filters?.teamLead],
  ['Status', filters?.status],
  ['Client', filters?.clientName],
  ['Role', filters?.role],
  ['Period', dashboardPeriodDisplay(filters?.period)]
].filter(([, value]) => value)
