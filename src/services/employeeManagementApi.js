import { apiFetch } from './apiClient'

async function json(response, fallback) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || fallback)
    error.code = payload.code
    throw error
  }
  return payload.data
}

export async function fetchEmployees() {
  return json(await apiFetch('/api/admin/employees', { cache: 'no-store' }), 'Unable to load employees.')
}

export async function fetchEmployeeDetail(employeeId) {
  return json(await apiFetch(`/api/admin/employees/${encodeURIComponent(employeeId)}`, { cache: 'no-store' }), 'Unable to load employee assignments.')
}

export async function fetchEmployeeReassignmentRecords(employeeId, category, { search = '', offset = 0, limit = 50 } = {}) {
  const params = new URLSearchParams({ category, search, offset: String(offset), limit: String(limit) })
  return json(await apiFetch(`/api/admin/employees/${encodeURIComponent(employeeId)}/reassignment-records?${params}`, { cache: 'no-store' }), 'Unable to load current assignments.')
}

export async function saveEmployeeStatus(employeeId, status) {
  return json(await apiFetch(`/api/admin/employees/${encodeURIComponent(employeeId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  }), 'Unable to update employee status.')
}

export async function reassignEmployee(employeeId, destinationUserId, selections) {
  return json(await apiFetch(`/api/admin/employees/${encodeURIComponent(employeeId)}/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination_user_id: destinationUserId, selections })
  }), 'Unable to reassign employee.')
}
