const assert = require('node:assert/strict')

const applicationId = index => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const USER_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'

function application(index, overrides = {}) {
  const id = applicationId(index)
  return {
    id, full_name: `Test Applicant ${String(index).padStart(3, '0')}`, email: `applicant${index}@example.test`,
    application_status: 'pending', cv_storage_path: `${id}/resume.pdf`,
    processing_token: null, converted_candidate_id: null, converted_association_id: null,
    public_role_name: 'Finance Manager', internal_job_title: 'Finance Manager', client_name: 'Example Client',
    mandate_consultants: ['Test Recruiter'], location: 'Mumbai', current_organisation: 'Example Company',
    current_designation: 'Finance Analyst', experience_years: 5, skills: ['Budgeting', 'Reporting'],
    current_salary: 12, expected_salary: 16, notice_period: 30, open_to_relocate: 'Yes',
    mobile_number: '9999999999', created_at: '2026-10-01T06:00:00.000Z',
    ...overrides
  }
}

function memoryDatabase(applications = []) {
  const tables = {
    public_applications: applications.map(row => ({ ...row })), public_application_deletions: [],
    page_view_permissions: [{ page_key: 'applied_candidates', view_permission: 'everyone' }], admin_users: []
  }
  const storageObjects = new Set(applications.map(row => row.cv_storage_path))
  const adoptedObjects = new Set(['adopted-master-cv.pdf'])
  const masterCandidates = [{ id: 'master-candidate', cv_storage_path: 'adopted-master-cv.pdf' }]
  const storageFailures = new Set()
  const rowDeleteFailures = new Set()
  const operations = []
  const removedPaths = []
  const database = {
    tables, storageObjects, adoptedObjects, masterCandidates, storageFailures, rowDeleteFailures, operations, removedPaths,
    beforeExecute: null, removeDelay: 0, activeRemovals: 0, maxActiveRemovals: 0,
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table touched: ${table}`)
      const state = { table, kind: 'select', values: null, filters: [], count: false, limit: Infinity, from: 0, to: Infinity }
      let execution
      const matches = row => state.filters.every(filter => filter(row))
      const execute = async single => {
        if (database.beforeExecute) await database.beforeExecute(state)
        operations.push({ table, kind: state.kind })
        let rows = tables[table].filter(matches)
        if (state.kind === 'upsert') {
          const key = table === 'public_application_deletions' ? 'application_id' : 'id'
          for (const value of [state.values].flat()) {
            if (!tables[table].some(row => row[key] === value[key])) tables[table].push({ ...value, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          }
          rows = []
        } else if (state.kind === 'update') {
          rows.forEach(row => Object.assign(row, state.values))
        } else if (state.kind === 'delete') {
          if (rows.some(row => rowDeleteFailures.has(row.id))) return { data: null, error: new Error('Synthetic database delete failure') }
          tables[table] = tables[table].filter(row => !matches(row))
        }
        const count = rows.length
        if (state.sort) rows.sort((a, b) => String(a[state.sort] || '').localeCompare(String(b[state.sort] || '')) * (state.ascending ? 1 : -1))
        rows = rows.slice(state.from, Math.min(state.to + 1, state.from + state.limit))
        return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map(row => ({ ...row })), error: null, count }
      }
      const run = single => { execution ||= execute(single); return execution }
      const builder = {
        select(columns, options = {}) { state.count = options.count === 'exact'; return builder },
        eq(field, value) { state.filters.push(row => row[field] === value); return builder },
        neq(field, value) { state.filters.push(row => row[field] !== value); return builder },
        in(field, values) { state.filters.push(row => values.includes(row[field])); return builder },
        ilike(field, pattern) { const term = pattern.replace(/[%*]/g, '').toLowerCase(); state.filters.push(row => String(row[field] || '').toLowerCase().includes(term)); return builder },
        or(expression) { const parts = expression.split(',').map(part => part.split('.ilike.')); state.filters.push(row => parts.some(([field, pattern]) => String(row[field] || '').toLowerCase().includes(pattern.replace(/[%*]/g, '').toLowerCase()))); return builder },
        contains(field, values) { state.filters.push(row => values.every(value => row[field]?.includes(value))); return builder },
        gte(field, value) { state.filters.push(row => row[field] >= value); return builder },
        lte(field, value) { state.filters.push(row => row[field] <= value); return builder },
        update(values) { state.kind = 'update'; state.values = values; return builder },
        upsert(values) { state.kind = 'upsert'; state.values = values; return builder },
        delete() { state.kind = 'delete'; return builder },
        order(field, { ascending = true } = {}) { state.sort = field; state.ascending = ascending; return builder },
        limit(value) { state.limit = value; return builder },
        range(from, to) { state.from = from; state.to = to; return builder },
        single() { return run(true) },
        maybeSingle() { return run(true) },
        then(resolve, reject) { return run(false).then(resolve, reject) }
      }
      return builder
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'public-applications', 'Only the staging bucket may be touched')
        return { async remove(paths) {
          database.activeRemovals += 1
          database.maxActiveRemovals = Math.max(database.maxActiveRemovals, database.activeRemovals)
          try {
            if (database.removeDelay) await new Promise(resolve => setTimeout(resolve, database.removeDelay))
            if (paths.some(path => storageFailures.has(path.split('/')[0]))) return { error: new Error('Synthetic storage failure') }
            paths.forEach(path => { removedPaths.push(path); storageObjects.delete(path) })
            return { data: paths, error: null }
          } finally { database.activeRemovals -= 1 }
        } }
      }
    }
  }
  return database
}

module.exports = { application, applicationId, USER_ID, OPERATION_ID, memoryDatabase }
