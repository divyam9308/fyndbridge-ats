const fs = require('fs/promises')
const crypto = require('crypto')
const supabase = require('./supabaseAdmin')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')
const { getDocumentFileMeta, extensionMatchesPath } = require('./documentFile')

const RESUME_BUCKET = STORAGE_BUCKETS.CV

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeCvLink(value) {
  return cleanText(value)
}

function normalizeResumeStoragePath(value) {
  return normalizeStoragePath(value, RESUME_BUCKET)
}

async function fileBuffer(file) {
  return file.buffer || fs.readFile(file.path)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function findByHash(hash) {
  if (!hash) return null
  const { data, error } = await supabase
    .from('candidates')
    .select('id, cv_link, resume_url, cv_file_hash, cv_storage_path')
    .eq('cv_file_hash', hash)
    .limit(1)
    .maybeSingle()
  if (error) {
    if (/cv_file_hash|cv_storage_path/i.test(error.message || '')) return null
    throw error
  }
  return data
}

async function findByLink(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const { data, error } = await supabase
    .from('candidates')
    .select('id, cv_link, resume_url, cv_storage_path')
    .or(`cv_link.eq.${normalized},resume_url.eq.${normalized}`)
    .limit(1)
    .maybeSingle()
  if (error) {
    if (/cv_storage_path/i.test(error.message || '')) {
      const fallback = await supabase
        .from('candidates')
        .select('id, cv_link, resume_url')
        .or(`cv_link.eq.${normalized},resume_url.eq.${normalized}`)
        .limit(1)
        .maybeSingle()
      if (fallback.error) throw fallback.error
      return fallback.data
    }
    throw error
  }
  return data
}

function publicUrl(objectPath) {
  const { data } = supabase.storage.from(RESUME_BUCKET).getPublicUrl(objectPath)
  return data?.publicUrl || ''
}

async function storageObjectExists(bucket, objectPath) {
  const cleanPath = normalizeStoragePath(objectPath, bucket)
  if (!cleanPath) return false
  const slash = cleanPath.lastIndexOf('/')
  const folder = slash === -1 ? '' : cleanPath.slice(0, slash)
  const name = slash === -1 ? cleanPath : cleanPath.slice(slash + 1)
  const { data, error } = await supabase.storage.from(bucket).list(folder, { search: name, limit: 1 })
  if (error) return false
  return (data || []).some((item) => item.name === name)
}

async function prepareUploadedCv(file) {
  if (!file) return null
  const meta = getDocumentFileMeta(file)
  const buffer = await fileBuffer(file)
  const hash = sha256(buffer)
  const existing = await findByHash(hash)
  const existingPath = normalizeResumeStoragePath(existing?.cv_storage_path || existing?.resume_url || existing?.cv_link || '')
  const canReuseExisting = existingPath &&
    extensionMatchesPath(existingPath, meta.extension) &&
    await storageObjectExists(RESUME_BUCKET, existingPath)
  if (canReuseExisting) {
    return {
      cv_link: existing.cv_link || existing.resume_url || '',
      resume_url: existing.resume_url || existing.cv_link || '',
      cv_file_hash: hash,
      cv_storage_path: existingPath,
      cv_original_name: meta.originalName,
      cv_mimetype: meta.contentType,
      duplicate: true
    }
  }

  const objectPath = `${hash}.${meta.extension}`
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(objectPath, buffer, {
    contentType: meta.contentType,
    upsert: false
  })
  const storageDuplicate = Boolean(error && /already exists|duplicate/i.test(error.message || ''))
  if (error && !storageDuplicate) throw error
  const url = publicUrl(objectPath)
  return {
    cv_link: url,
    resume_url: url,
    cv_file_hash: hash,
    cv_storage_path: normalizeResumeStoragePath(objectPath),
    cv_original_name: meta.originalName,
    cv_mimetype: meta.contentType,
    duplicate: storageDuplicate,
    resume_path: normalizeResumeStoragePath(objectPath)
  }
}

async function checkUploadedCvDuplicate(file) {
  if (!file) return null
  const buffer = await fileBuffer(file)
  const hash = sha256(buffer)
  const existing = await findByHash(hash)
  return {
    duplicate: Boolean(existing),
    cv_link: existing?.cv_link || existing?.resume_url || '',
    resume_url: existing?.resume_url || existing?.cv_link || '',
    cv_file_hash: hash,
    cv_storage_path: normalizeResumeStoragePath(existing?.cv_storage_path || '')
  }
}

async function checkLinkedCvDuplicate(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const existing = await findByLink(normalized)
  return {
    duplicate: Boolean(existing),
    cv_link: existing?.cv_link || existing?.resume_url || normalized,
    resume_url: existing?.resume_url || existing?.cv_link || normalized,
    cv_storage_path: normalizeResumeStoragePath(existing?.cv_storage_path || '')
  }
}

async function prepareLinkedCv(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const existing = await findByLink(normalized)
  return {
    cv_link: existing?.cv_link || existing?.resume_url || normalized,
    resume_url: existing?.resume_url || existing?.cv_link || normalized,
    cv_storage_path: normalizeResumeStoragePath(existing?.cv_storage_path || ''),
    duplicate: Boolean(existing)
  }
}

module.exports = {
  RESUME_BUCKET,
  normalizeCvLink,
  normalizeResumeStoragePath,
  prepareUploadedCv,
  prepareLinkedCv,
  checkUploadedCvDuplicate,
  checkLinkedCvDuplicate,
  storageObjectExists
}

