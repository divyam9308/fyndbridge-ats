const test = require('node:test')
const assert = require('node:assert/strict')
const { employmentDatabase, STAFF_IDS } = require('../../test-support/employmentMemory.cjs')
const { localDate, getFinancialYearForDate } = require('./attendanceUtils')

let database
const supabasePath = require.resolve('./supabaseAdmin')
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, children: [], exports: new Proxy({}, {
  get(_target, key) { const value = database[key]; return typeof value === 'function' ? value.bind(database) : value }
}) }
const attendance = require('./attendanceService')
const performance = require('./performanceReview')
const management = require('./employeeManagement')
const actor = { id: STAFF_IDS.admin, email: 'recruiter@fyndbridge.in' }
const now = localDate()
const year = Number(now.slice(0, 4)), month = Number(now.slice(5, 7))
const fy = getFinancialYearForDate(now)

test.beforeEach(() => { database = employmentDatabase(now) })

test('team current/future lists omit former staff, past month retains them, and today never adds them back', async () => {
  const original = structuredClone(database.tables.attendance_records)
  const current = await attendance.team(actor, year, month, fy)
  assert.equal(current.rows.some(row => row.user.user_id === STAFF_IDS.former), false)
  assert.equal(current.rows.some(row => row.user.user_id === STAFF_IDS.onLeave), true)
  const historical = await attendance.team(actor, year, month, fy, true)
  const former = historical.rows.find(row => row.user.user_id === STAFF_IDS.former)
  assert.equal(former.summary.present, 1)
  assert.ok(former.summary.working_days < current.rows[0].summary.working_days)
  assert.equal([...historical.today.present, ...historical.today.leave, ...historical.today.unmarked].some(row => row.user_id === STAFF_IDS.former), false)
  const previous = new Date(Date.UTC(year, month - 2, 1))
  const past = await attendance.team(actor, previous.getUTCFullYear(), previous.getUTCMonth() + 1, fy)
  assert.equal(past.rows.some(row => row.user.user_id === STAFF_IDS.former), true)
  const future = new Date(Date.UTC(year, month, 1))
  const next = await attendance.team(actor, future.getUTCFullYear(), future.getUTCMonth() + 1, fy, true)
  assert.equal(next.rows.some(row => row.user.user_id === STAFF_IDS.former), false)
  assert.deepEqual(database.tables.attendance_records, original)
})

test('managed leave balances hide inactive staff, preserve history and stop future accruals', async () => {
  const historicalLedger = structuredClone(database.tables.leave_ledger[0])
  const current = await attendance.listLeaveBalances(actor, fy)
  assert.equal(current.some(row => row.user.user_id === STAFF_IDS.former), false)
  assert.equal(current.some(row => row.user.user_id === STAFF_IDS.onLeave), true)
  const history = await attendance.listLeaveBalances(actor, fy, true)
  assert.equal(history.some(row => row.user.user_id === STAFF_IDS.former), true)
  const futureYear = `FY ${year + 1}-${String((year + 2) % 100).padStart(2, '0')}`
  await attendance.leaveBalanceSummary(STAFF_IDS.former, futureYear, `${year + 1}-12-01`)
  assert.equal(database.tables.leave_ledger.some(row => row.user_id === STAFF_IDS.former && row.entry_date >= database.departure), false)
  assert.deepEqual(database.tables.leave_ledger.find(row => row.id === historicalLedger.id), historicalLedger)
  await assert.rejects(attendance.adjustLeaveBalance(actor, STAFF_IDS.former, 3, 'Future adjustment', fy), error => error.statusCode === 409)
  assert.equal(database.tables.leave_ledger.some(row => row.description === 'Future adjustment'), false)
})

test('inactive PMS history is returned intact, without creating missing quarters or repairing partial rows', async () => {
  database.tables.performance_review_rows.pop()
  const before = structuredClone({ reviews: database.tables.performance_reviews, rows: database.tables.performance_review_rows })
  const history = await performance.getReview(actor, STAFF_IDS.former, 'Q1')
  assert.equal(history.read_only, true)
  assert.equal(history.rows.length, 4)
  assert.equal(history.rows[0].work_done, 'Saved before departure')
  await assert.rejects(performance.getReview(actor, STAFF_IDS.former, 'Q4'), error => error.statusCode === 404)
  await assert.rejects(performance.updateReview(actor, STAFF_IDS.former, [], 'Q1'), error => error.statusCode === 409)
  await assert.rejects(performance.updateReview(actor, STAFF_IDS.former, [], 'Q4'), error => error.statusCode === 409)
  assert.deepEqual({ reviews: database.tables.performance_reviews, rows: database.tables.performance_review_rows }, before)
  assert.equal(database.operations.some(operation => operation.kind !== 'select'), false)
})

test('only super admins can open former employee PMS history', async () => {
  await assert.rejects(performance.getReview({ id: STAFF_IDS.active, email: 'active@example.test' }, STAFF_IDS.former, 'Q1'), error => error.statusCode === 403)
  assert.equal(database.operations.some(operation => operation.table === 'performance_reviews'), false)
})

test('approving future requests cannot generate attendance for an inactive employee or change the stored request', async () => {
  const leave = { id: 'future-leave', user_id: STAFF_IDS.former, start_date: now, end_date: now, status: 'pending' }
  const correction = { id: 'future-correction', user_id: STAFF_IDS.former, attendance_date: now, status: 'pending' }
  database.tables.leave_requests.push(leave)
  database.tables.attendance_correction_requests.push(correction)
  const before = structuredClone({ leave, correction, records: database.tables.attendance_records })
  await assert.rejects(attendance.review(actor, 'leave', leave.id, 'approved'), error => error.statusCode === 409)
  await assert.rejects(attendance.review(actor, 'correction', correction.id, 'approved'), error => error.statusCode === 409)
  assert.deepEqual({ leave, correction, records: database.tables.attendance_records }, before)
  assert.equal(database.operations.some(operation => operation.kind !== 'select'), false)
})

test('same-status saves keep the departure date; reactivation restores future rosters and PMS editing', async () => {
  const previous = structuredClone(database.tables.employee_statuses.find(row => row.user_id === STAFF_IDS.former))
  const unchanged = await management.updateEmployeeStatus(STAFF_IDS.former, 'inactive', actor.id)
  assert.equal(unchanged.updated_at, previous.updated_at)
  assert.equal(database.operations.some(operation => operation.kind !== 'select'), false)
  await management.updateEmployeeStatus(STAFF_IDS.former, 'active', actor.id)
  assert.equal((await attendance.team(actor, year, month, fy)).rows.some(row => row.user.user_id === STAFF_IDS.former), true)
  const review = await performance.getReview(actor, STAFF_IDS.former, 'Q4')
  assert.equal(review.read_only, false)
  assert.equal(review.rows.length, 5)
  assert.equal(database.tables.performance_review_rows.filter(row => row.review_id === 'old-review')[0].work_done, 'Saved before departure')
})
