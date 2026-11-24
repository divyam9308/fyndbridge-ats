const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument, StandardFonts, degrees, PDFName, PDFNumber, rgb } = require('pdf-lib')
const { createDatabase } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { createCvBrandingService, STAGING_BUCKET } = require('./cvBranding')
const { brandCvPdf } = require('./cvBrandingPdf')
const { OPACITY, INSET_PT, WIDTH_PT } = require('../../../shared/cvBranding.cjs')

async function fixturePdf(rotations = [0, 0]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const angle of rotations) {
    const p = doc.addPage([595, 842]); p.setRotation(degrees(angle))
    p.drawText('Fyndbridge Branding Test Candidate', { x: 40, y: 790, font, size: 18 })
    p.drawText('Original CV content must remain selectable and unchanged.', { x: 40, y: 740, font, size: 11 })
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

test('vector watermark preserves page geometry, rotation, original streams and 60% opacity', async () => {
  const input = await fixturePdf([0, 90, 180, 270])
  const result = await brandCvPdf(input)
  const before = await PDFDocument.load(input), after = await PDFDocument.load(result.bytes)
  assert.equal(result.pageCount, 4)
  assert.equal(OPACITY, .6); assert.equal(INSET_PT, 7.5); assert.equal(WIDTH_PT, 45 * 72 / 25.4)
  assert.equal(after.catalog.get(PDFName.of('FyndbridgeCVBranding')).decodeText(), 'fb1')
  for (let i = 0; i < 4; i++) {
    const original = before.getPage(i), branded = after.getPage(i)
    assert.deepEqual(branded.getCropBox(), original.getCropBox())
    assert.deepEqual(branded.getMediaBox(), original.getMediaBox())
    assert.deepEqual(branded.getRotation(), original.getRotation())
    const old = original.node.Contents(), added = branded.node.Contents()
    for (let j = 0; j < old.size(); j++) {
      const bytes = before.context.lookup(old.get(j)).getContents()
      assert.ok(added.asArray().some(ref => Buffer.from(after.context.lookup(ref).getContents()).equals(Buffer.from(bytes))))
    }
    const states = branded.node.Resources().lookup(PDFName.of('ExtGState'))
    assert.ok(states.values().some(ref => states.context.lookup(ref).lookup(PDFName.of('ca'), PDFNumber).asNumber() === .6))
  }
})

test('durable branding queue protects originals, retries safely, cleans up and enforces private access', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db), logs = []
  const service = createCvBrandingService({ supabase: adapter, logger: { error: (...args) => logs.push(args) } })
  const buffer = await fixturePdf()
  const upload = () => service.stage({ buffer, originalname: 'Candidate.pdf', mimetype: 'application/pdf' })

  await t.test('queued originals are private and opening is locked until verified output replaces them', async () => {
    const file = await upload(), queued = await service.getJob(file.path)
    assert.equal(queued.status, 'queued')
    assert.ok(adapter.buckets.get(STAGING_BUCKET).has(queued.source_path))
    assert.equal(adapter.objects.has(file.path), false)
    await assert.rejects(service.assertReady(file.path), error => error.statusCode === 423)
    await service.run({ paths: [file.path] })
    const ready = await service.getJob(file.path)
    assert.equal(ready.status, 'ready'); assert.equal(ready.source_path, null); assert.equal(ready.page_count, 2)
    assert.equal(adapter.buckets.get(STAGING_BUCKET).has(queued.source_path), false)
    assert.ok(adapter.objects.has(file.path)); await service.assertReady(file.path)
    assert.equal((await service.run({ paths: [file.path] })).processed, 0)
    assert.notDeepEqual(adapter.objects.get(file.path), buffer)
  })
  await t.test('a failed render retains the private source and retry succeeds without duplicate stamping', async () => {
    let fail = true, calls = 0
    const processor = createCvBrandingService({ supabase: adapter, logger: { error() {} }, brandPdf: bytes => {
      calls++; if (fail) throw new Error('Synthetic render outage'); return brandCvPdf(bytes)
    } })
    const file = await upload(), queued = await service.getJob(file.path)
    await processor.run({ paths: [file.path] })
    assert.equal((await service.getJob(file.path)).status, 'failed')
    assert.equal((await processor.statuses([file.path]))[0].status, 'retrying')
    assert.ok(adapter.buckets.get(STAGING_BUCKET).has(queued.source_path))
    await assert.rejects(processor.assertReady(file.path), error => error.statusCode === 423)
    fail = false; await processor.retry([file.path]); await processor.run({ paths: [file.path] })
    assert.equal((await service.getJob(file.path)).status, 'ready'); assert.equal(calls, 2)
  })
  await t.test('source deletion failure keeps opening locked; a cleanup retry reuses the verified PDF', async () => {
    let calls = 0, fail = true
    const processor = createCvBrandingService({ supabase: adapter, logger: { error() {} }, brandPdf: bytes => { calls++; return brandCvPdf(bytes) } })
    const file = await upload(), queued = await service.getJob(file.path), originalFrom = adapter.storage.from
    adapter.storage.from = bucket => ({ ...originalFrom(bucket), ...(bucket === STAGING_BUCKET ? {
      remove: async paths => fail ? { error: new Error('Synthetic storage outage') } : originalFrom(bucket).remove(paths)
    } : {}) })
    await processor.run({ paths: [file.path] })
    assert.equal((await service.getJob(file.path)).status, 'finalizing')
    assert.ok(adapter.buckets.get(STAGING_BUCKET).has(queued.source_path))
    await assert.rejects(processor.assertReady(file.path), error => error.statusCode === 423)
    fail = false; await db.query("update cv_branding_jobs set next_attempt_at=now() where target_path=$1", [file.path])
    await processor.run({ paths: [file.path] }); adapter.storage.from = originalFrom
    assert.equal((await service.getJob(file.path)).status, 'ready'); assert.equal(calls, 1)
  })
  await t.test('deleting a record during processing cancels the worker and cannot recreate its CV', async () => {
    let release, started
    const begun = new Promise(resolve => { started = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const processor = createCvBrandingService({ supabase: adapter, brandPdf: async bytes => { started(); await gate; return brandCvPdf(bytes) } })
    const file = await upload(), queued = await service.getJob(file.path)
    const work = processor.run({ paths: [file.path] }); await begun
    await processor.cancel([file.path]); release(); await work
    assert.equal((await service.getJob(file.path)).status, 'cancelled')
    assert.equal(adapter.objects.has(file.path), false)
    assert.equal(adapter.buckets.get(STAGING_BUCKET).has(queued.source_path), false)
  })
  await t.test('claim leases stop concurrent workers from claiming the same job', async () => {
    const file = await upload()
    const a = await adapter.rpc('claim_cv_branding_jobs', { p_paths: [file.path], p_limit: 1 })
    const b = await adapter.rpc('claim_cv_branding_jobs', { p_paths: [file.path], p_limit: 1 })
    assert.equal(a.error, undefined); assert.equal(a.data.length, 1); assert.equal(b.data.length, 0)
    await service.cancel([file.path])
  })
  await t.test('storage interruptions keep a staging reservation retryable', async () => {
    const targetPath = `branded/fb1/retry-${Date.now()}.pdf`, originalFrom = adapter.storage.from
    let fail = true
    adapter.storage.from = bucket => ({ ...originalFrom(bucket), upload: async (...args) => {
      if (fail) return { error: new Error('Synthetic storage outage') }; return originalFrom(bucket).upload(...args)
    } })
    await assert.rejects(service.stage({ buffer, originalname: 'Retry.pdf' }, { targetPath }))
    assert.equal((await service.getJob(targetPath)).status, 'staging')
    fail = false
    await service.stage({ buffer, originalname: 'Retry.pdf' }, { targetPath }); adapter.storage.from = originalFrom
    await service.run({ paths: [targetPath] }); assert.equal((await service.getJob(targetPath)).status, 'ready')
  })
  await t.test('Word input goes through the converter before vector stamping and is stored only as PDF', async () => {
    let converted = 0
    const word = createCvBrandingService({ supabase: adapter, convertWord: async (bytes, name) => { assert.equal(name, 'Word.docx'); assert.equal(bytes.toString(), 'Word fixture'); converted++; return buffer } })
    const file = await word.stage({ buffer: Buffer.from('Word fixture'), originalname: 'Word.docx' })
    assert.equal(file.fileName, 'Word.pdf'); assert.equal(file.contentType, 'application/pdf')
    await word.run({ paths: [file.path] }); assert.equal(converted, 1); await word.assertReady(file.path)
  })
  await t.test('authenticated users cannot read job details or claim jobs directly', async () => {
    await db.exec('set role authenticated')
    try {
      await assert.rejects(db.query('select * from cv_branding_jobs'), error => error.code === '42501')
      await assert.rejects(db.query('select claim_cv_branding_jobs(null,1)'), error => error.code === '42501')
    } finally { await db.exec('reset role') }
  })
  await t.test('legacy CVs stay outside the new upload pipeline', async () => { await service.assertReady('existing-original.pdf') })
  await t.test('abandoned uploads expire without deleting a CV still referenced by a candidate', async () => {
    const abandoned = await upload(), kept = await upload()
    await db.query("update cv_branding_jobs set created_at=now()-interval '2 days' where target_path=any($1)", [[abandoned.path, kept.path]])
    await db.query("insert into candidates(full_name,mobile_number,cv_attachments) values('Retained branding fixture','9999999999',$1)", [JSON.stringify([{ path: kept.path }])])
    assert.equal((await service.reap()).removed, 1)
    assert.equal((await service.getJob(abandoned.path)).source_path, null)
    assert.equal((await service.getJob(abandoned.path)).status, 'cancelled')
    assert.equal((await service.getJob(kept.path)).status, 'queued')
  })
})

test('watermark remains visible on an opaque page without washing out black text', async () => {
  const { loadPdfDocument } = require('./resumeParser')
  const { createCanvas } = require('@napi-rs/canvas')
  const doc = await PDFDocument.create(), page = doc.addPage([300, 180])
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 180, color: rgb(1, 1, 1) })
  page.drawText('Readable black CV text', { x: 14, y: 158, size: 13 })
  const original = await doc.save(), branded = await brandCvPdf(original)
  const render = async bytes => {
    const pdf = await loadPdfDocument(bytes)
    try {
      const p = await pdf.getPage(1), viewport = p.getViewport({ scale: 2 })
      const canvas = createCanvas(viewport.width, viewport.height)
      await p.render({ canvas, viewport }).promise
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    } finally { await pdf.destroy() }
  }
  const before = await render(original), after = await render(branded.bytes)
  let changes = 0, blackPixels = 0
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] === 0 && before[i + 1] === 0 && before[i + 2] === 0 && before[i + 3] === 255) {
      blackPixels++; assert.deepEqual([...after.slice(i, i + 4)], [0, 0, 0, 255])
    }
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) changes++
  }
  assert.ok(blackPixels > 100); assert.ok(changes > 100)
})
