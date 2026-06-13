const { randomUUID } = require('crypto')
const supabase = require('../services/supabaseAdmin')
const { uploadDocument } = require('../services/documentStorage')

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

function normalizeBoolean(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '').toLowerCase() === 'yes'
}

function normalizeDuplicateText(value) {
  return clean(value).toLowerCase()
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
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
  return err?.code === '23505' && /client_display_id|clients_client_display_id/i.test(err.message || '')
}

function sortClientRows(rows, sort) {
  if (!sort.field) return rows.sort((a, b) => displayIdNumber(a.client_display_id, 'CL') - displayIdNumber(b.client_display_id, 'CL'))
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (sort.field === 'client_id') {
      return (displayIdNumber(a.client_display_id, 'CL') - displayIdNumber(b.client_display_id, 'CL')) * direction
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
  await ensureClientDisplayIds()
  const { data, error } = await supabase.from('clients').select('client_display_id, client_name, name, created_at').order('created_at', { ascending: true })
  if (error) throw error
  const parsedIds = (data || [])
    .map(row => displayIdNumber(row.client_display_id, 'CL'))
    .filter(number => number < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a - b)
  const nextId = nextFreeDisplayId(data, 'CL', true)
  console.log('nextClientDisplayId parsed CL IDs:', parsedIds)
  console.log('nextClientDisplayId selected:', nextId)
  return nextId
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
    contract_document: row.contract_document || row.contract_pdf_url || '',
    contract_pdf_url: row.contract_pdf_url || row.contract_document || '',
    contract_pdf_storage_path: row.contract_pdf_storage_path || '',
    activeJobs,
    follow_ups: followUps
  }
}

async function uploadContractPdf(file) {
  if (!file) return null
  if (file.mimetype !== 'application/pdf') {
    const err = new Error('Contract document must be a PDF')
    err.statusCode = 400
    throw err
  }
  return uploadDocument(file, 'client-contracts', String(new Date().getFullYear()))
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

  return {
    client_group_id: body.client_group_id || null,
    client_display_id: nullable(body.client_display_id),
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
    follow_up_date: body.follow_up_date || null,
    status: status || '',
    terms_signed_type: contractSigned ? nullable(termsType) : null,
    terms_signed_custom: contractSigned && termsType === 'Any Other' ? nullable(body.terms_signed_custom) : null,
    terms_value: contractSigned ? nullable(body.terms_value) : null,
    billing_entity: contractSigned ? nullable(body.billing_entity) : null,
    contract_signed: contractSigned,
    contract_document: contractSigned ? nullable(body.contract_document) : null,
    contract_pdf_url: contractSigned ? nullable(body.contract_pdf_url || body.contract_document) : null,
    contract_pdf_storage_path: contractSigned ? nullable(body.contract_pdf_storage_path) : null,
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

function missingClientColumn(error) {
  if (error?.code !== 'PGRST204' && error?.code !== '42703') return null
  const match = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"/)
  return match?.[1] || match?.[2] || null
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

async function listClients(req, res) {
  try {
    await ensureClientDisplayIds()
    const sort = normalizeSort(req.query)

    let query = supabase.from('clients').select('*')
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
    const { data, error } = await query
    if (error) throw error
    const sortedData = sortClientRows(data || [], sort)

    const { data: jobs, error: jobsError } = await supabase.from('jobs').select('client_id, status, mandate_status')
    if (jobsError) throw jobsError

    const activeJobsMap = {}
    const jobsByClient = {}
    ;(jobs || []).forEach((job) => {
      if (job.status === 'Open' || job.status === 'Active') activeJobsMap[job.client_id] = (activeJobsMap[job.client_id] || 0) + 1
      jobsByClient[job.client_id] = jobsByClient[job.client_id] || []
      jobsByClient[job.client_id].push(job)
    })

    const followUpsMap = await loadFollowUps(sortedData.map((client) => client.id))
    return res.json({
      data: sortedData.map((client) => normalizeClient(client, activeJobsMap[client.id] || 0, followUpsMap[client.id] || [], jobsByClient[client.id] || []))
    })
  } catch (err) {
    return logAndSendInternal(res, 'listClients', err)
  }
}

async function getClient(req, res) {
  try {
    const { data, error } = await supabase.from('clients').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Client not found' })
    const { data: jobs, error: jobsError } = await supabase.from('jobs').select('status, mandate_status').eq('client_id', req.params.id)
    if (jobsError) throw jobsError
    const followUpsMap = await loadFollowUps([data.id])
    return res.json(normalizeClient(data, 0, followUpsMap[data.id] || [], jobs || []))
  } catch (err) {
    return logAndSendInternal(res, 'getClient', err)
  }
}

async function createClient(req, res) {
  try {
    console.log('createClient payload:', req.body)
    if (req.file) {
      const contract = await uploadContractPdf(req.file)
      req.body.contract_document = contract.url
      req.body.contract_pdf_url = contract.url
      req.body.contract_pdf_storage_path = contract.path
    }
    const payload = clientPayload(req.body)
    const duplicateAction = req.body.duplicate_action
    const duplicate = await findClientDuplicate(payload.client_name)

    if (duplicate && !payload.client_group_id && duplicateAction !== 'update_current') {
      return res.status(409).json({ error: 'A client with the same name already exists.', duplicate: true, existing: duplicate })
    }

    if (duplicate && duplicateAction === 'update_current') {
      const { data, error } = await updateClientRow(duplicate.id, { ...payload, client_group_id: duplicate.client_group_id || duplicate.id, updated_at: new Date().toISOString() })
      if (error) throw error
      return res.json(normalizeClient(data))
    }

    if (!payload.client_display_id) {
      payload.client_display_id = await nextClientDisplayId(payload.client_name)
    } else if (!payload.client_group_id && !(await isClientDisplayIdAvailable(payload.client_display_id))) {
      releaseClientDisplayId(payload.client_display_id)
      return res.status(409).json({ error: `Client ID ${payload.client_display_id} is already taken. Please click Add New Client again.` })
    }
    console.log('createClient final client_display_id before insert:', payload.client_display_id)
    if (!payload.client_group_id) {
      payload.id = randomUUID()
      payload.client_group_id = payload.id
    }
    const { data, error } = await insertClient(payload)
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
        return res.status(201).json(normalizeClient(data))
      }
      if (groupError) throw groupError
      releaseClientDisplayId(payload.client_display_id)
      return res.status(201).json(normalizeClient(grouped))
    }

    releaseClientDisplayId(payload.client_display_id)
    return res.status(201).json(normalizeClient(data))
  } catch (err) {
    if (err.code === '23505' && /clients_name_key/i.test(err.message || '')) {
      return res.status(400).json({ error: 'Client name is still unique in Supabase. Run server/supabase-clients-module-upgrade.sql once.' })
    }
    if (isClientDisplayIdUniqueError(err)) {
      return res.status(400).json({ error: 'Client ID is still unique in Supabase. Run server/supabase-client-shared-display-ids.sql once.' })
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'createClient', err)
  }
}

async function updateClient(req, res) {
  try {
    if (req.file) {
      const contract = await uploadContractPdf(req.file)
      req.body.contract_document = contract.url
      req.body.contract_pdf_url = contract.url
      req.body.contract_pdf_storage_path = contract.path
    }
    const payload = clientPayload(req.body)
    if (!payload.client_display_id) {
      const { data: existing, error: existingError } = await supabase.from('clients').select('client_display_id').eq('id', req.params.id).maybeSingle()
      if (existingError) throw existingError
      payload.client_display_id = existing?.client_display_id || await nextClientDisplayId(payload.client_name)
    }
    const { data, error } = await updateClientRow(req.params.id, { ...payload, updated_at: new Date().toISOString() })

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Client not found' })
    return res.json(normalizeClient(data))
  } catch (err) {
    if (isClientDisplayIdUniqueError(err)) {
      return res.status(400).json({ error: 'Client ID is still unique in Supabase. Run server/supabase-client-shared-display-ids.sql once.' })
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'updateClient', err)
  }
}

async function addFollowUp(req, res) {
  try {
    const { follow_up_date, follow_up_comments } = req.body
    if (!follow_up_date) return res.status(400).json({ error: 'Follow Up Date is required' })

    const { data: existing, error: existingError } = await supabase
      .from('client_follow_ups')
      .select('follow_up_number')
      .eq('client_id', req.params.id)
      .order('follow_up_number', { ascending: false })
      .limit(1)

    if (existingError) throw existingError
    const followUpNumber = ((existing || [])[0]?.follow_up_number || 0) + 1

    const { data, error } = await supabase
      .from('client_follow_ups')
      .insert({
        client_id: req.params.id,
        follow_up_number: followUpNumber,
        follow_up_date,
        follow_up_comments: nullable(follow_up_comments)
      })
      .select('*')
      .single()

    if (error) throw error

    await supabase
      .from('clients')
      .update({ follow_up_date, comments: nullable(follow_up_comments), notes: nullable(follow_up_comments), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)

    return res.status(201).json(data)
  } catch (err) {
    return logAndSendInternal(res, 'addFollowUp', err)
  }
}

async function deleteClient(req, res) {
  try {
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
  getClient,
  createClient,
  updateClient,
  addFollowUp,
  deleteClient
}
