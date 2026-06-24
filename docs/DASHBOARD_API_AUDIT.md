# Dashboard API audit

Measurement basis: static execution-path inspection plus the opt-in `VITE_DEBUG_PERF=true` request tracer. No authenticated browser session is available in this workspace, so production counts below exclude React Strict Mode's development-only mount/replay. Verify them with the tracer after deployment.

| Endpoint | Calls on first page load | Calls after 1 minute idle | Calls after opening a dashboard modal | Calls after closing a dashboard modal | Calls after changing filters | Necessary? | Merge/cache/reuse |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `GET /api/dashboard?consultant=&period=` | 1 | 0 | 0 | 0 | 1 | Yes; provides all dashboard cards/charts. | Already merged: one response supplies all dashboard data. Existing state is reused by modals. Do not cache without a freshness requirement; focus intentionally refreshes it. |
| `GET /api/notifications` | 1 | 0 | 0 | 0 | 0 | Yes; Topbar bell mounts with the authenticated shell. | Cannot merge with dashboard without coupling global shell state. Realtime handles changes; no polling occurs. |
| `GET /api/user-profiles` | 0-1 | 0 | 0 | 0 | 0 | Needed only when the auth profile is absent; presence needs the name. | Reuses `AuthContext.profile` when available. Concurrent calls are now in-flight deduplicated. |
| `GET /api/admin/me` | 1 | 0 | 0 | 0 | 0 | Needed by online presence to label the current user role. | Do not cache or merge role access; changes must be reflected promptly. |

The online-users presence websocket is not an HTTP API call. It opens once while the tab is active and closes on blur, hidden, pagehide, or unmount.

## Findings

- Dashboard modal open/close only changes local React state; no endpoint is called.
- Filter changes alter the dashboard query key, so one replacement request is required.
- The dashboard route previously made eight Supabase reads per request. It now makes five: profiles, clients, candidates, candidate associations, and jobs. Recent activity reuses the already-loaded datasets.
- There is no dashboard polling interval. After one minute idle, no HTTP request occurs unless the page regains focus; focus intentionally triggers one dashboard refresh.
- React Strict Mode can issue an aborted development-only request during effect replay. It is not a production duplicate. `VITE_DEBUG_PERF=true` exposes it by duration and timestamp without logging records or credentials.

## Applied fixes

- Shared concurrent `/api/user-profiles` loads in `AuthContext` now reuse one promise.
- No dashboard caching or endpoint merging was added because the current request count does not demonstrate a production duplicate and dashboard freshness has no documented TTL.
