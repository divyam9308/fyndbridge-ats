const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/notificationController.js'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260727142950_delete_read_cleared_notifications_after_7_days.sql'),
  'utf8'
)

test('notification cleanup requires read, cleared, and at least seven days old', () => {
  assert.match(controller, /NOTIFICATION_RETENTION_DAYS = 7/)
  assert.match(controller, /\.not\('cleared_at', 'is', null\)[\s\S]*\.eq\('status', 'read'\)[\s\S]*\.lte\('cleared_at', cutoff\)/)
  assert.match(controller, /retention_days: NOTIFICATION_RETENTION_DAYS/)
  assert.match(controller, /cutoff/)
  assert.match(migration, /where status = 'read'[\s\S]*cleared_at is not null[\s\S]*cleared_at <= now\(\) - interval '7 days'/)
})

test('Supabase schedules the indexed cleanup hourly and removes existing eligible rows', () => {
  assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog/)
  assert.match(migration, /cron\.schedule\(/)
  assert.match(migration, /'delete-read-cleared-notifications-after-7-days'/)
  assert.match(migration, /'17 \* \* \* \*'/)
  assert.equal((migration.match(/delete from public\.notifications/g) || []).length, 2)
})

test('retention cleanup never targets pending or merely-read notifications', () => {
  const deleteStatements = migration.match(/delete from public\.notifications[\s\S]*?;/g) || []
  assert.equal(deleteStatements.length, 2)
  deleteStatements.forEach(statement => {
    assert.match(statement, /status = 'read'/)
    assert.match(statement, /cleared_at is not null/)
    assert.match(statement, /cleared_at <= now\(\) - interval '7 days'/)
    assert.doesNotMatch(statement, /status = 'pending'/)
  })
})
