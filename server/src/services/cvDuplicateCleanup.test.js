const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument } = require('pdf-lib')
const { createDatabase, id } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { planCandidateCvCleanup, applyCandidateCvCleanup } = require('./cvDuplicateCleanup')
const { mergeUploadedCvAttachments } = require('./cvUploadedAttachments')
const { createCvBrandingService, hash } = require('./cvBranding')
const { removeCvIfUnreferenced, reapPendingCvDeletions } = require('./cvStorageIntegrity')

async function pdf(text) { const doc = await PDFDocument.create(); doc.addPage().drawText(text); return Buffer.from(await doc.save()) }

test('reviewed duplicate cleanup prefers valid branded content, preserves versions and deletes no storage', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), source = await pdf('Synthetic duplicate')
  const branding = createCvBrandingService({ supabase: adapter })
  const staged = await branding.stage({ buffer: source, originalname: 'Original.pdf' })
  await branding.run({ paths: [staged.path] })
  const documents = [{ path: 'legacy/a.pdf', name: 'Different name.pdf' }, { path: staged.path, name: staged.fileName },
    { path: 'legacy/updated.pdf', name: 'Original.pdf', file_hash: hash(source) }, { path: 'legacy/missing.pdf', file_hash: hash(source) }]
  adapter.objects.set('legacy/a.pdf', source)
  adapter.objects.set('legacy/updated.pdf', await pdf('Genuinely different source with stale declared hash'))
  await db.query("insert into candidates(id,full_name,mobile_number,cv_storage_path,cv_attachments) values($1,'Synthetic cleanup','1234567890','legacy/a.pdf',$2)", [id(970), JSON.stringify(documents)])
  const get = async () => (await db.query('select * from candidates where id=$1', [id(970)])).rows[0]
  const plan = await planCandidateCvCleanup(adapter, await get(), { hashMissing: true })
  assert.equal(plan.removed.length, 1)
  assert.equal(plan.removed[0].retained_path, staged.path)
  assert.equal(plan.retained.length, 3)
  assert.equal(plan.ambiguous[0].path, 'legacy/missing.pdf')
  assert.equal((await get()).cv_attachments.length, 4)
  const objectsBefore = [...adapter.objects.keys()]
  await applyCandidateCvCleanup(adapter, plan)
  assert.equal((await get()).cv_storage_path, staged.path)
  assert.equal((await get()).cv_attachments.length, 3)
  assert.deepEqual([...adapter.objects.keys()], objectsBefore)
  await assert.rejects(applyCandidateCvCleanup(adapter, plan), /changed/)
  await db.query('update candidates set cv_attachments=cv_attachments||jsonb_build_array(cv_attachments->0) where id=$1', [id(970)])
  const repeatedPath = await planCandidateCvCleanup(adapter, await get(), { hashMissing: true })
  assert.ok(repeatedPath.removed.some(item => item.same_path_reference && item.path === staged.path && item.retained_path === staged.path))
  assert.equal(repeatedPath.potentially_unreferenced_after_apply.includes(staged.path), false)
  await applyCandidateCvCleanup(adapter, repeatedPath)
  assert.equal((await get()).cv_attachments.length, 3)
})

test('new upload replaces a verified identical legacy source and preserves different bytes with stale hashes', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), source = await pdf('Original source')
  const branding = createCvBrandingService({ supabase: adapter })
  adapter.objects.set('old.pdf', source)
  adapter.objects.set('different.pdf', await pdf('Updated source'))
  const staged = await branding.stage({ buffer: source, originalname: 'new-name.pdf' })
  const incoming = { path: staged.path, name: staged.fileName, file_hash: staged.fileHash }
  const merged = await mergeUploadedCvAttachments(adapter,
    [{ path: 'old.pdf', name: 'old.pdf' }, { path: 'different.pdf', name: 'old.pdf', file_hash: hash(source) }], [incoming])
  assert.deepEqual(merged.map(item => item.path), [staged.path, 'different.pdf'])
  const second = await branding.stage({ buffer: source, originalname: 'second-name.pdf' })
  const twoNew = await mergeUploadedCvAttachments(adapter, [], [incoming, { path: second.path, file_hash: second.fileHash }])
  assert.equal(twoNew.length, 1)
  const pendingReupload = await mergeUploadedCvAttachments(adapter, [incoming], [{ path: second.path, file_hash: second.fileHash }])
  assert.equal(pendingReupload.length, 1)
})

test('exhausted interrupted branding is retryable and pending storage deletions recover', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), branding = createCvBrandingService({ supabase: adapter })
  const staged = await branding.stage({ buffer: await pdf('Worker restart'), originalname: 'CV.pdf' })
  await db.query("update cv_branding_jobs set status='processing',attempts=3,lease_until=now()-interval '1 second' where target_path=$1", [staged.path])
  await branding.run({ paths: [staged.path] })
  assert.equal((await branding.getJob(staged.path)).status, 'failed')
  await branding.retry([staged.path]); await branding.run({ paths: [staged.path] })
  assert.equal((await branding.getJob(staged.path)).status, 'ready')
  adapter.objects.set('orphan.pdf', Buffer.from('synthetic object'))
  const original = adapter.storage.from
  adapter.storage.from = bucket => ({ ...original(bucket), remove: async () => ({ error: new Error('Storage outage') }) })
  await assert.rejects(removeCvIfUnreferenced(adapter, 'orphan.pdf'), /Storage outage/)
  adapter.storage.from = original
  assert.equal((await db.query("select removed_at from cv_storage_deletion_claims where path='orphan.pdf'")).rows[0].removed_at, null)
  await reapPendingCvDeletions(adapter)
  assert.equal(adapter.objects.has('orphan.pdf'), false)
  assert.ok((await db.query("select removed_at from cv_storage_deletion_claims where path='orphan.pdf'")).rows[0].removed_at)
})
