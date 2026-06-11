const fs = require('fs/promises')
const { v4: uuidv4 } = require('uuid')
const { parseResume } = require('../services/resumeParser')
const supabase = require('../services/supabaseAdmin')

const RESUME_BUCKET = 'resumes'

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function safeFileName(value) {
  return cleanText(value)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'resume'
}

async function uploadResumeToStorage(file) {
  const fileBuffer = file.buffer || await fs.readFile(file.path)
  const resumePath = `${Date.now()}-${uuidv4()}-${safeFileName(file.originalname)}`

  // Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env.
  // Bucket name must be "resumes".
  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(resumePath, fileBuffer, {
      contentType: file.mimetype,
      upsert: false
    })

  if (uploadError) {
    throw uploadError
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(resumePath, 60 * 60)

  if (!signedError && signedData?.signedUrl) {
    return {
      resume_path: resumePath,
      resume_url: signedData.signedUrl
    }
  }

  const { data: publicData } = supabase.storage
    .from(RESUME_BUCKET)
    .getPublicUrl(resumePath)

  return {
    resume_path: resumePath,
    resume_url: publicData?.publicUrl || ''
  }
}

function rowFromParsed(file, index, parsed, error = null, storage = {}, warnings = []) {
  const extracted = parsed?.extracted || {}
  const ai = parsed?.ai_extracted || {}

  return {
    temp_id: uuidv4(),
    serial_no: index + 1,
    file_name: file.originalname,
    candidate_name: cleanText(ai.name || extracted.full_name?.value),
    phone_number: cleanText(ai.mobile || extracted.mobile_number?.value),
    email: cleanText(ai.email || extracted.email?.value),
    current_designation: cleanText(ai.currentDesignation || extracted.current_designation?.value),
    current_organization: cleanText(ai.currentOrganisation || extracted.current_organisation?.value || extracted.current_company?.value),
    experience_years: Number.isFinite(Number(ai.experience ?? extracted.experience_years?.value))
      ? Number(ai.experience ?? extracted.experience_years?.value)
      : null,
    city: cleanText(ai.city || extracted.city?.value),
    state: cleanText(ai.state || extracted.state?.value),
    location: cleanText(ai.location || extracted.location?.value),
    skills: Array.isArray(ai.skills) && ai.skills.length ? ai.skills : (Array.isArray(extracted.skills?.value) ? extracted.skills.value : []),
    education: cleanText(ai.education || extracted.education?.value),
    salary: ai.salary ?? extracted.salary?.value ?? null,
    linkedin_url: cleanText(ai.linkedin || extracted.linkedin_url?.value),
    summary: cleanText(ai.summary || extracted.cover_letter?.value),
    resume_path: storage.resume_path || '',
    resume_url: storage.resume_url || '',
    warnings,
    error
  }
}

async function parseOne(file, index) {
  let storage = { resume_path: '', resume_url: '' }
  const warnings = []

  try {
    storage = await uploadResumeToStorage(file)
  } catch (err) {
    console.error('uploadResumeToStorage:', err.message)
    warnings.push('Resume file could not be uploaded to storage')
  }

  try {
    const parsed = await parseResume(file.path)
    return rowFromParsed(file, index, parsed, null, storage, warnings)
  } catch (err) {
    return rowFromParsed(file, index, null, err.message || 'Unable to parse resume', storage, warnings)
  } finally {
    try {
      await fs.unlink(file.path)
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('bulkParse cleanup:', err.message)
    }
  }
}

async function runLimited(items, limit, handler) {
  const results = new Array(items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await handler(items[index], index)
      }
    })
  )

  return results
}

async function bulkParseResumes(req, res) {
  try {
    const files = req.files || []

    if (!files.length) {
      return res.status(400).json({ error: 'Upload at least one resume.' })
    }

    const rows = await runLimited(files, 2, parseOne)

    return res.json({
      total: rows.length,
      rows
    })
  } catch (err) {
    console.error('bulkParseResumes:', err.message)
    return res.status(500).json({ error: 'Bulk resume parsing failed' })
  }
}

async function openResume(req, res) {
  try {
    const storagePath = decodeURIComponent(req.params.encodedPath || '')

    if (!storagePath) {
      return res.status(400).json({ error: 'Resume path is required' })
    }

    const { data, error } = await supabase.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(storagePath, 60 * 60)

    if (error || !data?.signedUrl) {
      return res.status(404).json({ error: 'Resume file could not be opened' })
    }

    return res.redirect(data.signedUrl)
  } catch (err) {
    console.error('openResume:', err.message)
    return res.status(500).json({ error: 'Resume file could not be opened' })
  }
}

module.exports = {
  bulkParseResumes,
  openResume
}
