const test = require('node:test')
const assert = require('node:assert/strict')
const { employmentDatabase, STAFF_IDS } = require('../../test-support/employmentMemory.cjs')
const { presenceDatabase } = require('../../test-support/presenceDatabase.cjs')
const { localDate, getFinancialYearForDate } = require('./attendanceUtils')
let database, presence
const adminPath = require.resolve('./supabaseAdmin')
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, children: [], exports: new Proxy({}, {
  get(_, key) { const value = database[key]; return typeof value === 'function' ? value.bind(database) : value }
}) }
const attendance = require('./attendanceService')
const actor = { id: STAFF_IDS.admin, email: 'recruiter@fyndbridge.in' }
const today = localDate(), year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7))
test.before(async () => {
  presence = await presenceDatabase()
  await presence.sql.query('insert into auth.users(id) select unnest($1::uuid[])', [Object.values(STAFF_IDS)])
  await presence.sql.query(`insert into public.user_daily_activity(user_id,activity_date,active_periods) values
    ($1,'2026-11-23',tstzmultirange(tstzrange('2026-11-23T04:00Z','2026-11-23T05:30Z','[)')))` , [STAFF_IDS.active])
})
test.after(async () => { await presence?.sql.close() })
test.beforeEach(() => {
  database = employmentDatabase(today)
  const employmentRpc = database.rpc.bind(database)
  database.rpc = async (name, args) => {
    if (name !== 'user_activity_summary') return employmentRpc(name, args)
    database.operations.push({ kind: 'rpc', name, args })
    return presence.rpc(name, args)
  }
})
test('team uses the dashboard SQL average for every eligible employee, including offline users', async () => {
  const result = await attendance.team(actor, year, month, getFinancialYearForDate(today))
  const call = database.operations.find(operation => operation.name === 'user_activity_summary')
  assert.equal(call.name, 'user_activity_summary')
  assert.deepEqual(new Set(call.args.p_user_ids), new Set([STAFF_IDS.active, STAFF_IDS.onLeave]))
  const dashboard = await presence.rpc(call.name, call.args)
  for (const row of result.rows) assert.deepEqual(row.activity_summary, dashboard.data.find(summary => summary.user_id === row.user.user_id))
  const active = result.rows.find(row => row.user.user_id === STAFF_IDS.active)
  assert.equal(active.summary.total_minutes, 0)
  assert.ok(active.activity_summary.average_seconds > 0)
  assert.equal(result.rows.find(row => row.user.user_id === STAFF_IDS.onLeave).activity_summary.average_seconds, 0)
})
test('selected months use dashboard fiscal-quarter boundaries across financial years', async () => {
  for (const [y, m, fy, period, start, end] of [
    [2027, 1, 'FY 2026-27', 'FY 2026-27 Q4', '2027-01-01', '2027-03-31'],
    [2027, 4, 'FY 2027-28', 'FY 2027-28 Q1', '2027-04-01', '2027-06-30']
  ]) {
    const result = await attendance.team(actor, y, m, fy)
    const call = database.operations.filter(operation => operation.name === 'user_activity_summary').at(-1)
    assert.equal(result.activity_period, period)
    assert.equal(call.args.p_start, start)
    assert.equal(call.args.p_end, end)
  }
})
test('activity access remains attendance-permission protected and RPC failures are not reported as zero', async () => {
  await assert.rejects(attendance.team({ id: STAFF_IDS.active, email: 'active@example.test' }, year, month, getFinancialYearForDate(today)), error => error.statusCode === 403)
  assert.equal(database.operations.some(operation => operation.kind === 'rpc'), false)
  const rpc = database.rpc
  database.rpc = async (name, args) => name === 'user_activity_summary' ? { data: null, error: new Error('Activity unavailable') } : rpc(name, args)
  await assert.rejects(attendance.team(actor, year, month, getFinancialYearForDate(today)), /Activity unavailable/)
})
