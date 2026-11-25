const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument } = require('pdf-lib')
const { createDatabase, assign, payload, association, CONSULTANT, ADMIN, id } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { createCvBrandingService } = require('./cvBranding')
const { createAssignedCvTransferService } = require('./assignedCvTransfer')
const { cleanupAssignedCvs } = require('./assignedCandidateCv')
const { hash } = require('./cvBranding')

async function pdf(text = 'Synthetic CV') {
  const doc = await PDFDocument.create()
  doc.addPage().drawText(text)
  return Buffer.from(await doc.save())
}

test('durable transfer brands only the requested legacy CV, survives retry and deduplicates secondary source bytes', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db)
  let transfers
  const branding = createCvBrandingService({ supabase: adapter, runTransfers: () => transfers.run(), logger: { error() {} } })
  transfers = createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } })
  const source = await pdf()
  const row = await assign(db, 930, { status: 'Interested' })
  const upload = (await db.query('select * from assigned_candidate_uploads where id=$1', [row.upload_id])).rows[0]
  adapter.objects.set(upload.cv_storage_path, source)
  await db.query("insert into candidates(id,full_name,mobile_number,cv_storage_path,cv_attachments) values($1,'Synthetic destination','1111111111','history/unrelated.pdf',$2)",
    [id(931), JSON.stringify([{ path: 'history/secondary.pdf', name: 'Different filename.pdf' }])])
  adapter.objects.set('history/unrelated.pdf', await pdf('Unrelated historical CV'))
  adapter.objects.set('history/secondary.pdf', source)
  const candidate = { ...payload(930), mobile_number: '1111111111' }
  const input = { id: row.id, actorId: CONSULTANT, candidate, association: association(), existingId: id(931), upload }
  const [first, repeated] = await Promise.all([transfers.enqueue(input), transfers.enqueue(input)])
  assert.equal(first.assignment_id, repeated.assignment_id)
  await transfers.run()
  assert.equal((await db.query('select added_at from assigned_candidates where id=$1', [row.id])).rows[0].added_at, null)
  assert.equal((await transfers.get(row.id)).status, 'pending')
  assert.equal(adapter.objects.has(upload.cv_storage_path), true)
  // A new service instance recovers the same persisted request after refresh/restart.
  const recovered = createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } })
  const target = (await recovered.get(row.id)).target_path
  await branding.run({ paths: [target] })
  await recovered.run()
  assert.equal((await recovered.get(row.id)).status, 'complete')
  const saved = (await db.query('select * from candidates where id=$1', [id(931)])).rows[0]
  assert.equal(saved.cv_attachments.length, 2)
  assert.equal(saved.cv_attachments.some(item => item.path === 'history/secondary.pdf'), false)
  assert.ok(saved.cv_attachments.some(item => item.path === target && item.file_hash === hash(source)))
  assert.ok(saved.cv_attachments.some(item => item.path === 'history/unrelated.pdf'))
  assert.equal((await db.query('select count(*)::int n from cv_branding_jobs')).rows[0].n, 1)
  await branding.assertReady('history/unrelated.pdf')
  assert.equal((await db.query('select count(*)::int n from cv_branding_jobs')).rows[0].n, 1)
  // Deleting the assigned record cannot delete the main candidate's result.
  await db.query('select delete_assigned_candidates($1,null,$2,false)', [ADMIN, [row.id]])
  await cleanupAssignedCvs(adapter)
  assert.equal(adapter.objects.has(target), true)
  assert.equal((await branding.getJob(target)).status, 'ready')
})

test('failed branding retains source and durable payload; retry produces one candidate', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db)
  let fail = true
  const branding = createCvBrandingService({ supabase: adapter, logger: { error() {} }, brandPdf: bytes => {
    if (fail) throw new Error('Synthetic render outage')
    return require('./cvBrandingPdf').brandCvPdf(bytes)
  } })
  const transfer = createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } })
  const row = await assign(db, 940, { status: 'Interested' })
  const upload = (await db.query('select * from assigned_candidate_uploads where id=$1', [row.upload_id])).rows[0]
  adapter.objects.set(upload.cv_storage_path, await pdf('Retry CV'))
  await transfer.enqueue({ id: row.id, actorId: CONSULTANT, candidate: payload(940), association: association(), upload })
  await transfer.run()
  const target = (await transfer.get(row.id)).target_path
  await branding.run({ paths: [target] })
  await db.query('update cv_branding_jobs set attempts=3 where target_path=$1', [target])
  await transfer.run()
  assert.equal((await transfer.get(row.id)).status, 'failed')
  assert.equal((await db.query('select count(*)::int n from candidates')).rows[0].n, 0)
  assert.equal(adapter.objects.has(upload.cv_storage_path), true)
  fail = false
  await transfer.retry(row.id)
  await branding.run({ paths: [target] })
  await Promise.all([transfer.run(), transfer.run()])
  assert.equal((await transfer.get(row.id)).status, 'complete')
  assert.equal((await db.query('select count(*)::int n from candidates')).rows[0].n, 1)
})

test('a damaged transfer output repairs only its reservation using the retained legacy source', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), branding = createCvBrandingService({ supabase: adapter })
  const transfer = createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } })
  const row = await assign(db, 945, { status: 'Interested' })
  const upload = (await db.query('select * from assigned_candidate_uploads where id=$1', [row.upload_id])).rows[0]
  const source = await pdf('Transfer output repair')
  adapter.objects.set(upload.cv_storage_path, source)
  await transfer.enqueue({ id: row.id, actorId: CONSULTANT, candidate: payload(945), association: association(), upload })
  await transfer.run()
  const target = (await transfer.get(row.id)).target_path
  await branding.run({ paths: [target] })
  adapter.objects.set(target, await pdf('Unbranded damaged output'))
  await transfer.run()
  assert.equal((await transfer.get(row.id)).status, 'pending')
  assert.equal((await branding.getJob(target)).status, 'queued')
  assert.deepEqual(adapter.objects.get(upload.cv_storage_path), source)
  await branding.run({ paths: [target] }); await transfer.run()
  assert.equal((await transfer.get(row.id)).status, 'complete')
  assert.ok(await branding.verifyReady(target))
})

test('large attachment lists compare every document across durable evidence batches', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), branding = createCvBrandingService({ supabase: adapter })
  const transfer = createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } })
  const docs = []
  for (let index = 0; index < 8; index++) {
    const path = `legacy/version-${index}.pdf`
    adapter.objects.set(path, await pdf(`Version ${index}`)); docs.push({ path, name: 'CV.pdf' })
  }
  await db.query("insert into candidates(id,full_name,mobile_number,cv_attachments) values($1,'Synthetic batch destination','2222222222',$2)", [id(948), JSON.stringify(docs)])
  const row = await assign(db, 949, { status: 'Interested' })
  const upload = (await db.query('select * from assigned_candidate_uploads where id=$1', [row.upload_id])).rows[0]
  adapter.objects.set(upload.cv_storage_path, adapter.objects.get(docs[7].path))
  await transfer.enqueue({ id: row.id, actorId: CONSULTANT, candidate: { ...payload(949), mobile_number: '2222222222' }, association: association(), existingId: id(948), upload })
  await transfer.run()
  const target = (await transfer.get(row.id)).target_path
  await branding.run({ paths: [target] }); await transfer.run()
  const request = await transfer.get(row.id)
  assert.equal(request.status, 'pending')
  assert.equal(request.candidate_payload._cv_identity_evidence.__complete, false)
  await createAssignedCvTransferService({ supabase: adapter, branding, logger: { error() {} } }).run()
  assert.equal((await transfer.get(row.id)).status, 'complete')
  const saved = (await db.query('select cv_attachments from candidates where id=$1', [id(948)])).rows[0].cv_attachments
  assert.equal(saved.length, 8)
  assert.ok(saved.some(doc => doc.path === target))
  assert.equal(saved.some(doc => doc.path === docs[7].path), false)
})
