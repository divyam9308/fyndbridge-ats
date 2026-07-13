const EMPLOYMENT_STATUSES = Object.freeze(['active', 'on_leave', 'inactive'])
const EMPLOYMENT_STATUS_SET = new Set(EMPLOYMENT_STATUSES)

function normalizeEmploymentStatus(value) {
  return EMPLOYMENT_STATUS_SET.has(value) ? value : 'active'
}

function validateEmploymentStatus(value) {
  if (!EMPLOYMENT_STATUS_SET.has(value)) {
    const error = new Error('Status must be active, on_leave or inactive.')
    error.statusCode = 400
    throw error
  }
  return value
}

function activeEmployeeOptions(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => normalizeEmploymentStatus(row.status) === 'active')
}

module.exports = { EMPLOYMENT_STATUSES, normalizeEmploymentStatus, validateEmploymentStatus, activeEmployeeOptions }
