const fs = require('fs/promises')
const { v4: uuidv4 } = require('uuid')
const { parseResume } = require('../services/resumeParser')
const supabase = require('../services/supabaseAdmin')
const { RESUME_BUCKET, prepareUploadedCv } = require('../services/cvStorage')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

async function uploadResumeToStorage(file) {
  const cv = await prepareUploadedCv(file)
  return {
    resume_path: cv?.resume_path || '',
    resume_url: cv?.resume_url || cv?.cv_link || '',
    cv_file_hash: cv?.cv_file_hash || '',
    cv_duplicate: Boolean(cv?.duplicate)
  }
}

function rowFromParsed(file, parsed, error = null, storage = {}, warnings = []) {
  const extracted = parsed?.extracted || {}
  const ai = parsed?.ai_extracted || {}

  return {
    temp_id: uuidv4(),
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
    cv_file_hash: storage.cv_file_hash || '',
    cv_duplicate: Boolean(storage.cv_duplicate),
    warnings,
    error
  }
}

async function parseOne(file) {
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
    return rowFromParsed(file, parsed, null, storage, warnings)
  } catch (err) {
    return rowFromParsed(file, null, err.message || 'Unable to parse resume', storage, warnings)
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
