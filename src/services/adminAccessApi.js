import { apiFetch, cachedApiJson, invalidateApiJsonCache } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export async function fetchAdminMe() {
  return cachedApiJson('/api/admin/me', {}, { ttlMs: 15000 })
}

export async function fetchPageViewPermissions() {
  return cachedApiJson('/api/admin/page-view-permissions', {}, { ttlMs: 30000 })
}

export async function updatePageViewPermission(pageKey, viewPermission) {
  const result = await json(await apiFetch('/api/admin/page-view-permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageKey, viewPermission })
  }))
  invalidateApiJsonCache('/api/admin/page-view-permissions')
  return result
}

export async function fetchDashboardVisibility() { return cachedApiJson('/api/admin/dashboard-visibility', {}, { ttlMs: 30000 }) }
export async function updateDashboardVisibility(restrictNonAdminToSelf) {
  const result = await json(await apiFetch('/api/admin/dashboard-visibility', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restrictNonAdminToSelf }) }))
  invalidateApiJsonCache('/api/admin')
  return result
}

export async function fetchAdminUsers() {
  return cachedApiJson('/api/admin/users', {}, { ttlMs: 30000 })
}

export async function fetchAdminBootstrap() {
  return cachedApiJson('/api/admin/bootstrap', {}, { ttlMs: 15000 })
}

export async function fetchAdminProfileOptions() {
  return cachedApiJson('/api/admin/user-profiles', {}, { ttlMs: 60000 })
}

export async function addAdminUser(userId, role = 'admin') {
  const result = await json(await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, role })
  }))
  invalidateApiJsonCache('/api/admin')
  return result
}

export async function removeAdminUser(email) {
  const result = await json(await apiFetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }))
  invalidateApiJsonCache('/api/admin')
  return result
}

export async function updateAdminUserRole(email, role) {
  const result = await json(await apiFetch(`/api/admin/users/${encodeURIComponent(email)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role })
  }))
  invalidateApiJsonCache('/api/admin')
  return result
}

export async function fetchColumnPermissions() {
  return cachedApiJson('/api/admin/column-permissions', {}, { ttlMs: 30000 })
}

export async function updateColumnPermission(tableName, columnKey, accessMode) {
  const result = await json(await apiFetch('/api/admin/column-permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName, columnKey, accessMode })
  }))
  invalidateApiJsonCache('/api/admin/column-permissions')
  return result
}

export async function fetchLockedRecords() {
  return cachedApiJson('/api/admin/locked-records', {}, { ttlMs: 15000 })
}

export async function setRecordLock(tableName, id, locked) {
  const result = await json(await apiFetch(`/api/admin/locks/${tableName}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked })
  }))
  invalidateApiJsonCache('/api/admin')
  return result
}
