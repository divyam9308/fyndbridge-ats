const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/jobController.js'), 'utf8')
const page = fs.readFileSync(path.join(root, 'src/pages/JobsPage.jsx'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260715071440_allow_confirmed_duplicate_mandates.sql'),
  'utf8'
)
const jobDisplayIdMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260715072228_ensure_unique_mandate_jb_ids.sql'),
  'utf8'
)
const secureViewMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260715072330_secure_duplicate_mandate_data_issue_view.sql'),
  'utf8'
)

test('ordinary mandate creates return a candidate-style duplicate review response', () => {
  assert.match(controller, /duplicateAction !== 'add_duplicate'/)
  assert.match(controller, /status\(409\)\.json\(\{[\s\S]*duplicate: true[\s\S]*allowAddDuplicate: true[\s\S]*existing/)
  assert.match(controller, /\.select\('\*, clients\(name, client_name, client_display_id\)'\)/)
})

test('confirmed duplicate mandates are explicitly marked while ordinary creates remain protected', () => {
  assert.match(controller, /payload\.duplicate_confirmed = Boolean\(duplicate && duplicateAction === 'add_duplicate'\)/)
  assert.match(migration, /add column if not exists duplicate_confirmed boolean not null default false/i)
  assert.match(migration, /set duplicate_confirmed = true[\s\S]*ranked_mandates[\s\S]*duplicate_rank > 1/i)
  assert.match(migration, /create unique index if not exists jobs_client_normalized_title_primary_unique[\s\S]*duplicate_confirmed = false/i)
  assert.match(migration, /drop index if exists public\.jobs_client_normalized_title_unique/i)
})

test('mandate page offers the same duplicate review actions as candidates', () => {
  assert.match(page, />Duplicate Mandate</)
  assert.match(page, />View More</)
  assert.match(page, />Add Duplicate</)
  assert.match(page, />Update Existing</)
  assert.match(page, /body\.append\('duplicate_action', 'add_duplicate'\)/)
  assert.match(page, /res\.status === 409 && data\.duplicate/)
})

test('each duplicate mandate receives a newly allocated, database-unique JB ID', () => {
  assert.match(controller, /const insertPayload = \{ \.\.\.payload, job_display_id: await nextJobDisplayId\(\) \}/)
  assert.match(controller, /if \(!isDisplayIdUniqueError\(error, 'job_display_id'\)\) break/)
  assert.match(jobDisplayIdMigration, /create unique index if not exists jobs_job_display_id_unique_idx[\s\S]*on public\.jobs \(job_display_id\)[\s\S]*job_display_id is not null/i)
})

test('duplicate mandate diagnostics preserve the caller RLS context', () => {
  assert.match(secureViewMigration, /alter view public\.data_issue_duplicate_jobs[\s\S]*security_invoker = true/i)
})
