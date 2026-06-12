const supabase = require('../services/supabaseAdmin')

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const PRIORITIES = ['P1', 'P2', 'P3', 'Scrap', 'Completed']

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
  return {
    ...row,
    job_display_id: row.job_display_id || '',
    role: row.title || '',
    location: row.city || row.location || '',
    consultants: Array.isArray(row.consultants) ? row.consultants : [],
    consultant: Array.isArray(row.consultants) && row.consultants.length ? row.consultants[0] : '-',
    team_lead: row.team_lead || '-',
    allocation_date: row.allocation_date || (row.created_at ? row.created_at.slice(0, 10) : ''),
    client: clientName,
    client_name: clientName,
    clients: undefined
  }
}

async function ensureJobDisplayIds() {
  const { data, error } = await supabase.from('jobs').select('id, job_display_id, created_at').order('created_at', { ascending: true }).limit(10000)
  if (error) throw error
  const rows = data || []
  const used = new Set(rows.map(row => row.job_display_id).filter(Boolean))
  let next = Math.max(0, ...rows.map(row => jobIdNumber(row.job_display_id))) + 1
  for (const row of rows.filter(item => !clean(item.job_display_id))) {
    while (used.has(`JB${next}`)) next += 1
    const id = `JB${next}`
    used.add(id)
    next += 1
    const { error: updateError } = await supabase.from('jobs').update({ job_display_id: id }).eq('id', row.id)
    if (updateError) throw updateError
  }
}

async function nextJobDisplayId() {
  await ensureJobDisplayIds()
  const { data, error } = await supabase.from('jobs').select('job_display_id')
  if (error) throw error
  const used = new Set((data || []).map(row => row.job_display_id).filter(Boolean))
  let next = 1
  while (used.has(`JB${next}`)) next += 1
  return `JB${next}`
}

function applyLocalFilters(rows, filters) {
  if (!filters || !Array.isArray(filters.conditions)) return rows
  return rows.filter(row => filters.conditions.every(({ field, operator, value }) => {
    const source = {
      job_id: row.job_display_id,
      consultant: (row.consultants || []).join(', '),
      team_lead: row.team_lead || '-',
      client_name: row.client_name,
      role: row.role,
      location: row.location,
      budget: row.budget,
      priority: row.priority,
      vertical: row.vertical,
      allocation_date: row.allocation_date
    }[field]
    const haystack = clean(source).toLowerCase()
    const needle = clean(value).toLowerCase()
    if (operator === 'blank') return !haystack || haystack === '-'
    if (operator === 'after') return row.allocation_date && row.allocation_date > value
    if (operator === 'before') return row.allocation_date && row.allocation_date < value
    if (operator === 'equals') return haystack === needle
    return haystack.includes(needle)
  }))
}

function parseAiFilters(prompt) {
  const text = clean(prompt)
  const lower = text.toLowerCase()
  const conditions = []
  const add = (field, operator, value) => {
    if (value !== undefined && clean(value)) conditions.push({ field, operator, value: clean(value) })
  }

  add('job_id', 'equals', text.match(/\bJB\d+\b/i)?.[0]?.toUpperCase())
  PRIORITIES.forEach(priority => {
    if (new RegExp(`\\b${priority.toLowerCase()}\\b`).test(lower)) add('priority', 'equals', priority)
  })
  BUDGETS.forEach(budget => {
    const key = budget.replace(/\s*lac/i, '').replace('>', '\\>')
    if (lower.includes(budget.toLowerCase()) || lower.includes(key.toLowerCase())) add('budget', 'equals', budget)
  })

  ;[
    ['consultant', /consultant\s+(?:is\s+)?([a-z][\w\s.-]*?)(?=\s+(?:team lead|client|role|location|budget|priority|vertical|date|for|in)\b|$)/i],
    ['team_lead', /team lead\s+(?:is\s+)?(-|[a-z][\w\s.-]*?)(?=\s+(?:consultant|client|role|location|budget|priority|vertical|date|for|in)\b|$)/i],
    ['client_name', /client\s+(?:is\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:consultant|team lead|role|location|budget|priority|vertical|date|for|in)\b|$)/i],
    ['role', /role\s+(?:contains\s+|is\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:consultant|team lead|client|location|budget|priority|vertical|date|for|in)\b|$)/i],
    ['location', /(?:location\s+(?:is\s+)?|in\s+)([a-z][\w\s.-]*?)(?=\s+(?:consultant|team lead|client|role|budget|priority|vertical|date|for)\b|$)/i],
    ['vertical', /vertical\s+(?:contains\s+|is\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:consultant|team lead|client|role|location|budget|priority|date|for|in)\b|$)/i]
  ].forEach(([field, regex]) => {
    const match = text.match(regex)
    if (match) add(field, match[0].toLowerCase().includes('contains') ? 'contains' : 'equals', match[1])
  })

  const dateMatch = text.match(/date\s+(after|before)\s+(.+)$/i)
  if (dateMatch) {
    const date = new Date(dateMatch[2])
    if (!Number.isNaN(date.getTime())) add('allocation_date', dateMatch[1].toLowerCase(), date.toISOString().slice(0, 10))
  }

  if (!conditions.length) return null
  return { conditions }
}

async function listJobs(req, res) {
  try {
    await ensureJobDisplayIds()
    let query = supabase.from('jobs').select('*, clients(name, client_name)')
    if (req.query.client_id) query = query.eq('client_id', req.query.client_id)
    const { data, error } = await query
    if (error) throw error
    let rows = (data || []).map(formatJob)
    rows = applyLocalFilters(rows, req.query.ai_filters ? JSON.parse(req.query.ai_filters) : null)
    const direction = req.query.sortDirection === 'desc' ? -1 : 1
    if (req.query.sortField === 'job_id') rows.sort((a, b) => direction * (jobIdNumber(a.job_display_id) - jobIdNumber(b.job_display_id)))
    else if (req.query.sortField === 'role') rows.sort((a, b) => direction * String(a.role || '').localeCompare(String(b.role || '')))
    else rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return res.json({ data: rows })
  } catch (err) {
    return logAndSendInternal(res, 'listJobs', err)
  }
}

async function getJob(req, res) {
  try {
    const { data, error } = await supabase.from('jobs').select('*, clients(name, client_name)').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    return res.json(formatJob(data))
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
  if (!partial || body.priority !== undefined) payload.priority = PRIORITIES.includes(body.priority) ? body.priority : null
  if (!partial || body.vertical !== undefined) payload.vertical = nullable(body.vertical)
  if (!partial || body.allocation_date !== undefined) payload.allocation_date = body.allocation_date || todayLocal()
  return payload
}

async function createJob(req, res) {
  try {
    const payload = await payloadFromBody(req.body)
    payload.job_display_id = await nextJobDisplayId()
    const { data, error } = await supabase.from('jobs').insert(payload).select('*, clients(name, client_name)').single()
    if (error) throw error
    return res.status(201).json(formatJob(data))
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'createJob', err)
  }
}

async function updateJob(req, res) {
  try {
    const payload = await payloadFromBody(req.body, true)
    payload.updated_at = new Date().toISOString()
    const { data, error } = await supabase.from('jobs').update(payload).eq('id', req.params.id).select('*, clients(name, client_name)').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    return res.json(formatJob(data))
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'updateJob', err)
  }
}

async function deleteJob(req, res) {
  try {
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
    const { data, error } = await supabase.from('profiles').select('email, full_name').order('email')
    if (error) throw error
    const users = [...new Set((data || []).map(row => displayNameFromEmail(row.email || row.full_name)).filter(Boolean))]
    return res.json({ data: users })
  } catch (err) {
    return logAndSendInternal(res, 'listJobUsers', err)
  }
}

async function buildJobFilters(req, res) {
  try {
    const filters = parseAiFilters(req.body.prompt)
    if (!filters) return res.status(400).json({ error: 'Could not parse Mandate Tracker filter.' })
    return res.json({ filters })
  } catch (err) {
    return logAndSendInternal(res, 'buildJobFilters', err)
  }
}

module.exports = { listJobs, getJob, createJob, updateJob, deleteJob, getNextJobDisplayId, listJobUsers, buildJobFilters }
