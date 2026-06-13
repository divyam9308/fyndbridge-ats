const fs = require('fs/promises')
const path = require('path')
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')
const { prepareUploadedCv, prepareLinkedCv, checkUploadedCvDuplicate, checkLinkedCvDuplicate } = require('../services/cvStorage')
const { callAiJson } = require('../services/aiProvider')
const { buildAiFilterPrompt, validateAiFilters, aiFilterSchema, applyFilters: applySharedFilters } = require('../services/filterEngine')

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
  return Boolean(text && text !== '-' && text !== 'n/a' && text !== 'na')
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function candidateDisplayIdNumber(value) {
  const number = displayIdNumber(value, 'CA')
  return number < Number.MAX_SAFE_INTEGER ? number : 0
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
  await ensureCandidateDisplayIds()
  const { data, error } = await supabase.from('candidates').select('candidate_display_id')
  if (error) throw error
  
  const existingIds = new Set(
    (data || [])
      .map((candidate) => candidate.candidate_display_id)
      .filter(Boolean)
  )

  let nextNum = 1
  while (existingIds.has(`CA${nextNum}`)) {
    nextNum++
  }
  return `CA${nextNum}`
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
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: row.client_id || candidate.client_id || null,
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
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: candidate.client_id || null,
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

async function findExactAssociationDuplicate({ email, mobileNumber, clientId, jobId }) {
  const normalizedEmail = normalizeDuplicateEmail(email)
  const mobile = normalizeDuplicateMobile(mobileNumber)
  const cleanClientId = cleanText(clientId)
  const cleanJobId = cleanText(jobId)

  if (!cleanClientId || !cleanJobId || (!isDuplicateValue(normalizedEmail) && !isDuplicateValue(mobile))) return null

  const { data: candidates, error: candidatesError } = await supabase
    .from('candidates')
    .select('id, email, mobile_number')
    .limit(10000)
  if (candidatesError) throw candidatesError

  const candidateIds = (candidates || [])
    .filter((candidate) => {
      const emailMatches = isDuplicateValue(normalizedEmail) && normalizeDuplicateEmail(candidate.email) === normalizedEmail
      const mobileMatches = isDuplicateValue(mobile) && normalizeDuplicateMobile(candidate.mobile_number) === mobile
      return emailMatches || mobileMatches
    })
    .map(candidate => candidate.id)

  if (!candidateIds.length) return null

  const { data, error } = await supabase
    .from('candidate_associations')
    .select('*, candidates(*)')
    .in('candidate_id', candidateIds)
    .eq('client_id', cleanClientId)
    .eq('job_id', cleanJobId)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? flattenAssociation(data) : null
}

function candidateFilterValue(row, field) {
  const values = {
    candidate_id: row.candidate_display_id,
    candidate_name: row.full_name,
    consultant: row.consultant_name,
    email: row.email,
    mobile: row.mobile_number,
    designation: row.current_designation,
    organisation: row.current_organisation || row.current_company,
    experience: row.experience_years,
    client_id: row.client_display_id || row.client_id,
    client_name: row.client_name,
    role: row.job_title,
    date: row.created_at,
    skills: Array.isArray(row.skills) ? row.skills.join(', ') : row.skills,
    current_ctc: row.current_salary,
    current_location: row.location || row.city,
    notice_period: row.notice_period,
    expected_ctc: row.expected_salary,
    open_to_relocate: row.open_to_relocate,
    comments: row.notes,
    status: row.status,
    month: row.created_at ? new Date(row.created_at).toLocaleString('en-US', { month: 'long' }) : '',
    linkedin: row.linkedin_url,
    cv: row.cv_link || row.resume_url
  }
  return values[field]
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
      return cv
    }
  }
  if (candidatePayload.cv_link || candidatePayload.resume_url) {
    const cv = await prepareLinkedCv(candidatePayload.cv_link || candidatePayload.resume_url)
    if (cv) {
      candidatePayload.cv_link = cv.cv_link
      candidatePayload.resume_url = cv.resume_url
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

  console.log('[insertAssociation] Final payload before insert:', JSON.stringify(nextPayload))

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

  console.log('[updateAssociation] Final payload before update:', JSON.stringify(nextPayload))

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

  const nextStatus = count > 0 ? 'Completed' : 'Ongoing'
  if (job.mandate_status === nextStatus && job.status === nextStatus) return
  const { error: updateError } = await supabase
    .from('jobs')
    .update({ mandate_status: nextStatus, status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updateError) throw updateError
}

async function listCandidates(req, res) {
  try {
    await ensureCandidateDisplayIds()

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1

    const hasAssocFilters = req.query.job_title || 
                            req.query.job_id ||
                            req.query.client_id ||
                            req.query.client_name || 
                            req.query.status || 
                            req.query.salary_min || 
                            req.query.salary_max || 
                            (req.query.ai_filters && (
                              req.query.ai_filters.includes('job') ||
                              req.query.ai_filters.includes('client') ||
                              req.query.ai_filters.includes('status') ||
                              req.query.ai_filters.includes('salary') ||
                              req.query.ai_filters.includes('consultant')
                            ));

    let relationSelect = 'candidate_associations(*)'
    if (hasAssocFilters) {
      relationSelect = 'candidate_associations!inner(*)'
    }

    let query = supabase
      .from('candidates')
      .select(`*, ${relationSelect}`, { count: 'exact' })

    if (req.query.sortField === 'candidate_id') {
      query = query.order('created_at', { ascending: false })
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

    const aiFilters = parseJsonFilter(req.query.ai_filters)
    const { data, error, count } = await (aiFilters ? query.limit(10000) : query.range(from, to))

    if (error) {
      throw error
    }

    const candidates = data || []
    if (req.query.sortField === 'candidate_id') {
      const direction = req.query.sortDirection === 'desc' ? -1 : 1
      candidates.sort((a, b) => direction * (candidateDisplayIdNumber(a.candidate_display_id) - candidateDisplayIdNumber(b.candidate_display_id)))
    }

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

    const jobIds = [...new Set(flattened.map(row => row.job_id).filter(Boolean))]
    if (jobIds.length) {
      const { data: jobRows, error: jobsError } = await supabase
        .from('jobs')
        .select('id, job_display_id')
        .in('id', jobIds)
      if (jobsError) throw jobsError
      const jobDisplayIds = new Map((jobRows || []).map(job => [job.id, job.job_display_id]))
      flattened = flattened.map(row => ({ ...row, job_display_id: row.job_display_id || jobDisplayIds.get(row.job_id) || '' }))
    }

    if (aiFilters) {
      const clientIds = [...new Set(flattened.map(row => row.client_id).filter(Boolean))]
      if (clientIds.length) {
        const { data: clientRows, error: clientsError } = await supabase
          .from('clients')
          .select('id, client_display_id')
          .in('id', clientIds)
        if (clientsError) throw clientsError
        const clientDisplayIds = new Map((clientRows || []).map(client => [client.id, client.client_display_id]))
        flattened = flattened.map(row => ({ ...row, client_display_id: clientDisplayIds.get(row.client_id) || '' }))
      }
      flattened = applySharedFilters('candidates', flattened, aiFilters, candidateFilterValue)
    }

    return res.json({
      data: aiFilters ? flattened.slice(from, to + 1) : flattened,
      total: aiFilters ? flattened.length : count || 0,
      page,
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

    return res.json({ data: (data || []).map(flattenAssociation) })
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

    return res.json(flattenAssociation(data))
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

    const duplicate = await findCandidateAnyDuplicate(candidatePayload.email, candidatePayload.mobile_number)

    if (duplicate && !['add_duplicate', 'update_current'].includes(duplicateAction)) {
      return res.status(409).json({
        duplicate: true,
        error: 'Duplicate candidate found.',
        existing: duplicate
      })
    }

    if (duplicateAction === 'add_duplicate') {
      const exactAssociation = await findExactAssociationDuplicate({
        email: candidatePayload.email,
        mobileNumber: candidatePayload.mobile_number,
        clientId: associationPayload.client_id,
        jobId: associationPayload.job_id
      })
      if (exactAssociation) {
        return res.status(409).json({
          duplicate: true,
          exactAssociation: true,
          error: 'This candidate has already been added for this client and mandate.',
          existing: exactAssociation
        })
      }
    }

    cvResult = await applyCvInput(req, candidatePayload)

    let candidate = duplicateAction === 'update_current'
      ? duplicate
      : (duplicateAction === 'add_duplicate' ? null : await findCandidateByNameAndMobile(candidatePayload.full_name, candidatePayload.mobile_number))

    if (!candidate) {
      const insertPayload = {
        ...candidatePayload
      }

      if (req.user?.id) {
        insertPayload.created_by = req.user.id
      }

      const { data, error } = await insertCandidate(insertPayload)

      if (error) {
        throw error
      }

      candidate = data

      const correctDisplayId = await nextCandidateDisplayId()
      const { error: updateError } = await supabase
        .from('candidates')
        .update({ candidate_display_id: correctDisplayId })
        .eq('id', candidate.id)

      if (updateError) {
        throw updateError
      }
      candidate.candidate_display_id = correctDisplayId
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

    console.log('[createCandidate] Final candidate_associations insert payload:', JSON.stringify(assocInsert))

    const { data: association, error: associationError } = await insertAssociation(assocInsert)

    if (associationError) {
      throw associationError
    }

    await syncMandateStatusForJob(association.job_id || assocInsert.job_id)

    return res.status(201).json({ ...flattenAssociation(association), cv_duplicate: Boolean(cvResult?.duplicate) })
  } catch (err) {
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

        console.log('[updateCandidate] Final candidate_associations update payload:', JSON.stringify(assocUpdate))

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

      console.log('[updateCandidate] Creating new candidate_associations row:', JSON.stringify(assocInsert))

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
    const filters = validateAiFilters('candidates', parsed)
    if (!filters) {
      return res.status(400).json({ error: 'Could not parse Candidates filter.' })
    }

    return res.json({ filters })
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message })
    }

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
  const objectPath = storagePathFromResumeUrl(resumeUrl)
  if (!objectPath) {
    return
  }

  const { data: sharedRows, error: sharedError } = await supabase
    .from('candidates')
    .select('id, resume_url, cv_link')
    .limit(10000)
  if (sharedError) throw sharedError
  if ((sharedRows || []).some(row => row.resume_url === resumeUrl || row.cv_link === resumeUrl)) return

  const [bucket, ...segments] = objectPath.split('/')
  if (!bucket || !segments.length) {
    return
  }

  const { error } = await supabase.storage.from(bucket).remove([segments.join('/')])
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
      cv_file_hash: cv?.cv_file_hash || ''
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
    return res.json(parsed)
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
