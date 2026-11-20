const { test, expect } = require('./fixtures.cjs')

test.afterEach(async ({ page, app }, info) => {
  if (info.status !== info.expectedStatus) console.log('auth diagnostic', { url: page.url(), errors: app.consoleErrors, state: await page.evaluate(() => ({ failures: window.__sessionFailures, events: window.__authEvents, sessionStored: Boolean(localStorage.getItem('sb-127-auth-token')) })) })
})

async function boot(page) {
  await page.addInitScript(() => {
    window.__sessionFailures = 0
    window.addEventListener('fb:api-unauthorized', () => { window.__sessionFailures++ })
  })
  await page.goto('/dashboard/applied-candidates')
  await expect(page.getByRole('heading', { name: 'Applied Candidates', exact: true }).first()).toBeVisible()
  return page.evaluate(async () => {
    const { supabase } = await import('/src/services/supabaseClient.js')
    window.__authEvents = []
    supabase.auth.onAuthStateChange((event, session) => { window.__authEvents.push({ event, hasSession: Boolean(session), email: session?.user?.email }) })
    supabase.auth.stopAutoRefresh()
    return (await supabase.auth.getSession()).data.session
  })
}

function renewedSession(original, newLogin = false) {
  const payload = JSON.parse(Buffer.from(original.access_token.split('.')[1], 'base64url'))
  const claims = { ...payload, exp: Math.floor(Date.now() / 1000) + 3600, renewal: 'browser-test', ...(newLogin ? { session_id: 'new-browser-login' } : {}) }
  return { ...original, access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c3ludGhldGlj`, refresh_token: 'synthetic-renewed-refresh', expires_in: 3600, expires_at: claims.exp }
}

test('expired API token refreshes and retries with a replaced header without logging out', async ({ page, app }) => {
  const original = await boot(page), renewed = renewedSession(original)
  let refreshes = 0, logouts = 0
  const sent = []
  await page.route('**/auth/v1/token**', async route => { refreshes++; await route.fulfill({ json: renewed }) })
  await page.route('**/auth/v1/logout**', async route => { logouts++; await route.fulfill({ json: {} }) })
  await page.route('**/api/auth-recovery-probe', async route => {
    const authorization = route.request().headers().authorization
    sent.push(authorization)
    await route.fulfill(authorization === `Bearer ${original.access_token}` ? { status: 401, json: { error: 'JWT expired' } } : { json: { ok: true } })
  })
  const result = await page.evaluate(async token => {
    const { apiFetch } = await import('/src/services/apiClient.js')
    const response = await apiFetch('/api/auth-recovery-probe', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: 'kept' }) })
    return { status: response.status, body: await response.json() }
  }, original.access_token)
  expect(result).toEqual({ status: 200, body: { ok: true } })
  expect(sent).toEqual([`Bearer ${original.access_token}`, `Bearer ${renewed.access_token}`])
  expect(refreshes).toBe(1); expect(logouts).toBe(0)
  expect(await page.evaluate(() => window.__sessionFailures)).toBe(0)
  await expect(page).toHaveURL(/\/dashboard\/applied-candidates$/)
  expect(app.consoleErrors).toEqual([])
})

test('simultaneous global fetch and apiFetch 401s share one SDK refresh without a logout storm', async ({ page, app }) => {
  const original = await boot(page), renewed = renewedSession(original)
  let refreshes = 0, logouts = 0
  const waiting = []
  await page.route('**/auth/v1/token**', async route => { refreshes++; await route.fulfill({ json: renewed }) })
  await page.route('**/auth/v1/logout**', async route => { logouts++; await route.fulfill({ json: {} }) })
  await page.route('**/api/auth-recovery-probe?*', async route => {
    if (route.request().headers().authorization === `Bearer ${original.access_token}`) {
      waiting.push(route)
      if (waiting.length === 8) await Promise.all(waiting.map(item => item.fulfill({ status: 401, json: { error: 'JWT expired' } })))
    } else await route.fulfill({ json: { ok: true } })
  })
  const statuses = await page.evaluate(async () => {
    const { apiFetch } = await import('/src/services/apiClient.js')
    return Promise.all(Array.from({ length: 8 }, async (_, index) => (await (index % 2 ? window.fetch : apiFetch)(`/api/auth-recovery-probe?request=${index}`)).status))
  })
  expect(statuses).toEqual(Array(8).fill(200))
  expect(refreshes).toBe(1); expect(logouts).toBe(0)
  expect(await page.evaluate(() => window.__sessionFailures)).toBe(0)
  await expect(page).toHaveURL(/\/dashboard\/applied-candidates$/)
  expect(app.consoleErrors).toEqual([])
})

test('a genuinely rejected refresh returns to login once and never requests global sign-out', async ({ page, app }) => {
  await boot(page)
  let refreshes = 0
  const logoutScopes = []
  await page.route('**/auth/v1/token**', async route => { refreshes++; await route.fulfill({ status: 400, json: { code: 'refresh_token_not_found', msg: 'Invalid refresh token' } }) })
  await page.route('**/auth/v1/logout**', async route => { logoutScopes.push(new URL(route.request().url()).searchParams.get('scope')); await route.fulfill({ json: {} }) })
  await page.route('**/api/auth-recovery-probe', route => route.fulfill({ status: 401, json: { error: 'JWT expired' } }))
  const status = await page.evaluate(async () => {
    const { apiFetch } = await import('/src/services/apiClient.js')
    return (await apiFetch('/api/auth-recovery-probe')).status
  })
  expect(status).toBe(401)
  await expect(page).toHaveURL(/\/login\?error=session$/)
  await expect(page.getByText('Your session has expired. Please sign in again.', { exact: true })).toBeVisible()
  expect(refreshes).toBe(1)
  expect(logoutScopes.every(scope => scope === 'local')).toBe(true)
  expect(await page.evaluate(() => window.__sessionFailures)).toBe(1)
  expect(app.consoleErrors).toEqual([])
})

test('a delayed failure from the old session cannot log out a newer login', async ({ page, app }) => {
  const original = await boot(page), newer = renewedSession(original, true)
  let logouts = 0
  await page.route('**/auth/v1/logout**', async route => { logouts++; await route.fulfill({ json: {} }) })
  await page.evaluate(async ({ previous, next }) => {
    const { supabase } = await import('/src/services/supabaseClient.js')
    const result = await supabase.auth.setSession(next)
    if (result.error) throw new Error(result.error.message)
    window.dispatchEvent(new CustomEvent('fb:api-unauthorized', { detail: { accessToken: previous.access_token, session: previous } }))
  }, { previous: original, next: newer })
  await expect(page.getByRole('heading', { name: 'Applied Candidates', exact: true }).first()).toBeVisible()
  expect(await page.evaluate(async () => (await (await import('/src/services/supabaseClient.js')).supabase.auth.getSession()).data.session?.access_token)).toBe(newer.access_token)
  expect(logouts).toBe(0)
  await expect(page).toHaveURL(/\/dashboard\/applied-candidates$/)
  expect(app.consoleErrors).toEqual([])
})

test('manual Sign out ends the current browser session without global sign-out', async ({ page, app }) => {
  await boot(page)
  const scopes = []
  await page.route('**/auth/v1/logout**', async route => {
    scopes.push(new URL(route.request().url()).searchParams.get('scope'))
    await route.fulfill({ json: {} })
  })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(scopes).toEqual(['local'])
  expect(app.consoleErrors).toEqual([])
})

test('a rejected in-flight refresh cannot erase a newer completed SDK login', async ({ page, app }) => {
  const original = await boot(page), newer = renewedSession(original, true)
  let release, started
  const rejected = new Promise(resolve => { release = resolve })
  const refreshing = new Promise(resolve => { started = resolve })
  await page.route('**/auth/v1/token**', async route => {
    started(); await rejected
    await route.fulfill({ status: 400, json: { code: 'refresh_token_not_found', msg: 'Invalid old refresh token' } })
  })
  await page.route('**/api/auth-recovery-probe', route => route.fulfill({ status: 401, json: { error: 'JWT expired' } }))
  await page.evaluate(async () => {
    const { apiFetch } = await import('/src/services/apiClient.js')
    window.__oldRequest = apiFetch('/api/auth-recovery-probe').then(response => response.status)
  })
  await refreshing
  await page.evaluate(async next => {
    const { supabase } = await import('/src/services/supabaseClient.js')
    const result = await supabase.auth.setSession(next)
    if (result.error) throw new Error(result.error.message)
  }, newer)
  release()
  expect(await page.evaluate(() => window.__oldRequest)).toBe(401)
  expect(await page.evaluate(async () => (await (await import('/src/services/supabaseClient.js')).supabase.auth.getSession()).data.session?.access_token)).toBe(newer.access_token)
  await expect(page).toHaveURL(/\/dashboard\/applied-candidates$/)
  expect(app.consoleErrors).toEqual([])
})

test('automatic local logout cannot erase a login completed while its response was pending', async ({ page, app }) => {
  const original = await boot(page), newer = renewedSession(original, true)
  let release, started
  const responseReady = new Promise(resolve => { release = resolve })
  const logoutStarted = new Promise(resolve => { started = resolve })
  const scopes = []
  await page.route('**/auth/v1/logout**', async route => {
    scopes.push(new URL(route.request().url()).searchParams.get('scope'))
    started(); await responseReady
    await route.fulfill({ json: {} })
  })
  await page.evaluate(async previous => {
    const { supabase } = await import('/src/services/supabaseClient.js')
    const signOut = supabase.auth.signOut.bind(supabase.auth)
    supabase.auth.signOut = async options => { try { return await signOut(options) } finally { window.__logoutSettled = true } }
    window.dispatchEvent(new CustomEvent('fb:api-unauthorized', { detail: { accessToken: previous.access_token, session: previous } }))
  }, original)
  await logoutStarted
  await page.evaluate(async next => {
    const { supabase } = await import('/src/services/supabaseClient.js')
    const result = await supabase.auth.setSession(next)
    if (result.error) throw new Error(result.error.message)
  }, newer)
  release()
  await expect.poll(() => page.evaluate(() => window.__logoutSettled)).toBe(true)
  expect(await page.evaluate(async () => (await (await import('/src/services/supabaseClient.js')).supabase.auth.getSession()).data.session?.access_token)).toBe(newer.access_token)
  expect(scopes).toEqual(['local'])
  await expect(page).toHaveURL(/\/dashboard\/applied-candidates$/)
  expect(app.consoleErrors).toEqual([])
})
