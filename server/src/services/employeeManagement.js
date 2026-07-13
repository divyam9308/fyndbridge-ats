const supabase = require('./supabaseAdmin')
const { validateEmploymentStatus } = require('./employeeStatus')

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

async function reassignEmployee({ actorId, actorEmail, sourceUserId, destinationUserId, categories }) {
  const selected = [...new Set((Array.isArray(categories) ? categories : []).map(clean).filter(Boolean))]
  if (!clean(sourceUserId) || !clean(destinationUserId)) {
    const error = new Error('Source and destination employees are required.')
    error.statusCode = 400
    throw error
  }
  if (!selected.length || selected.some((category) => !['clients', 'mandates', 'candidates'].includes(category))) {
    const error = new Error('Select at least one valid assignment category.')
    error.statusCode = 400
    throw error
  }
  const { data, error } = await supabase.rpc('reassign_employee_assignments', {
    p_actor_id: actorId,
    p_actor_email: actorEmail || '',
    p_source_user_id: sourceUserId,
    p_destination_user_id: destinationUserId,
    p_categories: selected
  })
  if (error) {
    const mapped = new Error(error.message || 'Unable to reassign employee.')
    mapped.statusCode = ['22023', 'P0002'].includes(error.code) ? 400 : error.code === '42501' ? 403 : 500
    throw mapped
  }
  return data
}

module.exports = { listEmployees, employeeDetail, updateEmployeeStatus, reassignEmployee }
