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

function periodQuery(period) {
  return period ? `?period=${encodeURIComponent(period)}` : ''
}

export async function fetchMyPerformanceReview(period) {
  return cachedApiJson(`/api/performance/me${periodQuery(period)}`, {}, { ttlMs: 30000 })
}

export async function fetchPerformanceReview(employeeUserId, period) {
  return cachedApiJson(`/api/performance/${encodeURIComponent(employeeUserId)}${periodQuery(period)}`, {}, { ttlMs: 30000 })
}

export async function savePerformanceReview(employeeUserId, rows, period) {
  const result = await json(await apiFetch(`/api/performance/${encodeURIComponent(employeeUserId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, period })
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

export async function fetchEmployeeHandbook() {
  return cachedApiJson('/api/performance/handbook', {}, { ttlMs: 30000 })
}

export async function uploadEmployeeHandbook(file) {
  const body = new FormData()
  body.append('handbook', file)
  const result = await json(await apiFetch('/api/performance/handbook', {
    method: 'POST',
    body
  }))
  invalidateApiJsonCache('/api/performance/handbook')
  return result
}
