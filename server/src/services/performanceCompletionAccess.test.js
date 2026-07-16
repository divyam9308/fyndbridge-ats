const test = require('node:test')
const assert = require('node:assert/strict')

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const supabase = require('./supabaseAdmin')
const adminAccess = require('./adminAccess')

const FIRST_USER_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222'

function review(employeeUserId, period, score) {
  return {
    employee_user_id: employeeUserId,
    review_period: period,
    performance_review_rows: Array.from({ length: 5 }, (_, index) => ({
      row_order: index + 1,
      self_score: score,
      ss_ns_score: null,
      ra_score: null
    }))
  }
}

test('completion status query is quarter-specific and limits normal/Admin users to self', async () => {
  const originalFrom = supabase.from
  const originalIsSuperAdmin = adminAccess.isSuperAdmin
  const queryLog = []
  const storedReviews = [
    review(FIRST_USER_ID, 'Q1', 1),
    review(FIRST_USER_ID, 'Q2', 2),
    review(SECOND_USER_ID, 'Q2', 0)
  ]

  adminAccess.isSuperAdmin = async actor => actor?.role === 'super_admin'
  delete require.cache[require.resolve('./performanceReview')]
  const { getCompletionStatuses } = require('./performanceReview')

  supabase.from = (table) => {
    const filters = []
    const entry = { table, select: '', filters }
    queryLog.push(entry)
    const query = {
      select(columns) {
        entry.select = columns
        return query
      },
      eq(column, value) {
        filters.push([column, value])
        return query
      },
      then(resolve, reject) {
        const rows = storedReviews.filter(row => filters.every(([column, value]) => row[column] === value))
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      }
    }
    return query
  }

  try {
    const normal = await getCompletionStatuses({ id: FIRST_USER_ID, role: 'user' }, 'Q2')
    const admin = await getCompletionStatuses({ id: FIRST_USER_ID, role: 'admin' }, 'Q2')
    const superAdmin = await getCompletionStatuses({ id: FIRST_USER_ID, role: 'super_admin' }, 'Q2')

    assert.deepEqual(Object.keys(normal), [FIRST_USER_ID])
    assert.deepEqual(Object.keys(admin), [FIRST_USER_ID])
    assert.deepEqual(Object.keys(superAdmin).sort(), [FIRST_USER_ID, SECOND_USER_ID])
    assert.deepEqual(superAdmin[SECOND_USER_ID].self, { state: 'complete', filled: 5, total: 5 })

    assert.ok(queryLog.every(entry => entry.table === 'performance_reviews'))
    assert.ok(queryLog.every(entry => entry.filters.some(([column, value]) => column === 'review_period' && value === 'Q2')))
    assert.ok(queryLog.slice(0, 2).every(entry => entry.filters.some(([column, value]) => column === 'employee_user_id' && value === FIRST_USER_ID)))
    assert.equal(queryLog[2].filters.some(([column]) => column === 'employee_user_id'), false)
    assert.match(queryLog[0].select, /performance_review_rows/)
  } finally {
    supabase.from = originalFrom
    adminAccess.isSuperAdmin = originalIsSuperAdmin
    delete require.cache[require.resolve('./performanceReview')]
  }
})
