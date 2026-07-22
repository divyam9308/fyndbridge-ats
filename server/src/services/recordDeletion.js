const supabase = require('./supabaseAdmin')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')

const ENTITY_TYPES = new Set(['candidate', 'applied_candidate', 'mandate', 'client'])
const DELETABLE_APPLICATION_STATUSES = Object.freeze(['pending', 'rejected'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISPLAY_ID_PATTERNS = {
  candidate: /^CA\d+$/i,
  mandate: /^JB\d+$/i,
  client: /^CL\d+$/i
}

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

function clean(value) {
  return String(value || '').trim()
}

function safeSearch(value) {
  return clean(value).replace(/[%_,()]/g, ' ').slice(0, 200)
}

async function listAppliedCandidateRecords({ search = '', page = 1, limit = 25 }) {
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1)
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100)
  const from = (safePage - 1) * safeLimit
  let query = supabase
    .from('public_applications')
    .select([
      'id', 'full_name', 'email', 'mobile_number', 'public_role_name',
      'internal_job_title_snapshot', 'client_name_snapshot', 'application_status',
      'created_at'
    ].join(', '), { count: 'exact' })
  const normalizedSearch = safeSearch(search)
  if (normalizedSearch) {
    const pattern = `*${normalizedSearch}*`
    query = query.or([
      `full_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `mobile_number.ilike.${pattern}`,
      `public_role_name.ilike.${pattern}`,
      `internal_job_title_snapshot.ilike.${pattern}`,
      `client_name_snapshot.ilike.${pattern}`,
      `application_status.ilike.${pattern}`
    ].join(','))
  }
  query = query.in('application_status', DELETABLE_APPLICATION_STATUSES)
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + safeLimit - 1)
  if (error) throw error
  const total = Number(count) || 0
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  return {
    data: (data || []).map(application => ({
      id: application.id,
      label: application.full_name,
      email: application.email,
      mobile_number: application.mobile_number,
      mandate: application.public_role_name || application.internal_job_title_snapshot,
      client: application.client_name_snapshot,
      status: application.application_status,
      created_at: application.created_at
    })),
    total,
    page: Math.min(safePage, totalPages),
    totalPages,
    limit: safeLimit
  }
}

async function getAppliedCandidateRows(ids) {
  const { data, error } = await supabase
    .from('public_applications')
    .select('id, full_name, application_status, cv_storage_path')
    .in('id', ids)
    .in('application_status', DELETABLE_APPLICATION_STATUSES)
  if (error) throw error
  return data || []
}

async function previewAppliedCandidateDeletion(ids) {
  const rows = await getAppliedCandidateRows(ids)
  if (rows.length !== ids.length) {
    const error = new Error('One or more selected records no longer exist. Refresh the list and try again.')
    error.statusCode = 409
    throw error
  }
  return {
    entityType: 'applied_candidate',
    selectedCount: rows.length,
    missingCount: ids.length - rows.length,
    selectedIds: rows.map(row => row.id),
    labels: rows.map(row => ({ id: row.id, label: row.full_name })),
    appliedCandidatesDeleted: rows.length,
    cvFilesDeleted: rows.length,
    notificationsDeleted: 0,
    followUpsDeleted: 0,
    idsRenumbered: false
  }
}

function normalizeAppliedCvCleanupItems(value) {
  if (!Array.isArray(value)) return []
  const paths = []
  for (const item of value) {
    const id = clean(item?.id)
    const objectPath = normalizeStoragePath(item?.path, STORAGE_BUCKETS.PUBLIC_APPLICATIONS)
    const fileName = objectPath.startsWith(`${id}/`) ? objectPath.slice(id.length + 1) : ''
    if (!UUID_PATTERN.test(id) || !/^(?:resume|[0-9a-f-]{36})\.pdf$/i.test(fileName)) {
      const error = new Error('Applied candidate CV cleanup path is invalid')
      error.statusCode = 409
      throw error
    }
    paths.push(objectPath)
  }
  return [...new Set(paths)]
}

async function removeAppliedCandidateCvs(value) {
  const paths = normalizeAppliedCvCleanupItems(value)
  if (!paths.length) return { cvFilesDeleted: 0, cvFilesPendingCleanup: 0 }
  let result = await supabase.storage.from(STORAGE_BUCKETS.PUBLIC_APPLICATIONS).remove(paths)
  if (result.error) result = await supabase.storage.from(STORAGE_BUCKETS.PUBLIC_APPLICATIONS).remove(paths)
  if (result.error) {
    console.error('[record deletion] applied candidate CV cleanup failed', {
      count: paths.length,
      message: result.error.message
    })
    return { cvFilesDeleted: 0, cvFilesPendingCleanup: paths.length }
  }
  return { cvFilesDeleted: paths.length, cvFilesPendingCleanup: 0 }
}

async function assertSuperAdminActor(actorUserId) {
  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', actorUserId)
    .eq('role', 'super_admin')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const forbidden = new Error('Super Admin required')
    forbidden.statusCode = 403
    throw forbidden
  }
}

async function deleteAppliedCandidateRecords(actorUserId, ids) {
  await assertSuperAdminActor(actorUserId)
  const rows = await getAppliedCandidateRows(ids)
  if (rows.length !== ids.length) {
    const error = new Error('One or more selected records no longer exist or have already been converted. Refresh the list and try again.')
    error.statusCode = 409
    throw error
  }
  const cleanupItems = rows.map(row => ({ id: row.id, path: row.cv_storage_path }))
  normalizeAppliedCvCleanupItems(cleanupItems)
  const { data, error } = await supabase
    .from('public_applications')
    .delete()
    .in('id', ids)
    .in('application_status', DELETABLE_APPLICATION_STATUSES)
    .select('id')
  if (error) throw error
  if ((data || []).length !== ids.length) {
    const conflict = new Error('One or more selected records changed during deletion. Refresh the list and try again.')
    conflict.statusCode = 409
    throw conflict
  }
  const cleanup = await removeAppliedCandidateCvs(cleanupItems)
  return {
    entityType: 'applied_candidate',
    appliedCandidatesDeleted: data.length,
    ...cleanup,
    idsRenumbered: false
  }
}

async function exactDisplayIdRecord(entityType, search) {
  if (!DISPLAY_ID_PATTERNS[entityType]?.test(search)) return null

  if (entityType === 'candidate') {
    const candidateResult = await supabase
      .from('candidates')
      .select('id, candidate_display_id, full_name, email, mobile_number, client_id, created_at')
      .ilike('candidate_display_id', search)
      .maybeSingle()
    if (candidateResult.error) throw candidateResult.error
    if (!candidateResult.data) return { data: [], total: 0 }

    const associationResult = await supabase
      .from('candidate_associations')
      .select('id, client_name, job_title, consultant_name, status, created_at')
      .eq('candidate_id', candidateResult.data.id)
      .order('created_at', { ascending: false })
    if (associationResult.error) throw associationResult.error

    const base = candidateResult.data
    const rows = (associationResult.data || []).map(association => ({
      id: association.id,
      row_kind: 'association',
      display_id: base.candidate_display_id,
      label: base.full_name,
      email: base.email,
      mobile_number: base.mobile_number,
      mandate: association.job_title,
      client: association.client_name,
      consultant: association.consultant_name,
      status: association.status,
      created_at: association.created_at
    }))
    if (!rows.length) {
      rows.push({
        id: base.id,
        row_kind: 'candidate',
        display_id: base.candidate_display_id,
        label: base.full_name,
        email: base.email,
        mobile_number: base.mobile_number,
        mandate: null,
        client: null,
        consultant: null,
        status: '-',
        created_at: base.created_at
      })
    }
    return { data: rows, total: rows.length }
  }

  if (entityType === 'mandate') {
    const jobResult = await supabase
      .from('jobs')
      .select('id, job_display_id, title, mandate_status, consultants, team_lead, allocation_date, created_at, clients(client_name, name)')
      .ilike('job_display_id', search)
      .maybeSingle()
    if (jobResult.error) throw jobResult.error
    if (!jobResult.data) return { data: [], total: 0 }
    const countResult = await supabase
      .from('candidate_associations')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobResult.data.id)
    if (countResult.error) throw countResult.error
    const job = jobResult.data
    return {
      data: [{
        id: job.id,
        display_id: job.job_display_id,
        label: job.title,
        client: job.clients?.client_name || job.clients?.name || null,
        status: job.mandate_status,
        consultants: Array.isArray(job.consultants) ? job.consultants.join(', ') : '',
        team_lead: job.team_lead,
        candidate_count: countResult.count || 0,
        allocation_date: job.allocation_date,
        created_at: job.created_at
      }],
      total: 1
    }
  }

  const clientResult = await supabase
    .from('clients')
    .select('id, client_group_id, client_display_id, client_name, name, consultant_name, status, location, city, created_at')
    .ilike('client_display_id', search)
    .order('created_at', { ascending: true })
  if (clientResult.error) throw clientResult.error
  if (!clientResult.data?.length) return { data: [], total: 0 }
  const rootId = clientResult.data[0].client_group_id || clientResult.data[0].id
  const root = clientResult.data.find(row => row.id === rootId) || clientResult.data[0]
  const scopeIds = [...new Set(clientResult.data.map(row => row.id))]
  const jobsResult = await supabase.from('jobs').select('id').in('client_id', scopeIds)
  if (jobsResult.error) throw jobsResult.error
  const jobIds = (jobsResult.data || []).map(job => job.id)
  const candidateResult = jobIds.length
    ? await supabase.from('candidate_associations').select('id', { count: 'exact', head: true }).in('job_id', jobIds)
    : { count: 0, error: null }
  if (candidateResult.error) throw candidateResult.error
  return {
    data: [{
      id: root.id,
      display_id: root.client_display_id,
      label: root.client_name || root.name,
      consultant: root.consultant_name,
      status: root.status,
      location: root.location || root.city,
      mandate_count: jobIds.length,
      candidate_count: candidateResult.count || 0,
      created_at: root.created_at
    }],
    total: 1
  }
}

async function listRecords({ entityType, search = '', page = 1, limit = 25 }) {
  const type = normalizeEntityType(entityType)
  if (type === 'applied_candidate') return listAppliedCandidateRecords({ search, page, limit })
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1)
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100)
  const safeSearch = clean(search).slice(0, 200)
  const exactDisplayResult = await exactDisplayIdRecord(type, safeSearch)
  if (exactDisplayResult) {
    return {
      data: exactDisplayResult.data.slice((safePage - 1) * safeLimit, safePage * safeLimit),
      total: exactDisplayResult.total,
      page: safePage,
      totalPages: Math.max(1, Math.ceil(exactDisplayResult.total / safeLimit)),
      limit: safeLimit
    }
  }
  const { data, error } = await supabase.rpc('admin_bulk_record_list', {
    p_entity_type: type,
    p_search: safeSearch,
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
  if (entityType === 'applied_candidate') return previewAppliedCandidateDeletion(ids)
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
  if (entityType === 'applied_candidate') return deleteAppliedCandidateRecords(actorUserId, ids)
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
  normalizeAppliedCvCleanupItems,
  exactDisplayIdRecord,
  listRecords,
  previewDeletion,
  deleteRecords
}
