const fs = require('fs/promises')
const pdfParse = require('pdf-parse')
const supabase = require('./supabaseAdmin')
const { uploadDocument } = require('./documentStorage')
const { pathExtension } = require('./documentFile')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')
const { isSuperAdmin } = require('./adminAccess')

const USER_MANUAL_KEY = 'user_manual'
const USER_MANUAL_FOLDER = 'current'

function serializeManual(value) {
  const row = value && typeof value === 'object' ? value : {}
  return {
    path: normalizeStoragePath(row.path || '', STORAGE_BUCKETS.USER_MANUAL),
    fileName: String(row.fileName || row.file_name || 'User Manual.pdf').trim(),
    updatedAt: row.updatedAt || row.updated_at || '',
    sections: Array.isArray(row.sections) ? row.sections : []
  }
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function looksLikePageNumber(line) {
  return /^\d{1,3}$/.test(line) || /^page\s+\d{1,3}$/i.test(line)
}

function isAllCaps(line) {
  const letters = line.replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && line === line.toUpperCase()
}

function isHeading(line, index) {
  if (!line || line.length > 90) return false
  if (looksLikePageNumber(line)) return false
  if (/^\d+(\.\d+)*\s+/.test(line)) return true
  if (/^[A-Z][A-Za-z/&(), -]{1,80}:$/.test(line)) return true
  if (isAllCaps(line)) return true
  return index === 0
}

function extractSections(text) {
  const rawLines = normalizeText(text).split('\n')
  const lines = rawLines.map(line => line.trim()).filter(Boolean).filter(line => !looksLikePageNumber(line))
  const sections = []
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const content = paragraph.join(' ').replace(/\s{2,}/g, ' ').trim()
    if (content) sections.push({ type: 'paragraph', content })
    paragraph = []
  }

  lines.forEach((line, index) => {
    if (/^[\u2022\-]\s+/.test(line)) {
      flushParagraph()
      sections.push({ type: 'bullet', content: line.replace(/^[\u2022\-]\s+/, '').trim() })
      return
    }
    if (isHeading(line, index)) {
      flushParagraph()
      sections.push({ type: index === 0 ? 'title' : 'heading', content: line })
      return
    }
    if (line.length <= 50 && /:$/.test(line)) {
      flushParagraph()
      sections.push({ type: 'subheading', content: line })
      return
    }
    paragraph.push(line)
  })

  flushParagraph()
  return sections
}

async function readUploadBuffer(file) {
  if (file?.buffer) return file.buffer
  if (file?.path) return fs.readFile(file.path)
  return Buffer.from([])
}

async function getUserManual() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', USER_MANUAL_KEY)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return serializeManual(data?.value)
}

async function updateUserManual(user, file) {
  if (!await isSuperAdmin(user)) {
    const err = new Error('Super Admin required')
    err.statusCode = 403
    throw err
  }
  if (!file) {
    const err = new Error('User manual PDF is required')
    err.statusCode = 400
    throw err
  }
  if (pathExtension(file.originalname) !== 'pdf' || file.mimetype !== 'application/pdf') {
    const err = new Error('Only PDF files are accepted for the user manual')
    err.statusCode = 400
    throw err
  }

  const buffer = await readUploadBuffer(file)
  const parsed = await pdfParse(buffer)
  const sections = extractSections(parsed.text)
  const uploaded = await uploadDocument(file, STORAGE_BUCKETS.USER_MANUAL, USER_MANUAL_FOLDER)
  const value = {
    path: uploaded.path,
    fileName: uploaded.fileName || 'User Manual.pdf',
    updatedAt: new Date().toISOString(),
    sections
  }

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: USER_MANUAL_KEY, value, updated_at: value.updatedAt })

  if (error) throw error
  return serializeManual(value)
}

module.exports = { getUserManual, updateUserManual }
