const crypto = require('node:crypto')
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
function encryptionKey() {
  const hex = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || ''
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw Object.assign(new Error('Gmail encryption is not configured.'), { code: 'CONFIGURATION' })
  return Buffer.from(hex, 'hex')
}
function encrypt(value, owner) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(owner))
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.')
}
function decrypt(value, owner) {
  const [version, iv, tag, bytes] = String(value).split('.')
  if (version !== 'v1') throw new Error('Invalid encrypted credentials')
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  cipher.setAAD(Buffer.from(owner)); cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(bytes, 'base64url')), cipher.final()]).toString('utf8'))
}
function config() {
  const id = process.env.GOOGLE_GMAIL_CLIENT_ID, secret = process.env.GOOGLE_GMAIL_CLIENT_SECRET
  const redirect = process.env.GOOGLE_GMAIL_REDIRECT_URI
  if (!id || !secret || !redirect) throw Object.assign(new Error('Gmail OAuth is not configured.'), { code: 'CONFIGURATION' })
  const url = new URL(redirect)
  if (url.pathname !== '/api/crm/gmail/callback' || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid Gmail callback configuration')
  encryptionKey()
  return { id, secret, redirect, origin: url.origin, secure: url.protocol === 'https:' }
}
function googleError(status, code) {
  // Never retain provider response messages: they may contain personal data.
  const error = new Error('Gmail provider request failed')
  error.status = status; error.code = code || 'GMAIL_API_ERROR'
  return error
}
function createGoogle(fetcher = fetch, { deadline = () => Infinity } = {}) {
  async function request(url, options = {}) {
    let response
    try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline() - Date.now()))) }) }
    catch { throw googleError(503, 'GMAIL_NETWORK') }
    let result
    try { result = await response.json() } catch { throw googleError(503, 'GMAIL_NETWORK') }
    if (!response.ok) {
      const reasons = (result.error?.errors || []).map(item => item.reason)
      if (reasons.includes('dailyLimitExceeded')) throw googleError(429, 'GMAIL_DAILY_QUOTA')
      if (response.status === 429 || reasons.some(reason => ['rateLimitExceeded','userRateLimitExceeded'].includes(reason))) throw googleError(429, 'GMAIL_RATE_LIMIT')
      throw googleError(response.status, result.error === 'invalid_grant' ? 'GMAIL_REVOKED' : 'GMAIL_API_ERROR')
    }
    return result
  }
  async function token(values) {
    const c = config()
    return request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...values }) })
  }
  return {
    exchange: (code, verifier) => token({ code, code_verifier: verifier, redirect_uri: config().redirect, grant_type: 'authorization_code' }),
    refresh: refreshToken => token({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    api: (access, path, params = {}) => request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${access}` } }),
    async revoke(value) {
      try { await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: value }), signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline() - Date.now()))) }) } catch { /* Local deletion always wins over a remote failure. */ }
    }
  }
}
function authorizationUrl(state, email, verifier) {
  const c = config()
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent select_account', login_hint: email, state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', include_granted_scopes: 'false' })}`
}
module.exports = { SCOPE, hash, encrypt, decrypt, config, createGoogle, authorizationUrl }
