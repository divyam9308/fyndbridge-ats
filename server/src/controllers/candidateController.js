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

const WRITABLE_FIELDS = [
  'full_name',
  'email',
  'mobile_number',
  'city',
  'state',
  'current_designation',
  'experience_years',
  'current_salary',
  'expected_salary',
  'skills',
  'education',
  'client_id',
  'job_id',
  'status',
  'notes',
  'source',
  'resume_url'
]

function logAndSendInternal(res, routeName, err) {
  console.error(`${routeName}:`, err.message)
  return res.status(500).json({ error: 'Internal server error' })
}

function normalizeNullable(value) {
  return value === '' ? null : value
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

  if (body.email !== undefined && body.email !== null && body.email !== '' && !isValidEmail(body.email)) {
    errors.email = 'email must be a valid email address'
  }

  if (
    body.mobile_number !== undefined &&
    body.mobile_number !== null &&
    body.mobile_number !== '' &&
    !isValidMobile(body.mobile_number)
  ) {
    errors.mobile_number = 'mobile_number must be a valid Indian mobile number'
  }

  if (body.experience_years !== undefined && body.experience_years !== null) {
    const value = Number(body.experience_years)
    if (!Number.isFinite(value) || value < 0) {
      errors.experience_years = 'experience_years must be greater than or equal to 0'
    }
  }

  for (const field of ['current_salary', 'expected_salary']) {
    if (body[field] !== undefined && body[field] !== null) {
      const value = Number(body[field])
      if (!isPositiveInteger(value)) {
        errors[field] = `${field} must be a positive integer with at most 9 digits`
      }
    }
  }

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    errors.status = `status must be one of: ${VALID_STATUSES.join(', ')}`
  }

  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || body.skills.some((skill) => typeof skill !== 'string')) {
      errors.skills = 'skills must be an array of strings'
    }
  }

  return errors
}

function buildCandidatePayload(body) {
  const payload = {}

  for (const field of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeNullable(body[field])
    }
  }

  if (payload.full_name) {
    payload.full_name = payload.full_name.trim()
  }

  for (const field of ['experience_years', 'current_salary', 'expected_salary']) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = Number(payload[field])
    }
  }

  return payload
}

async function findDuplicate({ email, mobile_number }) {
  const clauses = []

  if (email) {
    clauses.push(`email.eq.${email}`)
  }

  if (mobile_number) {
    clauses.push(`mobile_number.eq.${mobile_number}`)
  }

  if (!clauses.length) {
    return null
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .or(clauses.join(','))
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

function flattenCandidate(row) {
  if (!row) {
    return row
  }

  return {
    ...row,
    client_name: row.clients?.client_name || null,
    client_phone_number: row.clients?.phone_number || null,
    job_title: row.jobs?.job_title || null
  }
}

async function listCandidates(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200)
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('candidates')
      .select('*, clients(client_name), jobs(job_title)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (req.query.job_id) {
      query = query.eq('job_id', req.query.job_id)
    }

    if (req.query.client_id) {
      query = query.eq('client_id', req.query.client_id)
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

    if (req.query.search) {
      const search = String(req.query.search).replace(/[%*,]/g, '').trim()
      if (search) {
        query = query.or(`full_name.ilike.*${search}*,email.ilike.*${search}*,mobile_number.ilike.*${search}*`)
      }
    }

    const { data, error, count } = await query.range(from, to)

    if (error) {
      throw error
    }

    return res.json({
      data: (data || []).map(flattenCandidate),
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
      .from('candidates')
      .select('*, clients(client_name, phone_number), jobs(job_title)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    return res.json(flattenCandidate(data))
  } catch (err) {
    return logAndSendInternal(res, 'getCandidate', err)
  }
}

async function createCandidate(req, res) {
  try {
    const body = {
      ...req.body,
      status: req.body.status || 'Interested',
      source: 'manual'
    }
    const errors = validateCandidatePayload(body)

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const payload = buildCandidatePayload(body)

    if (req.query.force !== 'true') {
      const duplicate = await findDuplicate({
        email: payload.email,
        mobile_number: payload.mobile_number
      })

      if (duplicate) {
        return res.status(409).json({
          warning: 'duplicate',
          message: 'A candidate with this email/mobile already exists',
          existing_id: duplicate.id
        })
      }
    }

    const { data, error } = await supabase
      .from('candidates')
      .insert({
        ...payload,
        source: 'manual',
        created_by: req.user.id
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return res.status(201).json(data)
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

    const payload = buildCandidatePayload(req.body)

    const { data: existing, error: lookupError } = await supabase
      .from('candidates')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!existing) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    const { data, error } = await supabase
      .from('candidates')
      .update({
        ...payload,
        updated_by: req.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) {
      throw error
    }

    return res.json(data)
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

    const updatedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('candidates')
      .update({
        status: req.body.status,
        updated_by: req.user.id,
        updated_at: updatedAt
      })
      .eq('id', req.params.id)
      .select('id, status, updated_at')
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate not found' })
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
  } catch (err) {
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
      .from('candidates')
      .select('id, resume_url')
      .eq('id', req.params.id)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!existing) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    const { error } = await supabase.from('candidates').delete().eq('id', req.params.id)

    if (error) {
      throw error
    }

    await deleteResumeFromStorage(existing.resume_url)

    return res.json({ message: 'Candidate deleted' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteCandidate', err)
  }
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (err) {
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
