const supabase = require('./supabaseAdmin')
const { EMPLOYMENT_STATUSES, normalizeEmploymentStatus, validateEmploymentStatus, activeEmployeeOptions } = require('./employeeStatusUtils')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const normalizeName = (value) => clean(value).toLowerCase()

async function getEmployeeStatus(userId) {
  const id = clean(userId)
  if (!id) return null
  const { data, error } = await supabase
    .from('employee_statuses')
    .select('user_id, status, created_at, updated_at, updated_by')
    .eq('user_id', id)
    .maybeSingle()
  if (error) throw error
  return data ? { ...data, status: normalizeEmploymentStatus(data.status) } : null
}

async function listEmployeeDirectory() {
  const [profilesResult, statusesResult] = await Promise.all([
    supabase.from('user_profiles').select('user_id, name, email').not('name', 'is', null).order('name'),
    supabase.from('employee_statuses').select('user_id, status')
  ])
  if (profilesResult.error) throw profilesResult.error
  if (statusesResult.error) throw statusesResult.error
  const statusByUserId = new Map((statusesResult.data || []).map((row) => [clean(row.user_id), normalizeEmploymentStatus(row.status)]))
  return (profilesResult.data || []).map((profile) => ({
    id: clean(profile.user_id),
    user_id: clean(profile.user_id),
    name: clean(profile.name),
    email: clean(profile.email),
    status: statusByUserId.get(clean(profile.user_id)) || 'active'
  })).filter((profile) => profile.user_id && profile.name)
}

function unique(values, normalize = clean) {
  const result = []
  const seen = new Set()
  for (const value of values || []) {
    const normalized = normalize(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

async function assertActiveAssignments({ userIds = [], names = [], existingUserIds = [], existingNames = [] } = {}) {
  const requestedIds = unique(userIds)
  const requestedNames = unique(names, normalizeName)
  const allowedIds = new Set(unique(existingUserIds))
  const allowedNames = new Set(unique(existingNames, normalizeName))
  const directory = await listEmployeeDirectory()
  const byId = new Map(directory.map((employee) => [employee.user_id, employee]))
  const byName = new Map(directory.map((employee) => [normalizeName(employee.name), employee]))
  const newIds = requestedIds.filter((id) => !allowedIds.has(id) && !allowedNames.has(normalizeName(byId.get(id)?.name)))
  const newNames = requestedNames.filter((name) => !allowedNames.has(name))
  if (!newIds.length && !newNames.length) return
  const requested = [
    ...newIds.map((id) => byId.get(id)),
    ...newNames.map((name) => byName.get(name))
  ]
  if (requested.some((employee) => !employee)) {
    const error = new Error('Please select a valid employee from the dropdown.')
    error.statusCode = 400
    throw error
  }
  if (requested.some((employee) => employee.status !== 'active')) {
    const error = new Error('Only Active employees can receive new assignments.')
    error.statusCode = 400
    throw error
  }
}

module.exports = {
  EMPLOYMENT_STATUSES,
  normalizeEmploymentStatus,
  validateEmploymentStatus,
  activeEmployeeOptions,
  getEmployeeStatus,
  listEmployeeDirectory,
  assertActiveAssignments
}
