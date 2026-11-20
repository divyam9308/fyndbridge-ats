# API session recovery

Protected same-origin API calls use one recovery path, shared by `apiFetch` and
the global fetch interceptor. Public APIs, health endpoints and external URLs
never receive an automatically attached Supabase token.

Each request retains the token and login identity it started with. After a 401,
the client reads the current session. A newer token for the same login is retried
once directly; otherwise concurrent requests share one refresh operation. The
retry replaces Authorization and replays a cloned request, preserving its method,
headers and body. A request from a previous login is never replayed as a new user
or a new login session. Aborted requests do not trigger logout.

Recovery emits at most one failure event per failed token, and only while that
token still belongs to the current login. AuthContext checks both the SDK session
and its observed session before acting, signs out with `scope: 'local'`, and checks
again before clearing state or navigating. A delayed failure cannot clear a newer
token/login. Auth callbacks defer API work outside the SDK event notification to
avoid a refresh waiting on its own TOKEN_REFRESHED callback.

The Supabase client's auth transport also guards responses that arrive after a
new login completed. An obsolete refresh rejection uses the already-established
stored session so the SDK's refresh commit guard discards the old result instead
of removing newer storage. An obsolete local-logout response is returned to the
SDK as a session-changed conflict, preventing its cleanup from erasing the newer
login. Current-session errors pass through normally; API authorization still
validates the supplied token on the server.

`server/src/services/authRecovery.test.js` exercises concurrent requests, changed
tokens, explicit stale headers, POST replay, failed refresh, newer-login races,
single retry and aborts. `server/browser-tests/auth-recovery.spec.cjs` verifies
the real API wrapper, AuthContext and Supabase client using synthetic tokens and
local intercepted auth endpoints; no production sessions are modified.
