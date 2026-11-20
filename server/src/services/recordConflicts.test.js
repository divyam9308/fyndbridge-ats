const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
let compareRecordEdits, mergeReviewedEdits
test.before(async () => { ({ compareRecordEdits, mergeReviewedEdits } = await import('../../../shared/recordConflicts.js')) })
const { createDatabase, assign, ADMIN, CONSULTANT } = require('../../test-support/assignedCandidatesSchema.cjs')
const migration = name => fs.readFile(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8')
const fields = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'contacts', label: 'Contacts' }]

test('review preserves draft edits and newer changes to untouched fields without mutating inputs', () => {
  const original = { name: 'Original', status: 'Interested', contacts: [{ name: 'HR' }] }
  const draft = { ...original, name: 'My edit' }
  const latest = { ...original, status: 'In Discussion', version: 2 }
  const before = JSON.stringify([original, draft, latest])
  assert.deepEqual(mergeReviewedEdits(fields, original, draft, latest), { ...latest, name: 'My edit' })
  assert.equal(JSON.stringify([original, draft, latest]), before)
})

test('overlapping edits require explicit choices and nested contact changes are preserved', () => {
  const original = { name: 'Original', status: 'Interested', contacts: [{ name: 'HR' }] }
  const draft = { ...original, name: 'Mine', contacts: [{ name: 'My contact' }] }
  const latest = { ...original, name: 'Latest', contacts: [{ name: 'Latest contact' }] }
  assert.equal(compareRecordEdits(fields, original, draft, latest).filter(field => field.conflict).length, 2)
  assert.throws(() => mergeReviewedEdits(fields, original, draft, latest), /Choose/)
  assert.throws(() => mergeReviewedEdits(fields, original, draft, latest, { name: 'mine' }), /Choose/)
  assert.deepEqual(mergeReviewedEdits(fields, original, draft, latest, { name: 'latest', contacts: 'mine' }), { ...latest, contacts: draft.contacts })
  assert.equal(compareRecordEdits(fields, original, draft, draft).some(field => field.conflict), false)
})

test('production conflict migration preserves definitions and grants and rejects all three stale writes', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  for (const file of ['20261019105523_business_development_crm.sql', '20261020042221_crm_optional_contact_details.sql', '20261021090008_crm_organisation_summary.sql']) await db.exec(await migration(file))
  const snapshot = async () => (await db.query("select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition,proacl::text as grants,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('update_assigned_candidate','set_assigned_candidate_status','crm_save') order by proname")).rows
  const before = await snapshot()
  await db.exec(await migration('20261120204725_stop_business_conflict_retries.sql'))
  const after = await snapshot()
  assert.equal(after.length, 3)
  assert.deepEqual(after, before.map(row => ({ ...row, definition: row.definition.replaceAll("errcode='40001'", "errcode='PT409'") })))
  await db.exec(await migration('20261120204725_stop_business_conflict_retries.sql'))
  assert.deepEqual(await snapshot(), after)
  const assignment = await assign(db, 9911)
  const crm = (await db.query('select crm_save($1,null,null,$2) as data', [CONSULTANT, { organisation_name: 'Conflict fixture', contacts: [{ name: 'HR' }] }])).rows[0].data
  const readRows = async () => (await db.query('select to_jsonb(a) as data from assigned_candidates a union all select to_jsonb(c) from crm_clients c')).rows
  const originalRows = await readRows()
  for (const [sql, args] of [
    ['select update_assigned_candidate($1,$2,$3,$4)', [ADMIN, assignment.id, { full_name: 'Must not save' }, 0]],
    ['select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, assignment.id, 'Interested', 0]],
    ['select crm_save($1,$2,$3,$4)', [CONSULTANT, crm.id, 0, { status: 'Won', comment: 'Must not create history' }]]
  ]) await assert.rejects(db.query(sql, args), error => error.code === 'PT409')
  assert.deepEqual(await readRows(), originalRows)
  assert.equal((await db.query('select count(*)::int as count from crm_comments')).rows[0].count, 0)
})
