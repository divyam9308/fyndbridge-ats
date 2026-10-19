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
  await db.query('insert into auth.users values($1,$2)', [USER_ID, 'recruiter@fyndbridge.in'])
  await db.query("insert into employee_statuses(user_id,status) values($1,'active')", [USER_ID])
  await db.query('insert into user_profiles(user_id,name,email) values($1,$2,$3)', [USER_ID, 'Test Recruiter', 'recruiter@fyndbridge.in'])
  const adapter = databaseAdapter(db)
  const rpc = adapter.rpc
  adapter.rpc = async (...args) => { const result = await rpc(...args); if (result.error) result.error.details = result.error.detail; return result }
  const target = require.resolve('../src/services/supabaseAdmin')
  require.cache[target] = { id: target, filename: target, loaded: true, exports: adapter }
  const express = require('express'), app = express()
  let failSave = false
  app.use(require('cors')()); app.use(express.json())
  app.use((req, res, next) => { req.user = req.get('x-test-anonymous') ? null : { id: req.get('x-test-user') || USER_ID, email: 'recruiter@fyndbridge.in' }; next() })
  app.use('/api/crm', (req,res,next) => { if (failSave && ['POST','PATCH'].includes(req.method)) { failSave = false; return res.status(503).json({ error: 'Synthetic network failure. Retry your save.' }) } next() }, require('../src/middleware/requireAuth'), require('../src/routes/crm'))
  app.get('/test/state', async (req, res) => res.json({ clients: (await db.query('select * from crm_clients')).rows, comments: (await db.query('select * from crm_comments order by created_at desc,id desc')).rows, activities: (await db.query('select * from crm_activities')).rows, ats: (await db.query('select * from clients')).rows }))
  app.get('/test/permissions', async (req,res) => res.json((await db.query('select * from page_view_permissions')).rows))
  app.post('/test/permission', async (req,res) => { await db.query("update page_view_permissions set view_permission=$1 where page_key='crm'", [req.body.permission]); res.json({ ok: true }) })
  app.post('/test/fail-save', (req,res) => { failSave = true; res.json({ ok: true }) })
  app.post('/test/concurrent', async (req,res) => {
    const saved = await adapter.rpc('crm_save', { p_actor: OTHER, p_id: req.body.id, p_version: req.body.version, p_data: { status: 'Negotiation' } })
    res.json(saved)
  })
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, USER_ID, ADMIN, CONSULTANT, OTHER, INACTIVE }))
  process.on('message', async message => { if (message === 'close') { server.close(); await db.close(); process.exit(0) } })
}
start().catch(error => { console.error(error); process.exit(1) })
