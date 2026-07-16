const supabase = require('./supabaseAdmin')

const ENTITY_TYPES = new Set(['candidate', 'mandate', 'client'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function badRequest(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function normalizeEntityType(value) {
  const entityType = String(value || '').trim().toLowerCase()
  if (!ENTITY_TYPES.has(entityType)) throw badRequest('Invalid entity type')
  return entityType
}

function normalizeIds(value) {
  if (!Array.isArray(value) || !value.length) throw badRequest('Select at least one record')
  const ids = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
  if (!ids.length || ids.some(id => !UUID_PATTERN.test(id))) throw badRequest('One or more record IDs are invalid')
  if (ids.length > 500) throw badRequest('Select no more than 500 records at a time')
  return ids
}

function normalizeDeleteLinked(value) {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw badRequest('deleteLinkedCandidateRows must be a boolean')
  return value
}

function rpcError(error) {
  if (!error) return null
  const next = new Error(error.message || 'Record management request failed')
  if (error.code === '42501') next.statusCode = 403
  else if (error.code === 'P0002') next.statusCode = 409
  else if (error.code === '22023') next.statusCode = 400
  return next
}

async function listRecords({ entityType, search = '', page = 1, limit = 25 }) {
  const type = normalizeEntityType(entityType)
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1)
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100)
  const { data, error } = await supabase.rpc('admin_bulk_record_list', {
    p_entity_type: type,
    p_search: String(search || '').trim().slice(0, 200),
    p_offset: (safePage - 1) * safeLimit,
    p_limit: safeLimit
  })
  if (error) throw rpcError(error)
  const total = Number(data?.total) || 0
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  return {
    data: Array.isArray(data?.data) ? data.data : [],
    total,
    page: Math.min(safePage, totalPages),
    totalPages,
    limit: safeLimit
  }
}

async function previewDeletion(body) {
  const entityType = normalizeEntityType(body?.entityType)
  const ids = normalizeIds(body?.ids)
  const deleteLinkedCandidateRows = normalizeDeleteLinked(body?.deleteLinkedCandidateRows)
  const { data, error } = await supabase.rpc('admin_bulk_delete_preview', {
    p_entity_type: entityType,
    p_ids: ids,
    p_delete_linked_candidate_rows: deleteLinkedCandidateRows
  })
  if (error) throw rpcError(error)
  return data
}

async function deleteRecords(actorUserId, body) {
  const entityType = normalizeEntityType(body?.entityType)
  const ids = normalizeIds(body?.ids)
  const deleteLinkedCandidateRows = normalizeDeleteLinked(body?.deleteLinkedCandidateRows)
  const { data, error } = await supabase.rpc('admin_bulk_delete_records', {
    p_actor_user_id: actorUserId,
    p_entity_type: entityType,
    p_ids: ids,
    p_delete_linked_candidate_rows: deleteLinkedCandidateRows
  })
  if (error) throw rpcError(error)
  return data
}

module.exports = {
  ENTITY_TYPES,
  normalizeEntityType,
  normalizeIds,
  normalizeDeleteLinked,
  listRecords,
  previewDeletion,
  deleteRecords
}
