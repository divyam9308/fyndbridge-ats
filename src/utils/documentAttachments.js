const clean = (value) => String(value ?? '').trim()

export const fileNameFromPath = (value) => {
  const path = clean(value).split('?')[0]
  const name = path.split('/').pop() || 'Document'
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

export const normalizeAttachment = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const path = clean(value.path || value.storage_path || value.storagePath || value.url)
  if (!path || path === '-' || path.startsWith('/tmp/')) return null
  const size = Number(value.size ?? value.file_size ?? value.fileSize)
  return {
    path,
    name: clean(value.name || value.file_name || value.fileName || value.original_name || value.originalName) || fileNameFromPath(path),
    mime_type: clean(value.mime_type || value.mimetype || value.content_type || value.contentType),
    size: Number.isFinite(size) && size >= 0 ? size : null,
    uploaded_at: clean(value.uploaded_at || value.uploadedAt || value.created_at || value.createdAt),
    file_hash: clean(value.file_hash || value.fileHash || value.cv_file_hash)
  }
}

export const normalizeAttachments = (value, legacy = null) => {
  let input = value
  if (typeof value === 'string') {
    try { input = JSON.parse(value) } catch { input = [] }
  }
  const attachments = (Array.isArray(input) ? input : []).map(normalizeAttachment).filter(Boolean)
  if (!attachments.length && legacy) {
    const fallback = normalizeAttachment(legacy)
    if (fallback) attachments.push(fallback)
  }
  const seen = new Set()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.path)) return false
    seen.add(attachment.path)
    return true
  })
}

export const formatFileSize = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const pendingFileKey = (file, index = 0) => (
  `${file?.name || 'file'}-${file?.size || 0}-${file?.lastModified || 0}-${index}`
)

export const isExternalAttachment = (attachment) => /^https?:\/\//i.test(clean(attachment?.path))

export const validateDocumentSelection = (fileList, {
  allowedExtensions = ['pdf', 'doc', 'docx'],
  maxSize = 10 * 1024 * 1024,
  label = 'Document'
} = {}) => {
  const accepted = []
  const errors = []
  for (const file of Array.from(fileList || [])) {
    const extension = clean(file.name).split('.').pop().toLowerCase()
    if (!allowedExtensions.includes(extension)) {
      errors.push(`${file.name}: ${label} must be ${allowedExtensions.map(item => item.toUpperCase()).join(', ')}.`)
      continue
    }
    if (file.size > maxSize) {
      errors.push(`${file.name}: ${label} must be ${Math.round(maxSize / (1024 * 1024))} MB or smaller.`)
      continue
    }
    accepted.push(file)
  }
  return { accepted, errors }
}
