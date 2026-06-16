const fs = require('fs/promises')
const path = require('path')
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')
const { RESUME_BUCKET, prepareUploadedCv, prepareLinkedCv, checkUploadedCvDuplicate, checkLinkedCvDuplicate, normalizeResumeStoragePath } = require('../services/cvStorage')
const { callAiJson } = require('../services/aiProvider')
const { buildAiFilterPrompt, validateAiFilters, aiFilterSchema, applyFilters: applySharedFilters } = require('../services/filterEngine')
const { applyQueryFilters } = require('../services/queryFilters')
const { allocateNextDisplayId, isDisplayIdUniqueError } = require('../services/displayIdAllocator')

const VALID_STATUSES = [
  'Interested',
  'Not Interested',
  'Offered',
  'Hired',
  'Offer Declined',
  'Dropout',
  'Rejected by Recruiter',
  'Interview',
  'Client Submission',
  'Rejected by Client'
]

const CANDIDATE_FIELDS = [
  'full_name',
  'email',
  'mobile_number',
  'city',
  'state',
  'location',
  'current_designation',
  'current_company',
  'current_organisation',
  'experience_years',
  'notice_period',
  'open_to_relocate',
  'skills',
  'education',
  'cv_link',
  'cv_file_hash',
  'cv_storage_path',
  'cv_original_name',
  'cv_mimetype',
  'linkedin_url',
  'resume_url',
  'source',
  'client_id'
]

const ASSOCIATION_FIELDS = [
  'client_name',
  'job_title',
  'consultant_name',
  'status',
  'current_salary',
  'expected_salary',
  'offered_ctc',
  'date_of_joining',
  'notes',
  'client_id',
  'job_id'
]

function logAndSendInternal(res, routeName, err) {
  console.error(`${routeName}:`, err.message)
  return res.status(500).json({ error: 'Internal server error' })
}

function normalizeNullable(value) {
  return value === '' ? null : value
}

function normalizeMatchValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeMobile(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim()
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidMobile(value) {
  const v = String(value || '').trim()
  // Allow '-' as a placeholder (e.g. when CV has no phone number)
  if (v === '-') return true
  // Accept Indian numbers (starting with 6-9, 10 digits) OR international (7-15 digits, optional + prefix)
  return /^(\+?\d{1,4}[\s-]?)?(\d[\s-]?){7,14}\d$/.test(v)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= 999999999
}

function normalizeDuplicateText(value) {
  return cleanText(value).toLowerCase()
}

function normalizeDuplicateEmail(value) {
  return cleanText(value).toLowerCase()
}

function normalizeDuplicateMobile(value) {
  return normalizeMobile(value).replace(/\D/g, '')
}

function isDuplicateValue(value) {
  const text = normalizeDuplicateText(value)
  return Boolean(text && text !== '-' && text !== 'n/a' && text !== 'na' && text !== 'none')
}

function normalizeAssociationValue(value) {
  const text = cleanText(value)
  return isDuplicateValue(text) ? text : ''
}

function sameAssociationValue(a, b) {
  return normalizeAssociationValue(a) === normalizeAssociationValue(b)
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}\\s*(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function compareDisplayIds(a, b, prefix) {
  const aText = cleanText(a)
  const bText = cleanText(b)
  const aNumber = displayIdNumber(aText, prefix)
  const bNumber = displayIdNumber(bText, prefix)
  if (aNumber !== bNumber) return aNumber - bNumber
  return aText.localeCompare(bText, undefined, { sensitivity: 'base' })
}

async function ensureCandidateDisplayIds() {
  // Query ALL candidates directly (not just those with associations)
  // so every candidate gets a display ID, not just ones with associations.
  const { data, error } = await supabase
    .from('candidates')
    .select('id, candidate_display_id')
    .order('created_at', { ascending: true })
    .limit(10000)

  if (error) throw error

  const candidates = data || []

  if (!candidates.some((candidate) => !cleanText(candidate.candidate_display_id))) return

  // Find the highest existing numeric ID so we don't collide
  const existingIds = new Set(
    candidates
      .map((candidate) => candidate.candidate_display_id)
      .filter(Boolean)
  )

  let next = Math.max(0, ...candidates.map((candidate) => displayIdNumber(candidate.candidate_display_id, 'CA')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1

  for (const candidate of candidates.filter((item) => !cleanText(item.candidate_display_id))) {
    // Find the next truly unused ID (skip any that are already taken)
    while (existingIds.has(`CA${next}`)) {
      next++
    }
    const displayId = `CA${next}`
    existingIds.add(displayId)
    next++
    const { error: updateError } = await supabase
      .from('candidates')
      .update({ candidate_display_id: displayId })
      .eq('id', candidate.id)
    if (updateError) throw updateError
  }
}

async function nextCandidateDisplayId() {
  return allocateNextDisplayId({ supabase, table: 'candidates', column: 'candidate_display_id', prefix: 'CA', mode: 'max_plus_one' })
}

async function getNextCandidateDisplayId(req, res) {
  try {
    return res.json({ candidate_display_id: await nextCandidateDisplayId() })
  } catch (err) {
    return logAndSendInternal(res, 'getNextCandidateDisplayId', err)
  }
}

async function findCandidateAnyDuplicate(email, mobileNumber) {
  const normalizedEmail = normalizeDuplicateEmail(email)
  const mobile = normalizeDuplicateMobile(mobileNumber)

  if (!isDuplicateValue(normalizedEmail) && !isDuplicateValue(mobile)) return null

  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .limit(10000)

  if (error) throw error

  return (data || []).find((candidate) => {
    const emailMatches = isDuplicateValue(normalizedEmail) && normalizeDuplicateEmail(candidate.email) === normalizedEmail
    const mobileMatches = isDuplicateValue(mobile) && normalizeDuplicateMobile(candidate.mobile_number) === mobile
    return emailMatches || mobileMatches
  }) || null
}

async function findMatchingCandidates(email, mobileNumber) {
  const normalizedEmail = normalizeDuplicateEmail(email)
  const normalizedMobile = normalizeDuplicateMobile(mobileNumber)

  if (!isDuplicateValue(normalizedEmail) && !isDuplicateValue(normalizedMobile)) {
    return { matches: [], bestMatch: null, exactMatch: null }
  }

  const { data: candidates, error: candidatesError } = await supabase
    .from('candidates')
    .select('*')
    .limit(10000)

  if (candidatesError) throw candidatesError

  const matchedCandidates = (candidates || []).filter((candidate) => {
    const emailMatches = isDuplicateValue(normalizedEmail) && normalizeDuplicateEmail(candidate.email) === normalizedEmail
    const mobileMatches = isDuplicateValue(normalizedMobile) && normalizeDuplicateMobile(candidate.mobile_number) === normalizedMobile
    return emailMatches || mobileMatches
  })

  if (!matchedCandidates.length) {
    return { matches: [], bestMatch: null, exactMatch: null }
  }

  const candidateIds = matchedCandidates.map((candidate) => candidate.id)
  const { data: associations, error: associationsError } = await supabase
    .from('candidate_associations')
    .select('*, candidates(*)')
    .in('candidate_id', candidateIds)
    .order('created_at', { ascending: false })

  if (associationsError) throw associationsError

  const flattenedAssociations = await enrichCandidateRows((associations || []).map(flattenAssociation))
  const associationsByCandidateId = flattenedAssociations.reduce((map, row) => {
    map.set(row.candidate_id, [...(map.get(row.candidate_id) || []), row])
    return map
  }, new Map())

  const matches = matchedCandidates.map((candidate) => {
    const candidateRows = associationsByCandidateId.get(candidate.id)
    if (candidateRows?.length) return candidateRows
    return [flattenCandidateOnly(candidate)]
  }).flat()

  return {
    matches,
    bestMatch: matches[0] || flattenCandidateOnly(matchedCandidates[0]),
    matchedCandidates
  }
}

async function checkCandidateDuplicate(req, res) {
  try {
    const existing = await findCandidateAnyDuplicate(req.query.email, req.query.mobile)
    return res.json({ duplicate: Boolean(existing), existing })
  } catch (err) {
    return logAndSendInternal(res, 'checkCandidateDuplicate', err)
  }
}

function validateCandidatePayload(body, { partial = false } = {}) {
  const errors = {}

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim()) {
      errors.full_name = 'full_name is required'
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'mobile_number')) {
    const raw = String(body.mobile_number || '').trim()
    // Allow '-' as a placeholder when CV has no phone number
    if (raw !== '-') {
      const mobile = normalizeMobile(body.mobile_number)
      if (!mobile) {
        errors.mobile_number = 'mobile_number is required'
      } else if (!isValidMobile(mobile)) {
        errors.mobile_number = 'mobile_number must be a valid mobile number (min 7 digits)'
      }
    }
  }

  if (body.email !== undefined && body.email !== null && body.email !== '' && !isValidEmail(body.email)) {
    errors.email = 'email must be a valid email address'
  }

  if (body.experience_years !== undefined && body.experience_years !== null && body.experience_years !== '') {
    const value = Number(body.experience_years)
    if (!Number.isFinite(value) || value < 0) {
      errors.experience_years = 'experience_years must be greater than or equal to 0'
    }
  }

  if (body.notice_period !== undefined && body.notice_period !== null && body.notice_period !== '') {
    const value = Number(body.notice_period)
    if (!Number.isInteger(value) || value < 0) {
      errors.notice_period = 'notice_period must be a whole number greater than or equal to 0'
    }
  }

  if (
    body.open_to_relocate !== undefined &&
    body.open_to_relocate !== null &&
    typeof body.open_to_relocate !== 'boolean'
  ) {
    errors.open_to_relocate = 'open_to_relocate must be true or false'
  }

  for (const field of ['current_salary', 'expected_salary']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
      const value = Number(body[field])
      if (!isPositiveInteger(value)) {
        errors[field] = `${field} must be a positive integer with at most 9 digits`
      }
    }
  }

  // Allow '-' as a sentinel meaning "no status selected yet" (not just '' and null)
  if (body.status !== undefined && body.status !== null && body.status !== '' && body.status !== '-' && !VALID_STATUSES.includes(body.status)) {
    errors.status = `status must be one of: ${VALID_STATUSES.join(', ')}`
  }

  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || body.skills.some((skill) => typeof skill !== 'string')) {
      errors.skills = 'skills must be an array of strings'
    }
  }

  return errors
}

function pickPayload(body, fields) {
  const payload = {}

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeNullable(body[field])
    }
  }

  if (payload.full_name) {
    payload.full_name = normalizeMatchValue(payload.full_name)
  }

  if (payload.mobile_number) {
    payload.mobile_number = normalizeMobile(payload.mobile_number)
  }

  for (const field of ['experience_years', 'notice_period', 'current_salary', 'expected_salary']) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = Number(payload[field])
    }
  }

  return payload
}

async function findCandidateByNameAndMobile(fullName, mobileNumber) {
  const name = normalizeMatchValue(fullName)
  const mobile = normalizeMobile(mobileNumber)

  if (!name || !mobile) {
    return null
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .ilike('full_name', name)
    .eq('mobile_number', mobile)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

function flattenAssociation(row) {
  const candidate = row.candidates || {}

  return {
    id: row.id,
    association_id: row.id,
    candidate_id: row.candidate_id,
    candidate_display_id: candidate.candidate_display_id || null,
    full_name: candidate.full_name || null,
    email: candidate.email || null,
    mobile_number: candidate.mobile_number || null,
    city: candidate.city || null,
    state: candidate.state || null,
    location: candidate.location || null,
    current_designation: candidate.current_designation || null,
    current_company: candidate.current_company || null,
    current_organisation: candidate.current_organisation || candidate.current_company || null,
    experience_years: candidate.experience_years || null,
    notice_period: candidate.notice_period || null,
    open_to_relocate: candidate.open_to_relocate,
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    cv_file_hash: candidate.cv_file_hash || null,
    cv_storage_path: candidate.cv_storage_path || null,
    cv_original_name: candidate.cv_original_name || null,
    cv_mimetype: candidate.cv_mimetype || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: row.client_id || candidate.client_id || null,
    client_display_id: row.client_display_id || null,
    client_name: row.client_name || null,
    job_id: row.job_id || null,
    job_display_id: row.job_display_id || null,
    job_title: row.job_title || null,
    consultant_name: row.consultant_name || null,
    status: row.status || '-',
    current_salary: row.current_salary || null,
    expected_salary: row.expected_salary || null,
    offered_ctc: row.offered_ctc || null,
    date_of_joining: row.date_of_joining || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function flattenCandidateOnly(candidate) {
  return {
    id: candidate.id,
    association_id: null,
    candidate_id: candidate.id,
    candidate_display_id: candidate.candidate_display_id || null,
    full_name: candidate.full_name || null,
    email: candidate.email || null,
    mobile_number: candidate.mobile_number || null,
    city: candidate.city || null,
    state: candidate.state || null,
    location: candidate.location || null,
    current_designation: candidate.current_designation || null,
    current_company: candidate.current_company || null,
    current_organisation: candidate.current_organisation || candidate.current_company || null,
    experience_years: candidate.experience_years || null,
    notice_period: candidate.notice_period || null,
    open_to_relocate: candidate.open_to_relocate,
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    cv_file_hash: candidate.cv_file_hash || null,
    cv_storage_path: candidate.cv_storage_path || null,
    cv_original_name: candidate.cv_original_name || null,
    cv_mimetype: candidate.cv_mimetype || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: candidate.client_id || null,
    client_display_id: null,
    client_name: null,
    job_id: null,
    job_display_id: null,
    job_title: null,
    consultant_name: null,
    status: '-',
    current_salary: null,
    expected_salary: null,
    offered_ctc: null,
    date_of_joining: null,
    notes: null,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at
  }
}

async function enrichCandidateRows(rows) {
  if (!rows.length) return rows

  const jobIds = [...new Set(rows.map(row => row.job_id).filter(Boolean))]
  const clientIds = [...new Set(rows.map(row => row.client_id).filter(Boolean))]
  let nextRows = rows

  if (jobIds.length) {
    const { data: jobRows, error: jobsError } = await supabase
      .from('jobs')
      .select('id, job_display_id')
      .in('id', jobIds)
    if (jobsError) throw jobsError
    const jobDisplayIds = new Map((jobRows || []).map(job => [job.id, job.job_display_id]))
    nextRows = nextRows.map(row => ({ ...row, job_display_id: row.job_display_id || jobDisplayIds.get(row.job_id) || '' }))
  }

  if (clientIds.length) {
    const { data: clientRows, error: clientsError } = await supabase
      .from('clients')
      .select('id, client_display_id')
      .in('id', clientIds)
    if (clientsError) throw clientsError
    const clientDisplayIds = new Map((clientRows || []).map(client => [client.id, client.client_display_id]))
    nextRows = nextRows.map(row => ({ ...row, client_display_id: row.client_display_id || clientDisplayIds.get(row.client_id) || '' }))
  }

  return nextRows
}

async function findExactAssociationDuplicate({ email, mobileNumber, clientId, jobId }) {
  const { matches } = await findMatchingCandidates(email, mobileNumber)
  const incomingClientId = normalizeAssociationValue(clientId)
  const incomingJobId = normalizeAssociationValue(jobId)
  return matches.find((match) => (
    sameAssociationValue(match.client_id, incomingClientId) &&
    sameAssociationValue(match.job_id, incomingJobId)
  )) || null
}

const CANDIDATE_FILTER_MAPPING = {
  candidate_id: [{ column: 'candidate_display_id', kind: 'text' }],
  candidate_name: [{ column: 'full_name', kind: 'text' }],
  email: [{ column: 'email', kind: 'text' }],
  mobile: [{ column: 'mobile_number', kind: 'text' }],
  designation: [{ column: 'current_designation', kind: 'text' }],
  organisation: [{ column: 'current_organisation', kind: 'text' }],
  experience: [{ column: 'experience_years', kind: 'number' }],
  date: [{ column: 'created_at', kind: 'date' }],
  skills: [],
  current_location: [{ column: 'location', kind: 'text' }, { column: 'city', kind: 'text' }],
  notice_period: [{ column: 'notice_period', kind: 'number' }],
  open_to_relocate: [{ column: 'open_to_relocate', kind: 'boolean' }],
  education: [{ column: 'education', kind: 'text' }],
  linkedin: [{ column: 'linkedin_url', kind: 'text' }],
  cv: [{ column: 'cv_link', kind: 'text' }, { column: 'resume_url', kind: 'text' }],
  consultant: [{ column: 'candidate_associations.consultant_name', kind: 'text' }],
  client_name: [{ column: 'candidate_associations.client_name', kind: 'text' }],
  role: [{ column: 'candidate_associations.job_title', kind: 'text' }],
  current_ctc: [{ column: 'candidate_associations.current_salary', kind: 'number' }],
  expected_ctc: [{ column: 'candidate_associations.expected_salary', kind: 'number' }],
  comments: [{ column: 'candidate_associations.notes', kind: 'text' }],
  status: [{ column: 'candidate_associations.status', kind: 'text' }]
}
const ASSOCIATION_FILTER_FIELDS = new Set(['consultant', 'client_name', 'role', 'current_ctc', 'expected_ctc', 'comments', 'status'])

function candidateFilterValue(row, field) {
  return {
    candidate_id: row.candidate_display_id,
    candidate_name: row.full_name,
    consultant: row.consultant_name,
    email: row.email,
    mobile: row.mobile_number,
    designation: row.current_designation,
    organisation: row.current_organisation || row.current_company,
    experience: row.experience_years,
    skills: row.skills,
    client_id: row.client_display_id,
    client_name: row.client_name,
    role: row.job_title,
    current_ctc: row.current_salary,
    expected_ctc: row.expected_salary,
    current_location: row.location || row.city,
    notice_period: row.notice_period,
    open_to_relocate: row.open_to_relocate,
    comments: row.notes,
    status: row.status,
    month: row.created_at,
    linkedin: row.linkedin_url
  }[field]
}

function skillVariants(value) {
  const text = cleanText(value)
  if (!text) return []
  const title = text.toLowerCase().replace(/\b\w/g, char => char.toUpperCase())
  return [...new Set([text, text.toLowerCase(), text.toUpperCase(), title])]
}

async function resolveSkillCandidateIds(filters) {
  const skillConditions = (filters?.conditions || []).filter(condition => String(condition.field || '').toLowerCase() === 'skills')
  if (!skillConditions.length) return null
  const ids = new Set()
  for (const condition of skillConditions) {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value]
    for (const value of values) {
      for (const variant of skillVariants(value)) {
        const { data, error } = await supabase.from('candidates').select('id').contains('skills', [variant]).limit(10000)
        if (error) throw error
        ;(data || []).forEach(row => ids.add(row.id))
      }
    }
  }
  return [...ids]
}

async function resolveAssociationCandidateIds(filters) {
  if (filters?.mode !== 'any') return null
  const conditions = (filters.conditions || []).filter(condition => ASSOCIATION_FILTER_FIELDS.has(String(condition.field || '').toLowerCase()))
  if (!conditions.length) return null
  const clauses = conditions.map(condition => {
    const value = cleanText(condition.value).replace(/,/g, '\\,').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    if (!value) return null
    if (condition.field === 'consultant') return `consultant_name.ilike.*${value}*`
    if (condition.field === 'client_name') return `client_name.ilike.*${value}*`
    if (condition.field === 'role') return `job_title.ilike.*${value}*`
    if (condition.field === 'comments') return `notes.ilike.*${value}*`
    if (condition.field === 'status') return `status.ilike.*${value}*`
    return null
  }).filter(Boolean)
  if (!clauses.length) return []
  const { data, error } = await supabase
    .from('candidate_associations')
    .select('candidate_id')
    .or(clauses.join(','))
    .limit(10000)
  if (error) throw error
  return [...new Set((data || []).map(row => row.candidate_id).filter(Boolean))]
}

function candidateFilterMappingFor(filters) {
  if (filters?.mode !== 'any') return CANDIDATE_FILTER_MAPPING
  return Object.fromEntries(Object.entries(CANDIDATE_FILTER_MAPPING).filter(([field]) => !ASSOCIATION_FILTER_FIELDS.has(field)))
}

function missingAssociationColumn(error) {
  if (error?.code !== 'PGRST204' || !/candidate_associations/i.test(error.message || '')) return null
  const match = String(error.message || '').match(/'([^']+)' column/)
  const column = match?.[1]
  return ASSOCIATION_FIELDS.includes(column) ? column : null
}

function withoutColumn(payload, column) {
  const next = { ...payload }
  delete next[column]
  return next
}

function missingCandidateColumn(error) {
  if (error?.code !== 'PGRST204' && error?.code !== '42703') return null
  const match = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"/)
  const column = match?.[1] || match?.[2]
  return CANDIDATE_FIELDS.includes(column) ? column : null
}

async function insertCandidate(payload) {
  let insertPayload = payload
  let result = null
  for (let i = 0; i <= CANDIDATE_FIELDS.length; i++) {
    result = await supabase.from('candidates').insert(insertPayload).select('*').single()
    const missingColumn = missingCandidateColumn(result.error)
    if (!missingColumn) break
    insertPayload = withoutColumn(insertPayload, missingColumn)
  }
  return result
}

async function insertCandidateWithDisplayId(payload) {
  const candidateDisplayId = await nextCandidateDisplayId()
  const result = await insertCandidate({ ...payload, candidate_display_id: candidateDisplayId })
  if (result.error || !result.data) return result
  if (result.data.candidate_display_id === candidateDisplayId) return result

  const update = await supabase
    .from('candidates')
    .update({ candidate_display_id: candidateDisplayId })
    .eq('id', result.data.id)
    .select('*')
    .single()

  if (!update.error) return update
  await supabase.from('candidates').delete().eq('id', result.data.id)
  return { data: null, error: update.error }
}

async function updateCandidateRow(candidateId, payload) {
  let updatePayload = payload
  let result = null
  for (let i = 0; i <= CANDIDATE_FIELDS.length; i++) {
    result = await supabase.from('candidates').update(updatePayload).eq('id', candidateId)
    const missingColumn = missingCandidateColumn(result.error)
    if (!missingColumn) break
    updatePayload = withoutColumn(updatePayload, missingColumn)
  }
  return result
}

async function applyCvInput(req, candidatePayload) {
  if (req.file) {
    const cv = await prepareUploadedCv(req.file)
    if (cv) {
      candidatePayload.cv_link = cv.cv_link
      candidatePayload.resume_url = cv.resume_url
      candidatePayload.cv_file_hash = cv.cv_file_hash
      candidatePayload.cv_storage_path = cv.cv_storage_path
      candidatePayload.cv_original_name = cv.cv_original_name || req.file.originalname || candidatePayload.cv_original_name
      candidatePayload.cv_mimetype = cv.cv_mimetype || req.file.mimetype || candidatePayload.cv_mimetype
      return cv
    }
  }
  const tempResumePath = String(candidatePayload.cv_storage_path || '').trim()
  if (!req.file && tempResumePath && tempResumePath.startsWith('/tmp/')) {
    try {
      await fs.access(tempResumePath)
      const tempFile = {
        path: tempResumePath,
        originalname: req.body.cv_original_name || path.basename(tempResumePath),
        mimetype: req.body.cv_mimetype || (tempResumePath.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : tempResumePath.toLowerCase().endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/msword')
      }
      const cv = await prepareUploadedCv(tempFile)
      if (cv) {
        candidatePayload.cv_link = cv.cv_link
        candidatePayload.resume_url = cv.resume_url
        candidatePayload.cv_file_hash = cv.cv_file_hash
        candidatePayload.cv_storage_path = cv.cv_storage_path
        candidatePayload.cv_original_name = cv.cv_original_name || req.body.cv_original_name || candidatePayload.cv_original_name
        candidatePayload.cv_mimetype = cv.cv_mimetype || req.body.cv_mimetype || candidatePayload.cv_mimetype
        return cv
      }
    } catch (err) {
      console.error('applyCvInput temp upload error:', err.message)
      const uploadError = new Error('Resume upload failed. Please re-upload the CV and try again.')
      uploadError.statusCode = err.statusCode || 400
      throw uploadError
    } finally {
      try { await fs.unlink(tempResumePath) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('applyCvInput temp cleanup:', cleanupError.message) }
    }
  }
  if (candidatePayload.cv_link || candidatePayload.resume_url) {
    const cv = await prepareLinkedCv(candidatePayload.cv_link || candidatePayload.resume_url)
    if (cv) {
      candidatePayload.cv_link = cv.cv_link
      candidatePayload.resume_url = cv.resume_url
      if (cv.cv_storage_path) candidatePayload.cv_storage_path = cv.cv_storage_path
      if (req.body.cv_original_name) candidatePayload.cv_original_name = req.body.cv_original_name
      if (req.body.cv_mimetype) candidatePayload.cv_mimetype = req.body.cv_mimetype
      return cv
    }
  }
  return null
}

function parseJsonFilter(value) {
  if (!value) {
    return null
  }

  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return null
  }
}

async function insertAssociation(payload) {
  const nextPayload = { ...payload }
  nextPayload.status =
    typeof nextPayload.status === 'string' && nextPayload.status.trim()
      ? nextPayload.status.trim()
      : '-';

  let insertPayload = nextPayload
  let result = null
  for (let i = 0; i <= ASSOCIATION_FIELDS.length; i++) {
    result = await supabase
      .from('candidate_associations')
      .insert(insertPayload)
      .select('*, candidates(*)')
      .single()
    const missingColumn = missingAssociationColumn(result.error)
    if (!missingColumn) break
    insertPayload = withoutColumn(insertPayload, missingColumn)
  }

  return result
}

async function updateAssociation(associationId, payload) {
  const nextPayload = { ...payload }
  if (Object.prototype.hasOwnProperty.call(nextPayload, 'status')) {
    nextPayload.status =
      typeof nextPayload.status === 'string' && nextPayload.status.trim()
        ? nextPayload.status.trim()
        : '-';
  }

 

  let updatePayload = nextPayload
  let result = null
  for (let i = 0; i <= ASSOCIATION_FIELDS.length; i++) {
    result = await supabase
      .from('candidate_associations')
      .update(updatePayload)
      .eq('id', associationId)
    const missingColumn = missingAssociationColumn(result.error)
    if (!missingColumn) break
    updatePayload = withoutColumn(updatePayload, missingColumn)
  }

  return result
}

async function syncMandateStatusForJob(jobId) {
  const id = cleanText(jobId)
  if (!id) return
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, mandate_status, status')
    .eq('id', id)
    .maybeSingle()
  if (jobError) throw jobError
  if (!job || job.mandate_status === 'Scrapped' || job.status === 'Scrapped') return

  const { count, error: countError } = await supabase
    .from('candidate_associations')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', id)
    .eq('status', 'Hired')
  if (countError) throw countError

  if (count <= 0) return
  const nextStatus = 'Completed'
  if (job.mandate_status === nextStatus && job.status === nextStatus) return
  const { error: updateError } = await supabase
    .from('jobs')
    .update({ mandate_status: nextStatus, status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updateError) throw updateError
}

async function listCandidates(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const sortField = cleanText(req.query.sortField)
    const sortDirection = cleanText(req.query.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc'
    const aiFilters = parseJsonFilter(req.query.ai_filters)
    const localAiFilter = aiFilters?.mode === 'keyword'
    const skillCandidateIds = await resolveSkillCandidateIds(aiFilters)
    const associationCandidateIds = await resolveAssociationCandidateIds(aiFilters)
    const aiAssociationFilter = aiFilters?.mode !== 'any' && (aiFilters?.conditions || []).some((condition) => ASSOCIATION_FILTER_FIELDS.has(String(condition.field || '').toLowerCase()))

    const hasAssocFilters = req.query.job_title || 
                            req.query.job_id ||
                            req.query.client_id ||
                            req.query.client_name || 
                            req.query.status || 
                            req.query.salary_min || 
                            req.query.salary_max || 
                            aiAssociationFilter

    let relationSelect = 'candidate_associations(*)'
    if (hasAssocFilters) {
      relationSelect = 'candidate_associations!inner(*)'
    }

    let query = supabase
      .from('candidates')
      .select(`*, ${relationSelect}`, { count: 'exact' })

    if (sortField === 'candidate_id') {
      query = query.order('created_at', { ascending: sortDirection !== 'desc' })
    } else if (req.query.sortField === 'candidate_name') {
      query = query.order('full_name', { ascending: req.query.sortDirection !== 'desc' })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (req.query.job_title) {
      query = query.ilike('candidate_associations.job_title', `%${cleanText(req.query.job_title)}%`)
    }

    if (req.query.job_id) {
      query = query.eq('candidate_associations.job_id', cleanText(req.query.job_id))
    }

    if (req.query.client_name) {
      query = query.ilike('candidate_associations.client_name', `%${cleanText(req.query.client_name)}%`)
    }

    if (req.query.client_id) {
      query = query.eq('candidate_associations.client_id', cleanText(req.query.client_id))
    }

    if (req.query.status) {
      query = query.in(
        'candidate_associations.status',
        String(req.query.status)
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      )
    }

    if (req.query.salary_min) {
      query = query.gte('candidate_associations.current_salary', Number(req.query.salary_min))
    }

    if (req.query.salary_max) {
      query = query.lte('candidate_associations.current_salary', Number(req.query.salary_max))
    }

    if (req.query.experience_min) {
      query = query.gte('experience_years', Number(req.query.experience_min))
    }

    if (req.query.experience_max) {
      query = query.lte('experience_years', Number(req.query.experience_max))
    }

    if (req.query.city) {
      query = query.ilike('city', `%${cleanText(req.query.city)}%`)
    }

    if (req.query.state) {
      query = query.ilike('state', `%${cleanText(req.query.state)}%`)
    }

    if (req.query.search) {
      const search = cleanText(req.query.search)
      const mobile = normalizeMobile(search)
      query = query.or(
        [
          `full_name.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `mobile_number.ilike.%${mobile || search}%`,
          `city.ilike.%${search}%`,
          `state.ilike.%${search}%`,
          `current_designation.ilike.%${search}%`,
          `current_organisation.ilike.%${search}%`
        ].join(',')
      )
    }

    const appliedAi = localAiFilter ? { query } : applyQueryFilters(query, 'candidates', aiFilters, candidateFilterMappingFor(aiFilters), {
      applyCondition(nextQuery, condition) {
        if (condition.field !== 'skills') return nextQuery
        if (!skillCandidateIds?.length) return nextQuery.eq('id', '__no_match__')
        return nextQuery.in('id', skillCandidateIds)
      },
      orClauses(normalized) {
        const clauses = []
        if (skillCandidateIds?.length && normalized.some(condition => condition.field === 'skills')) clauses.push(`id.in.(${skillCandidateIds.join(',')})`)
        if (associationCandidateIds?.length) clauses.push(`id.in.(${associationCandidateIds.join(',')})`)
        return clauses
      }
    })
    query = appliedAi.query
    if (!localAiFilter) query = query.range(from, to)
    const { data, error, count } = await query

    if (error) {
      throw error
    }

    const candidates = data || []

    let flattened = []
    for (const candidate of candidates) {
      const associations = candidate.candidate_associations || []
      if (associations.length === 0) {
        flattened.push(flattenCandidateOnly(candidate))
      } else {
        for (const assoc of associations) {
          flattened.push(flattenAssociation({
            ...assoc,
            candidates: candidate
          }))
        }
      }
    }

    flattened = await enrichCandidateRows(flattened)
    if (localAiFilter) flattened = applySharedFilters('candidates', flattened, aiFilters, candidateFilterValue)

    const total = localAiFilter ? flattened.length : count || 0
    const paged = localAiFilter ? flattened.slice(from, to + 1) : flattened.slice(0, limit)

    return res.json({
      data: paged,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      limit
    })
  } catch (err) {
    return logAndSendInternal(res, 'listCandidates', err)
  }
}

async function listCandidateAssociations(req, res) {
  try {
    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('candidate_id', req.params.candidateId)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    return res.json({ data: await enrichCandidateRows((data || []).map(flattenAssociation)) })
  } catch (err) {
    return logAndSendInternal(res, 'listCandidateAssociations', err)
  }
}

async function getCandidate(req, res) {
  try {
    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    const [row] = await enrichCandidateRows([flattenAssociation(data)])
    return res.json(row)
  } catch (err) {
    return logAndSendInternal(res, 'getCandidate', err)
  }
}

async function createCandidate(req, res) {
  try {
    const incomingStatus = req.body.status || req.body.candidateStatus || req.body.application_status || req.body.association_status;
    const body = normalizeRequestBody({
      ...req.body,
      status: incomingStatus !== undefined ? incomingStatus : '',
      source: req.body.source || 'manual'
    })
    const errors = validateCandidatePayload(body)

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)
    const duplicateAction = cleanText(body.duplicate_action)
    let cvResult = null

    associationPayload.status =
      typeof associationPayload.status === "string" && associationPayload.status.trim()
        ? associationPayload.status.trim()
        : "-";

    const duplicateMatch = await findMatchingCandidates(candidatePayload.email, candidatePayload.mobile_number)
    const exactAssociation = duplicateMatch.matches.length
      ? duplicateMatch.matches.find((match) => (
        sameAssociationValue(match.client_id, associationPayload.client_id) &&
        sameAssociationValue(match.job_id, associationPayload.job_id)
      ))
      : null

    if (exactAssociation) {
      return res.status(409).json({
        duplicate: true,
        exactAssociation: true,
        allowAddDuplicate: false,
        error: 'This candidate already exists for the same client and mandate.',
        existing: exactAssociation
      })
    }

    if (duplicateMatch.matches.length && !['add_duplicate', 'update_current'].includes(duplicateAction)) {
      return res.status(409).json({
        duplicate: true,
        exactAssociation: false,
        allowAddDuplicate: true,
        error: 'A duplicate candidate was found. Use Add Duplicate only if client or mandate is different.',
        existing: duplicateMatch.bestMatch
      })
    }

    cvResult = await applyCvInput(req, candidatePayload)

    let candidate = null
    if (duplicateAction === 'update_current') {
      const targetId = duplicateMatch.bestMatch?.candidate_id
      if (targetId) {
        const { data, error } = await supabase
          .from('candidates')
          .select('*')
          .eq('id', targetId)
          .maybeSingle()
        if (error) throw error
        candidate = data
      }
    }

    if (!candidate) {
      let insertedCandidate = null
      let insertError = null
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const insertPayload = { ...candidatePayload }

        if (req.user?.id) {
          insertPayload.created_by = req.user.id
        }

        const result = await insertCandidateWithDisplayId(insertPayload)
        insertedCandidate = result.data
        insertError = result.error
        if (!insertError) break
        if (!isDisplayIdUniqueError(insertError, 'candidate_display_id')) break
      }

      if (insertError) {
        throw insertError
      }

      candidate = insertedCandidate
    } else {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) {
        updatePayload.updated_by = req.user.id
      }

      const { error: candidateUpdateError } = await updateCandidateRow(candidate.id, updatePayload)

      if (candidateUpdateError) {
        throw candidateUpdateError
      }

      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', candidate.id)
        .single()

      if (error) {
        throw error
      }

      candidate = data
    }

    const hasClient = (associationPayload.client_name && associationPayload.client_name !== '-') || associationPayload.client_id;
    const hasJob = (associationPayload.job_title && associationPayload.job_title !== '-') || associationPayload.job_id;
    const hasAssociation = hasClient || hasJob;

    if (!hasAssociation) {
      return res.status(201).json({ ...flattenCandidateOnly(candidate), cv_duplicate: Boolean(cvResult?.duplicate) })
    }

    const assocInsert = {
      ...associationPayload,
      candidate_id: candidate.id
    }

    if (req.user?.id) {
      assocInsert.created_by = req.user.id
    }
const { data: association, error: associationError } = await insertAssociation(assocInsert)

    if (associationError) {
      throw associationError
    }

    await syncMandateStatusForJob(association.job_id || assocInsert.job_id)

    return res.status(201).json({ ...flattenAssociation(association), cv_duplicate: Boolean(cvResult?.duplicate) })
  } catch (err) {
    if (isDisplayIdUniqueError(err, 'candidate_display_id')) {
      return res.status(400).json({ error: 'Could not allocate unique Candidate ID. Please try again.' })
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message })
    }
    return logAndSendInternal(res, 'createCandidate', err)
  } finally {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('createCandidate cleanup:', cleanupError.message) }
    }
  }
}

async function updateCandidate(req, res) {
  try {
    const incomingStatus = req.body.status || req.body.candidateStatus || req.body.application_status || req.body.association_status;
    const body = normalizeRequestBody({
      ...req.body
    })
    if (incomingStatus !== undefined) {
      body.status = incomingStatus;
    }

    const errors = validateCandidatePayload(body, { partial: true })

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const associationId = body.association_id || req.params.id
    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)
    const cvResult = await applyCvInput(req, candidatePayload)

    if (Object.prototype.hasOwnProperty.call(associationPayload, 'status')) {
      associationPayload.status =
        typeof associationPayload.status === 'string' && associationPayload.status.trim()
          ? associationPayload.status.trim()
          : '-';
    }

    let existingCandidateId = null
    let existingAssociation = null

    const { data: existingAssoc, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id, job_id')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (existingAssoc) {
      existingAssociation = existingAssoc
      existingCandidateId = existingAssoc.candidate_id
    } else {
      const { data: existingCand, error: candLookupError } = await supabase
        .from('candidates')
        .select('id')
        .eq('id', associationId)
        .maybeSingle()

      if (candLookupError) {
        throw candLookupError
      }
      if (existingCand) {
        existingCandidateId = existingCand.id
      }
    }

    if (!existingCandidateId) {
      return res.status(404).json({ error: 'Candidate or association not found' })
    }

    if (Object.keys(candidatePayload).length) {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) {
        updatePayload.updated_by = req.user.id
      }

      const { error } = await updateCandidateRow(existingCandidateId, updatePayload)

      if (error) {
        throw error
      }
    }

    const hasClient = (associationPayload.client_name && associationPayload.client_name !== '-') || associationPayload.client_id;
    const hasJob = (associationPayload.job_title && associationPayload.job_title !== '-') || associationPayload.job_id;
    const hasAssociation = hasClient || hasJob;

    let newAssociation = null

    if (existingAssociation) {
      if (Object.keys(associationPayload).length) {
        const assocUpdate = {
          ...associationPayload,
          updated_at: new Date().toISOString()
        }

        if (req.user?.id) {
          assocUpdate.updated_by = req.user.id
        }
const { error } = await updateAssociation(existingAssociation.id, assocUpdate)

        if (error) {
          throw error
        }
        const affectedJobIds = [...new Set([existingAssociation.job_id, assocUpdate.job_id].filter(Boolean))]
        for (const jobId of affectedJobIds) {
          await syncMandateStatusForJob(jobId)
        }
      }
    } else if (hasAssociation) {
      const assocInsert = {
        ...associationPayload,
        candidate_id: existingCandidateId
      }

      if (req.user?.id) {
        assocInsert.created_by = req.user.id
      }
const { data: inserted, error: insertError } = await insertAssociation(assocInsert)

      if (insertError) {
        throw insertError
      }

      newAssociation = inserted
      await syncMandateStatusForJob(inserted.job_id || assocInsert.job_id)
    }

    if (existingAssociation || newAssociation) {
      const assocId = existingAssociation ? existingAssociation.id : newAssociation.id
      const { data, error } = await supabase
        .from('candidate_associations')
        .select('*, candidates(*)')
        .eq('id', assocId)
        .single()

      if (error) {
        throw error
      }

      return res.json({ ...flattenAssociation(data), cv_duplicate: Boolean(cvResult?.duplicate) })
    } else {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', existingCandidateId)
        .single()

      if (error) {
        throw error
      }

      return res.json({ ...flattenCandidateOnly(data), cv_duplicate: Boolean(cvResult?.duplicate) })
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message })
    }
    return logAndSendInternal(res, 'updateCandidate', err)
  } finally {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('updateCandidate cleanup:', cleanupError.message) }
    }
  }
}

async function updateCandidateStatus(req, res) {
  try {
    if (!VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        errors: {
          status: `status must be one of: ${VALID_STATUSES.join(', ')}`
        }
      })
    }

    const updatePayload = {
      status: req.body.status,
      updated_at: new Date().toISOString()
    }

    if (req.user?.id) {
      updatePayload.updated_by = req.user.id
    }

    const { data, error } = await supabase
      .from('candidate_associations')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('id, status, job_id, updated_at')
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    await syncMandateStatusForJob(data.job_id)

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidateStatus', err)
  }
}

async function buildAiCandidateFilters(req, res) {
  try {
    const prompt = cleanText(req.body.prompt)
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' })
    }

    const parsed = await callAiJson({
      prompt: buildAiFilterPrompt('candidates', prompt),
      schema: aiFilterSchema(),
      schemaName: 'candidate_filter',
      temperature: 0
    })
    const filters = validateAiFilters('candidates', parsed, prompt)
    if (!filters) {
      const fallback = { mode: 'any', conditions: ['consultant', 'client_name', 'role', 'designation', 'mobile', 'email', 'skills'].map(field => ({ field, operator: 'contains', value: prompt })) }
return res.json({ filters: fallback })
    }
return res.json({ filters })
  } catch (err) {
    const fallback = validateAiFilters('candidates', null, req.body.prompt)
    if (fallback) return res.json({ filters: fallback, fallback: true })
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'buildAiCandidateFilters', err)
  }
}

function storagePathFromResumeUrl(resumeUrl) {
  if (!resumeUrl) {
    return null
  }

  try {
    const parsed = new URL(resumeUrl)
    const marker = '/storage/v1/object/'
    const markerIndex = parsed.pathname.indexOf(marker)
    if (markerIndex === -1) {
      return resumeUrl
    }

    const objectPath = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length))
    return objectPath.replace(/^sign\/|^public\//, '')
  } catch {
    return resumeUrl
  }
}

async function deleteResumeFromStorage(resumeUrl) {
  const objectPath = normalizeResumeStoragePath(storagePathFromResumeUrl(resumeUrl))
  if (!objectPath) {
    return
  }

  const { data: sharedRows, error: sharedError } = await supabase
    .from('candidates')
    .select('id, resume_url, cv_link')
    .limit(10000)
  if (sharedError) throw sharedError
  if ((sharedRows || []).some(row => row.resume_url === resumeUrl || row.cv_link === resumeUrl)) return

  if (!objectPath) {
    return
  }

  const { error } = await supabase.storage.from(RESUME_BUCKET).remove([objectPath])
  if (error) {
    console.error('deleteResumeFromStorage:', error.message)
  }
}

async function deleteCandidate(req, res) {
  try {
    const associationId = req.params.id

    const { data: existingAssoc, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id, candidates(resume_url)')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (existingAssoc) {
      const { error } = await supabase.from('candidate_associations').delete().eq('id', associationId)

      if (error) {
        throw error
      }

      const { count, error: countError } = await supabase
        .from('candidate_associations')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', existingAssoc.candidate_id)

      if (countError) {
        throw countError
      }

      if (!count) {
        await supabase.from('candidates').delete().eq('id', existingAssoc.candidate_id)
        await deleteResumeFromStorage(existingAssoc.candidates?.resume_url)
      }

      return res.json({ message: 'Candidate association deleted' })
    } else {
      const { data: existingCand, error: candLookupError } = await supabase
        .from('candidates')
        .select('id, resume_url')
        .eq('id', associationId)
        .maybeSingle()

      if (candLookupError) {
        throw candLookupError
      }

      if (!existingCand) {
        return res.status(404).json({ error: 'Candidate or association not found' })
      }

      await supabase.from('candidates').delete().eq('id', existingCand.id)
      await deleteResumeFromStorage(existingCand.resume_url)

      return res.json({ message: 'Candidate deleted' })
    }
  } catch (err) {
    return logAndSendInternal(res, 'deleteCandidate', err)
  }
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeRequestBody(body) {
  const next = { ...body }
  if (typeof next.skills === 'string') {
    try {
      const parsed = JSON.parse(next.skills)
      next.skills = Array.isArray(parsed) ? parsed : []
    } catch {
      next.skills = next.skills.split(',').map(cleanText).filter(Boolean)
    }
  }
  if (typeof next.open_to_relocate === 'string') {
    next.open_to_relocate = next.open_to_relocate === '' ? null : next.open_to_relocate === 'true'
  }
  return next
}

async function checkCvDuplicate(req, res) {
  try {
    let cv = null
    if (req.file) cv = await checkUploadedCvDuplicate(req.file)
    else cv = await checkLinkedCvDuplicate(req.body.cv_link || req.query.cv_link)
    return res.json({
      duplicate: Boolean(cv?.duplicate),
      cv_link: cv?.cv_link || '',
      resume_url: cv?.resume_url || '',
      cv_file_hash: cv?.cv_file_hash || '',
      cv_storage_path: cv?.cv_storage_path || ''
    })
  } catch (err) {
    return logAndSendInternal(res, 'checkCvDuplicate', err)
  } finally {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('checkCvDuplicate cleanup:', cleanupError.message) }
    }
  }
}

async function downloadPdfToTmp(resumeUrl) {
  const response = await axios.get(resumeUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  })

  const contentType = response.headers['content-type'] || ''
  if (!contentType.toLowerCase().includes('application/pdf')) {
    const error = new Error('URL does not point to a PDF')
    error.statusCode = 400
    throw error
  }

  const filePath = path.join('/tmp', `${uuidv4()}.pdf`)
  await fs.writeFile(filePath, Buffer.from(response.data))
  return filePath
}

async function parseResumeRoute(req, res) {
  let tmpFilePath = req.file?.path || null

  try {
    if (!tmpFilePath) {
      const resumeUrl = req.body.resume_url

      if (!resumeUrl || !isValidUrl(resumeUrl)) {
        return res.status(400).json({ error: 'A valid resume_url is required when no PDF file is uploaded' })
      }

      try {
        tmpFilePath = await downloadPdfToTmp(resumeUrl)
      } catch (err) {
        if (err.code === 'ECONNABORTED') {
          return res.status(408).json({ error: 'URL fetch timed out' })
        }

        if (err.statusCode === 400) {
          return res.status(400).json({ error: err.message })
        }

        throw err
      }
    }

    const parsed = await parseResume(tmpFilePath)
    const uploadSource = req.file || {
      path: tmpFilePath,
      originalname: path.basename(tmpFilePath || 'resume.pdf'),
      mimetype: 'application/pdf'
    }
    const cv = await prepareUploadedCv(uploadSource)
    return res.json({
      ...parsed,
      resume_path: cv?.resume_path || cv?.cv_storage_path || tmpFilePath,
      resume_url: cv?.resume_url || cv?.cv_link || '',
      cv_link: cv?.cv_link || cv?.resume_url || '',
      cv_file_hash: cv?.cv_file_hash || '',
      cv_storage_path: cv?.cv_storage_path || cv?.resume_path || tmpFilePath,
      cv_original_name: cv?.cv_original_name || uploadSource.originalname || '',
      cv_mimetype: cv?.cv_mimetype || uploadSource.mimetype || '',
      cv_duplicate: Boolean(cv?.duplicate)
    })
  } catch (err) {
    console.error('parseResumeRoute:', err.message)
    return res.status(500).json({ error: 'Parsing failed', detail: err.message })
  } finally {
    if (tmpFilePath) {
      try {
        await fs.unlink(tmpFilePath)
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('parseResumeRoute cleanup:', err.message)
        }
      }
    }
  }
}

module.exports = {
  VALID_STATUSES,
  checkCandidateDuplicate,
  checkCvDuplicate,
  getNextCandidateDisplayId,
  listCandidates,
  listCandidateAssociations,
  getCandidate,
  createCandidate,
  updateCandidate,
  updateCandidateStatus,
  buildAiCandidateFilters,
  deleteCandidate,
  parseResumeRoute
}

