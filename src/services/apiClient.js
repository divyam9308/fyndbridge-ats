import { supabase } from './supabaseClient'

const API_UNAUTHORIZED_EVENT = 'fb:api-unauthorized'
const documentOpenLocks = new Map()

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
  if (!String(url || '').startsWith('blob:') && !normalizeExternalUrl(url)) return false
  console.log('[document open] window.open', { url })
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

function showDocumentToast(message) {
  const existing = document.querySelector('[data-document-open-toast="true"]')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.className = 'notice-toast is-visible'
  toast.dataset.documentOpenToast = 'true'
  const text = document.createElement('span')
  text.textContent = message
  toast.appendChild(text)
  document.body.appendChild(toast)
  window.setTimeout(() => toast.remove(), 5000)
}

export function openExternalUrl(url) {
  const normalized = normalizeExternalUrl(url)
  if (!normalized) return false
  return openUrlInNewTab(normalized)
}

function acquireDocumentLock(url) {
  const key = String(url || '').trim()
  const now = Date.now()
  const expiresAt = documentOpenLocks.get(key) || 0
  if (expiresAt > now) return false
  documentOpenLocks.set(key, now + 1000)
  return true
}

export async function openProtectedUrl(url, options = {}) {
  if (!url) return false
  if (!acquireDocumentLock(url)) return false
  const notFoundMessage = options.notFoundMessage || 'Document file not found. Please re-upload the CV.'
  if (!isPrivateApiUrl(url)) {
    return openExternalUrl(url)
  }
  try {
    console.log('[document open] request', { url })
    const response = await apiFetch(url)
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok) {
      const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {}
      throw new Error(payload.error || notFoundMessage)
    }
    const payload = await response.json().catch(() => ({}))
    console.log('[document open] signed URL result', { ok: Boolean(payload.url), path: payload.path || '' })
    if (!normalizeExternalUrl(payload.url)) throw new Error(payload.error || notFoundMessage)
    openUrlInNewTab(payload.url)
    return true
  } catch (err) {
    showDocumentToast(err.message || notFoundMessage)
    return false
  }
}

export { API_UNAUTHORIZED_EVENT }
