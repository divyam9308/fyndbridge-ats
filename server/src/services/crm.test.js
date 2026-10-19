const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createDatabase, CONSULTANT, OTHER, INACTIVE, CLIENT } = require('../../test-support/assignedCandidatesSchema.cjs')
const { normalizeClientName } = require('../../../shared/clientNames.cjs')
const MIGRATION = path.resolve(__dirname, '../../../supabase/migrations/20261019105523_business_development_crm.sql')
const contact = { name: 'HR Contact', mobile: '+91 98765 43210', email: 'hr@example.test', designation: '', linkedin: '' }
async function createCrmDatabase() { const db = await createDatabase(); await db.exec(await fs.readFile(MIGRATION, 'utf8')); return db }
async function save(db, data, record = null, actor = CONSULTANT) { return (await db.query('select crm_save($1,$2,$3,$4) as data', [actor, record?.id || null, record?.version || null, JSON.stringify(data)])).rows[0].data }
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
test('CRM migration: transactions, persistence, duplicates, audit, concurrency and access control', async t => {
  const db = await createCrmDatabase(); t.after(() => db.close())
  let minimal, multiple
  await t.test('mandatory fields alone save; optional fields stay null; creation date and actor are authoritative', async () => {
    minimal = await save(db, { organisation_name: 'CRM Minimal', contacts: [contact], created_at: '2000-01-01', created_by: INACTIVE })
    assert.equal(minimal.assigned_consultant_id, CONSULTANT); assert.equal(minimal.created_by, CONSULTANT)
    assert.ok(new Date(minimal.created_at).getFullYear() > 2020)
    for (const key of ['sector', 'status', 'connected_through', 'conversion_probability', 'next_follow_up_date', 'latest_comment']) assert.equal(minimal[key], null)
    assert.equal(await scalar(db, 'select count(*)::int from crm_comments'), 0)
    assert.equal(await scalar(db, 'select count(*)::int from clients'), 1)
  })
  await t.test('multiple contacts remain one record; assignment override and initial comment persist', async () => {
    multiple = await save(db, { organisation_name: 'CRM Multiple', contacts: [contact, { ...contact, name: 'Other HR', email: 'other@example.test', mobile: '9876543211' }], assigned_consultant_id: OTHER, comment: 'Initial outreach' })
    assert.equal(multiple.contacts.length, 2); assert.equal(multiple.assigned_consultant_id, OTHER)
    assert.equal(multiple.latest_comment.body, 'Initial outreach')
    assert.equal(await scalar(db, 'select count(*)::int from crm_clients'), 2)
  })
  await t.test('name normalization matches Clients including whitespace, case and invisible characters', async () => {
    for (const name of ['  CRM   Minimal ', 'crm MINIMAL', '\u200bCRM Minimal\ufeff', 'CRM\tMinimal', 'CRM\u00a0Minimal']) {
      assert.equal(await scalar(db, 'select crm_normalize_name($1)', [name]), normalizeClientName(name))
      await assert.rejects(save(db, { organisation_name: name, contacts: [contact] }), error => error.code === '23505')
    }
  })
  await t.test('ATS duplicates block until explicit existing-client selection; no ATS write occurs', async () => {
    await assert.rejects(save(db, { organisation_name: ' example client ', contacts: [contact] }), error => error.code === '23505' && JSON.parse(error.detail).source === 'clients')
    const linked = await save(db, { organisation_name: 'Example Client', contacts: [contact], ats_client_id: CLIENT })
    assert.equal(linked.ats_client_id, CLIENT)
    assert.equal(await scalar(db, 'select count(*)::int from clients'), 1)
  })
  await t.test('self-edit allowed, creation unchanged, actual changes audited and comments append', async () => {
    const original = multiple
    multiple = await save(db, { organisation_name: 'CRM Multiple', status: 'Proposal Sent', conversion_probability: '50-75%', connected_through: 'Referral', assigned_consultant_id: CONSULTANT, next_follow_up_date: '2026-10-20', comment: 'Follow-up sent' }, multiple)
    assert.equal(multiple.created_at, original.created_at)
    const history = (await db.query('select * from crm_comments where crm_client_id=$1 order by created_at desc,id desc', [multiple.id])).rows
    assert.equal(history.length, 2)
    const events = (await db.query('select * from crm_activities where crm_client_id=$1', [multiple.id])).rows
    assert.ok(events.some(event => event.activity_type === 'status_changed' && event.new_value === 'Proposal Sent'))
    assert.ok(events.some(event => event.activity_type === 'assigned_consultant_id_changed' && event.previous_value === OTHER))
    assert.equal(events.filter(event => event.activity_type === 'comment_added').length, 2)
    const count = events.length
    multiple = await save(db, { status: 'Proposal Sent' }, multiple)
    assert.equal(await scalar(db, 'select count(*)::int from crm_activities where crm_client_id=$1', [multiple.id]), count)
    await assert.rejects(save(db, { status: 'Won' }, original), error => error.code === '40001')
  })
  await t.test('invalid contacts, missing mandatory data, unsafe URLs and invalid enums roll back atomically', async () => {
    for (const bad of [{ contacts: [] }, { organisation_name: '\u200b' }, { contacts: [contact, contact] }, { contacts: [{ ...contact, name: '' }] }, { contacts: [{ ...contact, mobile: '' }] }, { contacts: [{ ...contact, email: 'invalid' }] }, { contacts: [{ ...contact, linkedin: 'javascript:alert(1)' }] }, { status: 'Invalid' }, { conversion_probability: '100%' }]) {
      const before = await scalar(db, 'select count(*)::int from crm_activities')
      await assert.rejects(save(db, { organisation_name: 'Invalid fixture', contacts: [contact], comment: 'Must roll back', ...bad }))
      assert.equal(await scalar(db, 'select count(*)::int from crm_activities'), before)
    }
  })
  await t.test('inactive assignees and actors rejected; historical inactive assignment retained', async () => {
    await assert.rejects(save(db, { organisation_name: 'Inactive', contacts: [contact], assigned_consultant_id: INACTIVE }), /active consultants/)
    await assert.rejects(save(db, { status: 'Won' }, minimal, INACTIVE), /Active employee/)
    const beforeDeparture = await save(db, { organisation_name: 'Historical Assignment', contacts: [contact], assigned_consultant_id: OTHER })
    await db.query("update employee_statuses set status='inactive' where user_id=$1", [OTHER])
    const historical = await save(db, { status: 'Won' }, beforeDeparture)
    assert.equal(historical.status, 'Won'); assert.equal(historical.assigned_consultant_id, OTHER)
    await db.query("update employee_statuses set status='active' where user_id=$1", [OTHER])
  })
  await t.test('paginated search covers contacts and sector; follow-up boundaries use supplied company date', async () => {
    const list = async (search, follow) => scalar(db, "select crm_list($1,$2,'2026-10-20',1,1,'organisation_name',true)", [search, follow])
    assert.equal((await list('other@example.test', 'all')).total, 1)
    assert.equal((await list('', 'today')).total, 1)
    assert.equal((await list('', 'none')).total, 3)
    assert.equal((await list('', 'overdue')).total, 0)
    assert.equal((await list('', 'upcoming')).total, 0)
    assert.equal((await list('', 'all')).data.length, 1)
  })
  await t.test('browser roles cannot access tables or spoof actors through RPC; service role works', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      for (const table of ['crm_clients', 'crm_comments', 'crm_activities']) {
        await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
        await assert.rejects(db.query(`delete from ${table}`), /permission denied/)
      }
      await assert.rejects(save(db, { status: 'Won' }, minimal), /permission denied/)
      await assert.rejects(db.query("select crm_duplicate('CRM Minimal',null)"), /permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    minimal = await save(db, { comment: 'Service-backed authenticated route' }, minimal)
    assert.ok(minimal.latest_comment)
    await db.exec('reset role')
  })
})
