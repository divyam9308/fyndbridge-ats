import { apiFetch, openProtectedUrl } from './apiClient'

export async function assignedRequest(path = '', init = {}) {
  const headers = init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers }
  const response = await apiFetch(`/api/assigned-candidates${path}`, { ...init, headers, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error((response.status === 413 ? 'This CV exceeds the deployment upload limit. Choose a smaller file.' : payload.error) || Object.values(payload.errors || {})[0] || 'Unable to complete this request.')
    Object.assign(error, { status: response.status, code: payload.code, duplicate: payload.duplicate ? payload : null, exactAssociation: payload.exactAssociation })
    throw error
  }
  return payload
}
export const openAssignedCv = id => openProtectedUrl(`/api/assigned-candidates/${id}/cv`)
export async function transferAssignedCandidate(id, body, { onProgress } = {}) {
  const result = await assignedRequest(`/${id}/transfer`, { method: 'POST', body: JSON.stringify(body) })
  if (!result.processing) return result
  assignmentsChanged()
  onProgress?.('Processing CV and adding candidate…')
  try {
    // The durable worker continues after the modal closes or this bounded wait ends.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const state = await assignedRequest(`/${id}/transfer`)
      if (state.status === 'complete') return state
      if (state.status === 'failed') throw new Error(state.error || 'CV processing failed. Retry this transfer to continue.')
    }
    throw new Error('CV processing continues in the background. You can close this form and check the assignment’s transfer status. Saving again safely checks the same transfer.')
  } finally { assignmentsChanged({ candidates: true }); onProgress?.('') }
}
export function assignmentsChanged({ candidates = false } = {}) {
  window.dispatchEvent(new Event('ats:assigned-candidates-updated'))
  if (candidates) {
    window.dispatchEvent(new Event('ats:candidates-updated'))
    window.dispatchEvent(new Event('ats:jobs-updated'))
  }
  try { window.localStorage.setItem('ats:sidebar-counts-refresh', String(Date.now())) } catch { /* The current tab still refreshes. */ }
}
