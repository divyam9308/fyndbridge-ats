import { apiFetch } from './apiClient'

const REPORT_BASE_PATH = '/api/reports/consultant'

async function request(path, { signal } = {}) {
  const response = await apiFetch(`${REPORT_BASE_PATH}${path}`, {
    cache: 'no-store',
    signal
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error || payload.message || 'Unable to load the consultant report.')
    error.status = response.status
    error.code = payload.code
    throw error
  }

  return payload.data ?? payload
}

function reportParams({ consultantUserId, startDate, endDate }) {
  const params = new URLSearchParams()
  if (consultantUserId === 'overall') params.set('scope', 'overall')
  else if (consultantUserId) params.set('consultant_user_id', consultantUserId)
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  return params
}

export function getConsultantReportOptions({ signal } = {}) {
  return request('/options', { signal })
}

export function getConsultantReport(filters, { signal } = {}) {
  const params = reportParams(filters)
  return request(`?${params.toString()}`, { signal })
}

export function getConsultantReportRows(kind, filters, { signal } = {}) {
  const endpoint = kind === 'conversion' ? '/conversions' : '/mandates'
  const params = reportParams(filters)

  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.sortDirection) params.set('sort_direction', filters.sortDirection)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('page_size', String(filters.pageSize))

  return request(`${endpoint}?${params.toString()}`, { signal })
}
