import { supabase } from './supabaseClient'

const API_UNAUTHORIZED_EVENT = 'fb:api-unauthorized'

const isPrivateApiUrl = (value) => {
  const text = String(value || '')
  return text.startsWith('/api/') && !text.startsWith('/api/health') && !text.startsWith('/api/auth')
}

export async function getAccessToken() {
  return supabase ? (await supabase.auth.getSession()).data.session?.access_token || '' : ''
}

export async function authHeaders(existing = undefined) {
  const headers = new Headers(existing || {})
  const token = await getAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

export async function apiFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  const needsAuth = isPrivateApiUrl(url)
  const headers = needsAuth ? await authHeaders(init.headers || (typeof input !== 'string' ? input.headers : undefined)) : new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {})
  const response = await window.fetch(input, { ...init, headers })
  if (needsAuth && response.status === 401) {
    window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail: { url } }))
  }
  return response
}

export function installApiFetchInterceptor() {
  if (typeof window === 'undefined' || window.__fbApiFetchInstalled) return
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    const needsAuth = isPrivateApiUrl(url)
    const headers = needsAuth ? await authHeaders(init.headers || (typeof input !== 'string' ? input.headers : undefined)) : init.headers
    const response = await nativeFetch(input, needsAuth ? { ...init, headers } : init)
    if (needsAuth && response.status === 401) {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail: { url } }))
    }
    return response
  }
  window.__fbApiFetchInstalled = true
}

export async function openProtectedUrl(url) {
  if (!url) return
  if (!isPrivateApiUrl(url)) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const popup = window.open('', '_blank', 'noopener,noreferrer')
  try {
    const response = await apiFetch(url)
    if (!response.ok) throw new Error('Unauthorized')
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    if (popup) popup.location.href = objectUrl
    else window.open(objectUrl, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch {
    if (popup) popup.close()
  }
}

export { API_UNAUTHORIZED_EVENT }
