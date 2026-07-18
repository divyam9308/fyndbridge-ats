const { normalizeStoragePath } = require('./storageBuckets')

function clean(value) {
  return String(value ?? '').trim()
}

function parseArray(value, fieldName = 'attachments') {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // The caller receives one consistent validation error below.
    }
  }
  const error = new Error(`${fieldName} must be a JSON array.`)
  error.statusCode = 400
  throw error
}

function fileNameFromPath(value) {
  const path = clean(value).split('?')[0]
  const name = path.split('/').pop() || 'document'
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function normalizedSize(value) {
  const size = Number(value)
  return Number.isFinite(size) && size >= 0 ? size : null
}

function normalizeExternalUrl(value) {
  const text = clean(value)
  if (!text || text.length > 2048) return ''
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const parsed = new URL(withProtocol)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return ''
    return parsed.href
  } catch {
    return ''
  }
}

function externalLinkName(path, index = 0) {
  try {
    const hostname = new URL(path).hostname.replace(/^www\./i, '')
    return hostname ? `JD link (${hostname})` : `JD link ${index + 1}`
  } catch {
    return `JD link ${index + 1}`
  }
}

function normalizeExternalAttachments(value, {
  fieldName = 'links',
  maxCount = 20
} = {}) {
  const input = parseArray(value, fieldName)
  if (input.length > maxCount) {
    const error = new Error(`No more than ${maxCount} links can be added at once.`)
    error.statusCode = 400
    throw error
  }
  return input.map((item, index) => {
    const rawPath = typeof item === 'object' && item !== null
      ? item.path || item.url
      : item
    const path = normalizeExternalUrl(rawPath)
    if (!path) {
      const error = new Error('Please enter a valid HTTP or HTTPS link.')
      error.statusCode = 400
      throw error
    }
    return {
      path,
      name: clean(typeof item === 'object' && item !== null ? item.name : '').slice(0, 200) || externalLinkName(path, index),
      mime_type: 'text/uri-list',
      size: null,
      uploaded_at: new Date().toISOString(),
      file_hash: ''
    }
  })
}

function normalizeAttachment(value, bucket) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rawPath = value.path || value.storage_path || value.storagePath || value.url
  const path = normalizeStoragePath(rawPath, bucket)
  if (!path || path === '-' || path.startsWith('/tmp/')) return null
  return {
    path,
    name: clean(value.name || value.file_name || value.fileName || value.original_name || value.originalName) || fileNameFromPath(path),
    mime_type: clean(value.mime_type || value.mimetype || value.content_type || value.contentType),
    size: normalizedSize(value.size ?? value.file_size ?? value.fileSize),
    uploaded_at: clean(value.uploaded_at || value.uploadedAt || value.created_at || value.createdAt),
    file_hash: clean(value.file_hash || value.fileHash || value.cv_file_hash)
  }
}

function legacyAttachment({ path, name, mimeType, size, uploadedAt, fileHash, bucket }) {
  return normalizeAttachment({
    path,
    name,
    mime_type: mimeType,
    size,
    uploaded_at: uploadedAt,
    file_hash: fileHash
  }, bucket)
}

function normalizeAttachments(value, { bucket, legacy } = {}) {
  const input = value === undefined || value === null || value === ''
    ? []
    : (Array.isArray(value) ? value : parseArray(value))
  const normalized = input.map(item => normalizeAttachment(item, bucket)).filter(Boolean)
  if (!normalized.length && legacy) {
    const fallback = legacyAttachment({ ...legacy, bucket })
    if (fallback) normalized.push(fallback)
  }
  const seen = new Set()
  return normalized.filter((attachment) => {
    if (seen.has(attachment.path)) return false
    seen.add(attachment.path)
    return true
  })
}

function uploadedAttachment(upload) {
  return normalizeAttachment({
    path: upload?.path,
    name: upload?.fileName || upload?.name,
    mime_type: upload?.contentType || upload?.mime_type,
    size: upload?.size,
    uploaded_at: upload?.uploadedAt || upload?.uploaded_at || new Date().toISOString()
  }, upload?.bucket)
}

function removalPlan(existingAttachments, rawRemovedPaths, bucket, fieldName = 'removed attachment paths') {
  const existing = normalizeAttachments(existingAttachments, { bucket })
  const requested = parseArray(rawRemovedPaths, fieldName)
    .map(value => normalizeStoragePath(typeof value === 'object' ? value?.path : value, bucket))
    .filter(Boolean)
  const requestedSet = new Set(requested)
  const existingPaths = new Set(existing.map(item => item.path))
  const unknownPath = requested.find(path => !existingPaths.has(path))
  if (unknownPath) {
    const error = new Error('An attachment selected for deletion does not belong to this record.')
    error.statusCode = 400
    throw error
  }
  return {
    retained: existing.filter(item => !requestedSet.has(item.path)),
    removed: existing.filter(item => requestedSet.has(item.path))
  }
}

function isStorageObjectPath(value) {
  const path = clean(value)
  return Boolean(path && !/^https?:\/\//i.test(path) && !path.startsWith('/tmp/'))
}

function storagePaths(attachments) {
  return [...new Set((attachments || []).map(item => item?.path).filter(isStorageObjectPath))]
}

module.exports = {
  fileNameFromPath,
  isStorageObjectPath,
  legacyAttachment,
  normalizeAttachment,
  normalizeAttachments,
  normalizeExternalAttachments,
  normalizeExternalUrl,
  parseArray,
  removalPlan,
  storagePaths,
  uploadedAttachment
}
