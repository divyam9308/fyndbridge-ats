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
async function fixture(t, { historicalMigration = true } = {}) {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  process.env.GOOGLE_GMAIL_CLIENT_ID = 'synthetic-client'
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'synthetic-secret'
  process.env.GOOGLE_GMAIL_REDIRECT_URI = 'https://example.test/api/crm/gmail/callback'
  const db = await createDatabase(); t.after(() => db.close())
  for (const name of ['20261019105523_business_development_crm.sql', migration, '20261019182711_crm_gmail_manual_sync.sql', ...(historicalMigration ? ['20261023094350_crm_gmail_historical_sync.sql'] : [])]) await db.exec(await fs.readFile(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8'))
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
      if (endpoint === 'messages') return { messages: params.q.startsWith('after:') ? [{ id: 'recovered' }] : [] }
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
  assert.deepEqual(Object.keys(await service.status(CONSULTANT)).sort(), ['backfill_completed_at','backfill_started_at','connected','coverage_warning','email','last_error','last_sync_at','status'])
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
  const resumeAt = new Date(await scalar(db, 'select ai_resume_at from crm_gmail_worker')).getTime()
  assert.equal(new Date(retry.available_at).getTime(), resumeAt)
  assert.ok(resumeAt > Date.now() + 55000 && resumeAt <= Date.now() + 60000)
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
    for (const name of ['request_manual_sync','manual_sync_status']) await assert.rejects(db.query(`select crm_gmail_${name}($1)`, [CONSULTANT]), /permission denied/)
    for (const name of ['claim_user_sync','claim_user_job']) await assert.rejects(db.query(`select crm_gmail_${name}($1,$2)`, [crypto.randomUUID(), CONSULTANT]), /permission denied/)
    await assert.rejects(db.query('select crm_gmail_commit_backfill_page($1,$2,$3,$4)', [crypto.randomUUID(),crypto.randomUUID(),'[]',null]), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  assert.equal((await scalar(db, 'select crm_gmail_request_manual_sync($1)', [CONSULTANT])).state, 'not_connected')
  assert.equal((await scalar(db, 'select crm_gmail_manual_sync_status($1)', [CONSULTANT])).connection.connected, false)
  assert.equal(await scalar(db, 'select crm_gmail_claim_user_sync($1,$2)', [crypto.randomUUID(), CONSULTANT]), null)
  assert.equal(await scalar(db, 'select crm_gmail_claim_user_job($1,$2)', [crypto.randomUUID(), CONSULTANT]), null)
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
  const sync = await fetch(base + '/api/crm/gmail/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: OTHER }) })
  assert.equal(sync.status, 200)
  const summary = await sync.text()
  assert.match(summary, /consultant@fyndbridge.in/); assert.doesNotMatch(summary, /credentials|refresh_token|access_token|synthetic-access/)
  assert.equal(sync.headers.get('cache-control'), 'private, no-store')
  const repeated = await fetch(base + '/api/crm/gmail/sync', { method: 'POST' })
  assert.equal(repeated.status, 429); assert.ok(Number(repeated.headers.get('retry-after')) > 0)
})
test('manual sync discovers and analyses immediately, scopes both claims to the owner and deduplicates repeated syncs', async t => {
  const f = await fixture(t), c = await f.connect()
  const other = (await f.db.query("insert into crm_gmail_connections(user_id,email,credentials,history_id,sync_requested) values($1,'other@fyndbridge.in','unusable-other-credentials','99',true) returning id", [OTHER])).rows[0]
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id) values($1,'other-message')", [other.id])
  const result = await f.service.syncNow(CONSULTANT)
  assert.equal(result.state, 'completed'); assert.equal(result.connection.email, email)
  assert.ok(result.connection.last_sync_at); assert.equal(result.pending_jobs, 0)
  assert.equal(f.aiCalls, 1)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 1)
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections where id=$1', [other.id]), '99')
  assert.equal(await scalar(f.db, 'select status from crm_gmail_jobs where connection_id=$1', [other.id]), 'pending')
  assert.equal(await scalar(f.db, 'select last_manual_sync_at from crm_gmail_connections where id=$1', [other.id]), null)
  await assert.rejects(f.service.syncNow(CONSULTANT), { code: 'SYNC_COOLDOWN' })
  await f.db.query("update crm_gmail_connections set last_manual_sync_at=now()-interval '31 seconds' where id=$1", [c.id])
  assert.equal((await f.service.syncNow(CONSULTANT)).state, 'completed')
  assert.equal(f.aiCalls, 1)
})
test('manual sync imports all fourteen historical pages, resumes across workers and rechecks old mail for new contacts without duplicate analysis', async t => {
  const f = await fixture(t), c = await f.connect()
  const originalApi = f.google.api, listed = [], fullFetches = []
  const ids = [...Array.from({ length: 40 }, (_, index) => `old-${index + 1}`), 'old-unrelated', 'old-spam']
  f.page = { historyId: '101', history: [{ messagesAdded: [{ message: { id: 'old-1' } }] }] }
  f.google.api = async (access, endpoint, params) => {
    if (endpoint === 'messages') {
      listed.push({ ...params })
      const page = Number(params.pageToken || 0), start = page * 3
      return { messages: ids.slice(start, start + 3).map(id => ({ id })), ...(start + 3 < ids.length ? { nextPageToken: String(page + 1) } : {}) }
    }
    if (endpoint.startsWith('messages/old-')) {
      const id = endpoint.split('/')[1], item = message(id, Number(id.slice(4)) % 2 === 0)
      if (params.format === 'full') fullFetches.push(id)
      item.internalDate = String(Date.UTC(2018, 0, 1))
      if (id === 'old-unrelated') item.payload.headers[0].value = 'new@client.test'
      if (id === 'old-spam') item.labelIds = ['SPAM']
      return item
    }
    return originalApi(access, endpoint, params)
  }
  await f.service.run({ schedule: true })
  assert.equal(f.aiCalls, 0)
  assert.equal(await scalar(f.db, "select outcome from crm_gmail_jobs where message_id='old-1'"), 'before_connection')
  assert.equal(await scalar(f.db, 'select backfill_started_at from crm_gmail_connections'), null)
  const result = await f.service.syncNow(CONSULTANT)
  assert.equal(result.state, 'pending')
  assert.equal(result.backfill_pending, true)
  assert.ok(await scalar(f.db, 'select backfill_page_token from crm_gmail_connections'))
  let restartedAi = 0
  const resumed = createGmailService({ db: f.adapter, google: f.google, authorize: async () => email, ai: async () => { restartedAi++; return structuredClone(insight) } })
  for (let run = 0; run < 8; run++) {
    const progress = (await f.adapter.rpc('crm_gmail_manual_sync_status', { p_user: CONSULTANT })).data
    if (!progress.pending_jobs && !progress.backfill_pending) break
    await resumed.run()
  }
  const complete = (await f.adapter.rpc('crm_gmail_manual_sync_status', { p_user: CONSULTANT })).data
  assert.equal(complete.pending_jobs, 0); assert.equal(complete.backfill_pending, false)
  assert.ok(complete.connection.backfill_completed_at)
  assert.equal(listed.length, 14)
  assert.deepEqual(listed.map(page => page.pageToken || null), [null,...Array.from({ length: 13 }, (_, index) => String(index + 1))])
  assert.ok(listed.every(page => page.q.startsWith('before:') && !page.q.includes('after:')))
  assert.equal(f.aiCalls + restartedAi, 40)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 40)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where email_metadata->>'email_at'='2018-01-01T00:00:00.000Z'"), 40)
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections'), '101')
  assert.equal(fullFetches.length, 40)
  assert.ok(!fullFetches.includes('old-unrelated')); assert.ok(!fullFetches.includes('old-spam'))
  const newClient = await f.adapter.rpc('crm_save', { p_actor: CONSULTANT, p_id: null, p_version: null, p_data: { organisation_name: 'New historical contact', contacts: [{ ...contact, email: 'new@client.test', mobile: '9876543212' }] } })
  assert.ifError(newClient.error)
  await f.db.query("update crm_gmail_connections set last_manual_sync_at=now()-interval '31 seconds' where id=$1", [c.id])
  await f.service.syncNow(CONSULTANT)
  for (let run = 0; run < 4; run++) await resumed.run()
  assert.equal(f.aiCalls + restartedAi, 41)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 41)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where gmail_message_id='old-1'"), 1)
})
test('historical page commits are atomic, lease-fenced and keep their cursor when manual sync is repeated', async t => {
  const f = await fixture(t), c = await f.connect(), lease = crypto.randomUUID()
  await f.adapter.rpc('crm_gmail_request_manual_sync', { p_user: CONSULTANT })
  const startedAt = await scalar(f.db, 'select backfill_started_at from crm_gmail_connections')
  await f.db.exec("update crm_gmail_connections set sync_requested=false,page_token='incremental-cursor'")
  await f.adapter.rpc('crm_gmail_claim_user_sync', { p_lease: lease, p_user: CONSULTANT })
  const args = { p_id: c.id, p_lease: lease, p_ids: [''], p_page: 'next-historical-page' }
  const failed = await f.adapter.rpc('crm_gmail_commit_backfill_page', args)
  assert.ok(failed.error)
  assert.equal(await scalar(f.db, 'select backfill_page_token from crm_gmail_connections'), null)
  assert.equal(await scalar(f.db, 'select count(*)::int from crm_gmail_jobs'), 0)
  await f.db.exec("update crm_gmail_connections set lease_until=now()-interval '1 second'")
  assert.equal((await f.adapter.rpc('crm_gmail_commit_backfill_page', { ...args, p_ids: ['old-message'] })).data, false)
  await f.db.exec("update crm_gmail_connections set lease_until=now()+interval '1 minute'")
  assert.equal((await f.adapter.rpc('crm_gmail_commit_backfill_page', { ...args, p_lease: crypto.randomUUID(), p_ids: ['old-message'] })).data, false)
  assert.equal((await f.adapter.rpc('crm_gmail_commit_backfill_page', { ...args, p_ids: ['old-message'] })).data, true)
  await f.db.exec("update crm_gmail_connections set last_manual_sync_at=now()-interval '31 seconds'")
  await f.adapter.rpc('crm_gmail_request_manual_sync', { p_user: CONSULTANT })
  assert.equal(String(await scalar(f.db, 'select backfill_started_at from crm_gmail_connections')), String(startedAt))
  assert.equal(await scalar(f.db, 'select backfill_page_token from crm_gmail_connections'), 'next-historical-page')
  assert.equal(await scalar(f.db, 'select page_token from crm_gmail_connections'), 'incremental-cursor')
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections'), '100')
})
test('an expired historical page cursor restarts listing without replacing the incremental checkpoint', async t => {
  const f = await fixture(t); await f.connect()
  await f.db.exec("update crm_gmail_connections set backfill_started_at=now(),backfill_page_token='expired-cursor',sync_requested=false")
  const originalApi = f.google.api, tokens = []
  f.google.api = async (access, endpoint, params) => {
    if (endpoint === 'messages') {
      tokens.push(params.pageToken || null)
      if (params.pageToken) throw Object.assign(new Error('Expired list cursor'), { status: 400 })
      return { messages: [{ id: 'old-restored' }] }
    }
    const result = await originalApi(access, endpoint, params)
    if (endpoint === 'messages/old-restored') result.internalDate = String(Date.UTC(2018, 0, 1))
    return result
  }
  await f.service.run()
  assert.deepEqual(tokens, ['expired-cursor',null])
  assert.ok(await scalar(f.db, 'select backfill_completed_at from crm_gmail_connections'))
  assert.equal(await scalar(f.db, 'select history_id from crm_gmail_connections'), '100')
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 1)
})
test('AI minute quota resumes the same queued email after one minute instead of a daily pause', async t => {
  const f = await fixture(t); await f.connect()
  f.failAi = Object.assign(new Error('Minute limit'), { statusCode: 429, code: 'AI_QUOTA_REACHED' })
  const paused = await f.service.syncNow(CONSULTANT)
  assert.equal(paused.state, 'quota_paused')
  assert.equal(paused.pending_jobs, 1); assert.equal(f.aiCalls, 1)
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 0)
  await f.service.run(); assert.equal(f.aiCalls, 1)
  f.failAi = null
  // Expire the persisted minute, without waiting or altering production records.
  await f.db.exec("update crm_gmail_worker set ai_resume_at=now()-interval '1 second'; update crm_gmail_jobs set available_at=now()-interval '1 second'")
  await f.service.run()
  assert.equal(f.aiCalls, 2)
  assert.equal(await scalar(f.db, 'select status from crm_gmail_jobs'), 'completed')
  assert.equal(await scalar(f.db, "select count(*)::int from crm_activities where activity_type='gmail_email'"), 1)
})
test('historical migration shortens existing AI day-long pauses while preserving other retry schedules and service-only access', async t => {
  const f = await fixture(t, { historicalMigration: false }), c = await f.connect()
  await f.db.exec("update crm_gmail_worker set ai_resume_at=now()+interval '1 day'")
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id,status,last_error,available_at) values($1,'ai-paused','retryable_failure','QUOTA_PAUSED',now()+interval '1 day'),($1,'other-retry','retryable_failure','PROCESSING_FAILED',now()+interval '1 day')", [c.id])
  const original = await scalar(f.db, "select available_at from crm_gmail_jobs where message_id='other-retry'")
  await f.db.exec(await fs.readFile(path.resolve(__dirname, '../../../supabase/migrations/20261023094350_crm_gmail_historical_sync.sql'), 'utf8'))
  const delay = Number(await scalar(f.db, 'select extract(epoch from ai_resume_at-now()) from crm_gmail_worker'))
  assert.ok(delay > 55 && delay <= 60)
  assert.equal(await scalar(f.db, "select available_at=(select ai_resume_at from crm_gmail_worker) from crm_gmail_jobs where message_id='ai-paused'"), true)
  assert.equal(String(await scalar(f.db, "select available_at from crm_gmail_jobs where message_id='other-retry'")), String(original))
  const functions = (await f.db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon_allowed,has_function_privilege('authenticated',p.oid,'execute') as authenticated_allowed,has_function_privilege('service_role',p.oid,'execute') as service_allowed from pg_proc p where p.proname in ('crm_gmail_request_manual_sync','crm_gmail_claim_sync','crm_gmail_claim_user_sync','crm_gmail_commit_backfill_page','crm_gmail_manual_sync_status')")).rows
  assert.equal(functions.length, 5)
  for (const fn of functions) {
    assert.equal(fn.prosecdef, false)
    assert.equal(fn.anon_allowed, false); assert.equal(fn.authenticated_allowed, false); assert.equal(fn.service_allowed, true)
    assert.ok(fn.proconfig.some(option => option.startsWith('search_path=')))
  }
})
test('manual sync persists work when the worker is busy, then normal workers drain it without hourly discovery', async t => {
  const f = await fixture(t); await f.connect()
  await f.db.exec("update crm_gmail_worker set lease_id='00000000-0000-4000-8000-000000000001',lease_until=now()+interval '1 minute'")
  const result = await f.service.syncNow(CONSULTANT)
  assert.equal(result.state, 'pending'); assert.equal(result.discovery_pending, true); assert.equal(f.aiCalls, 0)
  await f.db.exec('update crm_gmail_worker set lease_until=null,lease_id=null')
  await f.service.run()
  assert.equal(f.aiCalls, 1)
})
test('manual sync respects provider backoff, the quota pause and persisted per-user cooldown under concurrent clicks', async t => {
  const f = await fixture(t), c = await f.connect()
  await f.db.query("update crm_gmail_connections set next_attempt_at=now()+interval '1 day' where id=$1", [c.id])
  const next = await scalar(f.db, 'select next_attempt_at from crm_gmail_connections where id=$1', [c.id])
  await f.db.query("insert into crm_gmail_jobs(connection_id,message_id) values($1,'quota-waiting')", [c.id])
  await f.db.exec("update crm_gmail_worker set ai_resume_at=now()+interval '1 day'")
  const results = await Promise.allSettled([f.service.syncNow(CONSULTANT), f.service.syncNow(CONSULTANT)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'fulfilled').value.state, 'quota_paused')
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SYNC_COOLDOWN')
  assert.equal(String(await scalar(f.db, 'select next_attempt_at from crm_gmail_connections where id=$1', [c.id])), String(next))
  assert.equal(f.aiCalls, 0); assert.equal(f.calls.filter(c => c.endpoint === 'history').length, 0)
})
test('manual sync rejects disconnected/revoked/wrong-email access and reports provider failures without claiming success', async t => {
  const f = await fixture(t)
  await assert.rejects(f.service.syncNow(CONSULTANT), { code: 'NOT_CONNECTED' })
  const c = await f.connect()
  const denied = createGmailService({ db: f.adapter, google: f.google, authorize: async () => { throw Object.assign(new Error('Denied'), { code: 'ACCESS_DENIED' }) } })
  await assert.rejects(denied.syncNow(CONSULTANT), { code: 'ACCESS_DENIED' })
  const wrongEmail = createGmailService({ db: f.adapter, google: f.google, authorize: async () => 'changed@fyndbridge.in' })
  await assert.rejects(wrongEmail.syncNow(CONSULTANT), { code: 'WORK_EMAIL_CHANGED' })
  assert.equal(await scalar(f.db, 'select last_manual_sync_at from crm_gmail_connections where id=$1', [c.id]), null)
  f.historyFailure = Object.assign(new Error('Provider failure'), { code: 'GMAIL_RATE_LIMIT', status: 429 })
  assert.equal((await f.service.syncNow(CONSULTANT)).state, 'pending')
  assert.equal(await scalar(f.db, 'select last_error from crm_gmail_connections where id=$1', [c.id]), 'SYNC_RETRY')
  await f.db.query("update crm_gmail_connections set last_manual_sync_at=null,status='reauthorization_required' where id=$1", [c.id])
  await assert.rejects(f.service.syncNow(CONSULTANT), { code: 'REAUTHORIZE' })
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
