const supabase = require('../services/supabaseAdmin')
const { randomUUID } = require('crypto')

const CLIENT_STATUSES = [
  'Converted',
  'Not Converted',
  'Follow Up Required',
  'Not Hiring',
  'Not Adding Consultants',
  "Didn't Pick Up"
]

const TERMS_TYPES = ['%', 'Fixed Fee Model', 'Slab %', 'Any Other']

function logAndSendInternal(res, method, err) {
  console.error(`${method} error:`, err.message || err)
  return res.status(500).json({ error: 'Internal server error', detail: err.message })
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

  const nameToDisplayId = new Map()
  let next = Math.max(0, ...(data || []).map((client) => displayIdNumber(client.client_display_id, 'CL')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1

  for (const client of data || []) {
    const normalizedName = normalizeDuplicateText(client.client_name || client.name)
    if (!normalizedName) continue
    const existing = nameToDisplayId.get(normalizedName)
    const current = clean(client.client_display_id)
    if (existing && current !== existing) {
      const { error: updateError } = await supabase.from('clients').update({ client_display_id: existing }).eq('id', client.id)
      if (isClientDisplayIdUniqueError(updateError)) return
      if (updateError) throw updateError
      continue
    }
    if (current) {
      nameToDisplayId.set(normalizedName, current)
      continue
    }
    const displayId = `CL${next++}`
    nameToDisplayId.set(normalizedName, displayId)
    const { error: updateError } = await supabase.from('clients').update({ client_display_id: displayId }).eq('id', client.id)
    if (isClientDisplayIdUniqueError(updateError)) return
    if (updateError) throw updateError
  }
}

async function nextClientDisplayId(clientName = '') {
  await ensureClientDisplayIds()
  const normalizedName = normalizeDuplicateText(clientName)
  const { data, error } = await supabase.from('clients').select('client_display_id, client_name, name, created_at').order('created_at', { ascending: true })
  if (error) throw error
  const existing = (data || []).find((client) => normalizeDuplicateText(client.client_name || client.name) === normalizedName)
  if (existing?.client_display_id) return existing.client_display_id
  const next = Math.max(0, ...(data || []).map((client) => displayIdNumber(client.client_display_id, 'CL')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1
  return `CL${next}`
}

function normalizeClient(row, activeJobs = 0, followUps = []) {
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
    status: row.status || 'Not Converted',
    terms_signed: row.terms_signed_type === 'Any Other' ? row.terms_signed_custom : row.terms_signed_type,
    contract_signed: Boolean(row.contract_signed),
    contract_document: row.contract_document || '',
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

  const bucket = 'client-contracts'
  await supabase.storage.createBucket(bucket, { public: true }).catch(() => {})
  const safeName = file.originalname.replace(/[^\w.-]+/g, '-')
  const path = `${new Date().getFullYear()}/${randomUUID()}-${safeName}`
  const { error } = await supabase.storage.from(bucket).upload(path, file.buffer, {
    contentType: 'application/pdf',
    upsert: false
  })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

function clientPayload(body) {
  const status = body.status || 'Not Converted'
  if (!CLIENT_STATUSES.includes(status)) {
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
  const contractSigned = normalizeBoolean(body.contract_signed)

  if (!clientName) {
    const err = new Error('Client Name is required')
    err.statusCode = 400
    throw err
  }
  if (!mobile) {
    const err = new Error('Mobile is required')
    err.statusCode = 400
    throw err
  }

  return {
    client_group_id: body.client_group_id || null,
    consultant_name: nullable(body.consultant_name || body.consultant),
    client_name: clientName,
    name: clientName,
    location: nullable(body.location || body.city),
    city: nullable(body.location || body.city),
    region: nullable(body.region || body.state),
    state: nullable(body.region || body.state),
    contact_person: nullable(body.contact_person || body.contact),
    contact: nullable(body.contact_person || body.contact),
    designation: nullable(body.designation),
    mobile,
    phone: mobile,
    email: nullable(body.email),
    linkedin: nullable(body.linkedin),
    sector: nullable(body.sector),
    connected_on_date: body.connected_on_date || null,
    comments: nullable(body.comments || body.notes),
    notes: nullable(body.comments || body.notes),
    follow_up_date: body.follow_up_date || null,
    status,
    terms_signed_type: status === 'Converted' ? nullable(termsType) : null,
    terms_signed_custom: status === 'Converted' && termsType === 'Any Other' ? nullable(body.terms_signed_custom) : null,
    terms_value: status === 'Converted' ? nullable(body.terms_value) : null,
    contract_signed: contractSigned,
    contract_document: contractSigned ? nullable(body.contract_document) : null,
    gstin: status === 'Converted' ? nullable(body.gstin) : null,
    pan: status === 'Converted' ? nullable(body.pan) : null,
    address_on_invoice: status === 'Converted' ? nullable(body.address_on_invoice) : null
  }
}

async function findClientDuplicate(name, email) {
  const normalizedName = normalizeDuplicateText(name)
  const normalizedEmail = normalizeDuplicateText(email)
  if (!normalizedName) return null

  let query = supabase.from('clients').select('*')
  if (normalizedEmail) query = query.ilike('email', normalizedEmail)
  else query = query.or(`client_name.ilike.${clean(name)},name.ilike.${clean(name)}`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).find((client) => normalizeDuplicateText(client.client_name || client.name) === normalizedName) || null
}

async function linkCandidatesToClient(client) {
  const name = clean(client.client_name || client.name)
  if (!name) return
  const normalized = normalizeDuplicateText(name)

  const { data: associations, error: assocError } = await supabase
    .from('candidate_associations')
    .select('id, client_name')
    .is('client_id', null)
    .ilike('client_name', name)
  if (assocError) throw assocError

  const assocIds = (associations || [])
    .filter((row) => normalizeDuplicateText(row.client_name) === normalized)
    .map((row) => row.id)
  if (assocIds.length) {
    const { error } = await supabase.from('candidate_associations').update({ client_id: client.id }).in('id', assocIds)
    if (error) throw error
  }

  const { data: candidates, error: candidateError } = await supabase
    .from('candidates')
    .select('id, current_company, current_organisation')
    .is('client_id', null)
    .or(`current_company.ilike.${name},current_organisation.ilike.${name}`)
  if (candidateError) throw candidateError

  const candidateIds = (candidates || [])
    .filter((row) => [row.current_company, row.current_organisation].some((value) => normalizeDuplicateText(value) === normalized))
    .map((row) => row.id)
  if (candidateIds.length) {
    const { error } = await supabase.from('candidates').update({ client_id: client.id }).in('id', candidateIds)
    if (error) throw error
  }
}

async function checkClientDuplicate(req, res) {
  try {
    const existing = await findClientDuplicate(req.query.name, req.query.email)
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

    const { data: jobs, error: jobsError } = await supabase.from('jobs').select('client_id, status')
    if (jobsError) throw jobsError

    const activeJobsMap = {}
    ;(jobs || []).forEach((job) => {
      if (job.status === 'Open' || job.status === 'Active') activeJobsMap[job.client_id] = (activeJobsMap[job.client_id] || 0) + 1
    })

    const followUpsMap = await loadFollowUps(sortedData.map((client) => client.id))
    return res.json({
      data: sortedData.map((client) => normalizeClient(client, activeJobsMap[client.id] || 0, followUpsMap[client.id] || []))
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
    const followUpsMap = await loadFollowUps([data.id])
    return res.json(normalizeClient(data, 0, followUpsMap[data.id] || []))
  } catch (err) {
    return logAndSendInternal(res, 'getClient', err)
  }
}

async function createClient(req, res) {
  try {
    if (req.file) req.body.contract_document = await uploadContractPdf(req.file)
    const payload = clientPayload(req.body)
    const duplicateAction = req.body.duplicate_action
    const duplicate = await findClientDuplicate(payload.client_name, payload.email)

    if (duplicate && !payload.client_group_id && !['update_current', 'add_duplicate'].includes(duplicateAction)) {
      return res.status(409).json({ error: 'A client with the same name and email already exists.', duplicate: true, existing: duplicate })
    }

    if (duplicate && duplicateAction === 'update_current') {
      const { data, error } = await supabase
        .from('clients')
        .update({ ...payload, client_group_id: duplicate.client_group_id || duplicate.id, updated_at: new Date().toISOString() })
        .eq('id', duplicate.id)
        .select('*')
        .single()
      if (error) throw error
      await linkCandidatesToClient(data)
      return res.json(normalizeClient(data))
    }

    payload.client_display_id = payload.client_display_id || await nextClientDisplayId(payload.client_name)
    const { data, error } = await supabase.from('clients').insert(payload).select('*').single()
    if (error) throw error

    if (!data.client_group_id) {
      const { data: grouped, error: groupError } = await supabase
        .from('clients')
        .update({ client_group_id: data.id })
        .eq('id', data.id)
        .select('*')
        .single()
      if (groupError) throw groupError
      await linkCandidatesToClient(grouped)
      return res.status(201).json(normalizeClient(grouped))
    }

    await linkCandidatesToClient(data)
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
    if (req.file) req.body.contract_document = await uploadContractPdf(req.file)
    const payload = clientPayload(req.body)
    payload.client_display_id = await nextClientDisplayId(payload.client_name)
    const { data, error } = await supabase
      .from('clients')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()

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
  listClients,
  getClient,
  createClient,
  updateClient,
  addFollowUp,
  deleteClient
}
