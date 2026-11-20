const test = require('node:test')
const assert = require('node:assert/strict')
let createAuthRecovery, createSessionFailureHandler, createSessionAwareAuthFetch
test.before(async () => ({ createAuthRecovery, createSessionFailureHandler, createSessionAwareAuthFetch } = await import('../../../src/services/authRecovery.js')))
const session = (token, login = 'login-1', user = 'user-1') => ({ access_token: `header.${Buffer.from(JSON.stringify({ session_id: login, sub: user, token })).toString('base64url')}.signature`, refresh_token: `refresh-${token}`, user: { id: user } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const unauthorized = () => new Response('{}', { status: 401 })

test('401 refreshes once and replaces an explicit old Authorization header while preserving the POST body', async () => {
  const original = session('old'), renewed = session('new')
  let current = original, refreshes = 0
  const sent = [], failures = []
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { refreshes++; current = renewed; return { data: { session: renewed } } },
    fetch: async input => { sent.push({ token: input.headers.get('Authorization'), body: await input.text(), method: input.method, custom: input.headers.get('X-Example') }); return sent.length === 1 ? unauthorized() : new Response('{}') }, onFailure: failure => failures.push(failure) })
  assert.equal((await request('https://app.test/api/example', { method: 'POST', headers: { Authorization: `Bearer ${original.access_token}`, 'X-Example': 'kept' }, body: 'draft data' })).status, 200)
  assert.equal(refreshes, 1)
  assert.deepEqual(sent, [original, renewed].map(item => ({ token: `Bearer ${item.access_token}`, body: 'draft data', method: 'POST', custom: 'kept' })))
  assert.deepEqual(failures, [])
})

test('a 401 from an in-flight old token retries with an already renewed token without refreshing again', async () => {
  const original = session('old'), renewed = session('new')
  let current = original, refreshes = 0, calls = 0
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { refreshes++ }, fetch: async input => {
    if (++calls === 1) { current = renewed; return unauthorized() }
    assert.equal(input.headers.get('Authorization'), `Bearer ${renewed.access_token}`)
    return new Response('{}')
  }, onFailure: () => assert.fail('must not log out') })
  assert.equal((await request('https://app.test/api/example')).status, 200)
  assert.equal(refreshes, 0)
  assert.equal(calls, 2)
})

test('simultaneous 401s share one refresh and each request retries only once', async () => {
  const original = session('old'), renewed = session('new'), release = deferred(), entered = deferred()
  let current = original, refreshes = 0, calls = 0
  const failures = []
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { refreshes++; entered.resolve(); await release.promise; current = renewed; return { data: { session: renewed } } },
    fetch: async input => { calls++; return input.headers.get('Authorization') === `Bearer ${original.access_token}` ? unauthorized() : new Response('{}') }, onFailure: failure => failures.push(failure) })
  const requests = Array.from({ length: 12 }, () => request('https://app.test/api/example'))
  await entered.promise; release.resolve()
  assert.ok((await Promise.all(requests)).every(response => response.status === 200))
  assert.equal(refreshes, 1); assert.equal(calls, 24); assert.deepEqual(failures, [])
})

test('a rejected refresh emits one failure for simultaneous requests and uses current-session sign-out only', async () => {
  let current = session('old'), refreshes = 0, logouts = 0, redirects = 0
  const scopes = [], failures = [], observed = current
  const failSession = createSessionFailureHandler({ getSession: async () => current, getObservedSession: () => observed,
    signOut: async options => { logouts++; scopes.push(options); current = null }, onFailure: () => { redirects++ } })
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { refreshes++; return { error: { code: 'refresh_token_not_found', status: 400 } } }, fetch: async () => unauthorized(),
    onFailure: failure => failures.push(failSession(failure)) })
  await Promise.all(Array.from({ length: 8 }, () => request('https://app.test/api/example')))
  await Promise.all(failures)
  assert.equal(refreshes, 1); assert.equal(logouts, 1); assert.equal(redirects, 1)
  assert.deepEqual(scopes, [{ scope: 'local' }])
})

test('a newer login during a failed refresh is preserved, including a new session for the same user', async () => {
  for (const user of ['user-1', 'user-2']) {
    const original = session('old'), newer = session('new-login', 'login-2', user), release = deferred(), entered = deferred()
    let current = original, calls = 0
    const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { entered.resolve(); await release.promise; return { error: { status: 400 } } },
      fetch: async () => { calls++; return unauthorized() }, onFailure: () => assert.fail('old request must not end the new login') })
    const response = request('https://app.test/api/example', { method: 'PATCH', body: 'old write' })
    await entered.promise; current = newer; release.resolve()
    assert.equal((await response).status, 401)
    assert.equal(calls, 1); assert.equal(current, newer)
  }
})

test('a delayed failure event cannot sign out a newer token or a newer login', async () => {
  const original = session('old')
  for (const newer of [session('renewed'), session('new-login', 'login-2')]) {
    const handler = createSessionFailureHandler({ getSession: async () => newer, getObservedSession: () => newer,
      signOut: async () => assert.fail('must not sign out newer session'), onFailure: () => assert.fail('must not redirect newer login') })
    assert.equal(await handler({ accessToken: original.access_token, session: original }), false)
  }
})

test('a second 401 ends recovery after one retry and reports only the still-current token', async () => {
  const original = session('old'), renewed = session('new')
  let current = original, calls = 0
  const failures = []
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { current = renewed; return { data: { session: renewed } } }, fetch: async () => { calls++; return unauthorized() }, onFailure: failure => failures.push(failure) })
  assert.equal((await request('https://app.test/api/example')).status, 401)
  assert.equal(calls, 2); assert.equal(failures.length, 1); assert.equal(failures[0].accessToken, renewed.access_token)
})

test('an aborted request does not retry or log out after its shared refresh finishes', async () => {
  let current = session('old')
  const release = deferred(), entered = deferred(), controller = new AbortController()
  let calls = 0
  const request = createAuthRecovery({ getSession: async () => current, refreshSession: async () => { entered.resolve(); await release.promise; current = session('new') },
    fetch: async () => { calls++; return unauthorized() }, onFailure: () => assert.fail('aborted request must not log out') })
  const response = request('https://app.test/api/example', { signal: controller.signal })
  await entered.promise; controller.abort(); release.resolve(); await response
  assert.equal(calls, 1)
})

test('SDK transport leaves current-session refresh errors and ordinary API responses unchanged', async () => {
  const current = { ...session('old'), expires_at: Date.now() / 1000 + 3600 }, error = unauthorized()
  const transport = createSessionAwareAuthFetch({ getStoredSession: () => current, fetch: async () => error })
  assert.equal(await transport('https://auth.test/auth/v1/token?grant_type=refresh_token', { body: JSON.stringify({ refresh_token: current.refresh_token }) }), error)
  const ordinary = createSessionAwareAuthFetch({ getStoredSession: () => assert.fail('ordinary API requests must not inspect auth storage'), fetch: async () => error })
  assert.equal(await ordinary('https://auth.test/rest/v1/records'), error)
})

test('SDK transport preserves an established newer session after rejection of an old refresh token', async () => {
  const original = session('old'), newer = { ...session('new', 'login-2'), expires_at: Date.now() / 1000 + 3600 }
  const transport = createSessionAwareAuthFetch({ getStoredSession: () => newer, fetch: async () => new Response('{}', { status: 400 }) })
  const response = await transport('https://auth.test/auth/v1/token?grant_type=refresh_token', { body: JSON.stringify({ refresh_token: original.refresh_token }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).access_token, newer.access_token)
})

test('SDK transport prevents an old local logout response from deleting a newer login', async () => {
  const original = session('old'), newer = { ...session('new', 'login-2'), expires_at: Date.now() / 1000 + 3600 }
  const transport = createSessionAwareAuthFetch({ getStoredSession: () => newer, fetch: async () => new Response('{}') })
  const response = await transport('https://auth.test/auth/v1/logout?scope=local', { headers: { Authorization: `Bearer ${original.access_token}` } })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'session_changed')
})

test('an explicit header from a previous login is never replayed as the current user', async () => {
  const original = session('old'), newer = session('new', 'login-2', 'user-2')
  let calls = 0
  const request = createAuthRecovery({ getSession: async () => newer,
    refreshSession: async () => assert.fail('must not refresh a different login'),
    fetch: async () => { calls++; return unauthorized() }, onFailure: () => assert.fail('must preserve the current login') })
  assert.equal((await request('https://app.test/api/example', { method: 'PATCH', headers: { Authorization: `Bearer ${original.access_token}` }, body: 'old draft' })).status, 401)
  assert.equal(calls, 1)
})
