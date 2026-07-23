const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { unpublishClosedMandatePayload } = require('./publicApplications')

const root = path.resolve(__dirname, '../../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')
const migration = read('supabase/migrations/20260723091826_fix_public_mandate_visibility_and_auto_unpublish.sql')
const jobController = read('server/src/controllers/jobController.js')
const appliedCandidatesController = read('server/src/controllers/appliedCandidatesController.js')
const jobsPage = read('src/pages/JobsPage.jsx')
const clientDetailPage = read('src/pages/ClientDetailPage.jsx')

test('closed mandate patches are automatically unpublished while P1 patches retain publication state', () => {
  assert.deepEqual(
    unpublishClosedMandatePayload({ mandate_status: 'Delivered (P2)', is_public: true }, { partial: true }),
    { mandate_status: 'Delivered (P2)', is_public: false }
  )
  assert.deepEqual(
    unpublishClosedMandatePayload({ mandate_status: 'Completed' }, { partial: true }),
    { mandate_status: 'Completed', is_public: false }
  )
  assert.deepEqual(
    unpublishClosedMandatePayload({ mandate_status: 'Ongoing (P1)', is_public: true }, { partial: true }),
    { mandate_status: 'Ongoing (P1)', is_public: true }
  )
  assert.deepEqual(
    unpublishClosedMandatePayload({ mandate_status: 'Delivered (P2)', is_public: true }),
    { mandate_status: 'Delivered (P2)', is_public: true }
  )
})

test('every API status-update path persists automatic unpublishing', () => {
  assert.match(jobController, /return unpublishClosedMandatePayload\(payload, \{ partial \}\)/)
  assert.match(
    appliedCandidatesController,
    /update\(\{\s*mandate_status:\s*'Completed',\s*status:\s*'Completed',\s*is_public:\s*false/
  )
})

test('filter view repair exposes public fields without broadening browser access', () => {
  assert.match(migration, /drop view public\.mandate_ai_filter_rows/i)
  assert.match(migration, /create view public\.mandate_ai_filter_rows\s+with \(security_invoker = true\)/i)
  for (const column of [
    'is_public',
    'public_slug',
    'public_name',
    'public_location',
    'public_experience',
    'public_skills',
    'application_deadline',
    'public_jd'
  ]) {
    assert.match(migration, new RegExp(`'${column}'`, 'i'))
  }
  assert.match(migration, /revoke all on public\.mandate_ai_filter_rows from public, anon, authenticated/i)
  assert.match(migration, /grant select on public\.mandate_ai_filter_rows to service_role/i)
})

test('database trigger and backfill enforce non-P1 mandates as not public', () => {
  assert.match(migration, /create or replace function public\.jobs_auto_unpublish_non_ongoing\(\)/i)
  assert.match(migration, /new\.mandate_status is distinct from 'Ongoing \(P1\)'[\s\S]*new\.is_public := false/i)
  assert.match(migration, /before insert or update of mandate_status, status, is_public[\s\S]*on public\.jobs/i)
  assert.match(
    migration,
    /update public\.jobs[\s\S]*set is_public = false[\s\S]*where is_public = true[\s\S]*mandate_status is distinct from 'Ongoing \(P1\)'/i
  )
})

test('status controls merge the server result and refresh the public-role count', () => {
  for (const page of [jobsPage, clientDetailPage]) {
    assert.match(page, /\{ \.\.\.row, \.\.\.data \}/)
    assert.match(page, /window\.dispatchEvent\(new Event\('ats:public-roles-updated'\)\)/)
  }
})
