const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const hook = fs.readFileSync(path.join(root, 'src/hooks/useOnlineUsers.js'), 'utf8')
const auth = fs.readFileSync(path.join(root, 'src/context/AuthContext.jsx'), 'utf8')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/presenceController.js'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260715080130_enable_user_presence_realtime.sql'), 'utf8')
const notifications = fs.readFileSync(path.join(root, 'src/components/NotificationBell.jsx'), 'utf8')
const realtimeRefresh = fs.readFileSync(path.join(root, 'src/hooks/useRealtimeRefresh.js'), 'utf8')

test('presence heartbeat uses one 60-second leader timer without global list polling', () => {
  assert.match(hook, /const HEARTBEAT_MS = 60 \* 1000/)
  assert.doesNotMatch(hook, /PRESENCE_POLL_MS|5000/)
  assert.match(hook, /heartbeatInFlight/)
  assert.match(hook, /fb_presence:\$\{userId\}:`/)
  assert.match(hook, /isDashboardEmbed/)
  assert.doesNotMatch(hook.slice(0, hook.indexOf('function useDashboardPresenceUsers')), /apiFetch\('\/api\/presence'/)
})

test('dashboard alone loads and subscribes to the full presence list with a 60-second fallback', () => {
  assert.match(hook, /function useDashboardPresenceUsers/)
  assert.match(hook, /apiFetch\('\/api\/presence'/)
  assert.match(hook, /table: 'user_presence'/)
  assert.match(hook, /const FALLBACK_POLL_MS = 60 \* 1000/)
  assert.match(hook, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'/)
  assert.match(hook, /supabase\.removeChannel\(channel\)/)
})

test('presence API expires at 120 seconds and avoids select-star reads and heartbeat returns', () => {
  assert.match(controller, /const OFFLINE_CUTOFF_MS = 120 \* 1000/)
  assert.doesNotMatch(controller, /\.from\('user_presence'\)[\s\S]{0,120}\.select\('\*'\)/)
  assert.match(controller, /tabs: visibleRows\.map\(serializeTab\)/)
  assert.match(controller, /return res\.json\(\{ ok: true, last_seen_at: payload\.last_seen_at \}\)/)
})

test('logout clears all presence rows before Supabase authentication signs out', () => {
  const clearIndex = auth.indexOf('await clearPresenceBeforeLogout')
  const signOutIndex = auth.indexOf('await supabase.auth.signOut', clearIndex)
  assert.ok(clearIndex >= 0)
  assert.ok(signOutIndex > clearIndex)
  assert.match(controller, /req\.body\?\.all_tabs === true/)
})

test('presence realtime publication and channels remain isolated from business realtime', () => {
  assert.match(migration, /alter publication supabase_realtime add table public\.user_presence/i)
  assert.doesNotMatch(migration, /clients|candidates|jobs|notifications|attendance/i)
  assert.match(notifications, /table: 'notifications'/)
  assert.match(realtimeRefresh, /nextChannel\.on\('postgres_changes'/)
  assert.doesNotMatch(hook, /table: '(clients|candidates|jobs|notifications|attendance_records)'/)
})
