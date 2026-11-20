// JWT claims are used only to correlate requests with a browser login. The API
// remains responsible for validating tokens and authorizing every operation.
function tokenClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload))
  } catch { return {} }
}

export function sameLogin(left, right) {
  return Boolean(left && right && left.user?.id === right.user?.id && tokenClaims(left.access_token).session_id === tokenClaims(right.access_token).session_id)
}

export function matchesFailedSession(failure, session) {
  return Boolean(session && session.access_token === failure?.accessToken && sameLogin(failure.session, session))
}

export function createSessionAwareAuthFetch({ fetch, getStoredSession }) {
  const storedSession = () => { try { return getStoredSession() } catch { return null } }
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input.href)
    const refresh = url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token'
    const logout = url.pathname.endsWith('/auth/v1/logout')
    if (!refresh && !logout) return fetch(input, init)
    let usedToken = ''
    if (refresh) {
      try { usedToken = JSON.parse(init.body).refresh_token || '' } catch { /* Let the SDK handle malformed requests. */ }
    } else usedToken = new Headers(init.headers || input.headers).get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    const response = await fetch(input, init)
    if (refresh && response.ok) return response
    // Wait for the error body too: a different tab can finish signing in while
    // an old auth response is still arriving over the network.
    await response.clone().text()
    const current = storedSession()
    if (!usedToken || !current?.access_token || !current?.refresh_token || !(current.expires_at * 1000 > Date.now())) return response
    if (refresh && current.refresh_token !== usedToken) {
      // The SDK's successful-refresh commit guard preserves replaced storage,
      // but its rejected-refresh path removes it unconditionally. Hand back the
      // already-established session so that guard discards the obsolete result.
      // This creates no login and does not bypass the API's token validation.
      return new Response(JSON.stringify({ ...current, expires_in: Math.max(0, Math.floor(current.expires_at - Date.now() / 1000)) }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
    if (logout && current.access_token !== usedToken) {
      // The server has signed out only the token sent with this local logout.
      // Keep the SDK from deleting a newer login when that response returns.
      return new Response(JSON.stringify({ code: 'session_changed', msg: 'A newer login replaced this session.' }), { status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
    return response
  }
}

export function createAuthRecovery({ getSession, refreshSession, fetch, onFailure }) {
  let refreshOperation
  let lastFailedToken = ''

  const readSession = async () => {
    try { return await getSession() } catch { return null }
  }
  const reportFailure = async (session, accessToken) => {
    const current = await readSession()
    if (!accessToken || (current && (!sameLogin(session, current) || current.access_token !== accessToken))) return
    if (lastFailedToken === accessToken) return
    lastFailedToken = accessToken
    onFailure({ accessToken, session: session ? { access_token: session.access_token, user: { id: session.user?.id } } : null })
  }

  return async (input, init = {}) => {
    const session = await readSession()
    const request = new Request(input, init)
    if (!request.headers.has('Authorization') && session?.access_token) request.headers.set('Authorization', `Bearer ${session.access_token}`)
    const accessToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    const requestSession = session && { access_token: accessToken, user: { id: tokenClaims(accessToken).sub || session.user?.id } }
    let response = await fetch(request.clone())
    if (response.status !== 401 || request.signal.aborted) return response

    let current = await readSession()
    let refreshed = false
    // Do not replay a write from an older login as another user/session.
    if (!sameLogin(requestSession, current)) {
      if (!current) await reportFailure(requestSession, accessToken)
      return response
    }
    if (current.access_token === accessToken) {
      if (refreshOperation?.token !== accessToken) {
        refreshOperation = {
          token: accessToken,
          promise: Promise.resolve().then(() => refreshSession(current)).catch(error => ({ error }))
        }
      }
      const result = await refreshOperation.promise
      refreshed = Boolean(!result?.error && result?.data?.session?.access_token)
      current = await readSession()
    }
    if (request.signal.aborted) return response
    if (!sameLogin(requestSession, current) || !current?.access_token || (current.access_token === accessToken && !refreshed)) {
      if (!current || sameLogin(requestSession, current)) await reportFailure(requestSession, accessToken)
      return response
    }

    const retry = request.clone()
    // Replace any caller-provided header, including one attached before refresh.
    retry.headers.set('Authorization', `Bearer ${current.access_token}`)
    response = await fetch(retry)
    if (response.status === 401 && !request.signal.aborted) await reportFailure(current, current.access_token)
    return response
  }
}

export function createSessionFailureHandler({ getSession, getObservedSession, signOut, onFailure }) {
  const pending = new Map()
  return failure => {
    if (!failure?.accessToken) return Promise.resolve(false)
    if (pending.has(failure.accessToken)) return pending.get(failure.accessToken)
    const operation = (async () => {
      const current = await getSession()
      const observed = getObservedSession()
      if ((current && !matchesFailedSession(failure, current)) || (observed && !matchesFailedSession(failure, observed))) return false
      if (current) await signOut({ scope: 'local' })
      const after = await getSession()
      const observedAfter = getObservedSession()
      if ((after && !matchesFailedSession(failure, after)) || (observedAfter && !matchesFailedSession(failure, observedAfter))) return false
      onFailure()
      return true
    })().finally(() => pending.delete(failure.accessToken))
    pending.set(failure.accessToken, operation)
    return operation
  }
}
