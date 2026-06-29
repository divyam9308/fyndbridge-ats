import { apiFetch, cachedApiJson, invalidateApiJsonCache } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed')
    error.fields = payload.fields || []
    throw error
  }
  return payload
}

export async function fetchMyPerformanceReview() {
  return cachedApiJson('/api/performance/me', {}, { ttlMs: 30000 })
}

export async function fetchPerformanceReview(employeeUserId) {
  return cachedApiJson(`/api/performance/${encodeURIComponent(employeeUserId)}`, {}, { ttlMs: 30000 })
}

export async function savePerformanceReview(employeeUserId, rows) {
  const result = await json(await apiFetch(`/api/performance/${encodeURIComponent(employeeUserId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  }))
  invalidateApiJsonCache('/api/performance')
  return result
}

export async function fetchPerformancePermissions() {
  return cachedApiJson('/api/performance/permissions', {}, { ttlMs: 30000 })
}

export async function savePerformancePermissions(permissions) {
  const result = await json(await apiFetch('/api/performance/permissions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions })
  }))
  invalidateApiJsonCache('/api/performance')
  invalidateApiJsonCache('/api/admin/bootstrap')
  return result
}
