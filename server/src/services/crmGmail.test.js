const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createDatabase, CONSULTANT, OTHER } = require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { createGmailService, backoff } = require('./crmGmail')
const { encrypt, decrypt, SCOPE, createGoogle } = require('./crmGmailGoogle')
const { addresses, matchMessage, extractBody, validateAnalysis } = require('./crmGmailContent')
const migration = '20261019165228_crm_gmail_integration.sql'
const contact = { name: 'HR', email: 'hr@client.test', mobile: '9876543210', designation: '', linkedin: '' }
const email = 'consultant@fyndbridge.in'
const insight = { summary: 'Client requested a meeting. No requirements at present.', meeting: { status: 'proposed', when: 'Friday at 2 PM', evidence: 'Can we meet Friday at 2 PM?' }, negative_response: { category: 'no_requirements', permanence: 'temporary', evidence: 'No requirements at present.' }, sentiment: { label: 'neutral', evidence: 'No requirements at present.' } }
const body = 'Can we meet Friday at 2 PM? No requirements at present.'
function message(id = 'm1', outgoing = false) { return { id, internalDate: String(Date.now() + 1000), labelIds: outgoing ? ['SENT'] : ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: outgoing ? email : 'HR <hr@client.test>' }, { name: 'To', value: outgoing ? 'hr@client.test' : email }, { name: 'Subject', value: 'Recruitment discussion' }], body: { data: Buffer.from(body).toString('base64url') } } } }
async function fixture(t) {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  process.env.GOOGLE_GMAIL_CLIENT_ID = 'synthetic-client'
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'synthetic-secret'
  process.env.GOOGLE_GMAIL_REDIRECT_URI = 'https://example.test/api/crm/gmail/callback'
  const db = await createDatabase(); t.after(() => db.close())
  for (const name of ['20261019105523_business_development_crm.sql', migration]) await db.exec(await fs.readFile(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8'))
  const adapter = databaseAdapter(db), rawRpc = adapter.rpc
  adapter.rpc = (name, args) => rawRpc(name, Object.fromEntries(Object.entries(args || {}).map(([key,value]) => [key, Array.isArray(value) ? JSON.stringify(value) : value])))
  const saved = await adapter.rpc('crm_save', { p_actor: CONSULTANT, p_id: null, p_version: null, p_data: { organisation_name: 'Gmail Client', contacts: [contact, { ...contact, email: 'other@client.test', mobile: '9876543211' }], status: 'Outreach Sent', conversion_probability: '<25%', comment: 'Preserve this comment.' } })
  if (saved.error) throw saved.error
  let aiCalls = 0, refreshes = 0, revokes = 0, profileEmail = email, failAi, historyFailure, page
  const calls = []
  const google = {
    async exchange() { return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: SCOPE } },
    async refresh() { refreshes++; return { access_token: 'refreshed', expires_in: 3600 } },
    async revoke() { revokes++ },
    async api(access, endpoint, params) {
      calls.push({ endpoint, params })
      if (endpoint === 'profile') return { emailAddress: profileEmail, historyId: '100' }
      if (endpoint === 'history') { if (historyFailure) throw historyFailure; return page || { historyId: '102', history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm1' } }] }] } }
      if (endpoint === 'messages') return { messages: [{ id: 'recovered' }] }
      return message(endpoint.split('/')[1], endpoint.includes('outgoing'))
    }
  }
  const service = createGmailService({ db: adapter, google, authorize: async user => user === CONSULTANT ? email : 'other@fyndbridge.in', ai: async () => { aiCalls++; if (failAi) throw failAi; return structuredClone(insight) } })
  async function connect() {
    const initial = await service.start(CONSULTANT), state = new URL(initial.url).searchParams.get('state')
    await service.callback({ state, browser: initial.browser, code: 'synthetic-code' })
    return (await db.query('select * from crm_gmail_connections')).rows[0]
  }
  return { db, adapter, service, google, connect, client: saved.data, calls, get aiCalls() { return aiCalls }, get refreshes() { return refreshes }, get revokes() { return revokes }, set profileEmail(value) { profileEmail = value }, set failAi(value) { failAi = value }, set historyFailure(value) { historyFailure = value }, set page(value) { page = value } }
}
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
test('AES-256-GCM hex decoding, random IV, owner binding and tamper rejection', () => {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  const one = encrypt({ refresh: 'synthetic' }, CONSULTANT), two = encrypt({ refresh: 'synthetic' }, CONSULTANT)
  assert.notEqual(one, two); assert.deepEqual(decrypt(one, CONSULTANT), { refresh: 'synthetic' })
  assert.throws(() => decrypt(one, OTHER)); assert.throws(() => decrypt(one.slice(0, -4) + 'AAAA', CONSULTANT))
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'bad'; assert.throws(() => encrypt({}, CONSULTANT)); process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
})
test('OAuth state is browser-bound, single-use, expires, validates scope/account, and preserves refresh tokens', async t => {
  const f = await fixture(t), { service, db } = f
  let start = await service.start(CONSULTANT), state = new URL(start.url).searchParams.get('state')
  const url = new URL(start.url)
  assert.equal(url.searchParams.get('scope'), SCOPE); assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  await assert.rejects(service.callback({ state, browser: 'x'.repeat(43), code: 'code' }), { code: 'INVALID_STATE' })
  f.profileEmail = 'someoneelse@fyndbridge.in'
  await assert.rejects(service.callback({ state, browser: start.browser, code: 'code' }), { code: 'ACCOUNT_MISMATCH' })
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_connections'), 0)
  await assert.rejects(service.callback({ state, browser: start.browser, code: 'code' }), { code: 'INVALID_STATE' })
  start = await service.start(CONSULTANT); state = new URL(start.url).searchParams.get('state')
  await db.exec("update crm_gmail_oauth_states set expires_at=now()-interval '1 second'")
  await assert.rejects(service.callback({ state, browser: start.browser, code: 'code' }), { code: 'INVALID_STATE' })
  f.profileEmail = email
  const exchange = f.google.exchange
  f.google.exchange = async () => ({ access_token:'synthetic-access',scope:'openid' })
  start = await service.start(CONSULTANT); state = new URL(start.url).searchParams.get('state')
  await assert.rejects(service.callback({state,browser:start.browser,code:'code'}),{code:'SCOPE_REQUIRED'})
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_connections'), 0)
  f.google.exchange = exchange
  start = await service.start(CONSULTANT); state = new URL(start.url).searchParams.get('state')
  await assert.rejects(service.callback({state,browser:start.browser,error:'access_denied'}),{code:'OAUTH_DENIED'})
  const connection = await f.connect()
  assert.equal(connection.history_id, '100'); assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_jobs'), 0)
  f.google.exchange = async () => ({ access_token: 'replacement', expires_in: 3600, scope: SCOPE })
  const replacement = await f.connect()
  assert.equal(replacement.id, connection.id); assert.equal(decrypt(replacement.credentials, CONSULTANT).refresh_token, 'synthetic-refresh')
  assert.deepEqual(Object.keys(await service.status(CONSULTANT)).sort(), ['connected','coverage_warning','email','last_error','last_sync_at','status'])
  assert.deepEqual(await service.status(OTHER), { connected: false })
  const expired = encrypt({ access_token: 'old', refresh_token: 'synthetic-refresh', expires_at: 0 }, CONSULTANT)
  await db.query('update crm_gmail_connections set credentials=$1', [expired]); replacement.credentials = expired
  assert.equal(await service.access(replacement), 'refreshed'); assert.equal(f.refreshes, 1)
  assert.equal(decrypt((await db.query('select credentials from crm_gmail_connections')).rows[0].credentials, CONSULTANT).refresh_token, 'synthetic-refresh')
})
test('exact incoming/outgoing matching across all contacts excludes unrelated, spoofed display names and ambiguous organisations', () => {
  const clients = [{ id: '1', contacts: [{ email: 'other@client.test' }, contact] }]
  assert.equal(matchMessage(message(), email, clients).client.id, '1')
  assert.equal(matchMessage(message('outgoing', true), email, clients).direction, 'outgoing')
  assert.equal(matchMessage(message(), email, [{ id: '2', contacts: [{ email: 'unrelated@client.test' }] }]).reason, 'unrelated')
  assert.equal(matchMessage(message(), email, [...clients, { id: '2', contacts: [contact] }]).reason, 'ambiguous')
  assert.deepEqual(addresses('"hr@client.test" <attacker@evil.test>'), ['attacker@evil.test'])
  assert.deepEqual(addresses('"HR, Person" <HR@Client.test>, Other <other@client.test>'), ['hr@client.test','other@client.test'])
})
test('MIME plain/HTML alternatives, charset, quoted context and attachments are handled without executing HTML', () => {
  const plain = text => ({ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } })
  const payload = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [plain('Hello\n-- \nSignature'), { mimeType: 'text/html', body: { data: Buffer.from('<p>Duplicate</p>').toString('base64url') } }] }, { ...plain('Private attachment'), filename: 'attachment.txt' }] }
  assert.equal(extractBody(payload), 'Hello')
  assert.equal(extractBody({ mimeType: 'text/html', body: { data: Buffer.from('<script>bad()</script><p>Meet &amp; talk<br>Friday</p>').toString('base64url') } }), 'Meet & talk\nFriday')
  assert.match(extractBody(plain('New reply\nOn Tuesday someone wrote:\nOld context')), /Earlier conversation/)
  assert.equal(extractBody({ mimeType: 'text/plain', body: { attachmentId: 'private' } }), '')
  assert.equal(extractBody({ mimeType:'text/plain',headers:[{name:'Content-Type',value:'text/plain; charset=iso-8859-1'}],body:{data:Buffer.from([99,97,102,233]).toString('base64url')} }), 'café')
  assert.match(extractBody(plain('Current message\n---------- Forwarded message ---------\nEarlier details')),/Earlier conversation/)
  assert.ok(extractBody(plain('Long thread '.repeat(2000))).length<=8500)
})
test('AI JSON validation: meeting vs confirmation, rejection category/permanence, sentiment evidence, unknown outgoing, invalid fields', () => {
  assert.equal(validateAnalysis(structuredClone(insight), body, 'incoming').meeting.status, 'proposed')
  for (const status of ['requested','confirmed','rescheduled','cancelled']) { const value = structuredClone(insight); value.meeting.status = status; assert.equal(validateAnalysis(value, body, 'incoming').meeting.status, status) }
  const outgoing = validateAnalysis(structuredClone(insight), body, 'outgoing')
  assert.equal(outgoing.sentiment.label, 'unknown'); assert.equal(outgoing.negative_response, null)
  const unknown = { summary: 'Consultant sent an introduction.', meeting: null, negative_response: null, sentiment: { label: 'unknown', evidence: null } }
  assert.deepEqual(validateAnalysis(unknown, 'Introduction', 'outgoing'), unknown)
  for (const mutate of [v => { v.probability = 70 }, v => { v.meeting.when = '2030-01-01' }, v => { v.meeting.status = 'accepted' }, v => { v.sentiment.label = 'positive'; v.sentiment.evidence = 'Invented' }, v => { v.negative_response.permanence = 'forever' }, v => { v.summary = '' }]) { const value = structuredClone(insight); mutate(value); assert.throws(() => validateAnalysis(value, body, 'incoming'), { code: 'INVALID_AI_OUTPUT' }) }
})
test('incremental sync/checkpoints, atomic claims, durable jobs, dedup, activity-only writes and disconnect fencing', async t => {
  const f = await fixture(t), c = await f.connect(), { db, service } = f
  const before = (await db.query('select * from crm_clients')).rows
  const comments = (await db.query('select * from crm_comments')).rows
  const manual = await scalar(db, "select count(*)::int from crm_activities where activity_type<>'gmail_email'")
  await service.run({ schedule: true })
  assert.equal(f.aiCalls, 1)
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_jobs'), 1)
  assert.equal(await scalar(db, "select status from crm_gmail_jobs"), 'completed')
  assert.equal(await scalar(db, 'select history_id from crm_gmail_connections'), '102')
  const activity = (await db.query("select * from crm_activities where activity_type='gmail_email'")).rows[0]
  assert.equal(activity.email_metadata.meeting.status, 'proposed'); assert.equal(activity.gmail_user_id, CONSULTANT)
  assert.equal(activity.crm_client_id, f.client.id)
  await service.run({ schedule: true }); assert.equal(f.aiCalls, 1)
  assert.deepEqual((await db.query('select * from crm_clients')).rows, before)
  assert.deepEqual((await db.query('select * from crm_comments')).rows, comments)
  assert.equal(await scalar(db, "select count(*)::int from crm_activities where activity_type<>'gmail_email'"), manual)
  // Incomplete pages retain original checkpoint; duplicate IDs cannot add jobs.
  f.page = { historyId: '200', nextPageToken: 'page-two', history: [{ messagesAdded: [{ message: { id: 'outgoing' } }] }] }
  await f.adapter.rpc('crm_gmail_schedule')
  const lease = crypto.randomUUID(), claimed = (await f.adapter.rpc('crm_gmail_claim_sync', { p_lease: lease })).data
  await service.discover(claimed, lease)
  assert.equal(await scalar(db, 'select history_id from crm_gmail_connections'), '102')
  assert.equal(await scalar(db, 'select page_token from crm_gmail_connections'), 'page-two')
  const job1 = (await f.adapter.rpc('crm_gmail_claim_job', { p_lease: lease })).data
  const job2 = (await f.adapter.rpc('crm_gmail_claim_job', { p_lease: crypto.randomUUID() })).data
  assert.ok(job1); assert.equal(job2, null)
  await service.disconnect(OTHER); assert.equal((await service.status(CONSULTANT)).connected, true)
  await service.disconnect(CONSULTANT)
  assert.equal(f.revokes, 1); assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_jobs'), 0)
  assert.equal((await f.adapter.rpc('crm_gmail_finish_job', { p_id: job1.id, p_lease: lease, p_client: f.client.id, p_metadata: {}, p_outcome: 'activity_created' })).data, false)
  assert.equal(await scalar(db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 1)
  assert.equal((await service.status(CONSULTANT)).connected, false)
  assert.equal(c.user_id, CONSULTANT)
})
const crypto = require('node:crypto')
test('quota circuit breaker, persistent retry, lease recovery, expired history and concurrent worker exclusion', async t => {
  const f = await fixture(t), { db, service, adapter } = f
  await f.connect(); f.failAi = Object.assign(new Error('Quota'), { statusCode: 429, code: 'AI_QUOTA_REACHED' })
  await service.run({ schedule: true })
  const retry = (await db.query('select * from crm_gmail_jobs')).rows[0]
  assert.equal(retry.status, 'retryable_failure'); assert.equal(retry.last_error, 'QUOTA_PAUSED')
  assert.ok(new Date(retry.available_at).getTime() > Date.now() + 23 * 3600000)
  await service.run(); assert.equal(f.aiCalls, 1)
  assert.ok(backoff(3) >= 480000)
  const lease = crypto.randomUUID()
  assert.equal((await adapter.rpc('crm_gmail_claim_worker', { p_lease: lease })).data, true)
  assert.deepEqual(await service.run({ schedule: true }), { busy: true })
  await db.exec("update crm_gmail_worker set lease_until=now()-interval '1 second',ai_resume_at=now(); update crm_gmail_jobs set status='processing',lease_until=now()-interval '1 second',available_at=now()")
  f.failAi = null; f.historyFailure = Object.assign(new Error('Expired checkpoint'), { status: 404 })
  await service.run({ schedule: true })
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_jobs'), 2)
  assert.ok(await scalar(db, 'select coverage_warning from crm_gmail_connections'))
  assert.ok(f.calls.some(call => call.endpoint === 'messages' && call.params.q.includes('after:')))
  assert.equal(await scalar(db, 'select history_id from crm_gmail_connections'), '100')
  assert.equal(await scalar(db, "select count(*)::int from crm_gmail_jobs where status='completed'"), 2)
})
test('operational tables and RPCs deny all browser roles', async t => {
  const f = await fixture(t), { db } = f
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`)
    for (const table of ['crm_gmail_connections','crm_gmail_oauth_states','crm_gmail_jobs','crm_gmail_worker']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
    await assert.rejects(db.query('select crm_gmail_schedule()'), /permission denied/)
    await assert.rejects(db.query('select crm_gmail_disconnect($1)', [CONSULTANT]), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  assert.equal(await scalar(db, 'select jsonb_array_length(crm_gmail_match_clients($1))', [JSON.stringify([contact.email])]), 1)
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_worker'), 1)
  await db.exec('reset role')
  const functions = (await db.query("select proname,prosecdef,proconfig from pg_proc where proname like 'crm_gmail_%'")).rows
  assert.ok(functions.every(fn => !fn.prosecdef && fn.proconfig.includes('search_path=""')))
})
test('Google adapter uses only read APIs, refresh form, safe errors and bounded timeouts', async () => {
  const requests = [], google = createGoogle(async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ access_token: 'fake', emailAddress: email }) } })
  await google.refresh('fake-refresh'); await google.api('fake-access','history',{ startHistoryId: '42' })
  assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token'); assert.equal(requests[1].options.headers.Authorization, 'Bearer fake-access')
  assert.ok(requests.every(r => r.options.signal))
  const failing = createGoogle(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'SECRET PERSONAL DATA' }) }))
  await assert.rejects(failing.refresh('fake'), error => error.code === 'GMAIL_REVOKED' && !error.message.includes('SECRET'))
})
test('HTTP OAuth callback is public but state-protected; cron uses its own secret; ownership uses req.user.id', async t => {
  const f = await fixture(t)
  const target = require.resolve('./supabaseAdmin')
  require.cache[target] = { id: target, filename: target, loaded: true, exports: f.adapter }
  const { createHandlers } = require('../routes/crmGmail')
  const express = require('express'), app = express(), handlers = createHandlers(f.service)
  app.use(express.json())
  app.get('/api/crm/gmail/callback', handlers.callback)
  app.get('/api/cron/crm-gmail-sync', handlers.syncCron)
  app.get('/api/cron/crm-gmail-worker', handlers.workerCron)
  app.use((req, res, next) => { req.user = { id: CONSULTANT }; next() })
  app.use('/api/crm/gmail', handlers.router)
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  process.env.CRON_SECRET = 'synthetic-cron-secret'
  for (const endpoint of ['sync','worker']) {
    assert.equal((await fetch(base + `/api/cron/crm-gmail-${endpoint}`)).status, 401)
    assert.equal((await fetch(base + `/api/cron/crm-gmail-${endpoint}`, { headers: { Authorization: 'Bearer wrong-secret' } })).status, 401)
    assert.equal((await fetch(base + `/api/cron/crm-gmail-${endpoint}`, { headers: { Authorization: 'Bearer synthetic-cron-secret' } })).status, 200)
  }
  const invalid = await fetch(base + '/api/crm/gmail/callback?state=bad&code=bad', { redirect: 'manual' })
  assert.equal(invalid.status, 303); assert.match(invalid.headers.get('location'), /gmail=INVALID_STATE/)
  const start = await fetch(base + '/api/crm/gmail/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: OTHER }) })
  assert.equal(start.status, 200)
  const cookie = start.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/)
  const { url } = await start.json(), state = new URL(url).searchParams.get('state')
  const callback = await fetch(base + `/api/crm/gmail/callback?state=${state}&code=synthetic`, { headers: { Cookie: cookie.split(';')[0] }, redirect: 'manual' })
  assert.equal(callback.status, 303); assert.match(callback.headers.get('location'), /gmail=connected/)
  assert.equal(await scalar(f.db, 'select user_id from crm_gmail_connections'), CONSULTANT)
  const response = await fetch(base + '/api/crm/gmail/status'), text = await response.text()
  assert.match(text, /consultant@fyndbridge.in/); assert.doesNotMatch(text, /credentials|refresh_token|access_token|synthetic-access/)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})
test('expired leases recover, revoked tokens require reauthorization, invalid output retries without field writes', async t => {
  const f = await fixture(t), { db, service } = f
  await f.connect(); f.failAi = Object.assign(new Error('Invalid output'), { code: 'INVALID_AI_OUTPUT' })
  await service.run({ schedule: true })
  assert.equal(await scalar(db, 'select last_error from crm_gmail_jobs'), 'INVALID_AI_OUTPUT')
  await db.exec("update crm_gmail_jobs set available_at=now()")
  f.failAi = null
  f.google.api = async () => { throw Object.assign(new Error('Revoked'), { status: 401 }) }
  f.google.refresh = async () => { throw Object.assign(new Error('Revoked'), { code: 'GMAIL_REVOKED' }) }
  await service.run()
  assert.equal(await scalar(db, 'select status from crm_gmail_connections'), 'reauthorization_required')
  assert.equal(await scalar(db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 0)
})
test('unmatched/ambiguous metadata never reaches full message fetch or Gemini; contact changes fence commit', async t => {
  const f = await fixture(t), { db, service } = f
  await f.connect()
  await db.query("update crm_clients set contacts=$1", [JSON.stringify([{ ...contact, email: 'not-matching@client.test' }])])
  await service.run({ schedule: true })
  assert.equal(f.aiCalls, 0); assert.ok(!f.calls.some(call => call.params?.format === 'full'))
  assert.equal(await scalar(db, 'select outcome from crm_gmail_jobs'), 'unrelated')
  await db.query('update crm_clients set contacts=$1', [JSON.stringify([contact])])
  await f.adapter.rpc('crm_save', { p_actor: CONSULTANT, p_id: null, p_version: null, p_data: { organisation_name: 'Ambiguous Gmail Client', contacts: [contact] } })
  f.page = { historyId: '105', history: [{ messagesAdded: [{ message: { id: 'ambiguous' } }] }] }
  await service.run({ schedule: true })
  assert.equal(f.aiCalls, 0); assert.equal(await scalar(db, "select outcome from crm_gmail_jobs where message_id='ambiguous'"), 'ambiguous')
})
test('one hourly discovery queues bounded work; later worker runs drain it without polling the mailbox again', async t => {
  const f = await fixture(t), { db, service } = f
  await f.connect()
  f.page = { historyId: '200', history: [{ messagesAdded: Array.from({ length: 25 }, (_, index) => ({ message: { id: `batch-${index}` } })) }] }
  await service.run({ schedule: true })
  const first = await scalar(db, "select count(*)::int from crm_gmail_jobs where status='completed'")
  assert.ok(first > 0 && first <= 12)
  await service.run(); await service.run()
  assert.equal(await scalar(db, "select count(*)::int from crm_gmail_jobs where status='completed'"), 25)
  assert.equal(f.calls.filter(call => call.endpoint === 'history').length, 1)
  assert.equal(await scalar(db, 'select count(*)::int from crm_gmail_jobs'), 25)
})
test('database completion rejects a newly ambiguous contact and invalidates consumed OAuth on disconnect', async t => {
  const f = await fixture(t), c = await f.connect(), lease = crypto.randomUUID()
  await f.db.query('insert into crm_gmail_jobs(connection_id,message_id) values($1,$2)', [c.id,'contact-race'])
  const job = (await f.adapter.rpc('crm_gmail_claim_job', { p_lease: lease })).data
  await f.adapter.rpc('crm_save', { p_actor: CONSULTANT, p_id: null, p_version: null, p_data: { organisation_name:'Second exact contact organisation',contacts:[contact] } })
  const completion = await f.adapter.rpc('crm_gmail_finish_job', { p_id: job.id,p_lease:lease,p_client:f.client.id,p_metadata:{ direction:'incoming',sender:contact.email,recipients:[email] },p_outcome:'activity_created' })
  assert.equal(completion.data,false)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"),0)
  assert.equal(await scalar(f.db,"select outcome from crm_gmail_jobs where id=$1",[job.id]),'contact_changed_or_ambiguous')
  const start = await f.service.start(CONSULTANT), state = new URL(start.url).searchParams.get('state')
  const { hash } = require('./crmGmailGoogle')
  await f.adapter.rpc('crm_gmail_consume_state',{p_hash:hash(state),p_browser:hash(start.browser)})
  await f.service.disconnect(CONSULTANT)
  const reconnect = await f.adapter.rpc('crm_gmail_connect',{p_hash:hash(state),p_user:CONSULTANT,p_email:email,p_credentials:encrypt({refresh_token:'fake'},CONSULTANT),p_history:'200'})
  assert.ok(reconnect.error)
  assert.equal(await scalar(f.db,'select count(*)::int from crm_gmail_connections'),0)
})
test('page enqueue failure rolls back checkpoint advancement; expired leases cannot commit', async t => {
  const f = await fixture(t), c = await f.connect(), lease = crypto.randomUUID()
  await f.adapter.rpc('crm_gmail_schedule')
  await f.adapter.rpc('crm_gmail_claim_sync',{p_lease:lease})
  const failed = await f.adapter.rpc('crm_gmail_commit_page',{p_id:c.id,p_lease:lease,p_ids:[''],p_history:'999',p_page:null,p_recovery:{}})
  assert.ok(failed.error); assert.equal(await scalar(f.db,'select history_id from crm_gmail_connections'),'100')
  assert.equal(await scalar(f.db,'select count(*)::int from crm_gmail_jobs'),0)
  await f.db.exec("update crm_gmail_connections set lease_until=now()-interval '1 second'")
  const expired = await f.adapter.rpc('crm_gmail_commit_page',{p_id:c.id,p_lease:lease,p_ids:['m2'],p_history:'999',p_page:null,p_recovery:{}})
  assert.equal(expired.data,false); assert.equal(await scalar(f.db,'select history_id from crm_gmail_connections'),'100')
})
test('Gmail quota reasons are retryable rather than mistaken for revoked authorization', async () => {
  for (const [reason,code] of [['dailyLimitExceeded','GMAIL_DAILY_QUOTA'],['rateLimitExceeded','GMAIL_RATE_LIMIT'],['userRateLimitExceeded','GMAIL_RATE_LIMIT']]) {
    const google = createGoogle(async () => ({ok:false,status:403,json:async()=>({error:{errors:[{reason}],message:'Private provider response'}})}))
    await assert.rejects(google.api('fake','history'), error => error.code===code && error.status===429 && !error.message.includes('Private'))
  }
})
test('confirmed work identity is server-authoritative and current CRM access is checked', async t => {
  const f = await fixture(t), { verifiedConsultant } = require('./crmGmail')
  f.adapter.auth = { admin: { getUserById: async id => ({ data:{user:{id,email,email_confirmed_at:new Date().toISOString(),user_metadata:{email:'attacker@other.test'}}} }) } }
  const access = { getPageViewPermission:async()=> 'everyone' }
  assert.equal(await verifiedConsultant(f.adapter, CONSULTANT, access),email)
  await assert.rejects(verifiedConsultant(f.adapter,CONSULTANT,{getPageViewPermission:async()=>null}),{code:'ACCESS_DENIED'})
  f.adapter.auth.admin.getUserById = async () => ({data:{user:{email,email_confirmed_at:null}}})
  await assert.rejects(verifiedConsultant(f.adapter,CONSULTANT,access),{code:'WORK_EMAIL_REQUIRED'})
  f.adapter.auth.admin.getUserById = async () => ({data:{user:{email:'outsider@gmail.com',email_confirmed_at:new Date().toISOString()}}})
  await assert.rejects(verifiedConsultant(f.adapter,CONSULTANT,access),{code:'WORK_EMAIL_REQUIRED'})
})
test('interrupted successful Gmail responses remain retryable instead of masquerading as empty messages', async () => {
  const google = createGoogle(async () => ({ ok:true,status:200,json:async()=>{ throw new Error('Interrupted response') } }))
  await assert.rejects(google.api('fake','messages/m1'),{code:'GMAIL_NETWORK',status:503})
})
