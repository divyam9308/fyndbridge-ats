# Presence API Technical Report

No application files were modified during the original investigation. This report is based only on the repository code that was inspected.

## 1. Executive summary

The presence system stores one database row per authenticated user and browser tab.

- /api/presence/heartbeat upserts the current tab's online or away status every 25 seconds.
- /api/presence fetches the complete fresh presence list every 5 seconds.
- Every successful heartbeat also causes another /api/presence fetch.
- Presence runs from AuthenticatedShell, so it runs across every authenticated ATS page, not only the dashboard.
- Users are treated as offline when their row is deleted or its last_seen_at becomes older than 75 seconds.
- Offline is not a stored database status.
- Stale rows are excluded from responses but never deleted by scheduled cleanup.
- No Supabase Realtime subscription exists for user_presence.
- The dashboard is the only frontend consumer that displays the returned list.
- The high Vercel request count is primarily caused by global 5-second polling, 25-second heartbeats, post-heartbeat list fetching, multiple tabs, route-change bursts, and focus/visibility events.

Steady foreground traffic per authenticated browser tab is approximately:

- 144 heartbeat POSTs/hour.
- 864 presence-list GETs/hour.
- 1,008 total presence HTTP requests/hour, excluding mount events and /offline.

Confirmed flow:

    Authenticated ATS shell mounts
    → tab-specific presence ID is created
    → heartbeat POST upserts user_presence
    → frontend requests the complete presence list
    → presence rows are grouped by employee
    → OnlineUsersContext updates
    → dashboard online-employees strip updates when the dashboard is open

There is no user_presence Realtime step in this flow.

## 2. /api/presence complete explanation

### Route definition

The route is registered at server/src/routes/presence.js, line 6:

    router.get('/', controller.listPresence)
    router.post('/heartbeat', controller.heartbeat)
    router.post('/offline', controller.offline)

It is mounted behind authentication at server/src/app.js, line 57:

    app.use('/api/presence', requireAuth, require('./routes/presence'))

Business method: GET /api/presence.

Global middleware applied before the route:

1. Conditional performance logger for development or DEBUG_PERF=true.
2. CORS.
3. express.json().
4. attachUser.
5. requireAuth.
6. listPresence.

CORS can also handle browser preflight requests, but only GET has a business handler for /api/presence.

### Authentication

The frontend's apiFetch gets the current Supabase session and adds Authorization: Bearer &lt;token&gt; in src/services/apiClient.js, lines 23-43.

Server authentication in server/src/middleware/authMiddleware.js:

1. Reads the bearer token.
2. Checks an in-memory token cache with a 60-second TTL.
3. On a cache miss, calls supabase.auth.getUser(token) through the server's anon Supabase client.
4. Builds req.user with id, email, and metadata-derived name.

requireAuth then:

1. Rejects missing users with 401.
2. Queries employee_statuses by req.user.id.
3. Rejects inactive employees with 403.

The employment-status query runs for every presence request; it is not cached.

### Parameters

- Request body: none.
- Query parameters: none are read.
- Authentication header: required.

### Database queries

The request normally executes three PostgREST/database queries:

1. employee_statuses lookup from requireAuth:

    select user_id, status, created_at, updated_at, updated_by
    from employee_statuses
    where user_id = &lt;current user&gt;

2. Fresh presence rows:

    select *
    from user_presence
    where last_seen_at &gt;= &lt;now minus 75 seconds&gt;
      and status in ('online', 'away')
    order by last_seen_at desc

3. Inactive-user filtering, when presence rows exist:

    select user_id
    from employee_statuses
    where user_id in (&lt;presence user IDs&gt;)
      and status = 'inactive'

There is no user_profiles join or separate profile query. Names, emails, initials, colours, and current paths come from values previously stored by heartbeat requests.

### Helper functions

listPresence calls:

- aggregatePresence(rows)
- latestRow(rows)
- serialize(row)
- normalizeStatus(value)
- initials(name, email) when stored initials are missing

Authentication also calls:

- cachedUser(token)
- cacheUser(token, user)
- getEmployeeStatus(userId)

### Response

Successful response:

    {
      "data": [
        {
          "id": "user UUID",
          "user_id": "user UUID",
          "email": "employee@fyndbridge.in",
          "name": "Employee Name",
          "display_name": "Employee Name",
          "initials": "EN",
          "avatar_color": "",
          "status": "online",
          "current_path": "/dashboard/candidates",
          "last_seen_at": "timestamp",
          "updated_at": "timestamp"
        }
      ],
      "cutoff": "timestamp"
    }

Failure response:

    { "error": "Unable to load presence." }

with HTTP 500. Authentication can instead return 401 or 403.

### Complete execution flow

1. Vercel rewrites /api/presence to the shared Express function in api/index.js.
2. The bearer token is attached and validated.
3. The current employee's employment status is checked.
4. The controller calculates a cutoff of now minus 75 seconds.
5. It fetches all recent online and away tab rows.
6. It separately fetches inactive employment records for those user IDs.
7. Inactive employees are removed.
8. Remaining rows are grouped by user_id.
9. For each user:
   - The newest tab row supplies profile metadata, current path, and timestamps.
   - If any fresh tab row is online, the aggregated user is online.
   - Otherwise the aggregated user is away.
10. Online users are sorted before away users, then alphabetically.
11. The full aggregated list is returned.

This route:

- Does not insert or update anything.
- Does not change status.
- Does not update last_seen_at.
- Does not remove stale rows.
- Does not return offline users.
- Does fetch the complete fresh employee-presence list.
- Does not subscribe to or trigger an application Realtime callback.
- Performs the related extra work of filtering inactive employees.

## 3. /api/presence/heartbeat complete explanation

### Route definition

Defined at server/src/routes/presence.js, line 7:

    router.post('/heartbeat', controller.heartbeat)

Business method: POST /api/presence/heartbeat.

It has the same middleware and authentication chain as /api/presence.

### Request body

The frontend sends:

    {
      "tab_id": "per-tab UUID",
      "display_name": "Employee Name",
      "email": "employee@fyndbridge.in",
      "initials": "EN",
      "role": "Consultant",
      "status": "online",
      "current_path": "/dashboard/candidates"
    }

Server handling:

| Field | Behavior |
|---|---|
| tab_id | Required; 400 if empty |
| display_name or name | Preferred over authenticated metadata |
| email | Request value preferred over authenticated email |
| initials | Stored, or calculated |
| avatar_color | Stored |
| status | Exact away remains away; every other value becomes online |
| current_path | Stored |
| role | Sent by frontend but completely ignored by the controller |
| user_id | Always taken from authenticated req.user.id |

### Database queries

Normally two database calls occur:

1. requireAuth queries employee_statuses.
2. The controller performs an atomic upsert:

    insert into user_presence (...)
    values (...)
    on conflict (user_id, tab_id)
    do update ...
    returning *

The conflict key is the composite primary key (user_id, tab_id).

### Timestamps and status

Every request writes:

- status
- last_seen_at = new Date().toISOString()
- updated_at = new Date().toISOString()

There is no last_active or heartbeat_at column.

### Helper functions

The heartbeat controller calls:

- clean(value)
- initials(name, email)
- normalizeStatus(value)
- serialize(row)

It also goes through the authentication helpers described above.

### Response

Successful response:

    {
      "data": {
        "id": "user UUID",
        "user_id": "user UUID",
        "email": "employee@fyndbridge.in",
        "name": "Employee Name",
        "display_name": "Employee Name",
        "initials": "EN",
        "avatar_color": "",
        "status": "online",
        "current_path": "/dashboard/candidates",
        "last_seen_at": "timestamp",
        "updated_at": "timestamp"
      }
    }

Possible errors:

- 401: missing/invalid authentication.
- 403: inactive employee.
- 400: missing tab ID.
- 500: failed upsert.

### Complete execution flow

1. The request reaches the shared Express function.
2. The bearer token identifies the current Supabase Auth user.
3. requireAuth checks the user's employment status.
4. The controller takes the immutable user_id from req.user.id.
5. It sanitizes whitespace in body fields.
6. It validates tab_id.
7. It derives status from the client-provided value.
8. It generates fresh last_seen_at and updated_at timestamps.
9. It atomically inserts or updates the current (user_id, tab_id) row.
10. It returns the saved row in serialized form.
11. The route itself stops here.
12. The frontend then independently calls GET /api/presence.

The route:

- Updates one tab row only.
- Updates status and timestamps on every heartbeat.
- Does not fetch the complete presence list itself.
- Does not determine offline users.
- Does not expire stale users.
- Does not query profiles.
- Does not delete anything.
- Does not perform unrelated ATS module work.
- Does not generate a repository-configured user_presence Realtime event.

## 4. Frontend call map

All direct presence HTTP calls are in src/hooks/useOnlineUsers.js.

| Function | Route | Method | Trigger |
|---|---|---:|---|
| loadPresence | /api/presence | GET | Mount, 5-second polling, after heartbeat, route navigation |
| heartbeat | /api/presence/heartbeat | POST | Mount, 25-second interval, navigation, focus/blur, visibility, pageshow, network restored |
| markCurrentTabOffline | /api/presence/offline | POST | pagehide, beforeunload, current employee becoming inactive |

Relevant timer setup:

    const HEARTBEAT_MS = 25000
    const PRESENCE_POLL_MS = 5000

    const heartbeatTimer = window.setInterval(
      () => heartbeat({ force: true }),
      HEARTBEAT_MS
    )
    const pollTimer = window.setInterval(loadPresence, PRESENCE_POLL_MS)

Relevant browser events:

    document.addEventListener('visibilitychange', writeStatus)
    window.addEventListener('focus', writeStatus)
    window.addEventListener('blur', writeStatus)
    window.addEventListener('pageshow', writeStatus)
    window.addEventListener('online', writeStatus)
    window.addEventListener('pagehide', markCurrentTabOffline)
    window.addEventListener('beforeunload', markCurrentTabOffline)

### Mounting scope

AuthenticatedShell.jsx wraps the entire authenticated layout:

    <OnlineUsersProvider>
      <DashboardLayout />
    </OnlineUsersProvider>

Therefore presence runs on:

- Dashboard
- Mandates
- Clients
- Candidates
- Attendance
- Consultant report
- Performance review
- User manual
- Admin
- Settings
- Profile
- Invoice routes

The provider persists across normal child-route navigation under the shell.

### Route navigation behavior

heartbeat depends on location.pathname and location.search. Navigation creates a new callback identity, which restarts the primary presence effect and also reruns the dedicated route effect.

A normal route change therefore schedules approximately:

- Two heartbeat POSTs.
- One immediate standalone presence GET.
- One presence GET after each heartbeat.

Total route-change burst: approximately two POSTs and three GETs.

### Dashboard consumer

Only DashboardHome.jsx reads the context:

    const onlineUsers = useOnlineUsers()

It renders OnlineUsersStrip.jsx at DashboardHome line 832.

The component:

- Filters for online and away again.
- Counts both groups.
- Shows avatars and tooltip details.
- Does not make API requests itself.

The dashboard does not reload. Only context state and the consuming component rerender.

### Login and logout

Login:

1. Google OAuth succeeds.
2. Auth, employment status, profile, and authorization resolve.
3. AuthenticatedShell mounts.
4. Presence requests begin.

Explicit logout in AuthContext.jsx calls only supabase.auth.signOut().

It does not call /api/presence/offline. The provider stops its timers after the session disappears, but its cleanup does not delete the presence row. The logged-out user can remain visible for up to 75 seconds.

Account deactivation is different: the Realtime employment-status handler dispatches fb:employee-status-changed, and the presence hook sends /offline for the current user before sign-out.

### Multiple callers

Normally there is one provider per authenticated document. Simultaneous calls are nevertheless possible because:

- Polling can overlap heartbeat-triggered fetching.
- Focus and visibility events can fire close together.
- Route navigation intentionally schedules two heartbeat paths.
- Every browser tab has its own provider.
- The dashboard drilldown iframe boots another authenticated ATS document while open and therefore another provider.

There is no in-flight deduplication or request cancellation for presence calls.

## 5. Current request-frequency calculations

### Heartbeat POSTs

Foreground steady-state interval:

    3,600 seconds ÷ 25 seconds = 144 heartbeat POSTs per tab per hour

| Scenario | Interval-only heartbeat requests | Including two initial mount heartbeats |
|---|---:|---:|
| One employee, one hour | 144 | approximately 146 |
| 20 employees, eight hours | 23,040 | approximately 23,080 |
| One employee, two tabs, one hour | 288 | approximately 292 |
| 20 employees, two tabs, eight hours | 46,080 | approximately 46,160 |

These totals exclude:

- Focus and blur.
- visibilitychange.
- Route navigation.
- pageshow.
- Network restoration.
- Browser timer throttling.
- Dashboard iframe providers.

### /api/presence GETs

Per foreground tab per hour:

    5-second polling:       3,600 ÷ 5  = 720 GETs
    After each heartbeat:   3,600 ÷ 25 = 144 GETs
    Steady total:                         864 GETs/hour
    Initial mount:                       + 3 GETs

Approximate first-hour GETs: 867 per tab.

For 20 employees over eight hours:

- One tab each: approximately 138,300 GETs including initial mounts.
- Two tabs each: approximately 276,600 GETs including initial mounts.

Steady combined traffic per tab:

    144 heartbeat POSTs + 864 list GETs = 1,008 requests/hour

A newly mounted tab adds approximately five immediate HTTP calls: two heartbeats and three list fetches.

## 6. Status lifecycle

| Status | Current rule |
|---|---|
| Online | Current tab reports while document.visibilityState is visible and document.hasFocus() is true |
| Away | Current tab reports when either visibility or browser focus condition is false |
| Offline | No fresh row is returned because the tab row was deleted or last_seen_at is over 75 seconds old |

The frontend rule is:

    return document.visibilityState === 'visible' && document.hasFocus()
      ? 'online'
      : 'away'

### Focus and visibility

- Visible and focused: online.
- Hidden, backgrounded, or unfocused: away.
- visibilitychange, focus, and blur force immediate writes.
- The server trusts the client-supplied status; it cannot independently inspect browser state.

### Timestamp expiry

- Heartbeat interval: 25 seconds.
- Offline cutoff: 75 seconds.
- This allows approximately three missed heartbeat intervals.
- Expired rows are excluded, not deleted.

### Closed tab

pagehide and beforeunload both send keepalive delete requests for the current tab row. These are best effort. If both events fire, two delete requests may be sent.

If delivery fails, the tab remains visible until the 75-second cutoff.

### Logout

Explicit logout does not delete presence. Offline becomes visible only after expiry unless an unload event also happens.

### Lost network

- Existing timers continue attempting requests.
- Network failures are swallowed.
- No immediate retry loop exists.
- After 75 seconds without a successful heartbeat, the user disappears.
- The online browser event forces a heartbeat when connectivity returns.

### Device sleep

Timers do not run during sleep. The employee disappears after the server-side cutoff as other clients poll. On wake, the next timer/focus/pageshow event restores presence.

### Multiple tabs

Each tab has a distinct tab_id and row.

Aggregation rules:

- If any fresh tab is online, the employee is online.
- If all fresh tabs are away, the employee is away.
- Closing one tab deletes only that tab's row.
- The newest row supplies current_path and timestamps, even if another tab caused the aggregated online status.

### Match with intended behavior

It partially matches:

- Online: yes, when a visible ATS document has focus.
- Away: yes while away heartbeats continue.
- Offline after heartbeat expiry: yes.
- Closed ATS: usually, but unload delivery is best effort.
- Logged out: not immediately; presence can remain for 75 seconds.
- Long-hidden/background tabs: browsers may throttle intervals enough for the employee to disappear instead of remaining away.

## 7. Database implementation

### Presence table

Created by supabase/migrations/20260630130000_user_presence.sql.

| Column | Type/behavior |
|---|---|
| user_id | UUID, FK to auth.users(id), cascade delete |
| tab_id | Text |
| email | Text |
| display_name | Text |
| initials | Text |
| avatar_color | Text |
| status | Text, constrained to online or away |
| current_path | Text |
| last_seen_at | timestamptz, default now() |
| updated_at | timestamptz, default now() |

Primary key and unique identity:

    primary key (user_id, tab_id)

### Indexes

- Implicit primary-key B-tree on (user_id, tab_id).
- idx_user_presence_last_seen_at on last_seen_at DESC.

Index assessment:

- Heartbeat upsert is properly indexed by the primary key.
- Offline deletion by user_id and tab_id is properly indexed.
- The fresh-presence query can use last_seen_at DESC for its range filter and ordering.
- The status condition matches every legally stored row because the constraint allows only online and away; it adds little filtering value.
- No confirmed missing presence index was found.
- employee_statuses.user_id is its primary key, so authentication and inactive-user lookups are indexed.

The database may still choose a sequential scan while the table is tiny, but the relevant repository indexes exist.

### RLS

RLS is enabled with:

- Authenticated users may select every row.
- Users may insert only their own user_id.
- Users may update only their own rows.
- Users may delete only their own rows.

The policies use (select auth.uid()), avoiding a per-row auth.uid() evaluation.

The Express controllers use supabaseAdmin with the service-role key, so their database queries bypass these RLS policies. Authorization is enforced by Express middleware instead.

### Functions and triggers

For user_presence itself:

- No database functions.
- No triggers.
- No automatic updated_at trigger.
- No stale-row cleanup function.
- No cron or scheduled cleanup.
- No publication setup for Realtime.

Indirectly connected employee_statuses infrastructure includes:

- ensure_employee_status_after_profile_name() trigger function.
- user_profiles_ensure_employee_status trigger.
- is_current_employee_active() function.
- Realtime publication of employee_statuses.

These affect inactive-account enforcement, not normal online/away calculation.

### Realtime configuration

No migration adds user_presence to supabase_realtime, and no frontend code subscribes to it.

Therefore presence uses polling, not Supabase Realtime.

### Whole-table work

- No route performs full-table cleanup.
- The list query is restricted by indexed last_seen_at.
- Stale rows remain indefinitely and increase table/index size over time.
- select('*') returns every column for every fresh tab, including tab_id, although not all fields are returned to the frontend.

## 8. Dashboard relationship

The returned presence list is displayed only by:

- src/pages/DashboardHome.jsx
- src/components/dashboard/OnlineUsersStrip.jsx

However, presence tracking and full-list polling run across the complete authenticated application because the provider wraps DashboardLayout.

Relationship to other features:

| Feature | Relationship |
|---|---|
| Authentication | Uses authenticated identity, but presence does not authenticate users |
| Attendance | None |
| Notifications | None |
| Candidates | No business integration; presence records the candidates route as current_path |
| Clients | Same: path tracking only |
| Mandates | Same: path tracking only |
| Performance review | Same: path tracking only |
| Consultant report | Same: path tracking only |
| Invoice | Same global provider and path tracking |
| Employee management | Indirect: an inactive status Realtime event sends the current user offline |
| General session tracking | Yes; every authenticated route is tracked |
| Dashboard | Only feature that displays the list |

No backend candidate, client, mandate, attendance, notification, or performance service references either presence route.

## 9. Confirmed sources of high request volume

### Confirmed causes

1. **Five-second full-list polling on every authenticated page.**

   This alone produces 720 GETs/hour/tab.

2. **Every heartbeat causes an additional full-list fetch.**

   This adds another 144 GETs/hour/tab.

3. **Twenty-five-second heartbeat writes.**

   This creates 144 POSTs and database upserts/hour/tab even when status and route have not changed.

4. **All heartbeat calls use force: true.**

   MIN_WRITE_MS never suppresses current callers.

5. **Presence is mounted globally.**

   Employees generate the same presence traffic on Candidates, Mandates, Reports, Attendance, Invoice, and other authenticated pages.

6. **Multiple browser tabs multiply requests linearly.**

   Each tab gets a unique ID, timer set, polling loop, and database row.

7. **Route navigation creates request bursts.**

   Approximately two heartbeats and three list GETs per navigation.

8. **Focus and visibility events force additional calls.**

   Blur plus visibilitychange can produce closely spaced duplicate-purpose writes.

9. **Dashboard drilldown iframe creates another provider.**

   While open, it behaves like an additional authenticated browsing context.

### Not confirmed as causes

- No user_presence Realtime callback triggers list refetches.
- Dashboard component rerenders do not independently call presence APIs.
- There is no immediate retry loop after failures.
- React Strict Mode does not leave persistent duplicate intervals because cleanup clears both timers and listeners.
- No server route recursively calls another presence route.

Strict Mode can replay effects in development, but the zero-delay mount timers are cleared during cleanup before the replayed effect creates the final timers. It is not a confirmed production duplication source.

## 10. Resource-usage assessment

| Resource | Actual impact |
|---|---|
| Vercel invocations | High count: approximately 1,008 presence invocations/hour/tab |
| Active CPU | Low per request; mainly JSON handling, row grouping, sorting, and serialization |
| Provisioned memory | Shared function configured for 1,024 MB in vercel.json; presence itself holds little data |
| Function duration | Includes waiting for two or three Supabase network requests |
| Network transfer | Repeated full presence-list responses and Vercel-to-Supabase traffic |
| Supabase writes | Approximately 144 upserts/hour/tab before extra events |
| Supabase reads | GET route normally performs three database calls; heartbeat normally performs two |
| Supabase Realtime | None for user_presence; employee-status Realtime is separate |

Approximate Supabase operations per steady tab-hour, assuming at least one fresh user exists:

    144 heartbeat requests × 2 Supabase calls =   288
    864 list requests × 3 Supabase calls      = 2,592
    Approximate total                         = 2,880 calls/hour/tab

This excludes token-cache misses that call Supabase Auth.

The routes are computationally lightweight. /api/presence is somewhat heavier than heartbeat because it loads all fresh tab rows, performs inactive filtering, groups rows, and sorts employees. High cost risk comes from invocation frequency and network/database repetition, not complex CPU computation.

The route with the highest request count is not necessarily the route with the highest active CPU per invocation.

## 11. Confirmed problems and risks

No Critical issue was confirmed.

| Severity | Location | Confirmed issue | Likely impact |
|---|---|---|---|
| High | src/hooks/useOnlineUsers.js:129 | Full list polled every 5 seconds on every authenticated page | Primary source of Vercel and Supabase reads |
| High | src/hooks/useOnlineUsers.js:89 | Every heartbeat also fetches the complete list despite independent polling | 144 additional full-list GETs/hour/tab |
| High | src/pages/AuthenticatedShell.jsx:5 | Presence list polling runs globally although only DashboardHome displays it | Non-dashboard pages generate unused list traffic |
| Medium | src/hooks/useOnlineUsers.js:128 | Every tab writes every 25 seconds regardless of whether status changed | Repeated writes and index maintenance |
| Medium | src/hooks/useOnlineUsers.js:153 | Route navigation activates both the restarted main effect and route heartbeat effect | Approximately two POSTs and three GETs per navigation |
| Medium | src/context/AuthContext.jsx:285 | Explicit logout does not call /presence/offline | Logged-out users may remain visible for 75 seconds |
| Medium | server/src/controllers/presenceController.js:63 | Stale rows are filtered but never deleted | Long-term table and index growth after failed unloads |
| Medium | src/hooks/useOnlineUsers.js:73 | No in-flight heartbeat/list deduplication | Overlapping calls and temporary status ordering races |
| Medium | src/pages/DashboardHome.jsx:591 | Dashboard drilldown iframe boots another authenticated provider | Additional heartbeat, polling, and database row while open |
| Low | src/hooks/useOnlineUsers.js:136 | Both pagehide and beforeunload send offline | Two idempotent delete invocations may occur |
| Low | src/hooks/useOnlineUsers.js:84 | HTTP 4xx/5xx responses do not throw because response.ok is not checked | Failed heartbeat responses can still trigger a list GET |
| Low | src/hooks/useOnlineUsers.js:51 | HTTP list errors replace the list with an empty array; network failures silently preserve state | Card may temporarily show zero employees without an error |
| Low | src/hooks/useOnlineUsers.js:10 | MIN_WRITE_MS is ineffective because all current callers pass force: true | Intended write suppression is unused |
| Low | server/src/controllers/presenceController.js:95 | Presentation metadata and status are trusted from the client | Authenticated users can misreport name/email/status for their own row |
| Low | server/src/controllers/presenceController.js:116 | Heartbeat returns the complete saved row although the caller ignores it | Small unnecessary database response and transfer |
| Low | docs/DASHBOARD_API_AUDIT.md:12 | Documentation claims presence uses a websocket, but current code uses HTTP polling | Misleading operational documentation |

Not confirmed:

- Persistent duplicate intervals.
- Missing timer cleanup.
- Duplicate user_presence Realtime subscriptions.
- Full-table cleanup per request.
- Missing presence query indexes.
- Immediate failed-request retries.
- Unconditional repeated success logging.

## 12. List of all relevant files

Backend and hosting:

- vercel.json
- api/index.js
- server/src/app.js
- server/src/routes/presence.js
- server/src/controllers/presenceController.js
- server/src/middleware/authMiddleware.js
- server/src/middleware/requireAuth.js
- server/src/services/employeeStatus.js
- server/src/services/supabaseAdmin.js
- server/src/services/supabaseAnon.js

Frontend:

- src/hooks/useOnlineUsers.js
- src/pages/AuthenticatedShell.jsx
- src/App.jsx
- src/pages/DashboardLayout.jsx
- src/pages/DashboardHome.jsx
- src/components/dashboard/OnlineUsersStrip.jsx
- src/components/dashboard/OnlineUsersStrip.css
- src/services/apiClient.js
- src/services/supabaseClient.js
- src/context/AuthContext.jsx
- src/pages/LoginPage.jsx
- src/components/Sidebar.jsx
- src/hooks/useAdminAccess.js
- src/main.jsx
- src/features/employee-management/EmployeeManagement.jsx

Database:

- supabase/migrations/20260630130000_user_presence.sql
- supabase/migrations/20260713082653_employee_management_backend.sql

Documentation contradiction:

- docs/DASHBOARD_API_AUDIT.md
