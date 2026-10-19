const test = require('node:test')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const { createDatabase, assign, ADMIN, id } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { cleanupAssignedCvs } = require('./assignedCandidateCv')

test('automatic assignment CV cleanup uses valid PostgREST JSON and preserves referenced documents', async t => {
  const db = await createDatabase()
  t.after(() => db.close())
  const adapter = databaseAdapter(db)
  // Use the actual SDK filter serialization, then execute its predicates in PostgreSQL.
  // The previous adapter alone masked JS arrays being encoded as PostgreSQL arrays.
  const client = createClient('https://database.example.test', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input)
      assert.equal(url.pathname, '/rest/v1/candidates')
      assert.equal(init.method, 'HEAD')
      try {
        const attachmentFilter = url.searchParams.get('cv_attachments')
        let query, params
        if (attachmentFilter) {
          assert.ok(attachmentFilter.startsWith('cs.'))
          query = 'select count(*)::int as count from candidates where cv_attachments @> $1::jsonb'
          params = [attachmentFilter.slice(3)]
        } else {
          params = []
          const predicates = url.searchParams.get('or').slice(1, -1).split(',').map(term => {
            const [field, path] = term.split('.eq.')
            assert.ok(['cv_storage_path', 'cv_link', 'resume_url'].includes(field))
            params.push(path)
            return `${field}=$${params.length}`
          })
          query = `select count(*)::int as count from candidates where ${predicates.join(' or ')}`
        }
        const count = (await db.query(query, params)).rows[0].count
        return new Response(null, { status: 200, headers: { 'content-range': `*/${count}` } })
      } catch {
        return new Response(null, { status: 400 })
      }
    } }
  })
  const supabase = { ...adapter, from: table => table === 'candidates' ? client.from(table) : adapter.from(table) }
  const retired = async n => {
    const assignment = await assign(db, n)
    const path = (await db.query('select cv_storage_path from assigned_candidate_uploads where id=$1', [id(n)])).rows[0].cv_storage_path
    adapter.objects.set(path, Buffer.from('synthetic CV'))
    await db.query('select delete_assigned_candidates($1,null,$2,false)', [ADMIN, [assignment.id]])
    return path
  }
  const manifest = async n => (await db.query('select * from assigned_candidate_uploads where id=$1', [id(n)])).rows[0]

  await t.test('a deleted assignment absent from main Candidates loses its file and staging manifest', async () => {
    const path = await retired(801)
    assert.equal(await cleanupAssignedCvs(supabase), 0)
    assert.equal(adapter.objects.has(path), false)
    assert.equal(await manifest(801), undefined)
    assert.ok(adapter.removedPaths.includes(path))
  })
  for (const [index, field] of ['cv_storage_path', 'cv_link', 'resume_url', 'cv_attachments'].entries()) {
    await t.test(`main Candidates reference in ${field} preserves the CV`, async () => {
      const n = 802 + index, path = await retired(n)
      const value = field === 'cv_attachments' ? JSON.stringify([{ path, name: 'Shared CV.pdf' }]) : path
      await db.query(`insert into candidates(full_name,mobile_number,${field}) values('Synthetic Shared Candidate','9876543210',$1)`, [value])
      assert.equal(await cleanupAssignedCvs(supabase), 0)
      assert.equal(adapter.objects.has(path), true)
      assert.ok(!adapter.removedPaths.includes(path))
      assert.equal((await manifest(n)).retired_at, null)
    })
  }
  await t.test('storage failure retains a retryable manifest and a later automatic pass finishes cleanup', async () => {
    const path = await retired(806), original = adapter.storage.from
    adapter.storage.from = () => ({ ...original(), remove: async () => ({ error: new Error('Synthetic storage outage') }) })
    try {
      assert.equal(await cleanupAssignedCvs(supabase), 1)
      assert.equal(adapter.objects.has(path), true)
      assert.equal((await manifest(806)).cleanup_claimed_at, null)
    } finally { adapter.storage.from = original }
    assert.equal(await cleanupAssignedCvs(supabase), 0)
    assert.equal(adapter.objects.has(path), false)
    assert.equal(await manifest(806), undefined)
  })
  await t.test('a live assignment keeps its CV even if its upload is marked for cleanup', async () => {
    await assign(db, 807)
    await db.query('update assigned_candidate_uploads set retired_at=now() where id=$1', [id(807)])
    assert.equal(await cleanupAssignedCvs(supabase), 0)
    assert.ok(await manifest(807))
    assert.ok(!adapter.removedPaths.some(path => path.endsWith(`${id(807)}.pdf`)))
  })
})
