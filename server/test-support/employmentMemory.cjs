const assert = require('node:assert/strict')
const { localDate, addDays, getFinancialYearForDate } = require('../src/services/attendanceUtils')

const STAFF_IDS = {
  admin: '20000000-0000-4000-8000-000000000001',
  active: '40000000-0000-4000-8000-000000000001',
  former: '40000000-0000-4000-8000-000000000002',
  onLeave: '40000000-0000-4000-8000-000000000003',
  noHistory: '40000000-0000-4000-8000-000000000004'
}

function employmentDatabase(today = localDate()) {
  const departure = `${today.slice(0, 7)}-10`
  const oldDate = addDays(departure, -5)
  const profiles = Object.entries(STAFF_IDS).map(([key, user_id]) => ({
    user_id, name: { admin: 'Test Recruiter', active: 'Active Consultant', former: 'Former Consultant', onLeave: 'On Leave Consultant', noHistory: 'Former Without Reviews' }[key],
    email: key === 'admin' ? 'recruiter@fyndbridge.in' : `${key}@example.test`
  }))
  const tables = {
    user_profiles: profiles,
    employee_statuses: profiles.map(profile => ({
      user_id: profile.user_id,
      status: [STAFF_IDS.former, STAFF_IDS.noHistory].includes(profile.user_id) ? 'inactive' : profile.user_id === STAFF_IDS.onLeave ? 'on_leave' : 'active',
      created_at: '2026-04-01T00:00:00.000Z', updated_at: `${departure}T06:00:00.000Z`
    })),
    admin_users: [{ user_id: STAFF_IDS.admin, email: profiles[0].email, role: 'super_admin', is_super_admin: true }],
    attendance_permissions: [], company_holidays: [], attendance_correction_requests: [], leave_requests: [],
    attendance_records: [{ id: 'old-attendance', user_id: STAFF_IDS.former, attendance_date: oldDate, status: 'present', worked_minutes: 480, clock_in_at: `${oldDate}T04:00:00Z`, clock_out_at: `${oldDate}T12:00:00Z` }],
    leave_ledger: [{ id: 'old-ledger', user_id: STAFF_IDS.former, entry_type: 'adjustment', amount: 2, entry_date: oldDate, financial_year: getFinancialYearForDate(oldDate), description: 'Historical adjustment' }],
    performance_reviews: [{ id: 'old-review', employee_user_id: STAFF_IDS.former, review_period: 'Q1', created_at: '2026-06-30T12:00:00Z', updated_at: '2026-07-01T12:00:00Z' }],
    performance_review_rows: Array.from({ length: 5 }, (_, i) => ({ id: `old-row-${i}`, review_id: 'old-review', row_order: i + 1, category: `Historical category ${i + 1}`, allocation: 20, work_done: 'Saved before departure', self_score: 4, ss_ns_score: 3, ra_score: 4 })),
    performance_column_permissions: []
  }
  const operations = []
  let serial = 0
  const keysFor = table => ({ employee_statuses: ['user_id'], performance_reviews: ['employee_user_id', 'review_period'], performance_review_rows: ['review_id', 'row_order'], attendance_records: ['user_id', 'attendance_date'] }[table] || ['id'])
  const database = {
    tables, operations, departure, oldDate,
    auth: { admin: { getUserById: async id => ({ data: { user: { id, email: profiles.find(p => p.user_id === id)?.email, created_at: '2026-04-01T00:00:00Z' } }, error: null }) } },
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected employment table: ${table}`)
      const state = { table, kind: 'select', filters: [], columns: '', values: null, limit: Infinity }
      let execution
      const execute = single => {
        operations.push({ table, kind: state.kind, values: structuredClone(state.values) })
        const matches = row => state.filters.every(filter => filter(row))
        let rows = tables[table].filter(matches)
        if (['insert', 'upsert'].includes(state.kind)) {
          rows = []
          for (const value of [state.values].flat()) {
            const keys = state.conflict?.split(',') || keysFor(table)
            let existing = tables[table].find(row => keys.every(key => value[key] !== undefined && row[key] === value[key]))
            if (table === 'leave_ledger' && value.entry_type === 'accrual') existing = tables[table].find(row => row.user_id === value.user_id && row.entry_type === 'accrual' && row.accrual_month === value.accrual_month)
            if (table === 'leave_ledger' && value.entry_type === 'opening_balance') existing = tables[table].find(row => row.user_id === value.user_id && row.entry_type === 'opening_balance' && row.financial_year === value.financial_year)
            if (existing && state.kind === 'insert') return { data: null, error: { code: '23505' } }
            if (existing && state.ignoreDuplicates) continue
            if (existing) Object.assign(existing, value)
            else { existing = { id: `synthetic-${++serial}`, created_at: new Date().toISOString(), ...value }; tables[table].push(existing) }
            rows.push(existing)
          }
        } else if (state.kind === 'update') rows.forEach(row => Object.assign(row, state.values))
        if (state.order) rows.sort((a, b) => String(a[state.order] || '').localeCompare(String(b[state.order] || '')))
        rows = rows.slice(0, state.limit)
        if (table === 'performance_reviews' && state.columns.includes('performance_review_rows')) rows = rows.map(row => ({ ...row, performance_review_rows: tables.performance_review_rows.filter(item => item.review_id === row.id) }))
        return { data: single ? structuredClone(rows[0] || null) : structuredClone(rows), error: null }
      }
      const run = single => execution ||= Promise.resolve().then(() => execute(single))
      const query = {
        select(columns = '*') { state.columns = columns; return query },
        eq(field, value) { state.filters.push(row => row[field] === value); return query },
        neq(field, value) { state.filters.push(row => row[field] !== value); return query },
        in(field, values) { state.filters.push(row => values.includes(row[field])); return query },
        not(field, operator, value) { assert.equal(operator, 'is'); state.filters.push(row => row[field] != value); return query },
        is(field, value) { state.filters.push(row => (row[field] ?? null) === value); return query },
        lt(field, value) { state.filters.push(row => row[field] < value); return query },
        gte(field, value) { state.filters.push(row => row[field] >= value); return query },
        lte(field, value) { state.filters.push(row => row[field] <= value); return query },
        or(expression) {
          const clauses = expression.split(',').map(clause => clause.split('.'))
          state.filters.push(row => clauses.some(([field, operator, ...parts]) => operator === 'eq' ? String(row[field]) === parts.join('.') : String(row[field] || '').toLowerCase() === parts.join('.').toLowerCase()))
          return query
        },
        insert(values) { state.kind = 'insert'; state.values = values; return query },
        upsert(values, options = {}) { state.kind = 'upsert'; state.values = values; state.conflict = options.onConflict; state.ignoreDuplicates = options.ignoreDuplicates; return query },
        update(values) { state.kind = 'update'; state.values = values; return query },
        order(field) { state.order = field; return query },
        limit(value) { state.limit = value; return query },
        maybeSingle() { return run(true) }, single() { return run(true) },
        then(resolve, reject) { return run(false).then(resolve, reject) }
      }
      return query
    }
  }
  return database
}

module.exports = { employmentDatabase, STAFF_IDS }
