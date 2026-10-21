const test = require('node:test')
const assert = require('node:assert/strict')
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
  await assert.rejects(db.query('select set_assigned_candidate_status($1,$2,$3,$4)', [CONSULTANT, own.id, 'Not Relevant', before.version]), error => error.code === '40001')
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
