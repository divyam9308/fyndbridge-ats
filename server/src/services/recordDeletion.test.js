const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  normalizeEntityType,
  normalizeIds,
  normalizeDeleteLinked
} = require('./recordDeletion')

const projectRoot = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20260716092942_super_admin_bulk_record_deletion.sql'),
  'utf8'
)
const routes = fs.readFileSync(path.join(projectRoot, 'server/src/routes/admin.js'), 'utf8')
const modal = fs.readFileSync(path.join(projectRoot, 'src/components/admin/RecordManagementModal.jsx'), 'utf8')
const adminPage = fs.readFileSync(path.join(projectRoot, 'src/pages/AdminPage.jsx'), 'utf8')
const deletionService = fs.readFileSync(path.join(projectRoot, 'server/src/services/recordDeletion.js'), 'utf8')
const displayIdSearchMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20260716095921_record_management_display_id_search.sql'),
  'utf8'
)

test('record deletion request validation accepts only supported entities and UUIDs', () => {
  assert.equal(normalizeEntityType('candidate'), 'candidate')
  assert.equal(normalizeEntityType('MANDATE'), 'mandate')
  assert.throws(() => normalizeEntityType('invoice'), /Invalid entity type/)

  const id = '97d9fbd9-9b3e-4d44-b147-88476ec61fde'
  assert.deepEqual(normalizeIds([id, id]), [id])
  assert.throws(() => normalizeIds([]), /Select at least one record/)
  assert.throws(() => normalizeIds(['CA12']), /invalid/)
  assert.equal(normalizeDeleteLinked(undefined), false)
  assert.equal(normalizeDeleteLinked(true), true)
  assert.throws(() => normalizeDeleteLinked('true'), /boolean/)
})

test('all record-management API routes independently require Super Admin', () => {
  assert.match(routes, /record-management\/records', requireSuperAdmin/)
  assert.match(routes, /record-management\/preview', requireSuperAdmin/)
  assert.match(routes, /record-management\/delete', requireSuperAdmin/)
  assert.match(adminPage, /\{isSuperAdmin \? \([\s\S]*title="Record Management"/)
  assert.match(modal, /useState\(false\)/)
})

test('database functions are service-role only and re-check the authoritative role', () => {
  assert.match(migration, /admin_user\.role = 'super_admin'/)
  assert.match(migration, /grant execute on function public\.admin_bulk_record_list[\s\S]*to service_role/)
  assert.match(migration, /grant execute on function public\.admin_bulk_delete_preview[\s\S]*to service_role/)
  assert.match(migration, /grant execute on function public\.admin_bulk_delete_records[\s\S]*to service_role/)
  assert.match(migration, /revoke all on function public\.admin_bulk_delete_records[\s\S]*from public, anon, authenticated/)
})

test('candidate identity and retain/delete relationship rules use stable row IDs', () => {
  assert.match(migration, /where association\.id = any\(selected_ids\)/)
  assert.match(migration, /set job_id = null,[\s\S]*job_title = null/)
  assert.match(migration, /set client_id = null,[\s\S]*client_name = null,[\s\S]*job_id = null/)
  assert.doesNotMatch(migration, /where\s+(?:full_name|email|mobile_number|resume_url)\s*=/i)
})

test('bulk deletion never removes resume storage objects or renumbers IDs', () => {
  assert.doesNotMatch(migration, /storage\.objects|storage\.remove|setval|nextval/i)
  assert.doesNotMatch(modal, /storage\.remove/)
  assert.match(modal, /Uploaded resume files will be preserved\./)
  assert.match(modal, /IDs will not be renumbered\./)
})

test('record selector searches and displays CA, JB and CL IDs', () => {
  assert.match(displayIdSearchMigration, /candidate\.candidate_display_id as display_id/)
  assert.match(displayIdSearchMigration, /job\.job_display_id as display_id/)
  assert.match(displayIdSearchMigration, /root\.client_display_id as display_id/)
  assert.match(displayIdSearchMigration, /concat_ws\([\s\S]*display_id/)
  assert.match(modal, /Search by candidate, CA ID/)
  assert.match(modal, /Search by mandate, JB ID/)
  assert.match(modal, /Search by client, CL ID/)
  assert.match(deletionService, /candidate: \/\^CA\\d\+\$\/i/)
  assert.match(deletionService, /mandate: \/\^JB\\d\+\$\/i/)
  assert.match(deletionService, /client: \/\^CL\\d\+\$\/i/)
})
