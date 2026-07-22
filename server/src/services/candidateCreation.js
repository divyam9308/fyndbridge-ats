const { allocateNextDisplayId, isDisplayIdUniqueError } = require('./displayIdAllocator')
const { candidateStatusError, cleanStatus: cleanCandidateStatus } = require('./candidateStatuses')
const { resolveClientGroupScope } = require('./clientGroups')

const CANDIDATE_FIELDS = Object.freeze([
  'full_name', 'email', 'mobile_number', 'city', 'state', 'location', 'current_designation',
  'current_company', 'current_organisation', 'experience_years', 'notice_period',
  'open_to_relocate', 'skills', 'education', 'cv_link', 'cv_file_hash', 'cv_storage_path',
  'cv_original_name', 'cv_mimetype', 'cv_attachments', 'linkedin_url', 'resume_url', 'source', 'client_id'
])

const ASSOCIATION_FIELDS = Object.freeze([
  'client_name', 'job_title', 'consultant_name', 'consultant_user_id', 'status',
  'current_salary', 'expected_salary', 'offered_ctc', 'date_of_joining', 'notes', 'client_id', 'job_id'
])

const CONVERSION_REQUEST_PERMISSION_FIELDS = Object.freeze([
  ['full_name', 'full_name'],
  ['email', 'email'],
  ['mobile_number', 'mobile_number'],
  ['current_designation', 'current_designation'],
  ['current_organisation', 'current_organisation'],
  ['experience_years', 'experience_years'],
  ['location', 'location'],
  ['skills', 'skills'],
  ['notice_period', 'notice_period'],
  ['open_to_relocate', 'open_to_relocate'],
  ['linkedin_url', 'linkedin_url'],
  ['consultant_name', 'consultant_name'],
  ['consultant_user_id', 'consultant_user_id'],
  ['status', 'status'],
  ['current_salary', 'current_salary'],
  ['expected_salary', 'expected_salary'],
  ['notes', 'notes']
])

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeEmail(value) {
  return clean(value).toLowerCase()
}

function normalizeMobile(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim()
}

function normalizeMobileIdentity(value) {
  return normalizeMobile(value).replace(/\D/g, '')
}

function isDuplicateValue(value) {
  const text = clean(value).toLowerCase()
  return Boolean(text && text !== '-' && text !== 'n/a' && text !== 'na' && text !== 'none')
}

function pickPayload(body, fields) {
  const payload = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) payload[field] = body[field] === '' ? null : body[field]
  }
  if (payload.full_name) payload.full_name = clean(payload.full_name)
  if (payload.email) payload.email = normalizeEmail(payload.email)
  if (payload.mobile_number) payload.mobile_number = normalizeMobile(payload.mobile_number)
  for (const field of ['experience_years', 'notice_period', 'current_salary', 'expected_salary']) {
    if (payload[field] !== undefined && payload[field] !== null) payload[field] = Number(payload[field])
  }
  return payload
}

function conversionRequestPermissionPayload(body) {
  return CONVERSION_REQUEST_PERMISSION_FIELDS.reduce((payload, [requestField, candidateField]) => {
    if (Object.prototype.hasOwnProperty.call(body || {}, requestField)) payload[candidateField] = body[requestField]
    return payload
  }, {})
}

function conversionBlankFillPermissionPayload(fields) {
  const requested = fields instanceof Set ? fields : new Set(fields || [])
  const payload = {}
  for (const field of requested) payload[field === 'cv' ? 'cv_files' : field] = true
  return payload
}

function validateCandidatePayload(body, { requireStatus = true, requireExpectedSalary = true } = {}) {
  const errors = {}
  if (!clean(body.full_name)) errors.full_name = 'full_name is required'
  if (!normalizeEmail(body.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(body.email))) errors.email = 'email must be a valid email address'
  const mobile = normalizeMobile(body.mobile_number)
  if (!/^\+?\d{7,15}$/.test(mobile)) errors.mobile_number = 'mobile_number must be a valid mobile number'
  if (!Number.isFinite(Number(body.experience_years)) || Number(body.experience_years) < 0) errors.experience_years = 'experience_years must be greater than or equal to 0'
  if (!Number.isInteger(Number(body.notice_period)) || Number(body.notice_period) < 0) errors.notice_period = 'notice_period must be a whole number greater than or equal to 0'
  if (!['true', 'false', 'NA'].includes(body.open_to_relocate)) errors.open_to_relocate = 'open_to_relocate must be Yes, No, or NA'
  if (!Array.isArray(body.skills) || !body.skills.length || body.skills.some((skill) => !clean(skill))) errors.skills = 'skills must be a non-empty array of strings'
  const currentSalary = Number(body.current_salary)
  if (!Number.isInteger(currentSalary) || currentSalary <= 0 || currentSalary > 999999999) {
    errors.current_salary = 'current_salary must be a positive integer with at most 9 digits'
  }
  const expectedSalary = Number(body.expected_salary)
  if ((requireExpectedSalary || clean(body.expected_salary)) && (!Number.isInteger(expectedSalary) || expectedSalary <= 0 || expectedSalary > 999999999)) {
    errors.expected_salary = 'expected_salary must be a positive integer with at most 9 digits'
  }
  if (requireStatus) {
    const statusError = candidateStatusError(body.status)
    if (statusError) errors.status = statusError
  }
  return errors
}

async function findCandidateRowsByIdentity(supabase, email, mobileNumber, columns = '*') {
  const normalizedEmail = normalizeEmail(email)
  const normalizedMobile = normalizeMobileIdentity(mobileNumber)
  const queries = []
  if (isDuplicateValue(normalizedEmail)) queries.push(supabase.from('candidates').select(columns).ilike('email', normalizedEmail).limit(10000))
  if (isDuplicateValue(normalizedMobile)) queries.push(supabase.from('candidates').select(columns).in('mobile_number', [normalizedMobile, `+${normalizedMobile}`]).limit(10000))
  if (!queries.length) return []
  const results = await Promise.all(queries)
  const byId = new Map()
  for (const { data, error } of results) {
    if (error) throw error
    for (const row of data || []) byId.set(row.id, row)
  }
  return [...byId.values()].filter((row) =>
    (isDuplicateValue(normalizedEmail) && normalizeEmail(row.email) === normalizedEmail) ||
    (isDuplicateValue(normalizedMobile) && normalizeMobileIdentity(row.mobile_number) === normalizedMobile)
  )
}

function duplicateCandidateDto(candidate) {
  return {
    candidate_id: candidate.id,
    candidate_display_id: candidate.candidate_display_id || null,
    full_name: candidate.full_name || null,
    email: candidate.email || null,
    mobile_number: candidate.mobile_number || null
  }
}

function missingColumn(error) {
  if (!['PGRST204', '42703'].includes(error?.code)) return ''
  const match = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"/)
  return match?.[1] || match?.[2] || ''
}

function without(payload, field) {
  const next = { ...payload }
  delete next[field]
  return next
}

async function insertCandidate(supabase, payload) {
  let insertPayload = payload
  let result
  for (let attempt = 0; attempt <= CANDIDATE_FIELDS.length; attempt += 1) {
    result = await supabase.from('candidates').insert(insertPayload).select('*').single()
    const column = missingColumn(result.error)
    if (!column || !CANDIDATE_FIELDS.includes(column)) break
    insertPayload = without(insertPayload, column)
  }
  return result
}

async function insertCandidateWithDisplayId(supabase, payload) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidateDisplayId = await allocateNextDisplayId({ supabase, table: 'candidates', column: 'candidate_display_id', prefix: 'CA' })
    const result = await insertCandidate(supabase, { ...payload, candidate_display_id: candidateDisplayId })
    if (result.error && isDisplayIdUniqueError(result.error, 'candidate_display_id')) continue
    if (result.error || !result.data || result.data.candidate_display_id === candidateDisplayId) return result
    const update = await supabase.from('candidates').update({ candidate_display_id: candidateDisplayId }).eq('id', result.data.id).select('*').single()
    if (!update.error) return update
    await supabase.from('candidates').delete().eq('id', result.data.id)
    return { data: null, error: update.error }
  }
  return { data: null, error: Object.assign(new Error('Could not allocate unique Candidate ID. Please try again.'), { statusCode: 400 }) }
}

function candidateCleanupError(cause) {
  const error = new Error('Candidate cleanup could not be confirmed. The application remains in processing state and can be retried after the database issue is resolved.')
  error.statusCode = 500
  error.preserveClaim = true
  error.cause = cause
  return error
}

async function removeCandidateIfUnassociated(supabase, candidateId) {
  const { count, error: associationError } = await supabase
    .from('candidate_associations')
    .select('id', { count: 'exact', head: true })
    .eq('candidate_id', candidateId)
  if (associationError) throw candidateCleanupError(associationError)
  if (count) return false

  const { error: deleteError } = await supabase.from('candidates').delete().eq('id', candidateId)
  if (deleteError) throw candidateCleanupError(deleteError)

  const { data: remaining, error: verifyError } = await supabase
    .from('candidates')
    .select('id')
    .eq('id', candidateId)
    .maybeSingle()
  if (verifyError || remaining) throw candidateCleanupError(verifyError || new Error('Candidate row still exists after cleanup.'))
  return true
}

async function insertAssociation(supabase, payload, { requirePublicMarker = false } = {}) {
  let insertPayload = { ...payload, status: cleanCandidateStatus(payload.status) }
  let result
  for (let attempt = 0; attempt <= ASSOCIATION_FIELDS.length; attempt += 1) {
    result = await supabase.from('candidate_associations').insert(insertPayload).select('*, candidates(*)').single()
    const column = missingColumn(result.error)
    if (!column || !ASSOCIATION_FIELDS.includes(column)) break
    insertPayload = without(insertPayload, column)
  }
  if (requirePublicMarker && payload.public_application_id && missingColumn(result?.error) === 'public_application_id') {
    result.error.statusCode = 503
    result.error.message = 'Applied Candidates schema is not ready. Apply the feature migration before converting.'
  }
  return result
}

async function validateMandateReference(supabase, payload) {
  if (!payload.client_id || !payload.job_id) throw Object.assign(new Error('A valid client and mandate are required.'), { statusCode: 400 })
  const { data: job, error } = await supabase.from('jobs').select('id, title, client_id, clients(client_name, name)').eq('id', payload.job_id).maybeSingle()
  if (error) throw error
  if (!job) throw Object.assign(new Error('The selected mandate no longer exists.'), { statusCode: 409 })
  const scope = await resolveClientGroupScope(supabase, payload.client_id)
  if (!scope.ownerId || scope.ownerId !== job.client_id) throw Object.assign(new Error('Selected mandate does not belong to the selected client.'), { statusCode: 400 })
  payload.client_id = job.client_id
  payload.job_title = job.title || payload.job_title
  payload.client_name = job.clients?.client_name || job.clients?.name || payload.client_name
  return job
}

async function validateConsultantReference(supabase, payload) {
  const name = clean(payload.consultant_name)
  const userId = clean(payload.consultant_user_id)
  if (!name || name === '-') return
  if (!userId) throw Object.assign(new Error('Please select a valid consultant from the dropdown.'), { statusCode: 400 })
  const [{ data: userProfile, error: userError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('user_profiles').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('id').eq('id', userId).maybeSingle()
  ])
  if (userError) throw userError
  if (profileError) throw profileError
  if (!userProfile && !profile) throw Object.assign(new Error('Please select a valid consultant from the dropdown.'), { statusCode: 400 })
  const { assertActiveAssignments } = require('./employeeStatus')
  await assertActiveAssignments({ userIds: [userId], names: [name] })
}

function conversionPayload(application, body, adoptedResume = {}) {
  const relocateValue = body.open_to_relocate ?? application.open_to_relocate
  const candidate = pickPayload({
    full_name: body.full_name ?? application.full_name,
    email: body.email ?? application.email,
    mobile_number: body.mobile_number ?? application.mobile_number,
    current_designation: body.current_designation ?? application.current_designation,
    current_organisation: body.current_organisation ?? application.current_organisation,
    current_company: body.current_organisation ?? application.current_organisation,
    experience_years: body.experience_years ?? application.experience_years,
    location: body.location ?? application.location,
    skills: body.skills ?? application.skills,
    notice_period: body.notice_period ?? application.notice_period,
    open_to_relocate: relocateValue === true ? 'true' : relocateValue === false ? 'false' : relocateValue,
    linkedin_url: body.linkedin_url ?? application.linkedin_url,
    source: 'public_application',
    client_id: application.client_id,
    ...adoptedResume
  }, CANDIDATE_FIELDS)
  const association = pickPayload({
    client_id: application.client_id,
    job_id: application.job_id,
    client_name: application.client_name_snapshot,
    job_title: application.internal_job_title_snapshot,
    consultant_name: body.consultant_name,
    consultant_user_id: body.consultant_user_id,
    status: body.status,
    current_salary: body.current_salary ?? application.current_salary,
    expected_salary: body.expected_salary ?? application.expected_salary,
    notes: body.notes ?? application.comments
  }, ASSOCIATION_FIELDS)
  return { candidate, association }
}

module.exports = {
  CANDIDATE_FIELDS,
  ASSOCIATION_FIELDS,
  clean,
  normalizeEmail,
  normalizeMobile,
  normalizeMobileIdentity,
  isDuplicateValue,
  pickPayload,
  validateCandidatePayload,
  findCandidateRowsByIdentity,
  duplicateCandidateDto,
  insertCandidate,
  insertCandidateWithDisplayId,
  removeCandidateIfUnassociated,
  insertAssociation,
  validateMandateReference,
  validateConsultantReference,
  conversionPayload,
  conversionRequestPermissionPayload,
  conversionBlankFillPermissionPayload
}
