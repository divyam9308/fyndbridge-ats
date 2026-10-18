const { rejectApplication } = require('./appliedCandidates')

const MAX_DELETE_BATCH = 100
const DELETE_CONCURRENCY = 4
const AUDIT_TABLE = 'public_application_deletions'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECEIPT_SELECT = 'application_id, status, code, cleanup_started_at'

function validateBulkDeletion(body) {
  const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['application_ids', 'operation_id'].includes(key))) invalid('Send application_ids and operation_id only.')
  if (typeof body.operation_id !== 'string' || !UUID.test(body.operation_id)) invalid('operation_id must be a UUID.')
  if (!Array.isArray(body.application_ids) || !body.application_ids.length || body.application_ids.length > MAX_DELETE_BATCH) invalid(`Select between 1 and ${MAX_DELETE_BATCH} applications.`)
  if (body.application_ids.some(id => typeof id !== 'string' || !UUID.test(id))) invalid('Every application ID must be a UUID.')
  const ids = body.application_ids.map(id => id.toLowerCase())
  if (new Set(ids).size !== ids.length) invalid('Duplicate application IDs are not allowed.')
  return { ids, operationId: body.operation_id.toLowerCase() }
}

async function updateReceipt(supabase, id, values) {
  let query = supabase.from(AUDIT_TABLE).update({ ...values, updated_at: new Date().toISOString() }).eq('application_id', id)
  // A concurrent retry must never overwrite a confirmed deletion with a failure.
  if (values.status !== 'deleted') query = query.neq('status', 'deleted')
  const { error } = await query
  if (error) throw error
}

const result = (id, status, code, message) => ({ id, status, code, message })

async function deleteOne(supabase, id, userId, operationId) {
  let receipt = null
  try {
    const { error: insertError } = await supabase.from(AUDIT_TABLE).upsert({
      application_id: id, operation_id: operationId, last_operation_id: operationId,
      requested_by: userId, last_attempt_by: userId, status: 'processing'
    }, { onConflict: 'application_id', ignoreDuplicates: true })
    if (insertError) throw insertError
    const { data, error } = await supabase.from(AUDIT_TABLE).select(RECEIPT_SELECT).eq('application_id', id).single()
    if (error) throw error
    receipt = data
    if (receipt.status === 'deleted') return result(id, 'deleted', 'already_deleted', 'Already deleted; no further cleanup needed.')
    await updateReceipt(supabase, id, { status: 'processing', code: null, last_attempt_by: userId, last_operation_id: operationId })
    await rejectApplication(supabase, id, userId, '', {
      beforeCleanup: async () => {
        const startedAt = receipt.cleanup_started_at || new Date().toISOString()
        await updateReceipt(supabase, id, { cleanup_started_at: startedAt })
        receipt.cleanup_started_at = startedAt
      }
    })
    await updateReceipt(supabase, id, { status: 'deleted', code: 'deleted', deleted_at: new Date().toISOString() })
    return result(id, 'deleted', 'deleted', 'Application and staged CV deleted.')
  } catch (error) {
    // If the process stopped after removing the row, its pre-cleanup receipt
    // proves that a repeat request is completing that same deletion.
    if (error.statusCode === 404 && receipt?.cleanup_started_at) {
      try {
        await updateReceipt(supabase, id, { status: 'deleted', code: 'already_deleted', deleted_at: new Date().toISOString() })
        return result(id, 'deleted', 'already_deleted', 'Deletion already completed.')
      } catch { /* Keep the receipt discoverable for another retry. */ }
    }
    const skipped = error.statusCode === 404 || error.code === 'APPLICATION_INELIGIBLE'
    const status = skipped ? 'skipped' : 'failed'
    const code = error.statusCode === 404 ? 'not_found'
      : skipped ? 'ineligible' : error.code === 'INVALID_STAGED_CV' ? 'invalid_staged_cv'
        : error.statusCode === 502 ? 'storage_cleanup_failed' : 'cleanup_failed'
    if (receipt) {
      try { await updateReceipt(supabase, id, { status, code }) }
      catch { /* A processing receipt is also included in the recovery list. */ }
    }
    const message = skipped ? (error.statusCode === 404 ? 'Application no longer exists.' : 'Application is no longer eligible for deletion.')
      : code === 'invalid_staged_cv' ? 'Invalid staged CV path. Ask an administrator to repair it before retrying.'
        : 'Deletion could not be completed. The cleanup is recoverable; retry this application.'
    return result(id, status, code, message)
  }
}

async function bulkDeleteApplications(supabase, body, userId) {
  const { ids, operationId } = validateBulkDeletion(body)
  const results = new Array(ids.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, ids.length) }, async () => {
    while (next < ids.length) {
      const index = next++
      results[index] = await deleteOne(supabase, ids[index], userId, operationId)
    }
  }))
  const summary = { deleted: 0, skipped: 0, failed: 0 }
  results.forEach(item => { summary[item.status] += 1 })
  return { operation_id: operationId, results, summary }
}

async function listDeletionFailures(supabase) {
  const { data, error, count } = await supabase.from(AUDIT_TABLE).select(RECEIPT_SELECT, { count: 'exact' })
    .in('status', ['failed', 'processing']).order('updated_at', { ascending: true }).limit(MAX_DELETE_BATCH)
  if (error) throw error
  if (!data?.length) return { data: [], total: 0 }
  const { data: applications, error: applicationError } = await supabase.from('public_applications')
    .select('id, full_name, application_status').in('id', data.map(item => item.application_id))
  if (applicationError) throw applicationError
  const byId = new Map((applications || []).map(item => [item.id, item]))
  return {
    data: data.map(item => ({
      id: item.application_id,
      full_name: byId.get(item.application_id)?.full_name || item.application_id,
      application_status: byId.get(item.application_id)?.application_status || 'missing',
      code: item.code,
      message: item.code === 'invalid_staged_cv' ? 'Staged CV needs repair before cleanup.' : 'Previous deletion needs cleanup. Select to retry.'
    })),
    total: count || data.length
  }
}

module.exports = { MAX_DELETE_BATCH, DELETE_CONCURRENCY, validateBulkDeletion, bulkDeleteApplications, listDeletionFailures }
