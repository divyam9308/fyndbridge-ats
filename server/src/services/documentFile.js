const path = require('path')

const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const EXTENSION_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXTENSION).map(([extension, mime]) => [mime, extension])
)

function clean(value) {
  return String(value || '').trim()
}

function extensionFromName(name) {
  const ext = path.extname(clean(name)).toLowerCase().replace(/^\./, '')
  return MIME_BY_EXTENSION[ext] ? ext : ''
}

function extensionFromMime(mime) {
  return EXTENSION_BY_MIME[clean(mime).toLowerCase()] || ''
}

function getDocumentFileMeta(file) {
  const originalName = clean(file?.originalname || file?.name)
  const extension = extensionFromName(originalName) || extensionFromMime(file?.mimetype || file?.type)
  if (!extension) {
    const error = new Error('Only PDF, DOC, and DOCX files are accepted')
    error.statusCode = 400
    throw error
  }
  return {
    originalName: originalName || `document.${extension}`,
    extension,
    contentType: MIME_BY_EXTENSION[extension],
    fileName: path.basename(originalName || `document.${extension}`)
  }
}

function pathExtension(value) {
  return extensionFromName(clean(value).split('?')[0])
}

function extensionMatchesPath(value, extension) {
  return pathExtension(value) === extension
}

module.exports = {
  MIME_BY_EXTENSION,
  getDocumentFileMeta,
  pathExtension,
  extensionMatchesPath
}
