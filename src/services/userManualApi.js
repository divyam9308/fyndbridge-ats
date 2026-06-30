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

export async function fetchUserManual() {
  return cachedApiJson('/api/user-manual', {}, { ttlMs: 30000 })
}

export async function uploadUserManual(file) {
  const body = new FormData()
  body.append('manual', file)
  const result = await json(await apiFetch('/api/user-manual', {
    method: 'POST',
    body
  }))
  invalidateApiJsonCache('/api/user-manual')
  return result
}
