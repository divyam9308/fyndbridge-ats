const fs = require('fs/promises')
const crypto = require('crypto')
const path = require('path')
const supabase = require('./supabaseAdmin')

const RESUME_BUCKET = 'resumes'

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeCvLink(value) {
  return cleanText(value)
}

function extensionForFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '')
  if (ext) return ext
  if (file.mimetype === 'application/pdf') return '.pdf'
  if (file.mimetype === 'application/msword') return '.doc'
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx'
  return '.bin'
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
    .select('id, cv_link, resume_url, cv_file_hash')
    .eq('cv_file_hash', hash)
    .limit(1)
    .maybeSingle()
  if (error) {
    if (/cv_file_hash/i.test(error.message || '')) return null
    throw error
  }
  return data
}

async function findByLink(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const { data, error } = await supabase
    .from('candidates')
    .select('id, cv_link, resume_url')
    .or(`cv_link.eq.${normalized},resume_url.eq.${normalized}`)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

function publicUrl(objectPath) {
  const { data } = supabase.storage.from(RESUME_BUCKET).getPublicUrl(objectPath)
  return data?.publicUrl || ''
}

async function prepareUploadedCv(file) {
  if (!file) return null
  const buffer = await fileBuffer(file)
  const hash = sha256(buffer)
  const existing = await findByHash(hash)
  if (existing?.resume_url || existing?.cv_link) {
    return {
      cv_link: existing.cv_link || existing.resume_url,
      resume_url: existing.resume_url || existing.cv_link,
      cv_file_hash: hash,
      duplicate: true
    }
  }

  const objectPath = `${hash}${extensionForFile(file)}`
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(objectPath, buffer, {
    contentType: file.mimetype,
    upsert: false
  })
  const storageDuplicate = Boolean(error && /already exists|duplicate/i.test(error.message || ''))
  if (error && !storageDuplicate) throw error
  const url = publicUrl(objectPath)
  return { cv_link: url, resume_url: url, cv_file_hash: hash, duplicate: storageDuplicate, resume_path: objectPath }
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
    cv_file_hash: hash
  }
}

async function checkLinkedCvDuplicate(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const existing = await findByLink(normalized)
  return {
    duplicate: Boolean(existing),
    cv_link: existing?.cv_link || existing?.resume_url || normalized,
    resume_url: existing?.resume_url || existing?.cv_link || normalized
  }
}

async function prepareLinkedCv(link) {
  const normalized = normalizeCvLink(link)
  if (!normalized) return null
  const existing = await findByLink(normalized)
  return {
    cv_link: existing?.cv_link || existing?.resume_url || normalized,
    resume_url: existing?.resume_url || existing?.cv_link || normalized,
    duplicate: Boolean(existing)
  }
}

module.exports = {
  RESUME_BUCKET,
  normalizeCvLink,
  prepareUploadedCv,
  prepareLinkedCv,
  checkUploadedCvDuplicate,
  checkLinkedCvDuplicate
}
