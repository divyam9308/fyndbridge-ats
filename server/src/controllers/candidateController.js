const fs = require('fs/promises')
const path = require('path')
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')

const VALID_STATUSES = [
  'Interested',
  'Not Interested',
  'Offered',
  'Hired',
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
  'linkedin_url',
  'resume_url',
  'source'
]

const ASSOCIATION_FIELDS = [
  'client_name',
  'job_title',
  'status',
  'current_salary',
  'expected_salary',
  'notes'
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidMobile(value) {
  return /^(\+?\d{1,3}[\s-]?)?[6-9]\d{9}$/.test(String(value || '').trim())
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= 999999999
}

function validateCandidatePayload(body, { partial = false } = {}) {
  const errors = {}

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim()) {
      errors.full_name = 'full_name is required'
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'mobile_number')) {
    const mobile = normalizeMobile(body.mobile_number)
    if (!mobile) {
      errors.mobile_number = 'mobile_number is required'
    } else if (!isValidMobile(mobile)) {
      errors.mobile_number = 'mobile_number must be a valid Indian mobile number'
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

  if (body.status !== undefined && body.status !== null && body.status !== '' && !VALID_STATUSES.includes(body.status)) {
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
    open_to_relocate: Boolean(candidate.open_to_relocate),
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_name: row.client_name || null,
    job_title: row.job_title || null,
    status: row.status || 'Interested',
    current_salary: row.current_salary || null,
    expected_salary: row.expected_salary || null,
    notes: row.notes || null,
    consultant_name: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

async function listCandidates(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 500)
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('candidate_associations')
      .select('*, candidates(*)', { count: 'exact' })
      .order('candidate_id', { ascending: true })
      .order('created_at', { ascending: false })

    if (req.query.job_title) {
      query = query.eq('job_title', req.query.job_title)
    }

    if (req.query.client_name) {
      query = query.eq('client_name', req.query.client_name)
    }

    if (req.query.status) {
      query = query.in(
        'status',
        String(req.query.status)
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      )
    }

    if (req.query.salary_min) {
      query = query.gte('current_salary', Number(req.query.salary_min))
    }

    if (req.query.salary_max) {
      query = query.lte('current_salary', Number(req.query.salary_max))
    }

    const { data, error, count } = await query.range(from, to)

    if (error) {
      throw error
    }

    return res.json({
      data: (data || []).map(flattenAssociation),
      total: count || 0,
      page,
      limit
    })
  } catch (err) {
    return logAndSendInternal(res, 'listCandidates', err)
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
    const body = {
      ...req.body,
      status: req.body.status || 'Interested',
      source: req.body.source || 'manual'
    }
    const errors = validateCandidatePayload(body)

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)

    let candidate = await findCandidateByNameAndMobile(candidatePayload.full_name, candidatePayload.mobile_number)

    if (!candidate) {
      const insertPayload = {
        ...candidatePayload
      }

      if (req.user?.id) {
        insertPayload.created_by = req.user.id
      }

      const { data, error } = await supabase
        .from('candidates')
        .insert(insertPayload)
        .select('id')
        .single()

      if (error) {
        throw error
      }

      candidate = data
    }

    const assocInsert = {
      ...associationPayload,
      candidate_id: candidate.id
    }

    if (req.user?.id) {
      assocInsert.created_by = req.user.id
    }

    const { data: association, error: associationError } = await supabase
      .from('candidate_associations')
      .insert(assocInsert)
      .select('*, candidates(*)')
      .single()

    if (associationError) {
      throw associationError
    }

    return res.status(201).json(flattenAssociation(association))
  } catch (err) {
    return logAndSendInternal(res, 'createCandidate', err)
  }
}

async function updateCandidate(req, res) {
  try {
    const errors = validateCandidatePayload(req.body, { partial: true })

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const associationId = req.body.association_id || req.params.id
    const candidatePayload = pickPayload(req.body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(req.body, ASSOCIATION_FIELDS)

    const { data: existing, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!existing) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    if (Object.keys(candidatePayload).length) {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) {
        updatePayload.updated_by = req.user.id
      }

      const { error } = await supabase
        .from('candidates')
        .update(updatePayload)
        .eq('id', existing.candidate_id)

      if (error) {
        throw error
      }
    }

    if (Object.keys(associationPayload).length) {
      const assocUpdate = {
        ...associationPayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) {
        assocUpdate.updated_by = req.user.id
      }

      const { error } = await supabase
        .from('candidate_associations')
        .update(assocUpdate)
        .eq('id', associationId)

      if (error) {
        throw error
      }
    }

    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('id', associationId)
      .single()

    if (error) {
      throw error
    }

    return res.json(flattenAssociation(data))
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidate', err)
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
      .select('id, status, updated_at')
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidateStatus', err)
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
    const { data: existing, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id, candidates(resume_url)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!existing) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    const { error } = await supabase.from('candidate_associations').delete().eq('id', req.params.id)

    if (error) {
      throw error
    }

    const { count, error: countError } = await supabase
      .from('candidate_associations')
      .select('id', { count: 'exact', head: true })
      .eq('candidate_id', existing.candidate_id)

    if (countError) {
      throw countError
    }

    if (!count) {
      await supabase.from('candidates').delete().eq('id', existing.candidate_id)
      await deleteResumeFromStorage(existing.candidates?.resume_url)
    }

    return res.json({ message: 'Candidate association deleted' })
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
  listCandidates,
  getCandidate,
  createCandidate,
  updateCandidate,
  updateCandidateStatus,
  deleteCandidate,
  parseResumeRoute
}
