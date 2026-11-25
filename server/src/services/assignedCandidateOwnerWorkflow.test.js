const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createDatabase, assign, CONSULTANT, OTHER, INACTIVE } = require('../../test-support/assignedCandidatesSchema.cjs')

test('status-only RPC allows assignees without management access and preserves protected fields', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const own = await assign(db, 951)
  const other = await assign(db, 952, { consultant: OTHER })
  const inactive = await assign(db, 953)
  const before = (await db.query('select * from assigned_candidates where id=$1', [own.id])).rows[0]
  assert.equal((await db.query("select private.consultant_resource_actor_allowed($1,'assigned_candidates_manage') as allowed", [CONSULTANT])).rows[0].allowed, false)
  const saved = (await db.query('select set_assigned_candidate_status($1,$2,$3,$4) as result', [CONSULTANT, own.id, 'Interested', before.version])).rows[0].result
  assert.equal(saved.status, 'Interested')
  assert.equal(Number(saved.version), Number(before.version) + 1)
  for (const key of ['full_name','mobile_number','client_id','job_id','assigned_consultant_id','upload_id','added_at','candidate_id','association_id']) assert.deepEqual(saved[key], before[key])
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, other.id, 'Interested', 1]), error => error.code === 'P0002')
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, own.id, 'Not Relevant', before.version]), error => error.code === 'PT409')
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, own.id, 'Hired', saved.version]), error => error.code === '22023')
  await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [CONSULTANT, own.id, { full_name: 'Unauthorized edit' }, saved.version]), error => error.code === '42501')
  await db.query('update assigned_candidates set assigned_consultant_id=$1 where id=$2', [OTHER, own.id])
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, own.id, 'Not Relevant', saved.version]), error => error.code === 'P0002')
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [INACTIVE, inactive.id, 'Interested', 1]), error => error.code === '42501')
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [OTHER, other.id, 'Interested', 1]), /permission denied/)
    await db.exec('reset role')
  }
})

test('Overall editing is enforced in PostgreSQL, revokes immediately and retains conflict and browser-role protection', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const row = await assign(db, 954, { consultant: OTHER })
  await db.query("update page_view_permissions set allowed_user_ids=$1 where page_key='assigned_candidates_overall'", [[CONSULTANT, INACTIVE]])
  const readDefinitions = async () => (await db.query("select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition,proacl::text as grants,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('set_assigned_candidate_status','update_assigned_candidate','transfer_assigned_candidate') order by proname")).rows
  const definitions = await readDefinitions()
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../../supabase/migrations/20261120212223_assigned_candidates_overall_editing.sql'), 'utf8'))
  assert.deepEqual(await readDefinitions(), definitions)
  for (const fn of definitions) {
    assert.equal(fn.prosecdef, false)
    assert.match(fn.definition, /assigned_candidates_overall/)
    if (fn.signature.startsWith('transfer_assigned_candidate')) assert.match(fn.definition, /Candidate CVs changed during verification/)
    else assert.doesNotMatch(fn.definition, /errcode='40001'/)
    assert.doesNotMatch(fn.grants, /authenticated|anon/)
  }
  const updated = (await db.query('select update_assigned_candidate($1,$2,$3,$4) as result', [CONSULTANT, row.id, { full_name: 'Overall edited record' }, 1])).rows[0].result
  assert.equal(updated.full_name, 'Overall edited record')
  const status = (await db.query('select set_assigned_candidate_status($1,$2,$3,$4) as result', [CONSULTANT, row.id, 'In Discussion', updated.version])).rows[0].result
  assert.equal(status.status, 'In Discussion')
  await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [CONSULTANT, row.id, { full_name: 'Stale write' }, 1]), error => error.code === 'PT409')
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [INACTIVE, row.id, 'Interested', status.version]), error => error.code === '42501')
  await db.exec(`select set_config('request.jwt.claim.sub','${OTHER}',false)`)
  await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [CONSULTANT, row.id, {}, status.version]), error => error.code === '42501')
  await db.exec("select set_config('request.jwt.claim.sub','',false)")
  await db.query("update page_view_permissions set allowed_user_ids='{}' where page_key='assigned_candidates_overall'")
  await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [CONSULTANT, row.id, {}, status.version]), error => error.code === '42501')
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, row.id, 'Interested', status.version]), error => error.code === 'P0002')
  assert.equal((await db.query('select full_name from assigned_candidates where id=$1', [row.id])).rows[0].full_name, 'Overall edited record')
})
