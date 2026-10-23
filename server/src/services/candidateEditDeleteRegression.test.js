const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createDatabase, ADMIN, CLIENT, JOB } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')

test('Candidates edit sends cleared text fields while create still omits empty defaults', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/pages/CandidatesPage.jsx'), 'utf8')
  const start = source.indexOf('    const formBody = new FormData()')
  const end = source.indexOf('    const manualCvFiles', start)
  assert.ok(start >= 0 && end > start)
  for (const update of [true, false]) {
    const context = { FormData, update, body: { full_name: 'Test Example', email: '', notes: '', education: '', city: '', unused: undefined } }
    vm.createContext(context)
    vm.runInContext(source.slice(start, end) + '\nglobalThis.result = formBody', context)
    for (const field of ['email', 'notes', 'education', 'city']) {
      assert.equal(context.result.has(field), update)
      if (update) assert.equal(context.result.get(field), '')
    }
    assert.equal(context.result.has('unused'), false)
  }
})

test('Candidates clears persisted fields and reports both candidate deletion failures', async t => {
  const db = await createDatabase()
  t.after(() => db.close())
  const adapter = databaseAdapter(db)
  const target = require.resolve('./supabaseAdmin')
  require.cache[target] = { id: target, filename: target, loaded: true, exports: adapter }
  const controller = require('../controllers/candidateController')
  const candidate = (await db.query("insert into candidates(full_name,mobile_number,email,education) values('Test Example','9876543210','example@example.test','Old education') returning id")).rows[0]
  const association = (await db.query("insert into candidate_associations(candidate_id,client_id,job_id,status,notes) values($1,$2,$3,'Interested','Old notes') returning id", [candidate.id, CLIENT, JOB])).rows[0]
  const response = () => ({ code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
  const res = response()
  await controller.updateCandidate({ user: { id: ADMIN }, params: { id: association.id }, body: { status: 'Interested', email: '', education: '', notes: '' } }, res)
  assert.equal(res.code, 200, JSON.stringify(res.body))
  assert.deepEqual((await db.query('select email,education from candidates where id=$1', [candidate.id])).rows[0], { email: null, education: null })
  assert.equal((await db.query('select notes from candidate_associations where id=$1', [association.id])).rows[0].notes, null)

  const originalFrom = adapter.from.bind(adapter)
  let cleanupCalls = 0
  adapter.storage.from = () => ({ remove: async () => { cleanupCalls++; return { data: [] } } })
  adapter.from = table => {
    const query = originalFrom(table)
    if (table === 'candidates') query.delete = () => ({ eq: () => Promise.resolve({ error: new Error('Synthetic deletion failure') }) })
    return query
  }
  for (const id of [association.id, candidate.id]) {
    const result = response()
    await controller.deleteCandidate({ user: { id: ADMIN }, params: { id } }, result)
    assert.equal(result.code, 500)
    assert.ok(result.body.error)
    assert.equal((await db.query('select count(*)::int as n from candidates where id=$1', [candidate.id])).rows[0].n, 1)
  }
  assert.equal(cleanupCalls, 0)
})
