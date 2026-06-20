const { v4: uuidv4 } = require('uuid')
const { parseResume } = require('../services/resumeParser')
const supabase = require('../services/supabaseAdmin')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { RESUME_BUCKET, checkUploadedCvDuplicate, normalizeResumeStoragePath } = require('../services/cvStorage')
const { MIME_BY_EXTENSION, pathExtension } = require('../services/documentFile')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isTempResumePath(value) {
  const filePath = String(value || '').trim()
  if (!filePath) return false
  const resolved = path.resolve(filePath)
  return [path.resolve('/tmp'), path.resolve(os.tmpdir())].some((tmpRoot) => resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`))
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
    cv_link: storage.resume_url || '',
    cv_file_hash: storage.cv_file_hash || '',
    cv_storage_path: storage.cv_storage_path || storage.resume_path || '',
    cv_original_name: file.originalname || '',
    cv_mimetype: file.mimetype || '',
    cv_duplicate: Boolean(storage.cv_duplicate),
    warnings,
    error
  }
}

async function parseOne(file) {
  let storage = { resume_path: file.path, resume_url: '', cv_file_hash: '', cv_storage_path: file.path, cv_duplicate: false }
  const warnings = []

  try {
    const duplicate = await checkUploadedCvDuplicate(file)
    storage = {
      resume_path: file.path,
      resume_url: duplicate?.resume_url || duplicate?.cv_link || '',
      cv_file_hash: duplicate?.cv_file_hash || '',
      cv_storage_path: file.path,
      cv_duplicate: Boolean(duplicate?.duplicate)
    }
  } catch (err) {
    console.error('checkUploadedCvDuplicate:', err.message)
    warnings.push('Resume duplicate check could not be completed')
  }

  try {
    const parsed = await parseResume(file.path)
    return rowFromParsed(file, parsed, null, storage, warnings)
  } catch (err) {
    return rowFromParsed(file, null, err.message || 'Unable to parse resume', storage, warnings)
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
    const rawPath = req.query.path || req.params.encodedPath || ''
    const storagePath = normalizeResumeStoragePath(decodeURIComponent(rawPath))
    console.log('[CV open] storage path', { path: storagePath })

    if (!storagePath) {
      return res.status(400).json({ error: 'Resume path is required' })
    }

    const extension = pathExtension(storagePath)
    const fileName = storagePath.split('/').pop() || `resume.${extension || 'pdf'}`
    const contentType = MIME_BY_EXTENSION[extension] || 'application/octet-stream'
    const disposition = extension === 'pdf' ? 'inline' : 'attachment'
    const options = disposition === 'attachment' ? { download: fileName } : undefined
    const { data, error } = await supabase.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(storagePath, 60 * 60, options)
    console.log('[CV open] signed URL creation result', { ok: Boolean(data?.signedUrl), error: error?.message || '' })
    if (error || !data?.signedUrl) {
      const slash = storagePath.lastIndexOf('/')
      const folder = slash === -1 ? '' : storagePath.slice(0, slash)
      const name = slash === -1 ? storagePath : storagePath.slice(slash + 1)
      const listed = await supabase.storage.from(RESUME_BUCKET).list(folder, { search: name, limit: 1 })
      const exists = !listed.error && (listed.data || []).some((item) => item.name === name)
      if (!exists) return res.status(404).json({ error: 'Document file not found. Please re-upload the CV.', path: storagePath })
      return res.status(404).json({ error: error?.message || 'Resume file could not be opened', path: storagePath })
    }

    return res.json({ url: data.signedUrl, fileName, contentType, disposition, path: storagePath })
  } catch (err) {
    console.error('openResume:', err.message)
    return res.status(500).json({ error: 'Resume file could not be opened' })
  }
}

async function discardTempResumes(req, res) {
  try {
    const values = Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.path]
    const paths = values
      .map((value) => String(value || '').trim())
      .filter(isTempResumePath)

    await Promise.all(paths.map(async (filePath) => {
      try {
        await fs.unlink(filePath)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }))

    return res.json({ deleted: paths.length })
  } catch (err) {
    console.error('discardTempResumes:', err.message)
    return res.status(500).json({ error: 'Could not discard temporary resumes' })
  }
}

module.exports = {
  bulkParseResumes,
  openResume,
  discardTempResumes
}

