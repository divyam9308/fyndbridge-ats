const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument } = require('pdf-lib')
const { createDatabase, ADMIN, CONSULTANT, OTHER, CLIENT, JOB, assign } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')

test('real upload/status/open/delete routes enforce branding completion and remove test storage', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  const adapter = databaseAdapter(db)
  const key = require.resolve('./supabaseAdmin'); require.cache[key] = { id: key, filename: key, loaded: true, exports: adapter }
  const express = require('express'), app = express(); app.use(express.json())
  let user = ADMIN
  app.use((req, res, next) => { req.user = { id: user, email: 'test@example.test' }; next() })
  app.use('/api/candidates', require('../routes/candidates'))
  app.use('/api/resumes', require('../routes/resumes'))
  app.use('/api/assigned-candidates', require('../routes/assignedCandidates'))
  const server = app.listen(0); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const service = require('./cvBranding').cvBranding()
  // Control worker scheduling in this API test, then run the real persisted job.
  const scheduled = []; service.schedule = paths => scheduled.push(paths)
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Route test candidate'); const bytes = await pdf.save()
  const body = new FormData()
  for (const [field, value] of Object.entries({ full_name: 'CV Lifecycle Fixture', email: 'cv-lifecycle@example.test', mobile_number: '9999987654',
    experience_years: '10', notice_period: '30', open_to_relocate: 'true', skills: '["Accounting"]',
    current_salary: '1000000', expected_salary: '1200000', status: 'Interested', client_id: CLIENT, job_id: JOB,
    consultant_user_id: CONSULTANT, consultant_name: 'Test Consultant' })) body.append(field, value)
  body.append('cv_files', new Blob([bytes], { type: 'application/pdf' }), 'Route-test.pdf')
  const created = await fetch(base + '/api/candidates', { method: 'POST', body }); assert.equal(created.status, 201)
  const saved = await created.json()
  const candidate = (await db.query('select * from candidates where id=$1', [saved.candidate_id])).rows[0]
  const path = candidate.cv_storage_path, recordId = candidate.id
  assert.equal(candidate.cv_file_hash, require('node:crypto').createHash('sha256').update(bytes).digest('hex'))
  const open = () => fetch(base + '/api/resumes/open?' + new URLSearchParams({ path, record_id: recordId }))
  const status = items => fetch(base + '/api/resumes/branding-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
  await t.test('the original cannot be opened while queued, including a direct API request', async () => {
    assert.equal((await open()).status, 423)
    const result = await status([{ type: 'cv', recordId, path }]); assert.equal(result.status, 200)
    assert.equal((await result.json()).data[0].status, 'queued'); assert.deepEqual(scheduled, [[path]])
    assert.equal((await status([{ type: 'cv', recordId, path: 'branded/fb1/unrelated.pdf' }])).status, 403)
  })
  await t.test('only a verified PDF with the original removed is unlocked', async () => {
    await service.run({ paths: [path] })
    const job = await service.getJob(path)
    assert.equal(job.status, 'ready'); assert.equal(job.source_path, null)
    assert.equal(adapter.buckets.get('cv-branding-staging').size, 0)
    const opened = await open(); assert.equal(opened.status, 200)
    assert.match((await opened.json()).url, /protected/)
    const branded = await PDFDocument.load(adapter.objects.get(path)); assert.equal(branded.getPageCount(), 1)
  })
  await t.test('deleting the created record removes its branded file and cancels the job', async () => {
    const removed = await fetch(base + '/api/candidates/' + saved.association_id, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    assert.equal((await db.query('select count(*)::int as n from candidates where id=$1', [recordId])).rows[0].n, 0)
    assert.equal(adapter.objects.has(path), false)
    assert.equal((await service.getJob(path)).status, 'cancelled')
  })
  await t.test('assignment status cannot be read or retried by a different assignee', async () => {
    const assigned = await assign(db, 111, { consultant: CONSULTANT })
    const target = `assigned/${ADMIN}/${assigned.upload_id}-fb1.pdf`
    await service.stage({ buffer: Buffer.from(bytes), originalname: 'Assignment.pdf' }, { targetPath: target })
    await db.query('update assigned_candidate_uploads set cv_storage_path=$1 where id=$2', [target, assigned.upload_id])
    user = OTHER
    assert.equal((await status([{ type: 'assigned', recordId: assigned.id, path: target }])).status, 404)
    assert.equal((await fetch(base + '/api/assigned-candidates/' + assigned.id + '/cv')).status, 404)
    user = CONSULTANT
    assert.equal((await fetch(base + '/api/assigned-candidates/' + assigned.id + '/cv')).status, 423)
    assert.equal((await status([{ type: 'assigned', recordId: assigned.id, path: target }])).status, 200)
    await service.run({ paths: [target] })
    assert.equal((await fetch(base + '/api/assigned-candidates/' + assigned.id + '/cv')).status, 200)
  })
  await t.test('legacy primary and secondary CVs both authorize without initiating historical branding', async () => {
    user = ADMIN
    const record = await db.query("insert into candidates(full_name,mobile_number,cv_storage_path,cv_attachments) values('Synthetic legacy','1234512345','legacy-primary.pdf','[{\"path\":\"legacy-secondary.pdf\"}]') returning id")
    const id = record.rows[0].id
    const jobsBefore = (await db.query('select count(*)::int n from cv_branding_jobs')).rows[0].n
    for (const path of ['legacy-primary.pdf', 'legacy-secondary.pdf']) {
      adapter.objects.set(path, Buffer.from(bytes))
      const response = await fetch(base + '/api/resumes/open?' + new URLSearchParams({ path, record_id: id }))
      assert.equal(response.status, 200)
    }
    assert.equal((await fetch(base + '/api/resumes/open?' + new URLSearchParams({ path: 'other.pdf', record_id: id }))).status, 403)
    assert.equal((await db.query('select count(*)::int n from cv_branding_jobs')).rows[0].n, jobsBefore)
  })
  await t.test('concurrent additional CV saves preserve every acknowledged version or return a recoverable conflict', async () => {
    user = ADMIN
    const record = (await db.query("insert into candidates(full_name,mobile_number,cv_storage_path,cv_attachments) values('Synthetic concurrent upload','1234561234','concurrent-original.pdf','[{\"path\":\"concurrent-original.pdf\",\"name\":\"CV.pdf\"}]') returning id")).rows[0]
    adapter.objects.set('concurrent-original.pdf', Buffer.from(bytes))
    const assoc = (await db.query("insert into candidate_associations(candidate_id,client_id,job_id,status) values($1,$2,$3,'Interested') returning id", [record.id, CLIENT, JOB])).rows[0]
    const upload = async text => {
      const doc = await PDFDocument.create(); doc.addPage().drawText(text)
      const form = new FormData(); form.append('status', 'Interested'); form.append('cv_files', new Blob([await doc.save()], { type: 'application/pdf' }), 'CV.pdf')
      const response = await fetch(base + '/api/candidates/' + assoc.id, { method: 'PATCH', body: form })
      return { status: response.status, payload: await response.json() }
    }
    const results = await Promise.all([upload('Distinct source A'), upload('Distinct source B')])
    for (const result of results) assert.ok([200,409].includes(result.status), JSON.stringify(result))
    const successes = results.filter(result => result.status === 200)
    assert.ok(successes.length >= 1)
    const current = (await db.query('select cv_attachments from candidates where id=$1', [record.id])).rows[0].cv_attachments
    assert.equal(current.length, 1 + successes.length)
    assert.ok(current.some(doc => doc.path === 'concurrent-original.pdf'))
  })
})
