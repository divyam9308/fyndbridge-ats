import { apiFetch } from './apiClient'
export async function crmRequest(path = '', options = {}) {
  const response = await apiFetch(`/api/crm${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Unable to complete the CRM request.'), { ...payload, status: response.status })
  return payload
}
