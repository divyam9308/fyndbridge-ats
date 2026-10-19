import { apiFetch, openProtectedUrl } from './apiClient'

export async function assignedRequest(path = '', init = {}) {
  const headers = init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers }
  const response = await apiFetch(`/api/assigned-candidates${path}`, { ...init, headers, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error((response.status === 413 ? 'This CV exceeds the deployment upload limit. Choose a smaller file.' : payload.error) || Object.values(payload.errors || {})[0] || 'Unable to complete this request.')
    Object.assign(error, { status: response.status, duplicate: payload.duplicate ? payload : null, exactAssociation: payload.exactAssociation })
    throw error
  }
  return payload
}
export const openAssignedCv = id => openProtectedUrl(`/api/assigned-candidates/${id}/cv`)
export function assignmentsChanged({ candidates = false } = {}) {
  window.dispatchEvent(new Event('ats:assigned-candidates-updated'))
  if (candidates) {
    window.dispatchEvent(new Event('ats:candidates-updated'))
    window.dispatchEvent(new Event('ats:jobs-updated'))
  }
  try { window.localStorage.setItem('ats:sidebar-counts-refresh', String(Date.now())) } catch { /* The current tab still refreshes. */ }
}
