const { randomUUID } = require('crypto')
const supabase = require('../services/supabaseAdmin')
const { uploadDocument } = require('../services/documentStorage')
const { STORAGE_BUCKETS, documentOpenUrl, normalizeStoragePath } = require('../services/storageBuckets')
const { allocateNextDisplayId, isDisplayIdUniqueError } = require('../services/displayIdAllocator')
const { validateAiFilters, applyFilters: applySharedFilters } = require('../services/filterEngine')
const { parseAiFilters } = require('../services/aiFilterParser')
const { applyQueryFilters } = require('../services/queryFilters')
const { createConsultantAssignmentNotification, createClientFollowUpDueNotification } = require('../services/assignmentNotifications')
const { isAdmin, stripHiddenFields, assertCanUpdateColumns, assertRowEditable } = require('../services/adminAccess')

const CLIENT_STATUSES = [
  'Active',
  'Inactive',
  'Converted',
  'Not Converted',
  'Follow Up Required',
  'Not Hiring',
  'Not Adding Consultants',
  "Didn't Pick Up"
]

const TERMS_TYPES = ['%', 'Fixed Fee Model', 'Slab %', 'Any Other']

function logAndSendInternal(res, method, err) {
  console.error(`${method} error:`, {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
    stack: err.stack
  })
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error')
  return res.status(500).json({ error: message, detail: err.message })
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function nullable(value) {
  const next = clean(value)
  return next || null
}

function normalizeFollowUpDateValue(value) {
  const text = clean(value)
  if (!text) return ''
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10)
}

function normalizeBoolean(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '').toLowerCase() === 'yes'
}

function normalizeDuplicateText(value) {
  return clean(value).toLowerCase()
}

function isPlaceholderContactPayload({ contactPerson, mobile, email, linkedin, designation }) {
  const name = clean(contactPerson).toLowerCase()
  const hasPlaceholderName = !name || /^contact\s+\d+$/.test(name)
  const hasDetails = [mobile, email, linkedin, designation].some(value => Boolean(clean(value)))
  return hasPlaceholderName && !hasDetails
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}\\s*(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function compareDisplayIds(a, b, prefix) {
  const aText = clean(a)
  const bText = clean(b)
  const aNumber = displayIdNumber(aText, prefix)
  const bNumber = displayIdNumber(bText, prefix)
  if (aNumber !== bNumber) return aNumber - bNumber
  return aText.localeCompare(bText, undefined, { sensitivity: 'base' })
}

const CLIENT_DISPLAY_ID_RESERVATION_MS = 10 * 60 * 1000
const reservedClientDisplayIds = new Map()

function cleanupClientDisplayIdReservations() {
  const now = Date.now()
  for (const [displayId, expiresAt] of reservedClientDisplayIds.entries()) {
    if (expiresAt <= now) reservedClientDisplayIds.delete(displayId)
  }
}

function releaseClientDisplayId(displayId) {
  reservedClientDisplayIds.delete(clean(displayId))
}

function reserveClientDisplayId(displayId) {
  const value = clean(displayId)
  if (value) reservedClientDisplayIds.set(value, Date.now() + CLIENT_DISPLAY_ID_RESERVATION_MS)
}

function nextFreeDisplayId(rows, prefix, includeReservations = false) {
  cleanupClientDisplayIdReservations()
  const used = new Set((rows || []).map((row) => displayIdNumber(row.client_display_id, prefix)).filter((number) => number < Number.MAX_SAFE_INTEGER))
  if (includeReservations) {
    for (const displayId of reservedClientDisplayIds.keys()) {
      const number = displayIdNumber(displayId, prefix)
      if (number < Number.MAX_SAFE_INTEGER) used.add(number)
    }
  }
  let next = 1
  while (used.has(next)) next += 1
  return `${prefix}${next}`
}

const SORT_FIELDS = new Set(['client_id', 'client_name'])
const SORT_DIRECTIONS = new Set(['asc', 'desc'])
const CLIENT_FILTER_MAPPING = {
  client_id: [{ column: 'client_display_id', kind: 'text' }],
  client_name: [{ column: 'client_name', kind: 'text' }, { column: 'name', kind: 'text' }],
  location: [{ column: 'location', kind: 'text' }, { column: 'city', kind: 'text' }, { column: 'address_on_invoice', kind: 'text' }],
  region: [{ column: 'region', kind: 'text' }, { column: 'state', kind: 'text' }],
  consultant: [{ column: 'consultant_name', kind: 'text' }, { column: 'consultant', kind: 'text' }],
  contact_person: [{ column: 'contact_person', kind: 'text' }, { column: 'contact', kind: 'text' }],
  mobile: [{ column: 'mobile', kind: 'text' }, { column: 'phone', kind: 'text' }],
  email: [{ column: 'email', kind: 'text' }],
  linkedin: [{ column: 'linkedin', kind: 'text' }],
  sector: [{ column: 'sector', kind: 'text' }],
  connected_on_date: [{ column: 'connected_on_date', kind: 'date' }],
  comments: [{ column: 'comments', kind: 'text' }, { column: 'notes', kind: 'text' }],
  follow_up_date: [{ column: 'follow_up_date', kind: 'date' }],
  status: [{ column: 'status', kind: 'text' }],
  terms_signed: [{ column: 'terms_signed_type', kind: 'text' }, { column: 'terms_signed_custom', kind: 'text' }],
  value: [{ column: 'terms_value', kind: 'text' }],
  billing_entity: [{ column: 'billing_entity', kind: 'text' }],
  gstin: [{ column: 'gstin', kind: 'text' }],
  pan: [{ column: 'pan', kind: 'text' }],
  address_on_invoice: [{ column: 'address_on_invoice', kind: 'text' }],
  designation: [{ column: 'designation', kind: 'text' }],
  contract_signed: [{ column: 'contract_signed', kind: 'boolean' }],
  contract_document: [{ column: 'contract_document', kind: 'text' }, { column: 'contract_pdf_url', kind: 'text' }, { column: 'contract_pdf_storage_path', kind: 'text' }]
}

function normalizeSort(query) {
  const field = clean(query.sortField)
  const direction = clean(query.sortDirection).toLowerCase()
  if (!SORT_FIELDS.has(field)) return { field: '', direction: 'asc' }
  return { field, direction: SORT_DIRECTIONS.has(direction) ? direction : 'asc' }
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
}

function isClientDisplayIdUniqueError(err) {
  return isDisplayIdUniqueError(err, 'client_display_id') || /clients_client_display_id/i.test(err?.message || '')
}

function sortClientRows(rows, sort) {
  if (!sort.field) return rows.sort((a, b) => displayIdNumber(a.client_display_id, 'CL') - displayIdNumber(b.client_display_id, 'CL'))
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (sort.field === 'client_id') {
      return compareDisplayIds(a.client_display_id, b.client_display_id, 'CL') * direction
    }
    return compareText(a.client_name || a.name, b.client_name || b.name) * direction
  })
}

async function ensureClientDisplayIds() {
  const { data, error } = await supabase
    .from('clients')
    .select('id, client_display_id, client_name, name, created_at')
    .order('created_at', { ascending: true })

  if (error) throw error

  const usedDisplayIds = new Set((data || []).map((client) => displayIdNumber(client.client_display_id, 'CL')).filter((number) => number < Number.MAX_SAFE_INTEGER))
  let next = displayIdNumber(nextFreeDisplayId(data, 'CL', true), 'CL')

  for (const client of data || []) {
    const current = clean(client.client_display_id)
    if (current) continue
    while (usedDisplayIds.has(next)) next += 1
    const displayId = `CL${next++}`
    usedDisplayIds.add(displayIdNumber(displayId, 'CL'))
    const { error: updateError } = await supabase.from('clients').update({ client_display_id: displayId }).eq('id', client.id)
    if (isClientDisplayIdUniqueError(updateError)) return
    if (updateError) throw updateError
  }
}

async function nextClientDisplayId() {
  return allocateNextDisplayId({ supabase, table: 'clients', column: 'client_display_id', prefix: 'CL' })
}

function parseJsonFilter(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function clientFilterValue(row, field) {
  return {
    client_id: row.client_display_id,
    client_name: row.client_name || row.name,
    location: [row.location, row.city, row.address_on_invoice].filter(Boolean).join(' '),
    region: row.region || row.state,
    consultant: row.consultant_name || row.consultant,
    contact_person: row.contact_person || row.contact,
    mobile: row.mobile || row.phone,
    email: row.email,
    linkedin: row.linkedin,
    sector: row.sector,
    connected_on_date: row.connected_on_date,
    comments: row.comments || row.notes,
    follow_up_date: row.follow_up_date,
    status: row.status,
    terms_signed: row.terms_signed_type === 'Any Other' ? row.terms_signed_custom : row.terms_signed_type,
    value: row.terms_value,
    billing_entity: row.billing_entity,
    gstin: row.gstin,
    pan: row.pan,
    address_on_invoice: row.address_on_invoice,
    designation: row.designation,
    contract_signed: row.contract_signed,
    contract_document: row.contract_document || row.contract_pdf_url || row.contract_pdf_storage_path
  }[field]
}

async function isClientDisplayIdAvailable(displayId) {
  const value = clean(displayId)
  if (!value) return false
  const { data, error } = await supabase.from('clients').select('id').eq('client_display_id', value).limit(1)
  if (error) throw error
  return !(data || []).length
}

async function getNextClientDisplayId(req, res) {
  try {
    const clientDisplayId = await nextClientDisplayId()
    reserveClientDisplayId(clientDisplayId)
    return res.json({ client_display_id: clientDisplayId })
  } catch (err) {
    return logAndSendInternal(res, 'getNextClientDisplayId', err)
  }
}

function deriveClientStatus(row, jobs = []) {
  if (row.status) return row.status
  if (jobs.length && jobs.every((job) => job.status === 'Scrapped' || job.mandate_status === 'Scrapped')) return 'Inactive'
  if (jobs.some((job) => ['Ongoing', 'Completed'].includes(job.status) || ['Ongoing', 'Completed'].includes(job.mandate_status))) return 'Active'
  return row.status || ''
}

function normalizeClient(row, activeJobs = 0, followUps = [], jobs = []) {
  const clientName = row.client_name || row.name || ''
  const contactPerson = row.contact_person || row.contact || ''
  const mobile = row.mobile || row.phone || ''
  const location = row.location || row.city || ''
  const region = row.region || row.state || ''
  const comments = row.comments || row.notes || ''
  const consultant = row.consultant_name || row.consultant || ''
  const latestFollowUp = followUps[followUps.length - 1] || null

  return {
    ...row,
    client_display_id: row.client_display_id,
    consultant_name: consultant,
    consultant,
    name: clientName,
    client_name: clientName,
    contact: contactPerson,
    designation: row.designation || '',
    contact_person: contactPerson,
    phone: mobile,
    mobile,
    city: location,
    location,
    state: region,
    region,
    notes: comments,
    comments,
    status: deriveClientStatus(row, jobs),
    terms_signed: row.terms_signed_type === 'Any Other' ? row.terms_signed_custom : row.terms_signed_type,
    billing_entity: row.billing_entity || '',
    contract_signed: Boolean(row.contract_signed),
    contract_document: documentOpenUrl('contract', row.contract_pdf_storage_path || row.contract_pdf_url || row.contract_document),
    contract_pdf_url: documentOpenUrl('contract', row.contract_pdf_storage_path || row.contract_pdf_url || row.contract_document),
    contract_pdf_storage_path: normalizeStoragePath(row.contract_pdf_storage_path || row.contract_pdf_url || row.contract_document, STORAGE_BUCKETS.CONTRACT),
    activeJobs,
    follow_up_date: latestFollowUp?.follow_up_date || '',
    follow_ups: followUps
  }
}

async function uploadContractPdf(file) {
  if (!file) return null
  return uploadDocument(file, STORAGE_BUCKETS.CONTRACT, String(new Date().getFullYear()))
}

function clientPayload(body) {
  const status = clean(body.status) || null
  if (status && !CLIENT_STATUSES.includes(status)) {
    const err = new Error(`Status must be one of: ${CLIENT_STATUSES.join(', ')}`)
    err.statusCode = 400
    throw err
  }

  const termsType = body.terms_signed_type || body.terms_type || ''
  if (termsType && !TERMS_TYPES.includes(termsType)) {
    const err = new Error(`Terms Signed must be one of: ${TERMS_TYPES.join(', ')}`)
    err.statusCode = 400
    throw err
  }

  const clientName = clean(body.client_name || body.name)
  const mobile = clean(body.mobile || body.phone)
  const email = clean(body.email)
  const contactPerson = clean(body.contact_person || body.contact)
  const contractSigned = normalizeBoolean(body.contract_signed)
  const contractPath = normalizeStoragePath(body.contract_pdf_storage_path || body.contract_pdf_url || body.contract_document, STORAGE_BUCKETS.CONTRACT)

  if (!clientName) {
    const err = new Error('Client Name is required')
    err.statusCode = 400
    throw err
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Enter a valid email')
    err.statusCode = 400
    throw err
  }
  if (body.client_group_id && !contactPerson) {
    const err = new Error('Contact Person is required')
    err.statusCode = 400
    throw err
  }
  if (body.client_group_id && isPlaceholderContactPayload({ contactPerson, mobile, email, linkedin: body.linkedin, designation: body.designation })) {
    const err = new Error('Enter real contact details before saving a contact person')
    err.statusCode = 400
    throw err
  }

  return {
    client_group_id: body.client_group_id || null,
    client_display_id: nullable(body.client_display_id),
    consultant_user_id: nullable(body.consultant_user_id),
    consultant_name: nullable(body.consultant_name || body.consultant),
    client_name: clientName,
    name: clientName,
    location: nullable(body.location || body.city),
    city: nullable(body.location || body.city),
    region: nullable(body.region || body.state),
    state: nullable(body.region || body.state),
    contact_person: nullable(contactPerson),
    contact: nullable(contactPerson),
    designation: nullable(body.designation),
    mobile,
    phone: mobile,
    email: nullable(email),
    linkedin: nullable(body.linkedin),
    sector: nullable(body.sector),
    connected_on_date: body.connected_on_date || null,
    comments: nullable(body.comments || body.notes),
    notes: nullable(body.comments || body.notes),
    status: status || '',
    terms_signed_type: contractSigned ? nullable(termsType) : null,
    terms_signed_custom: contractSigned && termsType === 'Any Other' ? nullable(body.terms_signed_custom) : null,
    terms_value: contractSigned ? nullable(body.terms_value) : null,
    billing_entity: contractSigned ? nullable(body.billing_entity) : null,
    contract_signed: contractSigned,
    contract_document: contractSigned ? nullable(contractPath) : null,
    contract_pdf_url: contractSigned ? nullable(contractPath) : null,
    contract_pdf_storage_path: contractSigned ? nullable(contractPath) : null,
    gstin: contractSigned ? nullable(body.gstin) : null,
    pan: contractSigned ? nullable(body.pan) : null,
    address_on_invoice: contractSigned ? nullable(body.address_on_invoice) : null
  }
}

async function findClientDuplicate(name) {
  const normalizedName = normalizeDuplicateText(name)
  if (!normalizedName) return null

  const { data, error } = await supabase.from('clients').select('*')
  if (error) throw error
  return (data || []).find((client) => normalizeDuplicateText(client.client_name || client.name) === normalizedName) || null
}

async function checkClientDuplicate(req, res) {
  try {
    const existing = await findClientDuplicate(req.query.name)
    return res.json({ duplicate: Boolean(existing), existing })
  } catch (err) {
    return logAndSendInternal(res, 'checkClientDuplicate', err)
  }
}

async function loadFollowUps(clientIds) {
  if (!clientIds.length) return {}
  const { data, error } = await supabase
    .from('client_follow_ups')
    .select('*')
    .in('client_id', clientIds)
    .order('follow_up_number', { ascending: true })

  if (error) throw error
  return (data || []).reduce((map, followUp) => {
    map[followUp.client_id] = map[followUp.client_id] || []
    map[followUp.client_id].push(followUp)
    return map
  }, {})
}

async function followUpScope(clientId) {
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, client_group_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  const ownerId = client?.client_group_id || client?.id || clientId
  const { data: groupRows, error: groupError } = await supabase
    .from('clients')
    .select('id')
    .eq('client_group_id', ownerId)
  if (groupError) throw groupError
  return {
    ownerId,
    ids: [...new Set([ownerId, clientId, ...(groupRows || []).map((row) => row.id)].filter(Boolean))]
  }
}

function mergeFollowUps(followUpsMap, clientIds) {
  return clientIds.flatMap((id) => followUpsMap[id] || [])
    .sort((a, b) => {
      const dateDiff = String(a.follow_up_date || '').localeCompare(String(b.follow_up_date || ''))
      if (dateDiff) return dateDiff
      const numberDiff = (a.follow_up_number || 0) - (b.follow_up_number || 0)
      if (numberDiff) return numberDiff
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })
}

async function loadClientWithRelations(clientId) {
  const scope = await followUpScope(clientId)
  const { data, error } = await supabase.from('clients').select('*').eq('id', scope.ownerId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const { data: jobs, error: jobsError } = await supabase.from('jobs').select('status, mandate_status').eq('client_id', scope.ownerId)
  if (jobsError) throw jobsError
  const followUpsMap = await loadFollowUps(scope.ids)
  return normalizeClient(data, 0, mergeFollowUps(followUpsMap, scope.ids), jobs || [])
}

async function findFollowUpDateDuplicate(clientIds, followUpDate, excludeFollowUpId = '') {
  const normalizedDate = normalizeFollowUpDateValue(followUpDate)
  const ids = Array.isArray(clientIds) ? clientIds.filter(Boolean) : [clientIds].filter(Boolean)
  if (!ids.length || !normalizedDate) return null
  let query = supabase
    .from('client_follow_ups')
    .select('id, follow_up_date')
    .in('client_id', ids)
    .eq('follow_up_date', normalizedDate)
    .limit(1)

  if (excludeFollowUpId) query = query.neq('id', excludeFollowUpId)
  const { data, error } = await query
  if (error) throw error
  return data?.[0] || null
}

async function syncEditedClientFollowUp(clientId, body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'follow_up_date')) return
  const followUpDate = normalizeFollowUpDateValue(body.follow_up_date)
  if (!followUpDate) return
  const scope = await followUpScope(clientId)
  const followUpsMap = await loadFollowUps(scope.ids)
  const followUps = mergeFollowUps(followUpsMap, scope.ids)
  const selectedId = clean(body.follow_up_id)
  const target = followUps.find((item) => item.id === selectedId) || followUps[followUps.length - 1] || null
  const duplicate = await findFollowUpDateDuplicate(scope.ids, followUpDate, target?.id || '')
  if (duplicate) {
    const err = new Error('A follow up already exists for this date.')
    err.statusCode = 409
    throw err
  }

  if (target) {
    const { data, error } = await supabase
      .from('client_follow_ups')
      .update({ follow_up_date: followUpDate, updated_at: new Date().toISOString() })
      .eq('id', target.id)
      .select('*')
      .single()
    if (error) throw error
    await notifyClientFollowUpDue(scope.ownerId, data)
    return
  }

  await createClientFollowUp(scope.ownerId, followUpDate, body.comments || body.notes)
}

function missingClientColumn(error) {
  if (error?.code !== 'PGRST204' && error?.code !== '42703') return null
  const match = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"|column\s+([a-zA-Z0-9_.]+)\s+does not exist/i)
  const value = match?.[1] || match?.[2] || match?.[3] || null
  return value ? String(value).split('.').pop() : null
}

async function insertClient(payload) {
  let next = payload
  let result = null
  for (let i = 0; i < 30; i += 1) {
    result = await supabase.from('clients').insert(next).select('*').single()
    const col = missingClientColumn(result.error)
    if (!col) break
    next = { ...next }
    delete next[col]
  }
  return result
}

async function updateClientRow(id, payload) {
  let next = payload
  let result = null
  for (let i = 0; i < 30; i += 1) {
    result = await supabase.from('clients').update(next).eq('id', id).select('*').maybeSingle()
    const col = missingClientColumn(result.error)
    if (!col) break
    next = { ...next }
    delete next[col]
  }
  return result
}

async function loadClientFollowUpNotificationTarget(clientId) {
  let selectFields = 'id, consultant_user_id, consultant_name, consultant, client_name, name'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await supabase
      .from('clients')
      .select(selectFields)
      .eq('id', clientId)
      .maybeSingle()
    const col = missingClientColumn(result.error)
    if (!col) return result
    const fields = selectFields.split(',').map((field) => field.trim()).filter(Boolean)
    selectFields = fields.filter((field) => field !== col).join(', ')
  }
  return { data: null, error: new Error('Unable to load client follow-up notification target') }
}

async function nextFollowUpNumber(clientId) {
  const { data, error } = await supabase
    .from('client_follow_ups')
    .select('follow_up_number')
    .eq('client_id', clientId)
    .order('follow_up_number', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data || [])[0]?.follow_up_number || 0) + 1
}

async function notifyClientFollowUpDue(clientId, followUp) {
  if (!followUp?.follow_up_date) return
  const { data: client, error } = await loadClientFollowUpNotificationTarget(clientId)
  if (error) throw error
  if (!client) return
  await createClientFollowUpDueNotification({
    consultantUserId: client.consultant_user_id,
    consultantName: client.consultant_name || client.consultant,
    clientId: client.id,
    clientName: client.client_name || client.name,
    followUpDate: followUp.follow_up_date,
    followUpId: followUp.id
  })
}

async function createClientFollowUp(clientId, followUpDate, followUpComments = '') {
  const normalizedDate = normalizeFollowUpDateValue(followUpDate)
  if (!normalizedDate) return null
  const scope = await followUpScope(clientId)
  const duplicate = await findFollowUpDateDuplicate(scope.ids, normalizedDate)
  if (duplicate) {
    const err = new Error('A follow up already exists for this date.')
    err.statusCode = 409
    throw err
  }
  const { data, error } = await supabase
    .from('client_follow_ups')
    .insert({
      client_id: scope.ownerId,
      follow_up_number: await nextFollowUpNumber(scope.ownerId),
      follow_up_date: normalizedDate,
      follow_up_comments: nullable(followUpComments)
    })
    .select('*')
    .single()
  if (error) throw error
  await notifyClientFollowUpDue(scope.ownerId, data)
  return data
}

async function listClients(req, res) {
  try {
    const sort = normalizeSort(req.query)
    const aiFilters = parseJsonFilter(req.query.ai_filters)
    const localAiFilter = aiFilters?.mode === 'keyword' || (aiFilters?.rankingHints || []).length || (aiFilters?.conditions || []).some(condition => ['consultant', 'value', 'follow_up_date'].includes(condition.field))
    const paginate = String(req.query.all || '').toLowerCase() !== 'true' && !localAiFilter
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase.from('clients').select('*', { count: paginate ? 'exact' : undefined })
    if (req.query.search) {
      const search = clean(req.query.search)
      query = query.or([
        `client_display_id.ilike.%${search}%`,
        `client_name.ilike.%${search}%`,
        `name.ilike.%${search}%`,
        `email.ilike.%${search}%`,
        `mobile.ilike.%${search}%`,
        `phone.ilike.%${search}%`,
        `contact_person.ilike.%${search}%`,
        `contact.ilike.%${search}%`
      ].join(','))
    }
    if (req.query.status && req.query.status !== 'All') {
      if (req.query.status === '-') {
        query = query.or('status.is.null,status.eq.')
      } else {
        query = query.eq('status', clean(req.query.status))
      }
    }
    if (!localAiFilter) {
      const appliedAi = applyQueryFilters(query, 'clients', aiFilters, CLIENT_FILTER_MAPPING)
      query = appliedAi.query
    }
    if (sort.field === 'client_id') query = query.order('created_at', { ascending: sort.direction !== 'desc' })
    else if (sort.field === 'client_name') query = query.order('client_name', { ascending: sort.direction !== 'desc' }).order('name', { ascending: sort.direction !== 'desc' })
    else query = query.order('created_at', { ascending: false })
    if (paginate) query = query.range(from, to)
    const { data, error, count } = await query
    if (error) throw error
    const pagedData = !paginate ? sortClientRows(data || [], sort) : (data || [])

    const clientIds = pagedData.map((client) => client.id)
    const jobsQuery = supabase.from('jobs').select('client_id, status, mandate_status')
    const { data: jobs, error: jobsError } = clientIds.length ? await jobsQuery.in('client_id', clientIds) : { data: [], error: null }
    if (jobsError) throw jobsError

    const activeJobsMap = {}
    const jobsByClient = {}
    ;(jobs || []).forEach((job) => {
      if (job.status === 'Open' || job.status === 'Active') activeJobsMap[job.client_id] = (activeJobsMap[job.client_id] || 0) + 1
      jobsByClient[job.client_id] = jobsByClient[job.client_id] || []
      jobsByClient[job.client_id].push(job)
    })

    const groupIds = [...new Set(pagedData.map((client) => client.client_group_id || client.id).filter(Boolean))]
    const { data: groupRows, error: groupRowsError } = groupIds.length
      ? await supabase.from('clients').select('id, client_group_id').in('client_group_id', groupIds)
      : { data: [], error: null }
    if (groupRowsError) throw groupRowsError
    const clientIdsByGroup = (groupRows || []).reduce((map, row) => {
      const key = row.client_group_id || row.id
      map[key] = map[key] || []
      map[key].push(row.id)
      return map
    }, {})
    const followUpsMap = await loadFollowUps([...new Set([...clientIds, ...groupIds, ...(groupRows || []).map((row) => row.id)])])
    const rows = pagedData.map((client) => {
      const groupId = client.client_group_id || client.id
      const scopeIds = [...new Set([groupId, client.id, ...(clientIdsByGroup[groupId] || [])].filter(Boolean))]
      return normalizeClient(client, activeJobsMap[client.id] || 0, mergeFollowUps(followUpsMap, scopeIds), jobsByClient[client.id] || [])
    })
    const filteredRows = paginate ? rows : applySharedFilters('clients', rows, aiFilters, clientFilterValue)
    const dataRows = localAiFilter ? filteredRows.slice(from, to + 1) : filteredRows
    const total = paginate ? count || 0 : filteredRows.length
    const totalPages = Math.max(1, Math.ceil(total / limit))
return res.json({ data: await stripHiddenFields('clients', dataRows, await isAdmin(req.user)), total, page, totalPages, limit })
  } catch (err) {
    return logAndSendInternal(res, 'listClients', err)
  }
}

async function buildClientFilters(req, res) {
  const prompt = clean(req.body.prompt)
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })
  try {
    return res.json(await parseAiFilters('clients', prompt))
  } catch (err) {
    const fallback = validateAiFilters('clients', null, prompt)
    if (fallback) return res.json({ filters: fallback, fallback: true })
    return logAndSendInternal(res, 'buildClientFilters', err)
  }
}

async function notifyClientConsultantAssignment(req, client, previousConsultantName = undefined) {
  await createConsultantAssignmentNotification({
    type: 'client',
    senderId: req.user?.id,
    consultantUserId: req.body.consultant_user_id,
    consultantName: client.consultant_name || client.consultant,
    previousConsultantName,
    entityName: client.client_name || client.name,
    clientId: client.id
  })
}

async function getClient(req, res) {
  try {
    const client = await loadClientWithRelations(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    return res.json(await stripHiddenFields('clients', client, await isAdmin(req.user)))
  } catch (err) {
    return logAndSendInternal(res, 'getClient', err)
  }
}

async function createClient(req, res) {
  try {
    if (req.file) {
      const contract = await uploadContractPdf(req.file)
      req.body.contract_document = contract.path
      req.body.contract_pdf_url = contract.path
      req.body.contract_pdf_storage_path = contract.path
    }
    const initialFollowUpDate = normalizeFollowUpDateValue(req.body.follow_up_date)
    const initialFollowUpComments = req.body.comments || req.body.notes
    const payload = clientPayload(req.body)
    const duplicateAction = req.body.duplicate_action
    const duplicate = await findClientDuplicate(payload.client_name)

    if (duplicate && !payload.client_group_id && duplicateAction !== 'update_current') {
      return res.status(409).json({ error: 'A client with the same name already exists.', duplicate: true, existing: duplicate })
    }

    if (duplicate && duplicateAction === 'update_current') {
      const { data, error } = await updateClientRow(duplicate.id, { ...payload, client_group_id: duplicate.client_group_id || duplicate.id, updated_at: new Date().toISOString() })
      if (error) throw error
      if (initialFollowUpDate) await createClientFollowUp(data.id, initialFollowUpDate, initialFollowUpComments)
      await notifyClientConsultantAssignment(req, data, duplicate.consultant_name || duplicate.consultant)
      return res.json(await loadClientWithRelations(data.id))
    }

    if (payload.client_group_id) {
      if (!payload.client_display_id) {
        const { data: parent, error: parentError } = await supabase
          .from('clients')
          .select('client_display_id')
          .eq('client_group_id', payload.client_group_id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (parentError) throw parentError
        payload.client_display_id = parent?.client_display_id || null
      }
    }

    let data = null
    let error = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const insertPayload = { ...payload }
      if (!insertPayload.client_group_id) {
        insertPayload.client_display_id = await nextClientDisplayId()
        insertPayload.id = randomUUID()
        insertPayload.client_group_id = insertPayload.id
      }
      const result = await insertClient(insertPayload)
      data = result.data
      error = result.error
      if (!error) {
        payload.client_display_id = insertPayload.client_display_id
        break
      }
      if (!insertPayload.client_group_id || !isClientDisplayIdUniqueError(error)) break
    }
    if (error) {
      console.error('createClient Supabase insert error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        payload
      })
      throw error
    }

    if (!data.client_group_id) {
      const { data: grouped, error: groupError } = await supabase
        .from('clients')
        .update({ client_group_id: data.id })
        .eq('id', data.id)
        .select('*')
        .single()
      if (missingClientColumn(groupError) === 'client_group_id') {
        releaseClientDisplayId(payload.client_display_id)
        if (initialFollowUpDate) await createClientFollowUp(data.id, initialFollowUpDate, initialFollowUpComments)
        await notifyClientConsultantAssignment(req, data)
        return res.status(201).json(await loadClientWithRelations(data.id))
      }
      if (groupError) throw groupError
      releaseClientDisplayId(payload.client_display_id)
      if (initialFollowUpDate) await createClientFollowUp(grouped.id, initialFollowUpDate, initialFollowUpComments)
      await notifyClientConsultantAssignment(req, grouped)
      return res.status(201).json(await loadClientWithRelations(grouped.id))
    }

    releaseClientDisplayId(payload.client_display_id)
    if (initialFollowUpDate) await createClientFollowUp(data.id, initialFollowUpDate, initialFollowUpComments)
    await notifyClientConsultantAssignment(req, data)
    return res.status(201).json(await loadClientWithRelations(data.id))
  } catch (err) {
    if (err.code === '23505' && /clients_name_key/i.test(err.message || '')) {
      return res.status(400).json({ error: 'Client name is still unique in Supabase. Run server/supabase-clients-module-upgrade.sql once.' })
    }
    if (isClientDisplayIdUniqueError(err)) {
      return res.status(400).json({ error: 'Could not allocate unique Client ID. Please try again.' })
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'createClient', err)
  }
}

async function updateClient(req, res) {
  try {
    const admin = await isAdmin(req.user)
    await assertRowEditable('clients', req.params.id, admin)
    await assertCanUpdateColumns('clients', req.body, admin)
    const { data: existing, error: existingError } = await supabase.from('clients').select('*').eq('id', req.params.id).maybeSingle()
    if (existingError) throw existingError
    if (!existing) return res.status(404).json({ error: 'Client not found' })

    if (req.file) {
      const contract = await uploadContractPdf(req.file)
      req.body.contract_document = contract.path
      req.body.contract_pdf_url = contract.path
      req.body.contract_pdf_storage_path = contract.path
    }
    await syncEditedClientFollowUp(req.params.id, req.body)
    const payload = clientPayload({ ...existing, ...req.body })
    delete payload.follow_up_date
    if (!payload.client_display_id) {
      payload.client_display_id = existing?.client_display_id || await nextClientDisplayId(payload.client_name)
    }
    const { data, error } = await updateClientRow(req.params.id, { ...payload, updated_at: new Date().toISOString() })

    if (error) throw error
    await notifyClientConsultantAssignment(req, data, existing.consultant_name || existing.consultant)
    return res.json(await stripHiddenFields('clients', await loadClientWithRelations(data.id), admin))
  } catch (err) {
    if (isClientDisplayIdUniqueError(err)) {
      return res.status(400).json({ error: 'Could not allocate unique Client ID. Please try again.' })
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'updateClient', err)
  }
}

async function addFollowUp(req, res) {
  try {
    const follow_up_date = normalizeFollowUpDateValue(req.body.follow_up_date)
    const { follow_up_comments } = req.body
    if (!follow_up_date) return res.status(400).json({ error: 'Follow Up Date is required' })
    const scope = await followUpScope(req.params.id)
    const data = await createClientFollowUp(scope.ownerId, follow_up_date, follow_up_comments)
    const client = await loadClientWithRelations(scope.ownerId)
    return res.status(201).json({ data, client, follow_ups: client?.follow_ups || [] })
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    if (err.code === '23505') return res.status(409).json({ error: 'A follow up already exists for this date.' })
    return logAndSendInternal(res, 'addFollowUp', err)
  }
}

async function updateFollowUp(req, res) {
  try {
    const follow_up_date = normalizeFollowUpDateValue(req.body.follow_up_date)
    const { follow_up_comments } = req.body
    if (!follow_up_date) return res.status(400).json({ error: 'Follow Up Date is required' })

    const scope = await followUpScope(req.params.id)
    const { data: existing, error: existingError } = await supabase
      .from('client_follow_ups')
      .select('*')
      .eq('id', req.params.followUpId)
      .in('client_id', scope.ids)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) return res.status(404).json({ error: 'Follow-up not found' })
    const duplicate = await findFollowUpDateDuplicate(scope.ids, follow_up_date, req.params.followUpId)
    if (duplicate) return res.status(409).json({ error: 'A follow up already exists for this date.' })

    const { data, error } = await supabase
      .from('client_follow_ups')
      .update({ follow_up_date, follow_up_comments: nullable(follow_up_comments) })
      .eq('id', req.params.followUpId)
      .in('client_id', scope.ids)
      .select('*')
      .single()

    if (error) throw error
    await notifyClientFollowUpDue(scope.ownerId, data)
    const client = await loadClientWithRelations(scope.ownerId)
    return res.json({ data, client, follow_ups: client?.follow_ups || [] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A follow up already exists for this date.' })
    return logAndSendInternal(res, 'updateFollowUp', err)
  }
}

async function deleteFollowUp(req, res) {
  try {
    const scope = await followUpScope(req.params.id)
    const { data, error } = await supabase
      .from('client_follow_ups')
      .delete()
      .eq('id', req.params.followUpId)
      .in('client_id', scope.ids)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Follow-up not found' })

    const { data: remaining, error: remainingError } = await supabase
      .from('client_follow_ups')
      .select('*')
      .in('client_id', scope.ids)
      .order('follow_up_number', { ascending: true })

    if (remainingError) throw remainingError
    const client = await loadClientWithRelations(scope.ownerId)
    return res.json({ data, client, follow_ups: remaining || [] })
  } catch (err) {
    return logAndSendInternal(res, 'deleteFollowUp', err)
  }
}

async function deleteClient(req, res) {
  try {
    await assertRowEditable('clients', req.params.id, await isAdmin(req.user))
    const { data, error } = await supabase.from('clients').delete().eq('id', req.params.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Client not found' })
    return res.json({ message: 'Client deleted successfully' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteClient', err)
  }
}

module.exports = {
  checkClientDuplicate,
  getNextClientDisplayId,
  listClients,
  buildClientFilters,
  getClient,
  createClient,
  updateClient,
  addFollowUp,
  updateFollowUp,
  deleteFollowUp,
  deleteClient
}

