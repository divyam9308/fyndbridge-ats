import { apiFetch } from './apiClient'

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
  return json(await apiFetch('/api/performance/me', { cache: 'no-store' }))
}

export async function fetchPerformanceReview(employeeUserId) {
  return json(await apiFetch(`/api/performance/${encodeURIComponent(employeeUserId)}`, { cache: 'no-store' }))
}

export async function savePerformanceReview(employeeUserId, rows) {
  return json(await apiFetch(`/api/performance/${encodeURIComponent(employeeUserId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  }))
}

export async function fetchPerformancePermissions() {
  return json(await apiFetch('/api/performance/permissions', { cache: 'no-store' }))
}

export async function savePerformancePermissions(permissions) {
  return json(await apiFetch('/api/performance/permissions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions })
  }))
}
