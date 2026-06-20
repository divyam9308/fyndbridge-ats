import { apiFetch } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export async function fetchAdminMe() {
  return json(await apiFetch('/api/admin/me', { cache: 'no-store' }))
}

export async function fetchAdminUsers() {
  return json(await apiFetch('/api/admin/users', { cache: 'no-store' }))
}

export async function addAdminUser(email, role = 'admin') {
  return json(await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role })
  }))
}

export async function removeAdminUser(email) {
  return json(await apiFetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }))
}

export async function updateAdminUserRole(email, role) {
  return json(await apiFetch(`/api/admin/users/${encodeURIComponent(email)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role })
  }))
}

export async function fetchColumnPermissions() {
  return json(await apiFetch('/api/admin/column-permissions', { cache: 'no-store' }))
}

export async function updateColumnPermission(tableName, columnKey, accessMode) {
  return json(await apiFetch('/api/admin/column-permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName, columnKey, accessMode })
  }))
}

export async function fetchLockedRecords() {
  return json(await apiFetch('/api/admin/locked-records', { cache: 'no-store' }))
}

export async function setRecordLock(tableName, id, locked) {
  return json(await apiFetch(`/api/admin/locks/${tableName}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked })
  }))
}
