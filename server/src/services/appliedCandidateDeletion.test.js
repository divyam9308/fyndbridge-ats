const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { application, applicationId, USER_ID, OPERATION_ID, memoryDatabase } = require('../../test-support/appliedCandidatesMemory.cjs')
const { MAX_DELETE_BATCH, DELETE_CONCURRENCY, validateBulkDeletion, bulkDeleteApplications } = require('./appliedCandidateDeletion')

const body = ids => ({ application_ids: ids, operation_id: OPERATION_ID })

test('bulk delete rejects invalid shapes, UUIDs, duplicates and oversized batches before touching data', async () => {
  for (const invalid of [null, [], {}, body([]), body(['bad']), body([null]), body([applicationId(1), applicationId(1).toUpperCase()]), body(Array.from({ length: MAX_DELETE_BATCH + 1 }, (_, i) => applicationId(i))), { ...body([applicationId(1)]), surprise: true }, { ...body([applicationId(1)]), operation_id: 'bad' }]) {
    assert.throws(() => validateBulkDeletion(invalid), error => error.statusCode === 400)
  }
  const db = memoryDatabase([application(1)])
  await assert.rejects(bulkDeleteApplications(db, body(['bad']), USER_ID), error => error.statusCode === 400)
  assert.equal(db.operations.length, 0)
})

test('mixed batch returns accurate outcomes, preserves adopted records, and records receipts outside staging', async () => {
  const db = memoryDatabase([application(1), application(2, { application_status: 'converting', processing_token: 'conversion' }), application(3), application(4, { application_status: 'converted', converted_candidate_id: 'master' })])
  db.storageFailures.add(applicationId(3))
  const result = await bulkDeleteApplications(db, body([1, 2, 3, 4, 5].map(applicationId)), USER_ID)
  assert.deepEqual(result.summary, { deleted: 1, skipped: 3, failed: 1 })
  assert.deepEqual(result.results.map(item => item.code), ['deleted', 'ineligible', 'storage_cleanup_failed', 'ineligible', 'not_found'])
  assert.equal(db.tables.public_applications.find(row => row.id === applicationId(3)).application_status, 'rejected')
  assert.equal(db.storageObjects.has(`${applicationId(3)}/resume.pdf`), true)
  assert.deepEqual(db.removedPaths, [`${applicationId(1)}/resume.pdf`])
  assert.deepEqual(db.masterCandidates, [{ id: 'master-candidate', cv_storage_path: 'adopted-master-cv.pdf' }])
  assert.deepEqual([...db.adoptedObjects], ['adopted-master-cv.pdf'])
  const receipt = db.tables.public_application_deletions.find(row => row.application_id === applicationId(1))
  assert.equal(receipt.status, 'deleted')
  assert.equal(receipt.requested_by, USER_ID)
  assert.ok(receipt.cleanup_started_at && receipt.deleted_at)
  assert.equal(Object.hasOwn(receipt, 'full_name'), false)
  assert.equal(db.tables.public_application_deletions.find(row => row.application_id === applicationId(3)).status, 'failed')
})

test('storage failure keeps an audit receipt and retry cleans up rejected rows idempotently', async () => {
  const db = memoryDatabase([application(1), application(2)])
  db.storageFailures.add(applicationId(2))
  const request = body([applicationId(1), applicationId(2)])
  assert.deepEqual((await bulkDeleteApplications(db, request, USER_ID)).summary, { deleted: 1, skipped: 0, failed: 1 })
  db.storageFailures.clear()
  const retry = await bulkDeleteApplications(db, request, USER_ID)
  assert.deepEqual(retry.summary, { deleted: 2, skipped: 0, failed: 0 })
  assert.equal(retry.results[0].code, 'already_deleted')
  assert.equal(db.removedPaths.filter(path => path.startsWith(applicationId(1))).length, 1)
  assert.ok(db.tables.public_application_deletions.every(row => row.status === 'deleted'))
  assert.equal(db.tables.public_applications.length, 0)
})

test('conversion wins a pending-status race and no CV cleanup occurs', async () => {
  const db = memoryDatabase([application(1)])
  db.beforeExecute = state => {
    if (state.table === 'public_applications' && state.kind === 'update') {
      db.tables.public_applications[0].application_status = 'converting'
      db.tables.public_applications[0].processing_token = 'race-winner'
    }
  }
  const result = await bulkDeleteApplications(db, body([applicationId(1)]), USER_ID)
  assert.deepEqual(result.summary, { deleted: 0, skipped: 1, failed: 0 })
  assert.equal(db.removedPaths.length, 0)
  assert.equal(db.tables.public_applications[0].processing_token, 'race-winner')
})

test('adopted IDs and unrelated storage paths are never removed even on otherwise pending rows', async () => {
  const db = memoryDatabase([application(1, { cv_storage_path: 'another-application/resume.pdf' }), application(2, { converted_candidate_id: 'master' }), application(3, { converted_association_id: 'association' })])
  const result = await bulkDeleteApplications(db, body([1, 2, 3].map(applicationId)), USER_ID)
  assert.deepEqual(result.summary, { deleted: 0, skipped: 2, failed: 1 })
  assert.equal(result.results[0].code, 'invalid_staged_cv')
  assert.equal(db.removedPaths.length, 0)
  assert.equal(db.tables.public_applications.length, 3)
})

test('database failure after CV cleanup remains retryable, including an interrupted receipt update', async () => {
  const db = memoryDatabase([application(1)])
  db.rowDeleteFailures.add(applicationId(1))
  assert.equal((await bulkDeleteApplications(db, body([applicationId(1)]), USER_ID)).summary.failed, 1)
  assert.equal(db.tables.public_applications[0].application_status, 'rejected')
  db.rowDeleteFailures.clear()
  assert.equal((await bulkDeleteApplications(db, body([applicationId(1)]), USER_ID)).summary.deleted, 1)
  const receipt = db.tables.public_application_deletions[0]
  receipt.status = 'processing' // Simulate process exit after deletion but before receipt completion.
  receipt.deleted_at = null
  const recovered = await bulkDeleteApplications(db, body([applicationId(1)]), USER_ID)
  assert.equal(recovered.results[0].code, 'already_deleted')
  assert.equal(receipt.status, 'deleted')
})

test('audit persistence failure prevents irreversible storage cleanup', async () => {
  const db = memoryDatabase([application(1)])
  db.beforeExecute = state => { if (state.table === 'public_application_deletions') throw new Error('Audit unavailable') }
  const result = await bulkDeleteApplications(db, body([applicationId(1)]), USER_ID)
  assert.equal(result.summary.failed, 1)
  assert.equal(db.removedPaths.length, 0)
  assert.equal(db.tables.public_applications[0].application_status, 'pending')
})

test('bounded concurrency processes each UUID exactly once and duplicate concurrent requests are safe', async () => {
  const db = memoryDatabase(Array.from({ length: 15 }, (_, index) => application(index)))
  db.removeDelay = 10
  const result = await bulkDeleteApplications(db, body(Array.from({ length: 15 }, (_, i) => applicationId(i))), USER_ID)
  assert.equal(result.summary.deleted, 15)
  assert.equal(db.maxActiveRemovals, DELETE_CONCURRENCY)
  const raceDb = memoryDatabase([application(1)])
  raceDb.removeDelay = 5
  const concurrent = await Promise.all([bulkDeleteApplications(raceDb, body([applicationId(1)]), USER_ID), bulkDeleteApplications(raceDb, body([applicationId(1)]), USER_ID)])
  assert.equal(concurrent.some(batch => batch.summary.deleted === 1), true)
  assert.equal(raceDb.tables.public_application_deletions[0].status, 'deleted')
  assert.equal(raceDb.tables.public_applications.length, 0)
})

test('real bulk route enforces authentication and fresh page access, including ordinary recruiters', async t => {
  const db = memoryDatabase([application(1)])
  const adminPath = require.resolve('./supabaseAdmin')
  require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: db }
  const router = require('../routes/appliedCandidates')
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => { if (req.headers.authorization === 'Bearer synthetic-recruiter') req.user = { id: USER_ID }; next() })
  app.use('/api/applied-candidates', router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}/api/applied-candidates`
  const request = (payload, authenticated = true) => fetch(`${url}/bulk-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer synthetic-recruiter' } : {}) }, body: JSON.stringify(payload) })
  assert.equal((await request(body([applicationId(1)]), false)).status, 401)
  db.tables.page_view_permissions = [{ page_key: 'applied_candidates', view_permission: 'super_admin_only' }]
  assert.equal((await request(body([applicationId(1)]))).status, 403)
  assert.equal(db.removedPaths.length, 0)
  db.tables.page_view_permissions = [{ page_key: 'applied_candidates', view_permission: 'everyone' }]
  assert.equal((await request(body(['invalid']))).status, 400)
  const response = await request(body([applicationId(1)]))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).summary, { deleted: 1, skipped: 0, failed: 0 })
  assert.equal((await fetch(`${url}/deletion-failures`, { headers: { Authorization: 'Bearer synthetic-recruiter' } })).status, 404)
})
