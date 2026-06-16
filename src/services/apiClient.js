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

export function normalizeExternalUrl(url) {
  const text = String(url || '').trim()
  if (!text || text === '-') return ''
  const value = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.') ? parsed.href : ''
  } catch {
    return ''
  }
}

function openUrlInNewTab(url) {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) return true
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

export function openExternalUrl(url) {
  const normalized = normalizeExternalUrl(url)
  if (!normalized) return false
  return openUrlInNewTab(normalized)
}

export async function openProtectedUrl(url) {
  if (!url) return false
  if (!isPrivateApiUrl(url)) {
    return openExternalUrl(url)
  }
  try {
    const response = await apiFetch(url)
    if (!response.ok) throw new Error('Unauthorized')
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => ({}))
      if (!payload.url) throw new Error('Document unavailable')
      openUrlInNewTab(payload.url)
      return true
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    openUrlInNewTab(objectUrl)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return true
  } catch {
    window.alert('Please allow pop-ups to open the document.')
    return false
  }
}

export { API_UNAUTHORIZED_EVENT }
