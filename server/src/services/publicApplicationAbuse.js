const crypto = require('crypto')

const memoryCounters = new Map()

const DEFAULTS = Object.freeze({
  minCompletionMs: 3000,
  formTokenMaxAgeMs: 2 * 60 * 60 * 1000,
  parseLimit: 10,
  parseWindowSeconds: 15 * 60,
  submitLimit: 5,
  submitWindowSeconds: 60 * 60
})

function clean(value) {
  return String(value || '').trim()
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function unsafeDevelopmentEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.PUBLIC_APPLICATION_ALLOW_UNSAFE_DEV === 'true'
}

function serviceUnavailable(message = 'Applications are temporarily unavailable. Please try again later.') {
  return Object.assign(new Error(message), { statusCode: 503, publicSafe: true })
}

function requestIp(req) {
  const forwarded = clean(req.get?.('x-forwarded-for')).split(',')[0].trim()
  return forwarded || clean(req.get?.('cf-connecting-ip')) || clean(req.get?.('x-real-ip')) || clean(req.ip) || 'unknown'
}

function rateLimitConfig(scope) {
  if (scope === 'parse') {
    return {
      limit: positiveInteger(process.env.PUBLIC_APPLICATION_PARSE_RATE_LIMIT, DEFAULTS.parseLimit),
      windowSeconds: positiveInteger(process.env.PUBLIC_APPLICATION_PARSE_RATE_WINDOW_SECONDS, DEFAULTS.parseWindowSeconds)
    }
  }
  return {
    limit: positiveInteger(process.env.PUBLIC_APPLICATION_SUBMIT_RATE_LIMIT, DEFAULTS.submitLimit),
    windowSeconds: positiveInteger(process.env.PUBLIC_APPLICATION_SUBMIT_RATE_WINDOW_SECONDS, DEFAULTS.submitWindowSeconds)
  }
}

function rateKey(req, scope) {
  const salt = clean(process.env.PUBLIC_APPLICATION_RATE_LIMIT_SALT)
  if (!salt) {
    if (!unsafeDevelopmentEnabled()) throw serviceUnavailable()
    return crypto.createHash('sha256').update(`unsafe-dev:${scope}:${requestIp(req)}`).digest('hex')
  }
  return crypto.createHmac('sha256', salt).update(`${scope}:${requestIp(req)}`).digest('hex')
}

function consumeMemoryLimit(key, scope, config, now = Date.now()) {
  const composite = `${scope}:${key}`
  const previous = memoryCounters.get(composite)
  const windowMs = config.windowSeconds * 1000
  const counter = !previous || previous.startedAt + windowMs <= now
    ? { startedAt: now, count: 1 }
    : { ...previous, count: previous.count + 1 }
  memoryCounters.set(composite, counter)
  const retryAfterSeconds = counter.count <= config.limit
    ? 0
    : Math.max(1, Math.ceil((counter.startedAt + windowMs - now) / 1000))
  return { isAllowed: counter.count <= config.limit, retryAfterSeconds }
}

async function consumeRateLimit(req, scope, dependencies = {}) {
  const key = rateKey(req, scope)
  const config = rateLimitConfig(scope)
  const supabase = dependencies.supabase || require('./supabaseAdmin')
  const { data, error } = await supabase.rpc('consume_public_application_rate_limit', {
    p_rate_key: key,
    p_scope: scope,
    p_window_seconds: config.windowSeconds,
    p_request_limit: config.limit
  })
  if (error || !Array.isArray(data) || !data[0]) {
    if (unsafeDevelopmentEnabled()) return consumeMemoryLimit(key, scope, config)
    throw serviceUnavailable()
  }
  return {
    isAllowed: Boolean(data[0].is_allowed),
    retryAfterSeconds: Number(data[0].retry_after_seconds) || 0
  }
}

function requirePublicRateLimit(scope, dependencies = {}) {
  return async function publicRateLimitMiddleware(req, res, next) {
    try {
      const result = await consumeRateLimit(req, scope, dependencies)
      if (!result.isAllowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds || 1))
        return res.status(429).json({ error: 'Too many requests. Please try again later.' })
      }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}

function formTokenSecret() {
  const secret = clean(process.env.PUBLIC_APPLICATION_FORM_TOKEN_SECRET)
  if (!secret && !unsafeDevelopmentEnabled()) throw serviceUnavailable()
  return secret
}

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function issueFormToken(req, now = Date.now()) {
  const startedAt = new Date(now).toISOString()
  const secret = formTokenSecret()
  if (!secret) return { formToken: 'unsafe-development', formStartedAt: startedAt }
  const payload = encode(JSON.stringify({ iat: now, ip: rateKey(req, 'form') }))
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return { formToken: `${payload}.${signature}`, formStartedAt: startedAt }
}

function safeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function verifyCompletionTime(req, body, now = Date.now()) {
  const minMs = positiveInteger(process.env.PUBLIC_APPLICATION_MIN_COMPLETION_MS, DEFAULTS.minCompletionMs)
  const maxAgeMs = positiveInteger(process.env.PUBLIC_APPLICATION_FORM_TOKEN_MAX_AGE_MS, DEFAULTS.formTokenMaxAgeMs)
  const token = clean(body.form_token)
  const secret = formTokenSecret()
  let startedAt = Number.NaN

  if (secret) {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra) throw Object.assign(new Error('Please reopen the application form and try again.'), { statusCode: 400, publicSafe: true })
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
    if (!safeEqual(signature, expected)) throw Object.assign(new Error('Please reopen the application form and try again.'), { statusCode: 400, publicSafe: true })
    let parsed
    try { parsed = JSON.parse(decode(payload)) } catch { parsed = null }
    if (!parsed || parsed.ip !== rateKey(req, 'form')) throw Object.assign(new Error('Please reopen the application form and try again.'), { statusCode: 400, publicSafe: true })
    startedAt = Number(parsed.iat)
  } else {
    startedAt = Date.parse(clean(body.form_started_at))
  }

  const elapsed = now - startedAt
  if (!Number.isFinite(startedAt) || elapsed < minMs || elapsed > maxAgeMs) {
    throw Object.assign(new Error('Please reopen the application form and try again.'), { statusCode: 400, publicSafe: true })
  }
}

async function verifyTurnstile(req, token, dependencies = {}) {
  const secret = clean(process.env.TURNSTILE_SECRET_KEY)
  if (!secret) {
    if (unsafeDevelopmentEnabled()) return
    throw serviceUnavailable()
  }
  if (!clean(token)) throw Object.assign(new Error('Please complete the security check.'), { statusCode: 400, publicSafe: true })
  const form = new URLSearchParams({ secret, response: clean(token), remoteip: requestIp(req) })
  const fetchImpl = dependencies.fetchImpl || global.fetch
  if (typeof fetchImpl !== 'function') throw serviceUnavailable()
  let response
  try {
    response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
  } catch {
    throw serviceUnavailable()
  }
  if (!response.ok) throw serviceUnavailable()
  const result = await response.json()
  if (!result?.success) throw Object.assign(new Error('Security check failed. Please try again.'), { statusCode: 400, publicSafe: true })
}

async function validateSubmissionAbuse(req, dependencies = {}) {
  if (clean(req.body.website)) return { bot: true }
  verifyCompletionTime(req, req.body)
  await verifyTurnstile(req, req.body.captcha_token, dependencies)
  return { bot: false }
}

function resetMemoryCounters() {
  memoryCounters.clear()
}

module.exports = {
  DEFAULTS,
  requestIp,
  rateLimitConfig,
  rateKey,
  consumeMemoryLimit,
  consumeRateLimit,
  requirePublicRateLimit,
  issueFormToken,
  verifyCompletionTime,
  verifyTurnstile,
  validateSubmissionAbuse,
  unsafeDevelopmentEnabled,
  resetMemoryCounters
}
