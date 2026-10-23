const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createDatabase, CONSULTANT } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { createGmailService } = require('./crmGmail')
const { encrypt } = require('./crmGmailGoogle')
const { contactEmails, contactQuery, emailTimestamp } = require('./crmGmailContent')
const schemaMigration = '20261023112559_crm_gmail_contact_search_and_event_time.sql'
const cleanupMigration = '20261023112632_crm_gmail_obsolete_queue_cleanup.sql'
const mailbox = 'consultant@fyndbridge.in'
const body = 'Recruitment discussion.'
const analysis = { summary: body, meeting: null, negative_response: null, sentiment: { label: 'unknown', evidence: null } }
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const sqlFile = name => fs.readFile(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8')
function message(id, peer = 'a@client.test', outgoing = false) {
  return { id, internalDate: String(Date.UTC(2025, 0, 10)), labelIds: outgoing ? ['SENT'] : ['INBOX'], payload: { mimeType: 'text/plain', headers: [
    { name: 'From', value: outgoing ? mailbox : peer }, { name: 'To', value: outgoing ? peer : mailbox },
    { name: 'Date', value: 'Fri, 10 Jan 2025 23:45:12 -0500' }, { name: 'Subject', value: id }
  ], body: { data: Buffer.from(body).toString('base64url') } } }
}
async function fixture(t, { beforeSchema } = {}) {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  const db = await createDatabase(); t.after(() => db.close())
  for (const name of ['20261019105523_business_development_crm.sql','20261019165228_crm_gmail_integration.sql','20261019182711_crm_gmail_manual_sync.sql','20261023094350_crm_gmail_historical_sync.sql','20261023112550_crm_gmail_shared_sync_and_client_history.sql',schemaMigration,'20261023112611_crm_gmail_explicit_history_modes.sql']) { if (name === schemaMigration) await beforeSchema?.(db); await db.exec(await sqlFile(name)) }
  const adapter = databaseAdapter(db), originalRpc = adapter.rpc
  adapter.rpc = (name, args) => originalRpc(name, Object.fromEntries(Object.entries(args || {}).map(([key,value]) => [key, Array.isArray(value) ? JSON.stringify(value) : value])))
  const rpc = async (name, args = {}) => { const result = await adapter.rpc(`crm_gmail_${name}`, args); if (result.error) throw result.error; return result.data }
  async function client(name, emails) {
    const result = await adapter.rpc('crm_save', { p_actor: CONSULTANT, p_id: null, p_version: null, p_data: { organisation_name: name, contacts: emails.map((email, index) => ({ name: `Contact ${index}`, email, mobile: '' })) } })
    if (result.error) throw result.error
    return result.data
  }
  // Legacy CRM schema requires mobile numbers; current production accepts name-only.
  await db.exec(await sqlFile('20261020042221_crm_optional_contact_details.sql'))
  const first = await client('Current client', ['a@client.test','b@client.test'])
  const credentials = encrypt({ access_token: 'synthetic', refresh_token: 'synthetic', expires_at: Date.now() + 3600000 }, CONSULTANT)
  const c = (await db.query("insert into crm_gmail_connections(user_id,email,credentials,history_id) values($1,$2,$3,'100') returning *", [CONSULTANT, mailbox, credentials])).rows[0]
  const calls = [], messages = new Map(); let aiCalls = 0
  const google = { api: async (access, endpoint, params) => { calls.push({ endpoint, params }); if (endpoint === 'history') return { historyId: '101', history: [] }; if (endpoint === 'messages') return { messages: [] }; return structuredClone(messages.get(endpoint.split('/')[1]) || message(endpoint.split('/')[1])) } }
  const service = createGmailService({ db: adapter, google, authorize: async () => mailbox, ai: async () => { aiCalls++; return structuredClone(analysis) } })
  async function begin() { await rpc('request_all_sync', { p_actor: CONSULTANT }); await db.exec('update crm_gmail_connections set sync_requested=false') }
  async function page() {
    const lease = crypto.randomUUID(); assert.equal(await rpc('claim_worker_v2', { p_lease: lease }), true)
    const connection = await rpc('claim_sync', { p_lease: lease })
    assert.ok(Boolean(connection))
    try { await service.discover(connection, lease) } finally { await db.exec('update crm_gmail_worker set lease_id=null,lease_until=null') }
  }
  return { db, adapter, rpc, client, first, c, google, calls, messages, service, begin, page, get aiCalls() { return aiCalls } }
}
test('contact normalization matches SQL; each deterministic batch covers all four directions and stays URL bounded', async t => {
  const f = await fixture(t)
  const contacts = [{ email: ' A@Client.Test ' }, { email: 'a@client.test' }, {}, { email: 'bad' }, { email: 'evil@client.test OR in:anywhere' }, { email: 'Name <b@client.test>' }, { email: null }, { email: 'a..b@client.test' }, null, { email: ['array@client.test'] }, { email: 'x'.repeat(65)+'@client.test' }, { email: 'valid@'+'x'.repeat(64)+'.test' }, { email: 'name+tag@client.test' }]
  await f.db.query('update crm_clients set contacts=$1', [JSON.stringify(contacts)])
  assert.deepEqual(await f.rpc('valid_contacts'), contactEmails(contacts))
  const emails = Array.from({ length: 1500 }, (_, i) => `contact${i}@client.test`)
  const queries = contactEmails(emails.map(email => ({ email }))).map(email => contactQuery(email, '2026-10-23T10:00:00Z'))
  assert.equal(queries.length, 1500)
  for (const q of queries) { for (const operator of ['from:', 'to:', 'cc:', 'bcc:', 'before:', '-in:spam', '-in:trash', '-in:drafts']) assert.ok(q.includes(operator)); assert.ok(new URLSearchParams({ q }).toString().length < 1800) }
  assert.throws(() => contactQuery('x@client.test OR in:anywhere', new Date()))
})
test('historical batches persist page tokens, fixed cutoff and contact indexes; duplicate messages never repeat AI', async t => {
  const f = await fixture(t); await f.begin()
  f.google.api = async (access, endpoint, params) => {
    f.calls.push({ endpoint, params })
    if (endpoint === 'messages') return { messages: [{ id: 'same' }], ...(params.q.includes('a@') && !params.pageToken ? { nextPageToken: 'page-two' } : {}) }
    if (endpoint === 'history') return { historyId: '101', history: [] }
    return message(endpoint.split('/')[1])
  }
  await f.page(); assert.equal(await scalar(f.db, 'select backfill_page_token from crm_gmail_connections'), 'page-two')
  assert.equal(await scalar(f.db, 'select contact_index from crm_gmail_connections'), 0)
  await f.page(); assert.equal(await scalar(f.db, 'select contact_index from crm_gmail_connections'), 1)
  await f.page(); assert.ok(await scalar(f.db, "select backfill_completed_at is not null from crm_gmail_connections"))
  const queries = f.calls.filter(c => c.endpoint === 'messages')
  assert.deepEqual(queries.map(c => c.params.pageToken || null), [null, 'page-two', null])
  assert.equal(new Set(queries.map(c => c.params.q.match(/before:\d+/)[0])).size, 1)
  assert.equal(await scalar(f.db, 'select count(*) from crm_gmail_jobs'), 1)
  await f.service.run(); assert.equal(f.aiCalls, 1)
  assert.equal(await scalar(f.db, "select count(*) from crm_activities where activity_type='gmail_email'"), 1)
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections'), '100')
})
test('contact replacement invalidates the old page, retains cutoff and excludes removed addresses from new queries', async t => {
  const f = await fixture(t); await f.begin()
  const before = await scalar(f.db, 'select backfill_started_at from crm_gmail_connections')
  f.google.api = async (access, endpoint, params) => {
    f.calls.push({ endpoint, params })
    if (endpoint === 'messages') {
      await f.db.query('update crm_clients set contacts=$1', [JSON.stringify([{ email: 'new@client.test' }])])
      return { messages: [{ id: 'obsolete' }], nextPageToken: 'old-page' }
    }
  }
  await f.page()
  assert.equal(await scalar(f.db, 'select count(*) from crm_gmail_jobs'), 0)
  f.google.api = async (access, endpoint, params) => { f.calls.push({ endpoint, params }); return { messages: [] } }
  await f.page()
  assert.match(f.calls.at(-1).params.q, /new@client.test/)
  assert.ok(!f.calls.at(-1).params.q.includes('a@client.test'))
  assert.equal(f.calls.at(-1).params.pageToken, undefined)
  assert.equal(String(await scalar(f.db, 'select backfill_started_at from crm_gmail_connections')), String(before))
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections'), '100')
})
test('failed and expired Gmail pages preserve their batch; no unrestricted fallback', async t => {
  const f = await fixture(t); await f.begin()
  await f.db.exec("update crm_gmail_connections set contact_index=1,backfill_page_token='expired'")
  let attempts = 0
  f.google.api = async (access, endpoint, params) => {
    f.calls.push({ endpoint, params }); attempts++
    if (attempts === 1) throw Object.assign(new Error('Expired'), { status: 400 })
    assert.match(params.q, /b@client.test/); assert.equal(params.pageToken, undefined)
    return { messages: [] }
  }
  await f.page(); assert.equal(attempts, 2)
  assert.equal(f.calls[0].params.q, f.calls[1].params.q)
  assert.ok(await scalar(f.db, "select backfill_completed_at is not null from crm_gmail_connections"))
})
test('current ownership receives transferred historical correspondence; removed contacts skip Gemini', async t => {
  const f = await fixture(t), second = await f.client('Transferred organisation', ['z@client.test'])
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id,discovery_kind,historical_client_id) values($1,'transferred','historical',$2),($1,'removed','historical',$2)", [f.c.id,f.first.id])
  await f.db.exec("update crm_gmail_jobs set discovery_contact_email='a@client.test' where message_id='transferred'")
  await f.db.query('update crm_clients set contacts=$1 where id=$2', [JSON.stringify([{ email: 'b@client.test' }]),f.first.id])
  await f.db.query('update crm_clients set contacts=$1 where id=$2', [JSON.stringify([{ email: 'a@client.test' }]),second.id])
  f.messages.set('removed', message('removed', 'old@client.test'))
  await f.service.run()
  assert.equal(f.aiCalls, 1)
  assert.equal(await scalar(f.db, "select crm_client_id from crm_activities where gmail_message_id='transferred'"), second.id)
  assert.equal(await scalar(f.db, "select outcome from crm_gmail_jobs where message_id='removed'"), 'unrelated')
})
test('metadata revalidation before Gemini and transaction-time matching fence concurrent contact changes and ambiguity', async t => {
  const f = await fixture(t)
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id,discovery_kind,historical_client_id) values($1,'removed-during-fetch','historical',$2)", [f.c.id,f.first.id])
  const api = f.google.api
  f.google.api = async (access, endpoint, params) => {
    if (params.format === 'full') await f.db.query('update crm_clients set contacts=$1', [JSON.stringify([{ email: 'b@client.test' }])])
    return api(access, endpoint, params)
  }
  await f.service.run(); assert.equal(f.aiCalls, 0)
  await f.db.query('update crm_clients set contacts=$1', [JSON.stringify([{ email: 'a@client.test' }])])
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id,discovery_kind,historical_client_id) values($1,'ambiguous-at-commit','historical',$2)", [f.c.id,f.first.id])
  const lease = crypto.randomUUID()
  await f.rpc('claim_worker_v2', { p_lease: lease })
  const job = await f.rpc('claim_job', { p_lease: lease })
  await f.client('New conflicting organisation', ['a@client.test'])
  assert.equal(await f.rpc('finish_job', { p_id: job.id,p_lease:lease,p_client:f.first.id,p_metadata:{ direction:'incoming',sender:'a@client.test',recipients:[mailbox],email_at:'2025-01-01T00:00:00Z' },p_outcome:'activity_created' }), false)
  assert.equal(await scalar(f.db, "select count(*) from crm_activities where activity_type='gmail_email'"), 0)
})
test('no contacts never lists a mailbox; later contacts start a fresh historical scan', async t => {
  const f = await fixture(t)
  await f.db.query('update crm_clients set contacts=$1', [JSON.stringify([{ name: 'Contact without email' }])])
  assert.equal((await f.service.syncNow(CONSULTANT)).state, 'no_contacts')
  assert.ok(!f.calls.some(c => c.endpoint === 'messages'))
  await f.db.query('update crm_clients set contacts=$1', [JSON.stringify([{ email: 'new@client.test' }])])
  await f.db.exec('update crm_gmail_worker set last_manual_sync_at=null')
  await f.service.syncNow(CONSULTANT)
  assert.ok(f.calls.some(c => c.endpoint === 'messages' && c.params.q.includes('new@client.test')))
})
test('cleanup revokes active leases, preserves history/checkpoints/permanent failures, and cannot be refilled by old commits', async t => {
  const f = await fixture(t), lease = crypto.randomUUID()
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id,status) values($1,'obsolete-pending','pending'),($1,'obsolete-retry','retryable_failure'),($1,'diagnostic','permanent_failure'),($1,'imported','completed')", [f.c.id])
  await f.rpc('claim_worker_v2', { p_lease: lease })
  const job = await f.rpc('claim_job', { p_lease: lease })
  await f.db.query("update crm_gmail_connections set lease_id=$1,lease_until=now()+interval '1 minute',backfill_started_at=now(),backfill_page_token='obsolete-page',sync_requested=true,page_token='incremental-page'", [lease])
  await f.db.query("insert into crm_activities(crm_client_id,activity_type,gmail_user_id,gmail_message_id,email_metadata) values($1,'gmail_email',$2,'imported',$3)", [f.first.id,CONSULTANT,JSON.stringify({ email_at:'2025-01-01T00:00:00Z' })])
  const activities = (await f.db.query('select * from crm_activities order by id')).rows
  const connections = (await f.db.query('select id,credentials,history_id,page_token from crm_gmail_connections')).rows
  await f.db.exec(await sqlFile(cleanupMigration))
  assert.equal(await scalar(f.db, "select count(*) from crm_gmail_jobs where status in ('pending','processing','retryable_failure')"), 0)
  assert.deepEqual((await f.db.query('select * from crm_activities order by id')).rows, activities)
  assert.deepEqual((await f.db.query('select id,credentials,history_id,page_token from crm_gmail_connections')).rows, connections)
  assert.equal(await scalar(f.db, "select status from crm_gmail_jobs where message_id='diagnostic'"), 'permanent_failure')
  assert.equal(await f.rpc('claim_worker', { p_lease: crypto.randomUUID() }), false)
  assert.equal(await f.rpc('commit_backfill_page', { p_id:f.c.id,p_lease:lease,p_ids:['obsolete-restored'],p_page:null }), false)
  assert.equal(await f.rpc('commit_page', { p_id:f.c.id,p_lease:lease,p_ids:['obsolete-restored'],p_history:'999',p_page:null,p_recovery:{} }), false)
  assert.equal(await f.rpc('finish_job', { p_id:job.id,p_lease:lease,p_client:f.first.id,p_metadata:{ direction:'incoming',sender:'a@client.test',recipients:[mailbox] },p_outcome:'activity_created' }), false)
  assert.equal(await scalar(f.db, 'select backfill_page_token from crm_gmail_connections'), null)
  assert.deepEqual(await scalar(f.db, 'select contact_snapshot from crm_gmail_connections'), ['a@client.test','b@client.test'])
  // Fresh discovery keeps permanent diagnostics and imported-message AI dedup intact.
  await f.db.exec('update crm_gmail_connections set sync_requested=false')
  f.google.api = async (access, endpoint) => endpoint==='messages' ? { messages:[{id:'diagnostic'},{id:'imported'},{id:'eligible'}] } : message(endpoint.split('/')[1])
  await f.begin(); await f.page(); await f.page()
  assert.equal(await f.rpc('claim_job', { p_lease: lease }), null, 'A revoked worker must not claim fresh jobs')
  await f.service.run()
  assert.equal(f.aiCalls,1)
  assert.equal(await scalar(f.db, "select status from crm_gmail_jobs where message_id='diagnostic'"), 'permanent_failure')
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id) values($1,'fresh-pending-after-maintenance')", [f.c.id])
  await assert.rejects(f.db.exec(await sqlFile(cleanupMigration)), /already applied/)
  assert.equal(await scalar(f.db, "select status from crm_gmail_jobs where message_id='fresh-pending-after-maintenance'"), 'pending')
})
test('RFC dates preserve offset/time, malformed dates fall back; database timeline paginates event time with stable ties', async t => {
  assert.equal(emailTimestamp(message('date')), '2025-01-11T04:45:12.000Z')
  for (const invalid of ['', 'invalid', '2025-01-10', 'Fri, 31 Feb 2025 23:00:00 +0000', 'Fri, 10 Jan 2025 25:00:00 +0000']) {
    const item=message('date'); item.payload.headers.find(h=>h.name==='Date').value=invalid
    assert.equal(emailTimestamp(item), '2025-01-10T00:00:00.000Z')
  }
  const f=await fixture(t)
  const createdBefore=(await f.db.query('select id,created_at from crm_activities order by id')).rows
  for(let i=0;i<27;i++) await f.db.query("insert into crm_activities(crm_client_id,activity_type,gmail_user_id,gmail_message_id,email_metadata) values($1,'gmail_email',$2,$3,$4)", [f.first.id,CONSULTANT,`dated-${i}`,JSON.stringify({email_at:i<2?'2024-12-31T20:00:00Z':'2025-01-11T04:45:12.000Z'})])
  const rows=(await f.db.query('select * from crm_activities where crm_client_id=$1 order by occurred_at desc,id desc',[f.first.id])).rows
  const pages=[]
  for(let offset=0;offset<rows.length;offset+=25) pages.push(...(await f.db.query('select * from crm_activities where crm_client_id=$1 order by occurred_at desc,id desc limit 25 offset $2',[f.first.id,offset])).rows)
  assert.deepEqual(pages.map(r=>r.id),rows.map(r=>r.id));assert.equal(new Set(pages.map(r=>r.id)).size,rows.length)
  assert.ok(rows.findIndex(r=>r.activity_type==='created')<rows.findIndex(r=>r.gmail_message_id==='dated-2'))
  assert.deepEqual((await f.db.query('select id,created_at from crm_activities where gmail_message_id is null order by id')).rows,createdBefore)
  assert.equal(await scalar(f.db,"select count(*) from crm_activities where gmail_message_id is not null and occurred_at=created_at"),0)
  const privileges=(await f.db.query("select p.proname,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,p.prosecdef from pg_proc p where pronamespace='public'::regnamespace and proname like 'crm_gmail_%'")).rows
  assert.ok(privileges.every(p=>!p.a&&!p.u&&!p.prosecdef))
})
test('the complete migration chain preserves the fresh contact scan and explicit client imports', async t => {
  const f = await fixture(t)
  const directory = path.resolve(__dirname, '../../../supabase/migrations')
  const later = (await fs.readdir(directory)).filter(name => name > schemaMigration && !name.includes('explicit_history_modes') && name.includes('crm_gmail') && name.endsWith('.sql')).sort()
  for (const name of later) await f.db.exec(await sqlFile(name))
  await f.db.exec('update crm_gmail_connections set sync_requested=false')
  const lease = crypto.randomUUID()
  assert.equal(await f.rpc('claim_worker_v2', { p_lease: lease }), true)
  const claimed = await f.rpc('claim_sync', { p_lease: lease })
  assert.ok(Boolean(claimed), 'The fresh current-contact scan must remain claimable')
  await f.rpc('request_client_import', { p_actor: CONSULTANT, p_client: f.first.id, p_emails: ['a@client.test','b@client.test'] })
  await f.rpc('claim_worker_v2', { p_lease: lease })
  assert.ok(Boolean(await f.rpc('claim_client_import', { p_lease: lease, p_client: f.first.id })))
})
test('existing Gmail event times backfill from saved metadata while manual and audit timestamps remain intact', async t => {
  let before
  const f = await fixture(t, { beforeSchema: async db => {
    const c = (await db.query("insert into crm_clients(organisation_name,contacts) values('Legacy timeline','[{\"email\":\"legacy@client.test\"}]') returning id")).rows[0]
    for (const [id, metadata] of [['legacy-valid',{ email_at:'2025-01-10T23:45:12-05:00' }],['legacy-invalid',{ email_at:'not a date' }]]) {
      await db.query("insert into crm_activities(crm_client_id,activity_type,gmail_user_id,gmail_message_id,email_metadata,created_at) values($1,'gmail_email',$2,$3,$4,'2026-10-23T09:12:31Z')",[c.id,CONSULTANT,id,JSON.stringify(metadata)])
    }
    await db.query("insert into crm_activities(crm_client_id,activity_type,created_at) values($1,'status_changed','2026-10-20T10:11:12Z')",[c.id])
    before=(await db.query('select id,created_at,email_metadata from crm_activities order by id')).rows
  } })
  assert.deepEqual((await f.db.query('select id,created_at,email_metadata from crm_activities where gmail_message_id like \'legacy-%\' or activity_type=\'status_changed\' order by id')).rows,before)
  assert.equal(new Date(await scalar(f.db,"select occurred_at from crm_activities where gmail_message_id='legacy-valid'")).toISOString(),'2025-01-11T04:45:12.000Z')
  assert.equal(await scalar(f.db,"select occurred_at=created_at from crm_activities where gmail_message_id='legacy-invalid'"),true)
  assert.equal(await scalar(f.db,"select occurred_at=created_at from crm_activities where activity_type='status_changed'"),true)
})
