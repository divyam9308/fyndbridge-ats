const supabase = require('../services/supabaseAdmin')
const { applyDashboardPeriod } = require('../utils/dashboardPeriod')
const { removeDocuments, uploadDocuments } = require('../services/documentStorage')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('../services/storageBuckets')
const { normalizeAttachments, normalizeExternalAttachments, removalPlan } = require('../services/documentAttachments')
const fs = require('fs/promises')
const { mandateAiFilter, MANDATE_FILTER_PERMISSION_KEYS } = require('../services/mandateAiFilter')
const { parseMandateIntent, validateMandateIntent, mandateExecutionFilter } = require('../services/mandateIntent')
const { resolveEntityFilterReferences } = require('../services/entityFilterReferences')
const { allocateNextDisplayId, isDisplayIdUniqueError } = require('../services/displayIdAllocator')
const { isAdmin, getColumnPermissions, stripHiddenFields, assertCanUpdateColumns, assertRowEditable } = require('../services/adminAccess')
const { assertActiveAssignments } = require('../services/employeeStatus')
const { resolveClientGroupScope } = require('../services/clientGroups')

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
const preferredUserName = (primaryName, secondaryName, email) => clean(primaryName) || clean(secondaryName) || displayNameFromEmail(email)
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
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

function stripMandateAiColumns(row) {
  return Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('ai_')))
}

function formatJob(row) {
  const cleanRow = stripMandateAiColumns(row)
  const clientName = row.ai_client_name || row.ai_client_legacy_name || row.clients?.client_name || row.clients?.name || 'Unknown Client'
  const mandateStatus = normalizeMandateStatus(row.mandate_status || row.status || row.priority)
  const jdAttachments = normalizeAttachments(row.jd_attachments, {
    bucket: STORAGE_BUCKETS.JD,
    legacy: { path: row.jd_storage_path || row.jd_url, uploadedAt: row.updated_at || row.created_at }
  })
  const primaryJd = jdAttachments[0]
  return {
    ...cleanRow,
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
    jd_attachments: jdAttachments,
    jd_url: primaryJd?.path || '',
    jd_storage_path: primaryJd?.path || '',
    client_display_id: row.ai_client_display_id || row.clients?.client_display_id || '',
    client: clientName,
    client_name: clientName,
    mandate_status: mandateStatus,
    status: mandateStatus,
    priority: mandateStatus,
    duplicate_confirmed: undefined,
    clients: undefined
  }
}

function requestFiles(req, ...fieldNames) {
  if (req.file) return [req.file]
  if (Array.isArray(req.files)) return req.files
  return fieldNames.flatMap(name => Array.isArray(req.files?.[name]) ? req.files[name] : [])
}

async function cleanupTempFiles(files) {
  await Promise.all((files || []).map(async (file) => {
    if (!file?.path) return
    try { await fs.unlink(file.path) } catch (error) { if (error.code !== 'ENOENT') console.error('job upload cleanup:', error.message) }
  }))
}

async function hydrateJobAttachmentRows(rows) {
  const missingIds = (rows || [])
    .filter(row => row?.id && !Object.prototype.hasOwnProperty.call(row, 'jd_attachments'))
    .map(row => row.id)
  if (!missingIds.length) return rows || []
  const { data, error } = await supabase.from('jobs').select('id, jd_attachments').in('id', missingIds)
  if (error) throw error
  const byId = new Map((data || []).map(row => [row.id, row.jd_attachments]))
  return (rows || []).map(row => byId.has(row.id) ? { ...row, jd_attachments: byId.get(row.id) } : row)
}

async function nextJobDisplayId() {
  return allocateNextDisplayId({ supabase, table: 'jobs', column: 'job_display_id', prefix: 'JB' })
}

async function findDuplicateMandate(clientId, title) {
  const normalizedTitle = clean(title).toLowerCase()
  if (!clientId || !normalizedTitle) return null
  const scope = await resolveClientGroupScope(supabase, clientId)
  if (!scope.ownerId) return null
  const { data, error } = await supabase
    .from('jobs')
    .select('*, clients(name, client_name, client_display_id)')
    .eq('client_id', scope.ownerId)
  if (error) throw error
  return (data || []).find(job => clean(job.title).toLowerCase() === normalizedTitle) || null
}

function isMandateTitleUniqueError(error) {
  if (error?.code !== '23505') return false
  const detail = `${error.constraint || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase()
  return detail.includes('jobs_client_normalized_title_primary_unique') || detail.includes('jobs_client_normalized_title_unique')
}

async function sendDuplicateMandateResponse(req, res, duplicate) {
  const existing = duplicate
    ? await stripHiddenFields('jobs', formatJob(duplicate), await isAdmin(req.user))
    : null
  return res.status(409).json({
    duplicate: true,
    allowAddDuplicate: true,
    error: 'A mandate with the same role already exists for this client.',
    existing
  })
}

async function assertClientExists(clientId) {
  const id = clean(clientId)
  if (!id) throw Object.assign(new Error('Please select a valid client from the dropdown.'), { statusCode: 400 })
  const scope = await resolveClientGroupScope(supabase, id)
  if (!scope.ownerId) throw Object.assign(new Error('Please select a valid client from the dropdown.'), { statusCode: 400 })
  return scope.ownerId
}

async function assertNoDuplicateMandate(clientId, title, excludeJobId = '') {
  const duplicate = await findDuplicateMandate(clientId, title)
  if (duplicate && duplicate.id !== excludeJobId) {
    throw Object.assign(new Error('Duplicate mandate already exists for this client and role.'), { statusCode: 409, duplicate })
  }
}

async function assertAssignmentUsersExist(payload, existing = {}) {
  const consultantNames = parseList(payload.consultants).filter(name => name !== '-')
  const teamLeadNames = payload.team_lead && payload.team_lead !== '-' ? [payload.team_lead] : []
  const names = [...consultantNames, ...teamLeadNames]
  if (!names.length) return
  const requestedIds = [...parseList(payload.consultant_user_ids), ...parseList(payload.team_lead_user_id)]
  const resolved = await resolveAssignmentUsers(names, requestedIds)
  const resolvedNames = new Set(resolved.map(user => clean(user.name).toLowerCase()))
  const unresolved = names.find(name => !resolvedNames.has(clean(name).toLowerCase()))
  if (unresolved) {
    throw Object.assign(new Error('Typed text is not a selected record. Please choose an option from the list.'), { statusCode: 400 })
  }
  await assertActiveAssignments({
    userIds: requestedIds,
    names,
    existingNames: [...parseList(existing.consultants), existing.team_lead].filter(Boolean)
  })
}

function parseJsonFilter(value) {
  if (!value) return null
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    throw Object.assign(new Error('Invalid Mandates AI filter.'), { statusCode: 400 })
  }
}

async function allowedMandateFilterFields(user) {
  const publicFields = Object.keys(mandateAiFilter.registry).filter(name => !mandateAiFilter.registry[name].internal)
  if (await isAdmin(user)) return publicFields
  const permissions = await getColumnPermissions('jobs')
  return publicFields.filter(name => {
    const permissionKey = MANDATE_FILTER_PERMISSION_KEYS[name]
    return !permissionKey || permissions[permissionKey] !== 'admin_hidden'
  })
}

function validatePersistedMandateFilters(raw, allowedFields) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('Invalid Mandates AI filter.'), { statusCode: 400 })
  }
  return validateMandateIntent(raw, { allowedFields, requireAiConfidence: false })
}

const MANDATE_AI_SORT_COLUMNS = {
  date_of_allocation: 'allocation_date',
  job_id: 'ai_job_display_number',
  role: 'title',
  budget: 'ai_budget_ceiling_lpa',
  experience: 'ai_experience_min_years'
}

async function listJobs(req, res) {
  try {
    if (String(req.query.options || '').toLowerCase() === 'true') {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_display_id, title, client_id')
        .order('title', { ascending: true })
      if (error) throw error
      return res.json({ data: await stripHiddenFields('jobs', data || [], await isAdmin(req.user)) })
    }

    const rawAiFilters = parseJsonFilter(req.query.ai_filters)
    const allowedFields = rawAiFilters ? await allowedMandateFilterFields(req.user) : null
    const validatedAiFilters = rawAiFilters ? validatePersistedMandateFilters(rawAiFilters, allowedFields) : null
    const executableAiFilters = validatedAiFilters
      ? mandateExecutionFilter(validatedAiFilters, { allowedFields })
      : null
    const aiFilters = executableAiFilters
      ? await resolveEntityFilterReferences('mandates', executableAiFilters)
      : null
    const aiActive = Boolean(aiFilters)
    const localConsultantFilter = clean(req.query.consultant)
    const sortField = clean(req.query.sortField)
    const sortDirection = clean(req.query.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc'
    const numericJobIdSort = sortField === 'job_id'
    const useFilterView = aiActive || Boolean(localConsultantFilter) || numericJobIdSort
    // Semantic filters and numeric display-ID ordering always remain bounded.
    const paginate = useFilterView || String(req.query.all || '').toLowerCase() !== 'true'
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    let query = useFilterView
      ? supabase.from('mandate_ai_filter_rows').select('*', { count: paginate ? 'exact' : undefined })
      : supabase.from('jobs').select('*, clients(name, client_name, client_display_id)', { count: paginate ? 'exact' : undefined })
    if (req.query.client_id) {
      const scope = await resolveClientGroupScope(supabase, req.query.client_id)
      query = query.eq('client_id', scope.ownerId || '__no_match__')
    }
    if (req.query.status) query = query.ilike('mandate_status', clean(req.query.status))
    if (req.query.teamLead) query = query.ilike('team_lead', clean(req.query.teamLead))
    if (req.query.role) query = query.ilike('title', clean(req.query.role))
    query = applyDashboardPeriod(query, 'allocation_date', clean(req.query.period), { dateOnly: true })
    if (req.query.clientName) {
      const name = clean(req.query.clientName)
      if (useFilterView) {
        const clientRoot = mandateAiFilter.validateFilter({
          root: { type: 'condition', field: 'client_name', operator: 'contains', value: name }
        }, { allowedFields: ['client_name'] }).root
        query = query.or(mandateAiFilter.compileAst(clientRoot))
      } else {
        const { data: matchingClients, error: matchingClientError } = await supabase
          .from('clients')
          .select('id')
          .or(`client_name.ilike.%${name}%,name.ilike.%${name}%`)
        if (matchingClientError) throw matchingClientError
        const ids = (matchingClients || []).map(client => client.id)
        query = ids.length ? query.in('client_id', ids) : query.eq('client_id', '__no_match__')
      }
    }

    if (localConsultantFilter) {
      const normalizedName = localConsultantFilter.toLowerCase()
      const assignmentRoot = mandateAiFilter.validateFilter({
        root: {
          type: 'group', combinator: 'OR', children: [
            { type: 'condition', field: 'consultant', operator: 'contains', value: normalizedName },
            { type: 'condition', field: 'team_lead', operator: 'equals', value: normalizedName }
          ]
        }
      }, { allowedFields: ['consultant', 'team_lead'] }).root
      query = query.or(mandateAiFilter.compileAst(assignmentRoot))
    }
    if (aiFilters?.root) query = query.or(mandateAiFilter.compileAst(aiFilters.root))

    const aiSort = validatedAiFilters?.sort?.[0]
    if (numericJobIdSort) query = query.order('ai_job_display_number', { ascending: sortDirection !== 'desc', nullsFirst: false })
    else if (req.query.sortField === 'role') query = query.order('title', { ascending: req.query.sortDirection !== 'desc' })
    else if (aiSort && MANDATE_AI_SORT_COLUMNS[aiSort.field]) query = query.order(MANDATE_AI_SORT_COLUMNS[aiSort.field], { ascending: aiSort.direction !== 'desc', nullsFirst: false })
    else query = query.order('created_at', { ascending: false })
    query = query.order('id', { ascending: true })
    if (paginate) query = query.range(from, to)
    const { data, error, count } = await query
    if (error) throw error
    const rows = (await hydrateJobAttachmentRows(data || [])).map(formatJob)
    const total = paginate ? count || 0 : rows.length
    const totalPages = Math.max(1, Math.ceil(total / limit))
    return res.json({ data: await stripHiddenFields('jobs', rows, await isAdmin(req.user)), total, page, totalPages, limit })
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
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
  const files = requestFiles(req, 'jd_file', 'jd_files')
  let uploadedAttachments = []
  try {
    const payload = await payloadFromBody(req.body)
    payload.client_id = await assertClientExists(payload.client_id)
    const duplicateAction = clean(req.body.duplicate_action)
    const duplicate = await findDuplicateMandate(payload.client_id, payload.title)
    if (duplicate && duplicateAction !== 'add_duplicate') {
      return await sendDuplicateMandateResponse(req, res, duplicate)
    }
    payload.duplicate_confirmed = Boolean(duplicate && duplicateAction === 'add_duplicate')
    await assertAssignmentUsersExist({ ...payload, consultant_user_ids: req.body.consultant_user_ids, team_lead_user_id: req.body.team_lead_user_id })
    const linkedAttachments = normalizeExternalAttachments(req.body.jd_links, { fieldName: 'jd_links' })
    uploadedAttachments = await uploadDocuments(files, STORAGE_BUCKETS.JD, String(new Date().getFullYear()))
    payload.jd_attachments = normalizeAttachments([...uploadedAttachments, ...linkedAttachments], { bucket: STORAGE_BUCKETS.JD })
    payload.jd_url = payload.jd_attachments[0]?.path || null
    payload.jd_storage_path = payload.jd_attachments[0]?.path || null
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
    if (uploadedAttachments.length) {
      try { await removeDocuments(STORAGE_BUCKETS.JD, uploadedAttachments) } catch (cleanupError) { console.error('createJob storage rollback:', cleanupError.message) }
    }
    if (isDisplayIdUniqueError(err, 'job_display_id')) {
      return res.status(400).json({ error: 'Could not allocate unique Job ID. Please try again.' })
    }
    if (isMandateTitleUniqueError(err)) {
      try {
        const duplicate = await findDuplicateMandate(req.body.client_id, req.body.role || req.body.title)
        return await sendDuplicateMandateResponse(req, res, duplicate)
      } catch (duplicateError) {
        return logAndSendInternal(res, 'createJob duplicate lookup', duplicateError)
      }
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'createJob', err)
  } finally {
    await cleanupTempFiles(files)
  }
}

async function updateJob(req, res) {
  const files = requestFiles(req, 'jd_file', 'jd_files')
  let uploadedAttachments = []
  let previousAttachments = []
  let removedAttachments = []
  let attachmentRowUpdated = false
  try {
    const admin = await isAdmin(req.user)
    await assertRowEditable('jobs', req.params.id, admin)
    await assertCanUpdateColumns('jobs', req.body, admin)
    const payload = await payloadFromBody(req.body, true)
    const { data: currentJob, error: currentJobError } = await supabase.from('jobs').select('client_id, title, consultants, team_lead, jd_attachments, jd_storage_path, jd_url, created_at, updated_at').eq('id', req.params.id).maybeSingle()
    if (currentJobError) throw currentJobError
    if (!currentJob) return res.status(404).json({ error: 'Mandate not found' })
    const nextClientId = await assertClientExists(payload.client_id || currentJob.client_id)
    if (Object.prototype.hasOwnProperty.call(payload, 'client_id') || nextClientId !== currentJob.client_id) payload.client_id = nextClientId
    const nextTitle = Object.prototype.hasOwnProperty.call(payload, 'title') ? payload.title : currentJob.title
    const duplicateIdentityChanged = nextClientId !== currentJob.client_id || clean(nextTitle).toLowerCase() !== clean(currentJob.title).toLowerCase()
    if (duplicateIdentityChanged) await assertNoDuplicateMandate(nextClientId, nextTitle, req.params.id)
    await assertAssignmentUsersExist(
      { ...payload, consultant_user_ids: req.body.consultant_user_ids, team_lead_user_id: req.body.team_lead_user_id },
      { consultants: currentJob.consultants, team_lead: currentJob.team_lead }
    )
    const linkedAttachments = normalizeExternalAttachments(req.body.jd_links, { fieldName: 'jd_links' })
    const hasAttachmentMutation = files.length > 0 || linkedAttachments.length > 0 || Object.prototype.hasOwnProperty.call(req.body, 'removed_jd_paths')
    if (hasAttachmentMutation) {
      previousAttachments = normalizeAttachments(currentJob.jd_attachments, {
        bucket: STORAGE_BUCKETS.JD,
        legacy: { path: currentJob.jd_storage_path || currentJob.jd_url, uploadedAt: currentJob.updated_at || currentJob.created_at }
      })
      const plan = removalPlan(previousAttachments, req.body.removed_jd_paths, STORAGE_BUCKETS.JD, 'removed_jd_paths')
      removedAttachments = plan.removed
      uploadedAttachments = await uploadDocuments(files, STORAGE_BUCKETS.JD, String(new Date().getFullYear()))
      const nextAttachments = normalizeAttachments([...plan.retained, ...uploadedAttachments, ...linkedAttachments], { bucket: STORAGE_BUCKETS.JD })
      payload.jd_attachments = nextAttachments
      payload.jd_url = nextAttachments[0]?.path || null
      payload.jd_storage_path = nextAttachments[0]?.path || null
    }
    payload.updated_at = new Date().toISOString()
    const { data, error } = await updateJobRow(req.params.id, payload)
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Mandate not found' })
    attachmentRowUpdated = hasAttachmentMutation
    if (removedAttachments.length) {
      try {
        await removeDocuments(STORAGE_BUCKETS.JD, removedAttachments)
      } catch (storageError) {
        const primary = previousAttachments[0]
        const rollback = await updateJobRow(req.params.id, {
          jd_attachments: previousAttachments,
          jd_url: primary?.path || null,
          jd_storage_path: primary?.path || null
        })
        if (rollback.error) console.error('updateJob attachment rollback:', rollback.error.message)
        if (uploadedAttachments.length) {
          try { await removeDocuments(STORAGE_BUCKETS.JD, uploadedAttachments) } catch (cleanupError) { console.error('updateJob new upload cleanup:', cleanupError.message) }
          uploadedAttachments = []
        }
        throw Object.assign(new Error('The mandate was saved, but its attachment deletion could not be completed. Existing attachments were restored.'), { statusCode: 502 })
      }
    }
    const job = formatJob(data)
    await createAssignmentNotifications({
      job,
      senderId: req.user?.id,
      consultantIds: req.body.consultant_user_ids,
      teamLeadId: req.body.team_lead_user_id,
      previousConsultants: currentJob?.consultants || [],
      previousTeamLead: currentJob?.team_lead || ''
    })
    return res.json(await stripHiddenFields('jobs', job, admin))
  } catch (err) {
    if (uploadedAttachments.length && !attachmentRowUpdated) {
      try { await removeDocuments(STORAGE_BUCKETS.JD, uploadedAttachments) } catch (cleanupError) { console.error('updateJob storage rollback:', cleanupError.message) }
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'updateJob', err)
  } finally {
    await cleanupTempFiles(files)
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
    const allowedFields = await allowedMandateFilterFields(req.user)
    const result = await parseMandateIntent(prompt, { allowedFields })
    const executable = mandateExecutionFilter(result.filters, { allowedFields })
    await resolveEntityFilterReferences('mandates', executable)
    return res.json(result)
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'buildJobFilters', err)
  }
}

module.exports = { listJobs, getJob, createJob, updateJob, deleteJob, getNextJobDisplayId, listJobUsers, buildJobFilters }
