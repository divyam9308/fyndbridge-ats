// Browser -> real Express CRM routes -> isolated PostgreSQL migration.
const { createDatabase, ADMIN, CONSULTANT, OTHER, INACTIVE } = require('./assignedCandidatesSchema.cjs')
const { databaseAdapter } = require('./assignedCandidatesAdapter.cjs')
const { USER_ID } = require('./appliedCandidatesMemory.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
async function start() {
  for (const key of Object.keys(process.env)) if (/GEMINI.*KEY|SUPABASE.*KEY/.test(key)) delete process.env[key]
  const db = await createDatabase()
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261019105523_business_development_crm.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261020042221_crm_optional_contact_details.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261019110948_crm_probability_sorting.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261019165228_crm_gmail_integration.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261019182711_crm_gmail_manual_sync.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261023094350_crm_gmail_historical_sync.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261023112550_crm_gmail_shared_sync_and_client_history.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261023112559_crm_gmail_contact_search_and_event_time.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261023112611_crm_gmail_explicit_history_modes.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261019185136_crm_activity_read_receipts.sql'), 'utf8'))
  await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261021093133_crm_incoming_email_row_highlights.sql'), 'utf8'))
  await db.query('insert into auth.users values($1,$2)', [USER_ID, 'recruiter@fyndbridge.in'])
  await db.query("insert into employee_statuses(user_id,status) values($1,'active')", [USER_ID])
  await db.query('insert into user_profiles(user_id,name,email) values($1,$2,$3)', [USER_ID, 'Test Recruiter', 'recruiter@fyndbridge.in'])
  const adapter = databaseAdapter(db)
  const rpc = adapter.rpc
  adapter.rpc = async (...args) => { const result = await rpc(...args); if (result.error) result.error.details = result.error.detail; return result }
  const target = require.resolve('../src/services/supabaseAdmin')
  require.cache[target] = { id: target, filename: target, loaded: true, exports: adapter }
  // Real manual-sync orchestration with isolated synthetic Google/AI providers.
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  const { encrypt } = require('../src/services/crmGmailGoogle')
  const gmailTarget = require.resolve('../src/services/crmGmail')
  const gmailExports = require(gmailTarget)
  let missingGmailMessage = false
  let historicalMessages = false
  const gmailService = gmailExports.createGmailService({ db: adapter,
    authorize: async id => { if (![USER_ID,OTHER].includes(id)) throw Object.assign(new Error('Denied'), { code: 'ACCESS_DENIED' }); return id === OTHER ? 'other@fyndbridge.in' : 'recruiter@fyndbridge.in' },
    google: {
      revoke: async () => {},
      api: async (access, endpoint, params) => {
        if (endpoint === 'messages/missing-sync-message') throw Object.assign(new Error('Synthetic missing email'), { status: 404, code: 'GMAIL_API_ERROR' })
        if (endpoint === 'messages') return historicalMessages
          ? params.pageToken ? { messages: [{ id: 'historical-outgoing' }] } : { messages: [{ id: 'historical-incoming' }], nextPageToken: 'historical-page-2' }
          : { messages: [] }
        const id = endpoint.split('/')[1], historical = id?.startsWith('historical-'), outgoing = id === 'historical-outgoing', mailbox = access === 'synthetic-other-access' ? 'other@fyndbridge.in' : 'recruiter@fyndbridge.in'
        return endpoint === 'history' ? { historyId: '101', history: [{ messagesAdded: [{ message: { id: 'manual-sync-message' } }, ...(missingGmailMessage ? [{ message: { id: 'missing-sync-message' } }] : [])] }] } : {
        id, internalDate: String(Date.now() - (historical ? 90 * 86400000 : 0)), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: outgoing ? mailbox : 'hr@client.test' }, { name: 'To', value: outgoing ? 'hr@client.test' : mailbox }, { name: 'Subject', value: historical ? 'Historical recruitment email' : 'Manual sync meeting' }], body: { data: Buffer.from('Can we meet Friday at 2 PM? No requirements at present.').toString('base64url') } }
        }
      }
    },
    ai: async () => ({ summary: 'Client requested a meeting.', meeting: { status: 'proposed', when: 'Friday at 2 PM', evidence: 'Can we meet Friday at 2 PM?' }, negative_response: { category: 'no_requirements', permanence: 'temporary', evidence: 'No requirements at present.' }, sentiment: { label: 'neutral', evidence: 'No requirements at present.' } })
  })
  require.cache[gmailTarget].exports = { ...gmailExports, createGmailService: () => gmailService }
  const express = require('express'), app = express()
  let failSave = false
  app.use(require('cors')()); app.use(express.json())
  app.use((req, res, next) => { req.user = req.get('x-test-anonymous') ? null : { id: req.get('x-test-user') || USER_ID, email: 'recruiter@fyndbridge.in' }; next() })
  app.use('/api/crm', (req,res,next) => { if (failSave && ['POST','PATCH'].includes(req.method)) { failSave = false; return res.status(503).json({ error: 'Synthetic network failure. Retry your save.' }) } next() }, require('../src/middleware/requireAuth'), require('../src/routes/crm'))
  app.get('/test/state', async (req, res) => res.json({ clients: (await db.query('select * from crm_clients')).rows, comments: (await db.query('select * from crm_comments order by created_at desc,id desc')).rows, activities: (await db.query('select * from crm_activities')).rows, reads: (await db.query('select * from crm_activity_reads')).rows, ats: (await db.query('select * from clients')).rows }))
  app.get('/test/permissions', async (req,res) => res.json((await db.query('select * from page_view_permissions')).rows))
  app.post('/test/permission', async (req,res) => { await db.query("update page_view_permissions set view_permission=$1 where page_key='crm'", [req.body.permission]); res.json({ ok: true }) })
  app.post('/test/gmail', async (req, res) => {
    missingGmailMessage = Boolean(req.body.missingMessage)
    historicalMessages = Boolean(req.body.historicalMessages)
    const owner = req.body.otherMailbox ? OTHER : USER_ID, mailbox = req.body.otherMailbox ? 'other@fyndbridge.in' : 'recruiter@fyndbridge.in'
    const credentials = encrypt({ access_token: req.body.otherMailbox ? 'synthetic-other-access' : 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600000 }, owner)
    await db.query('insert into crm_gmail_connections(user_id,email,credentials,history_id,last_sync_at) values($1,$2,$3,$4,now()) on conflict(user_id) do nothing', [owner,mailbox,credentials,'100'])
    if (req.body.resetCooldown) await db.exec("update crm_gmail_worker set last_manual_sync_at=null; update crm_gmail_client_imports set requested_at=now()-interval '31 seconds'")
    res.json({ ok: true })
  })
  app.post('/test/gmail-activity', async (req, res) => {
    await db.query("insert into crm_activities(crm_client_id,activity_type,created_by,gmail_user_id,gmail_message_id,email_metadata) values($1,'gmail_email',$2,$2,$3,$4)", [req.body.client_id, USER_ID, req.body.message_id || 'browser-message', JSON.stringify(req.body.metadata)])
    res.json({ ok: true })
  })
  app.post('/test/fail-save', (req,res) => { failSave = true; res.json({ ok: true }) })
  app.post('/test/concurrent', async (req,res) => {
    const saved = await adapter.rpc('crm_save', { p_actor: OTHER, p_id: req.body.id, p_version: req.body.version, p_data: { status: 'Negotiation' } })
    res.json(saved)
  })
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, USER_ID, ADMIN, CONSULTANT, OTHER, INACTIVE }))
  process.on('message', async message => { if (message === 'close') { server.close(); await db.close(); process.exit(0) } })
}
start().catch(error => { console.error(error); process.exit(1) })
