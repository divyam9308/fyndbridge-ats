const test = require('node:test')
const assert = require('node:assert/strict')
const { createDatabase, assign, id, CONSULTANT, OTHER, INACTIVE } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')

test('assignment editing repeats action grants, ownership, reference validation and optimistic concurrency', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), target = require.resolve('./supabaseAdmin')
  require.cache[target] = { id: target, filename: target, loaded: true, exports: adapter }
  const express = require('express'), app = express(); app.use(express.json())
  app.use((req, res, next) => { req.user = { id: CONSULTANT }; next() })
  app.use('/api/assigned-candidates', require('../routes/assignedCandidates'))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assigned-candidates${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { httpStatus: response.status, ...await response.json() }
  }
  const row = await assign(db, 901), colleague = await assign(db, 902, { consultant: OTHER })
  const current = async () => (await db.query('select * from assigned_candidates where id=$1', [row.id])).rows[0]
  const original = await current()
  const endpoints = [[`/${row.id}/consultant`, 'PATCH', { assigned_consultant_id: OTHER }], [`/${row.id}`, 'PATCH', { full_name: 'Edit', expected_version: 1 }], [`/${row.id}`, 'DELETE', {}]]
  for (const [path, method, body] of endpoints) assert.equal((await request(path, method, body)).httpStatus, 403)
  assert.equal((await request(`/${row.id}`)).httpStatus, 403)
  assert.equal((await request(`/${row.id}/cv`)).httpStatus, 200)
  await db.query("update page_view_permissions set allowed_user_ids=$1 where page_key='assigned_candidates_overall'", [[CONSULTANT]])
  assert.equal((await request('')).can_view_overall, true)
  assert.equal((await request(`/${colleague.id}/status`, 'PATCH', { status: 'Interested' })).httpStatus, 404)
  await db.query("update page_view_permissions set allowed_user_ids=$1 where page_key='assigned_candidates_manage'", [[CONSULTANT]])
  for (const [path, method, body] of [[`/${colleague.id}`, 'PATCH', { full_name: 'Denied', expected_version: 1 }], [`/${colleague.id}/consultant`, 'PATCH', { assigned_consultant_id: CONSULTANT }]]) assert.equal((await request(path, method, body)).httpStatus, 404)
  assert.equal((await request(`/${colleague.id}`, 'DELETE', {})).httpStatus, 403)
  const client = id(910), job = id(911)
  await db.query('insert into clients(id,name,client_name,client_display_id,client_group_id) values($1,$2,$2,$3,$1)', [client, 'Other Client', 'CL20'])
  await db.query('insert into jobs(id,client_id,title) values($1,$2,$3)', [job, client, 'Other Mandate'])
  const values = { full_name: 'Edited Assignment', mobile_number: '9876543210', client_id: client, job_id: job, status: 'Interested', assigned_consultant_id: CONSULTANT, expected_version: 1 }
  const saved = await request(`/${row.id}`, 'PATCH', values)
  assert.equal(saved.httpStatus, 200, JSON.stringify(saved))
  const after = await current()
  for (const key of ['full_name', 'mobile_number', 'client_id', 'job_id', 'status', 'assigned_consultant_id']) assert.equal(after[key], values[key])
  for (const key of ['assigned_at', 'created_at', 'assigned_by', 'upload_id', 'added_at', 'candidate_id', 'association_id']) assert.deepEqual(after[key], original[key])
  assert.equal(Number(after.version), 2); assert.ok(after.contacted_at)
  assert.equal((await request(`/${row.id}`, 'PATCH', values)).httpStatus, 409)
  const latest = await request(`/${row.id}`)
  assert.equal(latest.httpStatus, 200)
  assert.equal(Number(latest.data.version), 2)
  assert.equal(latest.data.upload_id, undefined)
  assert.equal((await request(`/${row.id}`, 'PATCH', { ...values, expected_version: 2, job_id: original.job_id })).httpStatus, 400)
  assert.equal((await request(`/${row.id}`, 'PATCH', { ...values, expected_version: 2, assigned_consultant_id: INACTIVE })).httpStatus, 409)
  for (const field of ['added_at', 'assigned_at', 'contacted_at', 'upload_id', 'candidate_id']) assert.equal((await request(`/${row.id}`, 'PATCH', { ...values, expected_version: 2, [field]: original[field] })).httpStatus, 400)
  assert.deepEqual(await current(), after)
  assert.equal((await request(`/${row.id}`, 'PATCH', { ...values, expected_version: 2, assigned_consultant_id: OTHER })).httpStatus, 200)
  assert.equal((await request(`/${row.id}/status`, 'PATCH', { status: 'Not Relevant' })).httpStatus, 404)
  assert.equal((await request(`/${row.id}`, 'DELETE', {})).httpStatus, 403)
  await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [CONSULTANT, row.id, '{}', 3]), error => error.code === 'P0002')
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select update_assigned_candidate($1,$2,$3,$4)', [OTHER, row.id, '{}', 3]), /permission denied/)
    await db.exec('reset role')
  }
})
