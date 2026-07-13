const supabase = require('./supabaseAdmin')
const { validateEmploymentStatus } = require('./employeeStatus')
const { CATEGORIES, normalizeSelections } = require('./employeeReassignmentUtils')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

function normalizeEmployee(row) {
  return {
    id: clean(row.user_id),
    user_id: clean(row.user_id),
    name: clean(row.name),
    email: clean(row.email),
    mobile: clean(row.mobile),
    status: row.status,
    counts: {
      clients: Number(row.client_count || 0),
      mandates: Number(row.mandate_count || 0),
      candidates: Number(row.candidate_count || 0)
    }
  }
}

async function listEmployees() {
  const { data, error } = await supabase.rpc('employee_management_list')
  if (error) throw error
  return (data || []).map(normalizeEmployee)
}

async function employeeDetail(employeeId) {
  const id = clean(employeeId)
  if (!id) {
    const error = new Error('Invalid employee ID.')
    error.statusCode = 400
    throw error
  }
  const { data, error } = await supabase.rpc('employee_management_detail', { p_employee_id: id, p_preview_limit: 4 })
  if (error) throw error
  if (!data) {
    const notFound = new Error('Employee not found.')
    notFound.statusCode = 404
    throw notFound
  }
  return {
    user_id: id,
    clients: Array.isArray(data.clients) ? data.clients : [],
    mandates: Array.isArray(data.mandates) ? data.mandates : [],
    candidates: Array.isArray(data.candidates) ? data.candidates : []
  }
}

async function reassignmentRecords(employeeId, { category, search = '', offset = 0, limit = 50 } = {}) {
  const id = clean(employeeId)
  const normalizedCategory = clean(category).toLowerCase()
  if (!id) {
    const error = new Error('Invalid employee ID.')
    error.statusCode = 400
    throw error
  }
  if (!CATEGORIES.includes(normalizedCategory)) {
    const error = new Error('Invalid reassignment category.')
    error.statusCode = 400
    throw error
  }
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50))
  const { data, error } = await supabase.rpc('employee_reassignment_records', {
    p_employee_id: id,
    p_category: normalizedCategory,
    p_search: clean(search),
    p_offset: safeOffset,
    p_limit: safeLimit
  })
  if (error) throw error
  if (!data) {
    const notFound = new Error('Employee not found.')
    notFound.statusCode = 404
    throw notFound
  }
  return {
    category: normalizedCategory,
    total: Number(data.total || 0),
    filtered_total: Number(data.filtered_total || 0),
    offset: safeOffset,
    limit: safeLimit,
    items: Array.isArray(data.items) ? data.items : []
  }
}

async function updateEmployeeStatus(employeeId, status, actorId) {
  const id = clean(employeeId)
  const nextStatus = validateEmploymentStatus(status)
  if (!id) {
    const error = new Error('Invalid employee ID.')
    error.statusCode = 400
    throw error
  }
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, name')
    .eq('user_id', id)
    .not('name', 'is', null)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile || !clean(profile.name)) {
    const error = new Error('Employee not found.')
    error.statusCode = 404
    throw error
  }
  const { data: previous } = await supabase.from('employee_statuses').select('status').eq('user_id', id).maybeSingle()
  const { data, error } = await supabase
    .from('employee_statuses')
    .upsert({ user_id: id, status: nextStatus, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: 'user_id' })
    .select('user_id, status, created_at, updated_at, updated_by')
    .single()
  if (error) throw error
  return { ...data, previous_status: previous?.status || 'active' }
}

async function reassignEmployee({ actorId, actorEmail, sourceUserId, destinationUserId, selections }) {
  if (!clean(sourceUserId) || !clean(destinationUserId)) {
    const error = new Error('Source and destination employees are required.')
    error.statusCode = 400
    throw error
  }
  const normalizedSelections = normalizeSelections(selections)
  const { data, error } = await supabase.rpc('reassign_employee_assignments', {
    p_actor_id: actorId,
    p_actor_email: actorEmail || '',
    p_source_user_id: sourceUserId,
    p_destination_user_id: destinationUserId,
    p_selections: normalizedSelections
  })
  if (error) {
    const mapped = new Error(error.message || 'Unable to reassign employee.')
    mapped.statusCode = error.code === '42501' ? 403 : /no longer assigned|assignment changed/i.test(error.message || '') ? 409 : ['22023', '22P02', 'P0001', 'P0002'].includes(error.code) ? 400 : 500
    mapped.code = mapped.statusCode === 409 ? 'STALE_ASSIGNMENT' : error.code
    throw mapped
  }
  return data
}

module.exports = { listEmployees, employeeDetail, reassignmentRecords, updateEmployeeStatus, reassignEmployee }
