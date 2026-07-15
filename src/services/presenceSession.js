import { apiFetch } from './apiClient'

export const PRESENCE_LOGOUT_EVENT = 'fb:presence-logout'
export const PRESENCE_LOGOUT_STORAGE_KEY = 'fb_presence_logout'

function announcePresenceLogout(userId) {
  const detail = { user_id: userId || '', at: Date.now() }
  window.dispatchEvent(new CustomEvent(PRESENCE_LOGOUT_EVENT, { detail }))
  try { window.localStorage.setItem(PRESENCE_LOGOUT_STORAGE_KEY, JSON.stringify(detail)) } catch {
    // The current tab still receives the DOM event when storage is unavailable.
  }
}

export async function clearPresenceBeforeLogout(userId = '') {
  if (!userId) return
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 2500)
  try {
    await apiFetch('/api/presence/offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all_tabs: true }),
      signal: controller.signal
    })
  } catch {
    // Logout must continue even if the best-effort presence cleanup fails.
  } finally {
    window.clearTimeout(timeout)
    announcePresenceLogout(userId)
  }
}
