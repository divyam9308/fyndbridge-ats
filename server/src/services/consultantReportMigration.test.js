const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260714210227_consultant_report_stage_tracking.sql'
)
const migration = fs.readFileSync(migrationPath, 'utf8')
const overallAudienceMigration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20260715185553_overall_consultant_report_audience.sql'),
  'utf8'
)

const stageColumns = [
  ['Client Submission', 'client_submission_at'],
  ['Interview', 'interview_at'],
  ['Offered', 'offered_at'],
  ['Hired', 'hired_at']
]

test('consultant report migration adds only nullable first-stage timestamp columns without a backfill', () => {
  for (const [, column] of stageColumns) {
    assert.match(migration, new RegExp(`add column if not exists ${column} timestamptz null`, 'i'))
  }
  assert.doesNotMatch(migration, /update\s+public\.candidate_associations\s+set/i)
  assert.doesNotMatch(migration, /\b(created_at|updated_at|date_of_joining)\b\s*::?\s*timestamptz/i)
  assert.doesNotMatch(migration, /\b(delete|truncate)\s+(?:from\s+)?public\.candidate_associations/i)
})

test('stage trigger records only an inserted or newly entered exact canonical stage', () => {
  assert.match(migration, /if tg_op = 'INSERT' then[\s\S]*entered_stage := true/i)
  for (const [, column] of stageColumns) {
    assert.match(migration, new RegExp(`if tg_op = 'INSERT' then[\\s\\S]*?new\\.${column} := null`, 'i'))
  }
  assert.match(migration, /entered_stage := new\.status is distinct from old\.status/i)
  for (const [status, column] of stageColumns) {
    assert.match(
      migration,
      new RegExp(`when '${status}' then[\\s\\S]*?if new\\.${column} is null then[\\s\\S]*?new\\.${column} := now\\(\\)`, 'i')
    )
  }
  assert.match(migration, /before insert or update of[\s\S]*status[\s\S]*on public\.candidate_associations/i)
})

test('stage timestamps cannot be cleared or overwritten by later association updates', () => {
  for (const [, column] of stageColumns) {
    assert.match(migration, new RegExp(`new\\.${column} := old\\.${column}`, 'i'))
  }
  assert.match(migration, /update of[\s\S]*client_submission_at[\s\S]*interview_at[\s\S]*offered_at[\s\S]*hired_at/i)
  assert.match(migration, /security invoker[\s\S]*set search_path = ''/i)
  assert.doesNotMatch(migration, /security definer/i)
})

test('Report permission seed is idempotent and preserves an existing administrator choice', () => {
  assert.match(migration, /insert into public\.page_view_permissions \(page_key, view_permission\)[\s\S]*values \('report', 'everyone'\)/i)
  assert.match(migration, /on conflict \(page_key\) do nothing/i)
})

test('migration does not duplicate indexes already present in the deployed schema', () => {
  assert.doesNotMatch(migration, /create\s+(?:unique\s+)?index/i)
})

test('Overall Consultants audience migration idempotently seeds admins without changing database privileges', () => {
  assert.match(
    overallAudienceMigration,
    /insert into public\.app_settings\s*\(\s*key\s*,\s*value\s*\)[\s\S]*?values\s*\(\s*'overall_consultant_report_audience'\s*,\s*'"admins"'::jsonb\s*\)/i
  )
  assert.match(overallAudienceMigration, /on conflict\s*\(\s*key\s*\)\s*do nothing/i)
  assert.doesNotMatch(overallAudienceMigration, /\b(?:grant|revoke)\b/i)
  assert.doesNotMatch(overallAudienceMigration, /\b(?:create|alter|drop)\s+policy\b/i)
})
