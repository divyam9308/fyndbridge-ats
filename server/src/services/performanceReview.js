const supabase = require('./supabaseAdmin')
const { isSuperAdmin } = require('./adminAccess')

const REVIEW_PERIOD = 'current'

const BASE_FIELDS = [
  'category',
  'allocation',
  'work_done',
  'self_score',
  'ss_ns_feedback',
  'ss_ns_score',
  'ra_feedback',
  'ra_score'
]

const CALCULATED_FIELDS = ['self_rating', 'ss_ns_rating', 'final_rating']

const COLUMN_KEYS = [
  'category',
  'allocation',
  'work_done',
  'self_score',
  'self_rating',
  'ss_ns_feedback',
  'ss_ns_score',
  'ss_ns_rating',
  'ra_feedback',
  'ra_score',
  'final_rating'
]

const DEFAULT_ROWS = [
  { row_order: 1, category: 'Revenue and Mandate Lifecycle Management', allocation: 60 },
  { row_order: 2, category: 'Business Development', allocation: 10 },
  { row_order: 3, category: 'Business Enablement and Operational Excellence', allocation: 5 },
  { row_order: 4, category: 'Interpersonal & Organizational Effectiveness', allocation: 10 },
  { row_order: 5, category: 'Process Compliance', allocation: 15 }
]

const DEFAULT_PERMISSIONS = Object.fromEntries(COLUMN_KEYS.map(key => [key, 'everyone']))

function httpError(message, statusCode = 400, fields = undefined) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (fields) err.fields = fields
  return err
}

function assertUuid(value, label = 'User id') {
  const text = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw httpError(`${label} is invalid`, 400)
  }
  return text
}

function numeric(value, field, { nullable = false, min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null
    throw httpError(`${field} is required`)
  }
  const number = Number(value)
  if (!Number.isFinite(number)) throw httpError(`${field} must be numeric`)
  if (number < min || number > max) throw httpError(`${field} must be between ${min} and ${max}`)
  return number
}

function cleanText(value, field) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw httpError(`${field} must be a string`)
  return value
}

function rating(score, allocation) {
  return (Number(score) || 0) * (Number(allocation) || 0) / 100
}

function serializeRow(row) {
  return {
    id: row.id,
    row_order: row.row_order,
    category: row.category || '',
    allocation: Number(row.allocation) || 0,
    work_done: row.work_done || '',
    self_score: row.self_score === null || row.self_score === undefined ? null : Number(row.self_score),
    self_rating: rating(row.self_score, row.allocation),
    ss_ns_feedback: row.ss_ns_feedback || '',
    ss_ns_score: row.ss_ns_score === null || row.ss_ns_score === undefined ? null : Number(row.ss_ns_score),
    ss_ns_rating: rating(row.ss_ns_score, row.allocation),
    ra_feedback: row.ra_feedback || '',
    ra_score: row.ra_score === null || row.ra_score === undefined ? null : Number(row.ra_score),
    final_rating: rating(row.ra_score, row.allocation)
  }
}

function serializeReview(review, rows) {
  const serializedRows = [...rows].sort((a, b) => a.row_order - b.row_order).map(serializeRow)
  const totals = serializedRows.reduce((acc, row) => ({
    allocation_total: acc.allocation_total + row.allocation,
    self_rating_total: acc.self_rating_total + row.self_rating,
    ss_ns_rating_total: acc.ss_ns_rating_total + row.ss_ns_rating,
    final_rating_total: acc.final_rating_total + row.final_rating
  }), { allocation_total: 0, self_rating_total: 0, ss_ns_rating_total: 0, final_rating_total: 0 })
  return {
    id: review.id,
    employee_user_id: review.employee_user_id,
    review_period: review.review_period,
    rows: serializedRows,
    ...totals
  }
}

async function assertCanAccessEmployee(actor, employeeUserId) {
  const targetUserId = assertUuid(employeeUserId, 'Employee user id')
  if (actor?.id === targetUserId) return { targetUserId, superAdmin: false }
  const superAdmin = await isSuperAdmin(actor)
  if (!superAdmin) throw httpError('Super Admin required to access another employee review', 403)
  return { targetUserId, superAdmin: true }
}

async function fetchRows(reviewId) {
  const { data, error } = await supabase
    .from('performance_review_rows')
    .select('*')
    .eq('review_id', reviewId)
    .order('row_order', { ascending: true })
  if (error) throw error
  return data || []
}

async function insertDefaultRows(reviewId) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('performance_review_rows')
    .upsert(DEFAULT_ROWS.map(row => ({
      review_id: reviewId,
      ...row,
      work_done: '',
      self_score: null,
      ss_ns_feedback: '',
      ss_ns_score: null,
      ra_feedback: '',
      ra_score: null,
      created_at: now,
      updated_at: now
    })), { onConflict: 'review_id,row_order' })
  if (error) throw error
}

async function ensureReview(employeeUserId, actorId) {
  const targetUserId = assertUuid(employeeUserId, 'Employee user id')
  let { data: review, error } = await supabase
    .from('performance_reviews')
    .select('*')
    .eq('employee_user_id', targetUserId)
    .eq('review_period', REVIEW_PERIOD)
    .maybeSingle()
  if (error) throw error

  if (!review) {
    const now = new Date().toISOString()
    const inserted = await supabase
      .from('performance_reviews')
      .insert({
        employee_user_id: targetUserId,
        review_period: REVIEW_PERIOD,
        created_by: actorId || null,
        updated_by: actorId || null,
        created_at: now,
        updated_at: now
      })
      .select('*')
      .single()
    if (inserted.error?.code === '23505') {
      const refetched = await supabase
        .from('performance_reviews')
        .select('*')
        .eq('employee_user_id', targetUserId)
        .eq('review_period', REVIEW_PERIOD)
        .single()
      if (refetched.error) throw refetched.error
      review = refetched.data
    } else if (inserted.error) {
      throw inserted.error
    } else {
      review = inserted.data
    }
  }

  let rows = await fetchRows(review.id)
  if (rows.length < 5) {
    await insertDefaultRows(review.id)
    rows = await fetchRows(review.id)
  }
  return { review, rows }
}

async function getReview(actor, employeeUserId) {
  const { targetUserId } = await assertCanAccessEmployee(actor, employeeUserId)
  const { review, rows } = await ensureReview(targetUserId, actor.id)
  return serializeReview(review, rows)
}

async function getPermissions() {
  const { data, error } = await supabase
    .from('performance_column_permissions')
    .select('column_key, access_level')
  if (error) throw error
  return (data || []).reduce((acc, row) => {
    if (COLUMN_KEYS.includes(row.column_key)) acc[row.column_key] = row.access_level || 'everyone'
    return acc
  }, { ...DEFAULT_PERMISSIONS })
}

function normalizeRowsPayload(rows, permissions, superAdmin, existingRows = []) {
  if (!Array.isArray(rows) || rows.length !== 5) throw httpError('Exactly 5 performance rows are required')
  const orders = rows.map(row => Number(row?.row_order))
  if (orders.some(order => !Number.isInteger(order) || order < 1 || order > 5) || new Set(orders).size !== 5) {
    throw httpError('Row orders must be exactly 1 to 5')
  }

  let allocationTotal = 0
  const blockedFields = new Set()
  const existingByOrder = new Map(existingRows.map(row => [Number(row.row_order), row]))
  const normalized = rows.map(row => {
    const unsupported = Object.keys(row || {}).filter(key => (
      !['id', 'row_order', ...BASE_FIELDS].includes(key) && !CALCULATED_FIELDS.includes(key)
    ))
    if (unsupported.length) throw httpError(`Unsupported fields: ${unsupported.join(', ')}`)
    const calculated = Object.keys(row || {}).filter(key => CALCULATED_FIELDS.includes(key))
    if (calculated.length) throw httpError('Calculated rating fields cannot be updated', 400, calculated)

    for (const field of BASE_FIELDS) {
      const level = permissions[field] || 'everyone'
      if (!superAdmin && ['super_admin_disabled', 'super_admin_hidden'].includes(level) && Object.prototype.hasOwnProperty.call(row, field)) {
        blockedFields.add(field)
      }
    }

    const existing = existingByOrder.get(Number(row.row_order)) || {}
    const value = (field) => Object.prototype.hasOwnProperty.call(row, field) ? row[field] : existing[field]
    const allocation = numeric(value('allocation'), `row ${row.row_order} allocation`, { min: 0, max: 100 })
    allocationTotal += allocation
    return {
      row_order: Number(row.row_order),
      category: cleanText(value('category'), `row ${row.row_order} category`),
      allocation,
      work_done: cleanText(value('work_done'), `row ${row.row_order} work_done`),
      self_score: numeric(value('self_score'), `row ${row.row_order} self_score`, { nullable: true, min: 0, max: 5 }),
      ss_ns_feedback: cleanText(value('ss_ns_feedback'), `row ${row.row_order} ss_ns_feedback`),
      ss_ns_score: numeric(value('ss_ns_score'), `row ${row.row_order} ss_ns_score`, { nullable: true, min: 0, max: 5 }),
      ra_feedback: cleanText(value('ra_feedback'), `row ${row.row_order} ra_feedback`),
      ra_score: numeric(value('ra_score'), `row ${row.row_order} ra_score`, { nullable: true, min: 0, max: 5 })
    }
  })

  if (blockedFields.size) {
    throw httpError('You do not have permission to update protected performance fields.', 403, [...blockedFields])
  }
  if (Math.round(allocationTotal * 100) !== 10000) {
    throw httpError('Allocation total must equal 100%.')
  }
  return normalized.sort((a, b) => a.row_order - b.row_order)
}

async function updateReview(actor, employeeUserId, rowsPayload) {
  const { targetUserId, superAdmin } = await assertCanAccessEmployee(actor, employeeUserId)
  const [existing, permissions] = await Promise.all([
    ensureReview(targetUserId, actor.id),
    getPermissions()
  ])
  const canManageAllColumns = superAdmin || (actor.id === targetUserId && await isSuperAdmin(actor))
  const rows = normalizeRowsPayload(rowsPayload, permissions, canManageAllColumns, existing.rows)
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('performance_review_rows')
    .upsert(rows.map(row => ({
      review_id: existing.review.id,
      ...row,
      updated_at: now
    })), { onConflict: 'review_id,row_order' })
  if (error) throw error

  const reviewUpdate = await supabase
    .from('performance_reviews')
    .update({ updated_by: actor.id, updated_at: now })
    .eq('id', existing.review.id)
    .select('*')
    .single()
  if (reviewUpdate.error) throw reviewUpdate.error
  return getReview(actor, targetUserId)
}

async function updatePermissions(actor, payload) {
  if (!(await isSuperAdmin(actor))) throw httpError('Super Admin required', 403)
  const entries = Array.isArray(payload?.permissions)
    ? payload.permissions
    : Object.entries(payload?.permissions || payload || {}).map(([column_key, access_level]) => ({ column_key, access_level }))
  if (!entries.length) throw httpError('Performance permissions are required')

  const rows = entries.map(item => {
    const columnKey = String(item.column_key || item.columnKey || '').trim()
    const accessLevel = String(item.access_level || item.accessLevel || '').trim()
    if (!COLUMN_KEYS.includes(columnKey)) throw httpError(`Invalid performance column: ${columnKey || '(blank)'}`)
    if (!['everyone', 'super_admin_disabled', 'super_admin_hidden'].includes(accessLevel)) throw httpError(`Invalid access level for ${columnKey}`)
    return {
      column_key: columnKey,
      access_level: accessLevel,
      updated_by: actor.id,
      updated_at: new Date().toISOString()
    }
  })

  const { error } = await supabase
    .from('performance_column_permissions')
    .upsert(rows, { onConflict: 'column_key' })
  if (error) throw error
  return getPermissions()
}

module.exports = {
  BASE_FIELDS,
  CALCULATED_FIELDS,
  COLUMN_KEYS,
  DEFAULT_ROWS,
  DEFAULT_PERMISSIONS,
  getReview,
  updateReview,
  getPermissions,
  updatePermissions
}
