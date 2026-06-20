const supabase = require('../services/supabaseAdmin')
const { uploadDocument } = require('../services/documentStorage')
const { STORAGE_BUCKETS, documentOpenUrl, normalizeStoragePath } = require('../services/storageBuckets')
const fs = require('fs/promises')
const { validateAiFilters, applyFilters: applySharedFilters } = require('../services/filterEngine')
const { parseAiFilters } = require('../services/aiFilterParser')
const { applyQueryFilters } = require('../services/queryFilters')
const { allocateNextDisplayId, isDisplayIdUniqueError } = require('../services/displayIdAllocator')
const { isAdmin, stripHiddenFields, assertCanUpdateColumns, assertRowEditable } = require('../services/adminAccess')

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const MANDATE_STATUSES = ['Ongoing', 'Scrapped', 'Completed']

function logAndSendInternal(res, method, err) {
  console.error(`${method} error:`, err.message || err)
  return res.status(500).json({ error: 'Internal server error', detail: err.message })
}

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const nullable = (value) => {
  const text = clean(value)
  return text && text !== '-' ? text : null
}
const displayNameFromEmail = (email) => clean(email).split('@')[0] || clean(email) || '-'
const jobIdNumber = (value) => Number(String(value || '').match(/^JB(\d+)$/i)?.[1] || 0)
const preferredUserName = (primaryName, secondaryName, email) => clean(primaryName) || clean(secondaryName) || displayNameFromEmail(email)
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
const compareDisplayIds = (a, b, prefix) => {
  const aText = clean(a)
  const bText = clean(b)
  const pattern = new RegExp(`^${prefix}\\s*(\\d+)$`, 'i')
  const aNumber = Number(aText.match(pattern)?.[1] || 0)
  const bNumber = Number(bText.match(pattern)?.[1] || 0)
  if (aNumber !== bNumber) return aNumber - bNumber
  return aText.localeCompare(bText, undefined, { sensitivity: 'base' })
}
const normalizeMandateStatus = (value) => {
  const text = clean(value)
  if (text === 'Completed') return 'Completed'
  if (text === 'Scrapped' || text === 'Scrap') return 'Scrapped'
  if (text === 'Ongoing') return 'Ongoing'
  return text ? '-' : '-'
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean)
  return String(value || '').split(',').map(clean).filter(Boolean)
}

function userNameMatches(name, user) {
  const target = clean(name).toLowerCase()
  return Boolean(target && [user.name, user.email, displayNameFromEmail(user.email)].map(item => clean(item).toLowerCase()).includes(target))
}

async function resolveAssignmentUsers(names = [], ids = []) {
  const cleanIds = parseList(ids)
  const cleanNames = parseList(names)
  if (!cleanIds.length && !cleanNames.length) return []
  const [{ data: userProfiles }, { data: profiles }] = await Promise.all([
    supabase.from('user_profiles').select('user_id, email, name'),
    supabase.from('profiles').select('id, email, full_name')
  ])
  const profileById = new Map((profiles || []).map(row => [row.id, row]))
  const users = []
  const seen = new Set()
  for (const row of userProfiles || []) {
    const profile = profileById.get(row.user_id)
    const user = {
      id: row.user_id,
      email: row.email || profile?.email || '',
      name: preferredUserName(row.name, profile?.full_name, row.email || profile?.email)
    }
    if (isUuid(user.id) && !seen.has(user.id)) {
      seen.add(user.id)
      users.push(user)
    }
  }
  for (const row of profiles || []) {
    const user = { id: row.id, email: row.email || '', name: preferredUserName('', row.full_name, row.email) }
    if (isUuid(user.id) && !seen.has(user.id)) {
      seen.add(user.id)
      users.push(user)
    }
  }
  const byId = new Map(users.map(user => [user.id, user]))
  const resolved = cleanIds.map(id => byId.get(id)).filter(Boolean)
  for (const name of cleanNames) {
    const user = users.find(item => userNameMatches(name, item))
    if (user && !resolved.some(item => item.id === user.id)) resolved.push(user)
  }
  return resolved
}

async function createAssignmentNotifications({ job, senderId, consultantIds, teamLeadId, previousConsultants = [], previousTeamLead = '' }) {
  if (!job?.id || !isUuid(senderId)) return
  const clientName = job.client_name || job.clients?.client_name || job.clients?.name || 'Client'
  const role = job.role || job.title || 'Mandate'
  const consultantUsers = await resolveAssignmentUsers(job.consultants || [], consultantIds)
  const teamLeadUsers = await resolveAssignmentUsers(job.team_lead && job.team_lead !== '-' ? [job.team_lead] : [], teamLeadId ? [teamLeadId] : [])
  const previousConsultantUsers = await resolveAssignmentUsers(previousConsultants)
  const previousTeamLeadUsers = await resolveAssignmentUsers(previousTeamLead && previousTeamLead !== '-' ? [previousTeamLead] : [])
  const previousConsultantIds = new Set(previousConsultantUsers.map(user => user.id))
  const previousTeamLeadIds = new Set(previousTeamLeadUsers.map(user => user.id))
  const rows = []

  for (const user of consultantUsers) {
    if (!user.id || user.id === senderId || previousConsultantIds.has(user.id)) continue
    rows.push({
      recipient_user_id: user.id,
      sender_user_id: senderId,
      mandate_id: job.id,
      client_id: job.client_id,
      role_type: 'consultant',
      title: 'New Mandate Assignment',
      message: `You are assigned as Consultant for ${role} - ${clientName}`,
      status: 'pending',
      action_type: 'mark_read_assignment'
    })
  }

  for (const user of teamLeadUsers) {
    if (!user.id || user.id === senderId || previousTeamLeadIds.has(user.id)) continue
    rows.push({
      recipient_user_id: user.id,
      sender_user_id: senderId,
      mandate_id: job.id,
      client_id: job.client_id,
      role_type: 'team_lead',
      title: 'New Mandate Assignment',
      message: `You are assigned as Team Lead for ${role} - ${clientName}`,
      status: 'pending',
      action_type: 'mark_read_assignment'
    })
  }

  const safeRows = rows.filter(row => row.recipient_user_id && row.sender_user_id && row.recipient_user_id !== row.sender_user_id)
  if (safeRows.length) {
    for (const row of safeRows) {
      const { error } = await supabase.from('notifications').insert(row)
      if (error && error.code !== '23505' && error.code !== '42P01') throw error
    }
  }
}

function todayLocal() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

function normalizeConsultants(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(values.map(clean).filter(item => item && item !== '-'))]
}

function formatJob(row) {
  const clientName = row.clients?.client_name || row.clients?.name || 'Unknown Client'
  const mandateStatus = normalizeMandateStatus(row.mandate_status || row.status || row.priority)
  return {
    ...row,
    id: row.id,
    mandate_id: row.id,
    client_id: row.client_id,
    client_primary_id: row.client_id,
    job_display_id: row.job_display_id || '',
    role: row.title || '',
    location: row.city || row.location || '',
    consultants: Array.isArray(row.consultants) ? row.consultants : [],
    consultant: Array.isArray(row.consultants) && row.consultants.length ? row.consultants[0] : '-',
    team_lead: row.team_lead || '-',
    allocation_date: row.allocation_date || (row.created_at ? row.created_at.slice(0, 10) : ''),
    jd_url: documentOpenUrl('jd', row.jd_storage_path || row.jd_url),
    jd_storage_path: normalizeStoragePath(row.jd_storage_path || row.jd_url, STORAGE_BUCKETS.JD),
    client_display_id: row.clients?.client_display_id || '',
    client: clientName,
    client_name: clientName,
    mandate_status: mandateStatus,
    status: mandateStatus,
    priority: mandateStatus,
    clients: undefined
  }
}

async function nextJobDisplayId() {
  return allocateNextDisplayId({ supabase, table: 'jobs', column: 'job_display_id', prefix: 'JB' })
}

function jobFilterValue(row, field) {
  return {
    job_id: row.job_display_id,
    consultant: row.consultants,
    team_lead: row.team_lead,
    client_id: row.client_display_id,
    client_name: row.client_name,
    role: row.role,
    location: row.location,
    budget: row.budget,
    experience: row.experience,
    mandate_status: row.mandate_status,
    vertical: row.vertical,
    comments: row.comments || row.notes,
    date_of_allocation: row.allocation_date,
    jd: row.jd_storage_path || row.jd_url
  }[field]
}

const JOB_FILTER_MAPPING = {
  job_id: [{ column: 'job_display_id', kind: 'text' }],
  consultant: [{ column: 'consultants', kind: 'array' }],
  team_lead: [{ column: 'team_lead', kind: 'text' }],
  client_id: [{ column: 'clients.client_display_id', kind: 'text' }],
  role: [{ column: 'title', kind: 'text' }],
  location: [{ column: 'city', kind: 'text' }],
  budget: [{ column: 'budget', kind: 'text' }],
  experience: [{ column: 'experience', kind: 'number' }],
  mandate_status: [{ column: 'mandate_status', kind: 'text' }],
  vertical: [{ column: 'vertical', kind: 'text' }],
  comments: [{ column: 'comments', kind: 'text' }, { column: 'notes', kind: 'text' }],
  date_of_allocation: [{ column: 'allocation_date', kind: 'date' }],
  jd: [{ column: 'jd_storage_path', kind: 'text' }, { column: 'jd_url', kind: 'text' }]
}

function parseJsonFilter(value) {
  if (!value) return null
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return null
  }
}

async function listJobs(req, res) {
  try {
    const aiFilters = parseJsonFilter(req.query.ai_filters)
    const localAiFilter = aiFilters?.mode === 'keyword' || (aiFilters?.rankingHints || []).length || (aiFilters?.conditions || []).some(condition => ['consultant', 'budget'].includes(condition.field))
    const paginate = String(req.query.all || '').toLowerCase() !== 'true' && !localAiFilter
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const sortField = clean(req.query.sortField)
    const sortDirection = clean(req.query.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc'
    let query = supabase.from('jobs').select('*, clients(name, client_name, client_display_id)', { count: paginate ? 'exact' : undefined })
    if (req.query.client_id) query = query.eq('client_id', req.query.client_id)
    const clientNameConditions = (aiFilters?.conditions || []).filter((condition) => ['client_name', 'client'].includes(String(condition.field || '').toLowerCase()))
    let matchedClientIds = null
    if (clientNameConditions.length) {
      const clientQuery = supabase.from('clients').select('id')
      for (const condition of clientNameConditions) {
        const value = clean(condition.value)
        if (!value) continue
        if (condition.operator === 'equals') clientQuery.or(`client_name.ilike.${value},name.ilike.${value}`)
        else clientQuery.or(`client_name.ilike.%${value}%,name.ilike.%${value}%`)
      }
      const { data: clientRows, error: clientError } = await clientQuery
      if (clientError) throw clientError
      matchedClientIds = [...new Set((clientRows || []).map((row) => row.id))]
      if (!matchedClientIds.length && aiFilters?.mode !== 'any') {
return res.json({ data: [], total: 0, page, totalPages: 1, limit })
      }
    }
    const filtered = localAiFilter ? { query } : applyQueryFilters(query, 'mandates', aiFilters, JOB_FILTER_MAPPING, {
      applyCondition(nextQuery, condition) {
        if (condition.field !== 'client_name') return nextQuery
        if (!matchedClientIds?.length) return nextQuery.eq('client_id', '__no_match__')
        return nextQuery.in('client_id', matchedClientIds)
      },
      orClauses(normalized) {
        if (!matchedClientIds?.length) return []
        return normalized.some((condition) => condition.field === 'client_name') ? [`client_id.in.(${matchedClientIds.join(',')})`] : []
      }
    })
    query = filtered.query
    if (sortField === 'job_id') query = query.order('created_at', { ascending: sortDirection !== 'desc' })
    else if (req.query.sortField === 'role') query = query.order('title', { ascending: req.query.sortDirection !== 'desc' })
    else query = query.order('created_at', { ascending: false })
    if (paginate) query = query.range(from, to)
    const { data, error, count } = await query
    if (error) throw error
    let rows = (data || []).map(formatJob)
    if (!paginate) rows = applySharedFilters('mandates', rows, aiFilters, jobFilterValue)
    const filteredTotal = rows.length
    if (localAiFilter) rows = rows.slice(from, to + 1)
    const total = paginate ? count || 0 : filteredTotal
    const totalPages = Math.max(1, Math.ceil(total / limit))
return res.json({ data: await stripHiddenFields('jobs', rows, await isAdmin(req.user)), total, page, totalPages, limit })
  } catch (err) {
    return logAndSendInternal(res, 'listJobs', err)
  }
}

async function getJob(req, res) {
  try {
    const { data, error } = await supabase.from('jobs').select('*, clients(name, client_name, client_display_id)').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    return res.json(await stripHiddenFields('jobs', formatJob(data), await isAdmin(req.user)))
  } catch (err) {
    return logAndSendInternal(res, 'getJob', err)
  }
}

async function payloadFromBody(body, partial = false) {
  const role = clean(body.role || body.title)
  const clientId = clean(body.client_id)
  if (!partial && !role) throw Object.assign(new Error('Role is required'), { statusCode: 400 })
  if (!partial && !clientId) throw Object.assign(new Error('Client Name is required'), { statusCode: 400 })
  const payload = {}
  if (!partial || body.title !== undefined || body.role !== undefined) payload.title = role
  if (!partial || body.client_id !== undefined) payload.client_id = clientId
  if (!partial || body.location !== undefined || body.city !== undefined) payload.city = nullable(body.location || body.city)
  if (!partial || body.consultants !== undefined) payload.consultants = normalizeConsultants(body.consultants)
  if (!partial || body.team_lead !== undefined) payload.team_lead = nullable(body.team_lead)
  if (!partial || body.budget !== undefined) payload.budget = BUDGETS.includes(body.budget) ? body.budget : null
  if (!partial || body.mandate_status !== undefined || body.priority !== undefined || body.status !== undefined) {
    const status = normalizeMandateStatus(body.mandate_status || body.priority || body.status)
    payload.mandate_status = MANDATE_STATUSES.includes(status) ? status : '-'
    payload.status = payload.mandate_status
  }
  if (!partial || body.vertical !== undefined) payload.vertical = nullable(body.vertical)
  if (!partial || body.allocation_date !== undefined) payload.allocation_date = body.allocation_date || todayLocal()
  if (!partial || body.jd_url !== undefined) payload.jd_url = nullable(normalizeStoragePath(body.jd_storage_path || body.jd_url, STORAGE_BUCKETS.JD))
  if (!partial || body.jd_storage_path !== undefined) payload.jd_storage_path = nullable(normalizeStoragePath(body.jd_storage_path || body.jd_url, STORAGE_BUCKETS.JD))
  return payload
}

function missingJobColumn(error) {
  if (error?.code !== 'PGRST204' && error?.code !== '42703') return null
  const match = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"/)
  return match?.[1] || match?.[2] || null
}

async function insertJob(payload) {
  let next = payload
  let result = null
  for (let i = 0; i < 4; i += 1) {
    result = await supabase.from('jobs').insert(next).select('*, clients(name, client_name, client_display_id)').single()
    const col = missingJobColumn(result.error)
    if (!col) break
    next = { ...next }
    delete next[col]
  }
  return result
}

async function updateJobRow(id, payload) {
  let next = payload
  let result = null
  for (let i = 0; i < 4; i += 1) {
    result = await supabase.from('jobs').update(next).eq('id', id).select('*, clients(name, client_name, client_display_id)').maybeSingle()
    const col = missingJobColumn(result.error)
    if (!col) break
    next = { ...next }
    delete next[col]
  }
  return result
}

async function createJob(req, res) {
  try {
    const payload = await payloadFromBody(req.body)
    if (req.file) {
      const jd = await uploadDocument(req.file, STORAGE_BUCKETS.JD, String(new Date().getFullYear()))
      payload.jd_url = jd.path
      payload.jd_storage_path = jd.path
    }
    if (!payload.mandate_status) payload.mandate_status = '-'
    if (!payload.status) payload.status = payload.mandate_status
    let data = null
    let error = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const insertPayload = { ...payload, job_display_id: await nextJobDisplayId() }
      const result = await insertJob(insertPayload)
      data = result.data
      error = result.error
      if (!error) break
      if (!isDisplayIdUniqueError(error, 'job_display_id')) break
    }
    if (error) throw error
    const job = formatJob(data)
    await createAssignmentNotifications({
      job,
      senderId: req.user?.id,
      consultantIds: req.body.consultant_user_ids,
      teamLeadId: req.body.team_lead_user_id
    })
    return res.status(201).json(job)
  } catch (err) {
    if (isDisplayIdUniqueError(err, 'job_display_id')) {
      return res.status(400).json({ error: 'Could not allocate unique Job ID. Please try again.' })
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'createJob', err)
  } finally {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('createJob cleanup:', cleanupError.message) }
    }
  }
}

async function updateJob(req, res) {
  try {
    const admin = await isAdmin(req.user)
    await assertRowEditable('jobs', req.params.id, admin)
    await assertCanUpdateColumns('jobs', req.body, admin)
    const payload = await payloadFromBody(req.body, true)
    if (req.file) {
      const jd = await uploadDocument(req.file, STORAGE_BUCKETS.JD, String(new Date().getFullYear()))
      payload.jd_url = jd.path
      payload.jd_storage_path = jd.path
    }
    payload.updated_at = new Date().toISOString()
    const { data: previousJob } = await supabase.from('jobs').select('consultants, team_lead').eq('id', req.params.id).maybeSingle()
    const { data, error } = await updateJobRow(req.params.id, payload)
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    const job = formatJob(data)
    await createAssignmentNotifications({
      job,
      senderId: req.user?.id,
      consultantIds: req.body.consultant_user_ids,
      teamLeadId: req.body.team_lead_user_id,
      previousConsultants: previousJob?.consultants || [],
      previousTeamLead: previousJob?.team_lead || ''
    })
    return res.json(await stripHiddenFields('jobs', job, admin))
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'updateJob', err)
  } finally {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('updateJob cleanup:', cleanupError.message) }
    }
  }
}

async function deleteJob(req, res) {
  try {
    await assertRowEditable('jobs', req.params.id, await isAdmin(req.user))
    const { data, error } = await supabase.from('jobs').delete().eq('id', req.params.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    return res.json({ message: 'Mandate deleted successfully' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteJob', err)
  }
}

async function getNextJobDisplayId(req, res) {
  try {
    return res.json({ job_display_id: await nextJobDisplayId() })
  } catch (err) {
    return logAndSendInternal(res, 'getNextJobDisplayId', err)
  }
}

async function listJobUsers(req, res) {
  try {
    const { data: userProfiles, error } = await supabase
      .from('user_profiles')
      .select('user_id, email, name')
      .order('name')
    if (error) throw error
    const seen = new Set()
    const users = []

    for (const row of userProfiles || []) {
      const name = clean(row.name)
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      users.push({ id: row.user_id, name, email: row.email || '' })
    }

    return res.json({ data: users })
  } catch (err) {
    return logAndSendInternal(res, 'listJobUsers', err)
  }
}

async function buildJobFilters(req, res) {
  try {
    const prompt = clean(req.body.prompt)
    if (!prompt) return res.status(400).json({ error: 'prompt is required' })
    return res.json(await parseAiFilters('mandates', prompt))
  } catch (err) {
    const fallback = validateAiFilters('mandates', null, req.body.prompt)
    if (fallback) return res.json({ filters: fallback, fallback: true })
    return logAndSendInternal(res, 'buildJobFilters', err)
  }
}

module.exports = { listJobs, getJob, createJob, updateJob, deleteJob, getNextJobDisplayId, listJobUsers, buildJobFilters }

