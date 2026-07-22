const test = require('node:test')
const assert = require('node:assert/strict')

const {
  requestIp,
  rateKey,
  consumeRateLimit,
  issueFormToken,
  verifyCompletionTime,
  verifyTurnstile,
  validateSubmissionAbuse,
  resetMemoryCounters
} = require('./publicApplicationAbuse')

const ENV_KEYS = [
  'NODE_ENV',
  'PUBLIC_APPLICATION_ALLOW_UNSAFE_DEV',
  'PUBLIC_APPLICATION_RATE_LIMIT_SALT',
  'PUBLIC_APPLICATION_PARSE_RATE_LIMIT',
  'PUBLIC_APPLICATION_PARSE_RATE_WINDOW_SECONDS',
  'PUBLIC_APPLICATION_FORM_TOKEN_SECRET',
  'PUBLIC_APPLICATION_MIN_COMPLETION_MS',
  'PUBLIC_APPLICATION_FORM_TOKEN_MAX_AGE_MS',
  'TURNSTILE_SECRET_KEY'
]

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, values)
  resetMemoryCounters()
  try {
    return await run()
  } finally {
    resetMemoryCounters()
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

function request(ip = '203.0.113.8', headers = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    ip,
    body: {},
    get(name) { return normalizedHeaders[String(name).toLowerCase()] || '' }
  }
}

test('request identity prefers the first forwarded IP and hashes it with a secret salt', async () => {
  await withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_APPLICATION_RATE_LIMIT_SALT: 'rate-limit-secret'
  }, async () => {
    const req = request('127.0.0.1', { 'x-forwarded-for': '198.51.100.4, 10.0.0.2' })
    assert.equal(requestIp(req), '198.51.100.4')
    assert.match(rateKey(req, 'parse'), /^[0-9a-f]{64}$/)
    assert.notEqual(rateKey(req, 'parse'), rateKey(req, 'submit'))
    assert.doesNotMatch(rateKey(req, 'parse'), /198\.51\.100\.4/)
  })
})

test('signed form token enforces minimum time, maximum age, signature, and requesting IP', async () => {
  await withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_APPLICATION_RATE_LIMIT_SALT: 'rate-limit-secret',
    PUBLIC_APPLICATION_FORM_TOKEN_SECRET: 'form-token-secret',
    PUBLIC_APPLICATION_MIN_COMPLETION_MS: '3000',
    PUBLIC_APPLICATION_FORM_TOKEN_MAX_AGE_MS: '7200000'
  }, async () => {
    const started = Date.parse('2026-07-22T06:30:00.000Z')
    const req = request('203.0.113.8')
    const issued = issueFormToken(req, started)

    assert.match(issued.formToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    assert.equal(issued.formStartedAt, '2026-07-22T06:30:00.000Z')
    assert.doesNotThrow(() => verifyCompletionTime(req, { form_token: issued.formToken }, started + 3000))
    assert.throws(() => verifyCompletionTime(req, { form_token: issued.formToken }, started + 2999), { statusCode: 400 })
    assert.throws(() => verifyCompletionTime(req, { form_token: issued.formToken }, started + 7200001), { statusCode: 400 })
    assert.throws(() => verifyCompletionTime(request('203.0.113.9'), { form_token: issued.formToken }, started + 3000), { statusCode: 400 })

    const [payload, signature] = issued.formToken.split('.')
    const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    assert.throws(() => verifyCompletionTime(req, { form_token: tampered }, started + 3000), { statusCode: 400 })
  })
})

test('Turnstile verification is dependency-injected, forwards the remote IP, and fails closed', async () => {
  await withEnvironment({
    NODE_ENV: 'production',
    TURNSTILE_SECRET_KEY: 'turnstile-secret'
  }, async () => {
    let call
    const fetchImpl = async (url, options) => {
      call = { url, options }
      return { ok: true, json: async () => ({ success: true }) }
    }
    await verifyTurnstile(request('203.0.113.8'), 'captcha-response', { fetchImpl })
    assert.equal(call.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    assert.equal(call.options.method, 'POST')
    const sent = new URLSearchParams(call.options.body)
    assert.equal(sent.get('secret'), 'turnstile-secret')
    assert.equal(sent.get('response'), 'captcha-response')
    assert.equal(sent.get('remoteip'), '203.0.113.8')

    await assert.rejects(
      verifyTurnstile(request(), 'captcha-response', { fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) }) }),
      { statusCode: 400 }
    )
    await assert.rejects(
      verifyTurnstile(request(), 'captcha-response', { fetchImpl: async () => { throw new Error('offline') } }),
      { statusCode: 503 }
    )
    await assert.rejects(verifyTurnstile(request(), '', { fetchImpl }), { statusCode: 400 })
  })
})

test('durable rate limiting fails closed in production and uses bounded memory only under explicit local bypass', async () => {
  const unavailableRpc = { rpc: async () => ({ data: null, error: new Error('database unavailable') }) }

  await withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_APPLICATION_RATE_LIMIT_SALT: 'rate-limit-secret'
  }, async () => {
    await assert.rejects(consumeRateLimit(request(), 'parse', { supabase: unavailableRpc }), { statusCode: 503 })
  })

  await withEnvironment({
    NODE_ENV: 'development',
    PUBLIC_APPLICATION_ALLOW_UNSAFE_DEV: 'true',
    PUBLIC_APPLICATION_RATE_LIMIT_SALT: 'rate-limit-secret',
    PUBLIC_APPLICATION_PARSE_RATE_LIMIT: '2',
    PUBLIC_APPLICATION_PARSE_RATE_WINDOW_SECONDS: '600'
  }, async () => {
    assert.deepEqual(await consumeRateLimit(request(), 'parse', { supabase: unavailableRpc }), { isAllowed: true, retryAfterSeconds: 0 })
    assert.deepEqual(await consumeRateLimit(request(), 'parse', { supabase: unavailableRpc }), { isAllowed: true, retryAfterSeconds: 0 })
    const blocked = await consumeRateLimit(request(), 'parse', { supabase: unavailableRpc })
    assert.equal(blocked.isAllowed, false)
    assert.ok(blocked.retryAfterSeconds > 0)
  })
})

test('missing production abuse configuration fails closed while honeypot submissions short-circuit safely', async () => {
  await withEnvironment({ NODE_ENV: 'production' }, async () => {
    assert.throws(() => rateKey(request(), 'parse'), { statusCode: 503 })
    assert.throws(() => issueFormToken(request()), { statusCode: 503 })
  })

  await withEnvironment({ NODE_ENV: 'production' }, async () => {
    const req = request()
    req.body = { website: 'bot-filled-value' }
    assert.deepEqual(await validateSubmissionAbuse(req, {
      fetchImpl: async () => assert.fail('honeypot must not call Turnstile')
    }), { bot: true })
  })
})
