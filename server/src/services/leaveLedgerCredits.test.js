const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { databaseAdapter } = require('../../test-support/assignedCandidatesAdapter.cjs')
const { employmentDatabase, STAFF_IDS } = require('../../test-support/employmentMemory.cjs')

let database
const supabasePath = require.resolve('./supabaseAdmin')
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, children: [], exports: new Proxy({}, {
  get(_target, key) { const value = database[key]; return typeof value === 'function' ? value.bind(database) : value }
}) }
const attendance = require('./attendanceService')
const migrations = path.resolve(__dirname, '../../../supabase/migrations')
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8')
const signature = 'public.insert_leave_ledger_credit(uuid,text,text,date,numeric,text,date)'

test('automatic leave credits skip existing rows atomically and preserve other failures', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.leave_requests(id uuid primary key, start_date date);
  `)
  const schema = read('20260712094233_attendance_leave_backend.sql')
  await db.exec(schema.match(/create table if not exists public\.leave_ledger \([\s\S]*?\n\);/)[0])
  await db.exec(read('20260712101329_leave_financial_year_carry_forward.sql'))
  await db.exec(read('20261125214831_leave_ledger_credit_insert_once.sql'))
  await db.exec('alter table public.leave_ledger enable row level security; grant usage on schema public to anon,authenticated,service_role; grant select,insert on public.leave_ledger to service_role;')
  for (const id of Object.values(STAFF_IDS)) await db.query('insert into auth.users values($1)', [id])
  const adapter = databaseAdapter(db)
  const memory = employmentDatabase('2026-11-26')
  const getUser = memory.auth.admin.getUserById
  memory.auth.admin.getUserById = async id => {
    const result = await getUser(id)
    result.data.user.created_at = '2026-07-01T00:00:00Z'
    return result
  }
  database = { ...memory, from: table => table === 'leave_ledger' ? adapter.from(table) : memory.from(table), rpc: adapter.rpc }
  const credit = overrides => adapter.rpc('insert_leave_ledger_credit', {
    p_user_id: STAFF_IDS.active, p_financial_year: 'FY 2026-27', p_entry_type: 'accrual',
    p_entry_date: '2026-08-01', p_amount: 1.5, p_description: 'Original credit', p_accrual_month: '2026-08-01', ...overrides
  })
  const rows = async () => (await db.query('select * from leave_ledger order by user_id,entry_type,accrual_month')).rows

  await t.test('repeated and overlapping calls retain exactly one original monthly credit', async () => {
    assert.equal((await credit()).data, true)
    const original = await rows()
    const results = await Promise.all(Array.from({ length: 24 }, () => credit({ p_amount: 3, p_description: 'Must not replace original' })))
    assert.ok(results.every(result => !result.error && result.data === false))
    assert.deepEqual(await rows(), original)
    assert.equal((await credit({ p_user_id: STAFF_IDS.onLeave })).data, true)
    assert.equal((await rows()).length, 2)
  })

  await t.test('opening balances, including zero, are credited only once per financial year', async () => {
    const args = { p_entry_type: 'opening_balance', p_entry_date: '2026-04-01', p_accrual_month: null, p_amount: 0 }
    assert.equal((await credit(args)).data, true)
    const original = await rows()
    assert.equal((await credit({ ...args, p_amount: 5 })).data, false)
    assert.deepEqual(await rows(), original)
    assert.equal((await credit({ ...args, p_financial_year: 'FY 2027-28', p_entry_date: '2027-04-01', p_amount: 5 })).data, true)
  })

  await t.test('foreign keys, checks, unsupported types and unrelated unique violations remain errors', async () => {
    assert.equal((await credit({ p_user_id: '00000000-0000-4000-8000-000000000000' })).error.code, '23503')
    assert.equal((await credit({ p_accrual_month: '2026-09-01', p_amount: -1 })).error.code, '23514')
    assert.equal((await credit({ p_accrual_month: null })).error.code, '22023')
    assert.equal((await credit({ p_financial_year: null })).error.code, '22023')
    assert.equal((await credit({ p_entry_type: 'adjustment' })).error.code, '22023')
    await db.exec("create unique index synthetic_other_credit_key on leave_ledger(description) where description='Unrelated unique key'")
    assert.equal((await credit({ p_accrual_month: '2026-09-01', p_description: 'Unrelated unique key' })).data, true)
    assert.equal((await credit({ p_accrual_month: '2026-10-01', p_description: 'Unrelated unique key' })).error.code, '23505')
    await db.exec('drop index synthetic_other_credit_key')
  })

  await t.test('only service_role can execute; function retains invoker security and fixed search path', async () => {
    const permissions = (await db.query(`select
      has_function_privilege('anon',$1,'execute') as anon,
      has_function_privilege('authenticated',$1,'execute') as authenticated,
      has_function_privilege('service_role',$1,'execute') as service_role,
      prosecdef,proconfig from pg_proc where oid=$1::regprocedure`, [signature])).rows[0]
    assert.equal(permissions.anon, false)
    assert.equal(permissions.authenticated, false)
    assert.equal(permissions.service_role, true)
    assert.equal(permissions.prosecdef, false)
    assert.ok(permissions.proconfig.some(setting => setting.startsWith('search_path=')))
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`)
      try {
        const result = await credit({ p_accrual_month: '2026-11-01' })
        if (role === 'service_role') assert.equal(result.data, true)
        else assert.equal(result.error.code, '42501')
      } finally { await db.exec('reset role') }
    }
  })

  await t.test('real balance service catches up missing months and leaves historical rows unchanged on reload', async () => {
    await db.exec('truncate leave_ledger')
    await db.query(`insert into leave_ledger(user_id,entry_date,entry_type,amount,financial_year,description)
      values($1,'2026-08-01','adjustment',2,'FY 2026-27','Historical adjustment')`, [STAFF_IDS.active])
    const before = await rows()
    const first = await attendance.leaveBalanceSummary(STAFF_IDS.active, 'FY 2026-27', '2026-11-26')
    assert.equal(first.accrued_leave, 6)
    assert.equal(first.available_balance, 8)
    const saved = await rows()
    const repeated = await Promise.all(Array.from({ length: 4 }, () => attendance.leaveBalanceSummary(STAFF_IDS.active, 'FY 2026-27', '2026-11-26')))
    assert.ok(repeated.every(summary => summary.available_balance === 8))
    assert.deepEqual(await rows(), saved)
    assert.deepEqual(saved.find(row => row.entry_type === 'adjustment'), before[0])
    const nextYear = await attendance.leaveBalanceSummary(STAFF_IDS.active, 'FY 2027-28', '2027-04-01')
    assert.equal(nextYear.opening_carry_forward, 5)
    assert.equal(nextYear.accrued_leave, 1.5)
    const carried = await rows()
    await attendance.leaveBalanceSummary(STAFF_IDS.active, 'FY 2027-28', '2027-04-01')
    assert.deepEqual(await rows(), carried)
  })

  await t.test('balance service surfaces RPC failures, including unexpected duplicate errors', async () => {
    const rpc = database.rpc
    try {
      for (const code of ['08006', '23505']) {
        const error = { code, message: 'Synthetic database failure' }
        database.rpc = async () => ({ error })
        await assert.rejects(attendance.leaveBalanceSummary(STAFF_IDS.active, 'FY 2026-27', '2026-11-26'), result => result === error)
      }
    } finally { database.rpc = rpc }
  })
})
