const { v4: uuidv4 } = require('uuid')
const { PUBLIC_APPLICATION_BUCKET, validateStagedResumePath, clean, indiaDate, isDateOnly } = require('./publicApplications')
const { normalizeMandateStatus } = require('./mandateStatuses')

const APPLICATION_STATUSES = Object.freeze(['pending', 'converting', 'converted', 'linked_existing', 'rejected'])
const DEFAULT_LIST_STATUSES = Object.freeze(['pending', 'converting'])
const LIST_SORT_FIELDS = Object.freeze(new Set(['created_at', 'full_name', 'public_role_name', 'location', 'application_status']))
const APPLICATION_SELECT = [
  'id', 'job_id', 'client_id', 'public_role_name', 'internal_job_title_snapshot', 'client_name_snapshot',
  'mandate_consultants_snapshot', 'full_name', 'email', 'mobile_number', 'current_designation',
  'current_organisation', 'experience_years', 'location', 'skills', 'notice_period', 'current_salary',
  'expected_salary', 'linkedin_url', 'comments', 'open_to_relocate', 'cv_storage_path', 'cv_original_name',
  'cv_mimetype', 'cv_file_hash', 'application_status', 'processing_token', 'processing_started_at',
  'converted_candidate_id', 'converted_association_id', 'converted_by', 'converted_at', 'rejected_by',
  'rejected_at', 'rejection_reason', 'created_at', 'updated_at',
  'jobs(job_display_id, is_public, mandate_status, application_deadline)',
  'clients(client_display_id)'
].join(', ')

function publicApplicationDto(row, { detail = false } = {}) {
  const dto = {
    id: row.id,
    application_id: row.id,
    job_id: row.job_id,
    client_id: row.client_id,
    client_display_id: row.clients?.client_display_id || null,
    job_display_id: row.jobs?.job_display_id || null,
    public_role_name: row.public_role_name,
    internal_job_title: row.internal_job_title_snapshot,
    client_name: row.client_name_snapshot,
    mandate_consultants: row.mandate_consultants_snapshot || [],
    full_name: row.full_name,
    email: row.email,
    mobile_number: row.mobile_number,
    current_designation: row.current_designation,
    current_organisation: row.current_organisation,
    experience_years: row.experience_years,
    location: row.location,
    skills: row.skills || [],
    notice_period: row.notice_period,
    current_salary: row.current_salary,
    expected_salary: row.expected_salary,
    linkedin_url: row.linkedin_url,
    comments: row.comments,
    open_to_relocate: row.open_to_relocate,
    cv_original_name: row.cv_original_name,
    cv_mimetype: row.cv_mimetype,
    application_status: row.application_status,
    converted_candidate_id: row.converted_candidate_id,
    converted_association_id: row.converted_association_id,
    converted_at: row.converted_at,
    rejected_at: row.rejected_at,
    rejection_reason: row.rejection_reason,
    requires_closed_role_confirmation: !row.jobs || !row.jobs.is_public || normalizeMandateStatus(row.jobs.mandate_status) !== 'Ongoing (P1)' || !row.jobs.application_deadline || row.jobs.application_deadline < indiaDate(),
    live_mandate_status: row.jobs?.mandate_status || null,
    live_application_deadline: row.jobs?.application_deadline || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
  if (detail) dto.is_conversion_processing = row.application_status === 'converting'
  return dto
}

function safeSearch(value) {
  return clean(value).replace(/[%_,()]/g, ' ').slice(0, 100)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
}

function indiaDayTimestamp(value, endOfDay = false) {
  const date = clean(value)
  if (!isDateOnly(date)) return ''
  const timestamp = new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`)
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString()
}

function parseStatuses(value) {
  if (!value) return [...DEFAULT_LIST_STATUSES]
  if (clean(value).toLowerCase() === 'all') return []
  const statuses = [...new Set(String(value).split(',').map((status) => clean(status).toLowerCase()).filter((status) => APPLICATION_STATUSES.includes(status)))]
  return statuses.length ? statuses : [...DEFAULT_LIST_STATUSES]
}

async function listApplications(supabase, queryParams = {}) {
  const page = Math.max(Number.parseInt(queryParams.page, 10) || 1, 1)
  const limit = Math.min(Math.max(Number.parseInt(queryParams.limit, 10) || 25, 1), 100)
  const from = (page - 1) * limit
  const requestedSort = clean(queryParams.sortField || queryParams.sort_by)
  const sortField = LIST_SORT_FIELDS.has(requestedSort) ? requestedSort : 'created_at'
  const ascending = clean(queryParams.sortDirection || queryParams.sort_order).toLowerCase() === 'asc'
  let query = supabase.from('public_applications').select(APPLICATION_SELECT, { count: 'exact' })
  const statuses = parseStatuses(queryParams.status)
  if (statuses.length) query = query.in('application_status', statuses)
  const search = safeSearch(queryParams.search)
  if (search) {
    const pattern = `*${search}*`
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern},mobile_number.ilike.${pattern},public_role_name.ilike.${pattern},internal_job_title_snapshot.ilike.${pattern},client_name_snapshot.ilike.${pattern},location.ilike.${pattern}`)
  }
  if (clean(queryParams.role)) {
    query = isUuid(queryParams.role)
      ? query.eq('job_id', clean(queryParams.role))
      : query.eq('public_role_name', clean(queryParams.role))
  }
  if (clean(queryParams.client)) {
    query = isUuid(queryParams.client)
      ? query.eq('client_id', clean(queryParams.client))
      : query.eq('client_name_snapshot', clean(queryParams.client))
  }
  if (clean(queryParams.consultant)) query = query.contains('mandate_consultants_snapshot', [clean(queryParams.consultant)])
  if (clean(queryParams.location)) query = query.ilike('location', `%${safeSearch(queryParams.location)}%`)
  const dateFrom = indiaDayTimestamp(queryParams.date_from)
  const dateTo = indiaDayTimestamp(queryParams.date_to, true)
  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)
  const { data, error, count } = await query.order(sortField, { ascending }).range(from, from + limit - 1)
  if (error) throw error
  return {
    data: (data || []).map((row) => publicApplicationDto(row)),
    total: count || 0,
    page,
    totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
    limit
  }
}

async function getApplication(supabase, applicationId) {
  const { data, error } = await supabase.from('public_applications').select(APPLICATION_SELECT).eq('id', applicationId).maybeSingle()
  if (error) throw error
  return data
}

function staleConversionThreshold(now = Date.now()) {
  const configured = Number.parseInt(process.env.PUBLIC_APPLICATION_CONVERSION_STALE_MS, 10)
  const staleMs = Number.isInteger(configured) && configured >= 60000 ? configured : 15 * 60 * 1000
  return new Date(now - staleMs).toISOString()
}

async function claimApplication(supabase, applicationId, now = new Date()) {
  let current = await getApplication(supabase, applicationId)
  if (!current) throw Object.assign(new Error('Application not found.'), { statusCode: 404 })
  if (['converted', 'linked_existing'].includes(current.application_status)) return { application: current, idempotent: true, token: null }
  if (current.application_status === 'rejected') throw Object.assign(new Error('Rejected applications cannot be converted.'), { statusCode: 409 })
  const token = uuidv4()
  let query = supabase.from('public_applications').update({
    application_status: 'converting',
    processing_token: token,
    processing_started_at: now.toISOString(),
    updated_at: now.toISOString()
  }).eq('id', applicationId)
  if (current.application_status === 'pending') {
    query = query.eq('application_status', 'pending')
  } else if (current.application_status === 'converting' && current.processing_started_at && current.processing_started_at < staleConversionThreshold(now.getTime())) {
    query = query.eq('application_status', 'converting').eq('processing_token', current.processing_token).lt('processing_started_at', staleConversionThreshold(now.getTime()))
  } else {
    throw Object.assign(new Error('This application is already being converted.'), { statusCode: 409 })
  }
  const { data, error } = await query.select(APPLICATION_SELECT).maybeSingle()
  if (error) throw error
  if (!data) {
    current = await getApplication(supabase, applicationId)
    if (['converted', 'linked_existing'].includes(current?.application_status)) return { application: current, idempotent: true, token: null }
    throw Object.assign(new Error('This application is already being converted.'), { statusCode: 409 })
  }
  return { application: data, idempotent: false, token }
}

async function releaseApplicationClaim(supabase, applicationId, token) {
  if (!token) return
  const { error } = await supabase.from('public_applications').update({
    application_status: 'pending',
    processing_token: null,
    processing_started_at: null,
    converted_candidate_id: null,
    converted_association_id: null,
    updated_at: new Date().toISOString()
  }).eq('id', applicationId).eq('application_status', 'converting').eq('processing_token', token).select('id').maybeSingle()
  if (error) throw error
}

async function recordConversionCandidate(supabase, applicationId, token, candidateId) {
  const { data, error } = await supabase.from('public_applications').update({
    converted_candidate_id: candidateId,
    updated_at: new Date().toISOString()
  }).eq('id', applicationId)
    .eq('application_status', 'converting')
    .eq('processing_token', token)
    .select(APPLICATION_SELECT)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw Object.assign(new Error('The provisional conversion candidate could not be recorded. The candidate will be cleaned up before retry.'), {
      statusCode: 409
    })
  }
  return data
}

async function finalizeApplication(supabase, applicationId, token, values) {
  const now = new Date().toISOString()
  let query = supabase.from('public_applications').update({
    application_status: values.application_status,
    converted_candidate_id: values.candidate_id,
    converted_association_id: values.association_id,
    converted_by: values.user_id,
    converted_at: now,
    processing_token: null,
    processing_started_at: null,
    updated_at: now
  }).eq('id', applicationId).eq('application_status', 'converting')
  if (token) query = query.eq('processing_token', token)
  const { data, error } = await query.select(APPLICATION_SELECT).maybeSingle()
  if (error) throw error
  if (!data) {
    const current = await getApplication(supabase, applicationId)
    if (['converted', 'linked_existing'].includes(current?.application_status)) return current
    throw Object.assign(new Error('The conversion could not be finalized and can be safely retried.'), { statusCode: 409 })
  }
  return data
}

async function removeFinalizedApplication(supabase, application) {
  if (!application?.id || !['converted', 'linked_existing'].includes(application.application_status)) {
    throw Object.assign(new Error('Only a converted application can be removed.'), { statusCode: 409 })
  }
  const objectPath = validateStagedResumePath(application)
  let cleanup = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).remove([objectPath])
  if (cleanup.error) cleanup = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).remove([objectPath])
  if (cleanup.error) {
    throw Object.assign(new Error('The candidate was added, but the staged CV could not be removed. Retry the conversion cleanup.'), {
      statusCode: 502
    })
  }

  const { data, error } = await supabase
    .from('public_applications')
    .delete()
    .eq('id', application.id)
    .in('application_status', ['converted', 'linked_existing'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) return { removed: false, cvRemoved: false }
  return { removed: true, cvRemoved: true }
}

async function rejectApplication(supabase, applicationId, userId, reason) {
  const rejectionReason = clean(reason)
  if (!rejectionReason) throw Object.assign(new Error('Rejection reason is required.'), { statusCode: 400 })
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('public_applications').update({
    application_status: 'rejected',
    rejected_by: userId,
    rejected_at: now,
    rejection_reason: rejectionReason,
    updated_at: now
  }).eq('id', applicationId).eq('application_status', 'pending').select(APPLICATION_SELECT).maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Only pending applications can be rejected.'), { statusCode: 409 })
  return data
}

async function signedCv(supabase, application) {
  const objectPath = validateStagedResumePath(application)
  const expiresIn = 5 * 60
  const { data, error } = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).createSignedUrl(objectPath, expiresIn)
  if (error || !data?.signedUrl) throw error || new Error('Could not create a signed resume URL.')
  return { url: data.signedUrl, fileName: application.cv_original_name, contentType: 'application/pdf', expiresIn }
}

module.exports = {
  APPLICATION_STATUSES,
  DEFAULT_LIST_STATUSES,
  APPLICATION_SELECT,
  publicApplicationDto,
  parseStatuses,
  listApplications,
  getApplication,
  staleConversionThreshold,
  claimApplication,
  releaseApplicationClaim,
  recordConversionCandidate,
  finalizeApplication,
  removeFinalizedApplication,
  rejectApplication,
  signedCv
}
