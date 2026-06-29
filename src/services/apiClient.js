import { supabase } from './supabaseClient'

const API_UNAUTHORIZED_EVENT = 'fb:api-unauthorized'
const documentOpenLocks = new Map()
const debugCallCounts = {}
const DOCUMENT_OPEN_TYPES = {
  cv: { bucket: 'resumes', endpoint: '/api/resumes/open' },
  resume: { bucket: 'resumes', endpoint: '/api/resumes/open' },
  contract: { bucket: 'contract-pdfs', endpoint: '/api/documents/open/contract' },
  jd: { bucket: 'jds', endpoint: '/api/documents/open/jd' },
  invoice: { bucket: 'invoice', endpoint: '/api/documents/open/invoice' }
}

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
  const headers = needsAuth
    ? await authHeaders(init.headers || (typeof input !== 'string' ? input.headers : undefined))
    : new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {})

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
    const trace = import.meta.env.VITE_DEBUG_PERF === 'true'
    const startedAt = trace ? performance.now() : 0
    const headers = needsAuth
      ? await authHeaders(init.headers || (typeof input !== 'string' ? input.headers : undefined))
      : init.headers

    let response
    try {
      response = await nativeFetch(input, needsAuth ? { ...init, headers } : init)
    } finally {
      if (trace || import.meta.env.DEV) {
        const parsedUrl = new URL(url || window.location.href, window.location.origin)
        const path = parsedUrl.pathname
        if (import.meta.env.DEV) {
          const key = debugApiKey(path, parsedUrl.searchParams)
          if (key) {
            debugCallCounts[key] = (debugCallCounts[key] || 0) + 1
            console.debug('[Supabase Debug] Call counts:', { ...debugCallCounts })
          }
        }
        if (trace) {
        console.debug('[perf]', { request: path, method: init.method || 'GET', timestamp: new Date().toISOString(), durationMs: Number((performance.now() - startedAt).toFixed(1)) })
        }
      }
    }

    if (needsAuth && response.status === 401) {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail: { url } }))
    }

    return response
  }

  window.__fbApiFetchInstalled = true
}

function debugApiKey(path, params) {
  if (path.includes('/column-permissions')) return 'column_permissions'
  if (path.includes('/performance')) return 'performance'
  if (path.includes('/user-profiles')) return 'user_profiles'
  if (path.includes('/admin/me')) return 'admin_users'
  if (path.includes('/notifications')) return 'notifications'
  if (path.includes('/candidates')) return 'candidates'
  if (path.includes('/clients')) return params?.has('client_follow_ups') ? 'client_follow_ups' : 'clients'
  if (path.includes('/jobs')) return 'jobs'
  if (path.includes('/auth/v1/user')) return 'auth/v1/user'
  return ''
}

export function normalizeExternalUrl(url) {
  const text = String(url || '').trim()
  if (!text || text === '-') return ''

  const value = /^https?:\/\//i.test(text) ? text : `https://${text}`

  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')
      ? parsed.href
      : ''
  } catch {
    return ''
  }
}

function openUrlInNewTab(url) {
  const text = String(url || '').trim()
  const isBlobUrl = text.startsWith('blob:')
  const normalized = isBlobUrl ? text : normalizeExternalUrl(text)

  if (!normalized) return false

  if (import.meta.env.DEV) console.debug('[document open] window.open', { ok: true })

  const opened = window.open(normalized, '_blank')

  if (opened) opened.opener = null
  return Boolean(opened)
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

export function isValidStoragePath(path) {
  const text = String(path ?? '').trim()
  return Boolean(text && text !== '-' && !text.startsWith('/tmp/'))
}

export function documentOpenUrl(type, path) {
  const config = DOCUMENT_OPEN_TYPES[type]
  if (!config || !isValidStoragePath(path)) return ''
  const params = new URLSearchParams({ path: String(path).trim() })
  return `${config.endpoint}?${params.toString()}`
}

export function openExternalUrl(url) {
  const normalized = normalizeExternalUrl(url)
  if (!normalized) return false
  return openUrlInNewTab(normalized)
}

function acquireDocumentLock(url) {
  const key = String(url || '').trim()
  if (!key) return false

  const now = Date.now()
  const expiresAt = documentOpenLocks.get(key) || 0

  if (expiresAt > now) return false

  documentOpenLocks.set(key, now + 1500)

  window.setTimeout(() => {
    if ((documentOpenLocks.get(key) || 0) <= Date.now()) {
      documentOpenLocks.delete(key)
    }
  }, 1600)

  return true
}

export async function openProtectedUrl(url, options = {}) {
  const rawUrl = String(url || '').trim()
  if (!rawUrl) return false

  if (!acquireDocumentLock(rawUrl)) return false

  const notFoundMessage = options.notFoundMessage || 'Document file not found. Please re-upload the CV.'

  if (!isPrivateApiUrl(rawUrl)) {
    const opened = openExternalUrl(rawUrl)
    if (!opened) showDocumentToast('Please allow pop-ups to open the document.')
    return opened
  }

  try {
    if (import.meta.env.DEV) console.debug('[document open] request', { url: rawUrl })

    const response = await apiFetch(rawUrl)
    const contentType = response.headers.get('content-type') || ''

    if (!response.ok) {
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {}

      throw new Error(payload.error || notFoundMessage)
    }

    const payload = await response.json().catch(() => ({}))

    if (import.meta.env.DEV) console.debug('[document open] signed URL result', {
      ok: Boolean(payload.url),
      path: payload.path || '',
    })

    const signedUrl = normalizeExternalUrl(payload.url)

    if (!signedUrl) {
      throw new Error(payload.error || notFoundMessage)
    }

    const opened = openUrlInNewTab(signedUrl)

    if (!opened) {
      showDocumentToast('Please allow pop-ups to open the document.')
      return false
    }

    return true
  } catch (err) {
    showDocumentToast(err.message || notFoundMessage)
    return false
  }
}

export async function openProtectedDocumentPath(type, path, options = {}) {
  const config = DOCUMENT_OPEN_TYPES[type]
  if (!config || !isValidStoragePath(path)) {
    showDocumentToast(options.missingMessage || 'Document is missing or needs to be reuploaded')
    return false
  }
  if (import.meta.env.DEV) console.debug('[storage] generating signed URL only after click', { bucket: config.bucket, path })
  return openProtectedUrl(documentOpenUrl(type, path), options)
}

export { API_UNAUTHORIZED_EVENT }
