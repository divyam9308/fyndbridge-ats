const fs = require('fs/promises')
const path = require('path')
const multer = require('multer')

const MAX_PUBLIC_RESUME_BYTES = 1024 * 1024
const PDF_MIME_TYPE = 'application/pdf'
const PDF_SIGNATURE = Buffer.from('%PDF-')

function publicUploadError(message, code = 'INVALID_PUBLIC_RESUME') {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.publicSafe = true
  return error
}

function publicResumeFileFilter(req, file, callback) {
  const extension = path.extname(String(file.originalname || '')).toLowerCase()
  if (extension !== '.pdf' || file.mimetype !== PDF_MIME_TYPE) {
    return callback(publicUploadError('Resume must be a PDF file.'))
  }
  return callback(null, true)
}

const publicApplicationUpload = multer({
  dest: '/tmp',
  limits: {
    // Busboy emits its limit event when a file is exactly equal to fileSize.
    // One extra byte keeps exactly 1 MiB valid while still rejecting 1 MiB + 1.
    fileSize: MAX_PUBLIC_RESUME_BYTES + 1,
    files: 1,
    fields: 40
  },
  fileFilter: publicResumeFileFilter
})

async function cleanupPublicResume(file) {
  if (!file?.path) return
  try {
    await fs.unlink(file.path)
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('public resume cleanup:', error.message)
  }
}

async function hasPdfSignature(file) {
  if (!file?.path) return false
  const handle = await fs.open(file.path, 'r')
  try {
    const buffer = Buffer.alloc(PDF_SIGNATURE.length)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return bytesRead === PDF_SIGNATURE.length && buffer.equals(PDF_SIGNATURE)
  } finally {
    await handle.close()
  }
}

async function validatePublicResume(req, res, next) {
  try {
    if (!req.file) throw publicUploadError('Resume PDF is required.')
    if (!(await hasPdfSignature(req.file))) {
      throw publicUploadError('Resume must be a valid PDF file.')
    }
    return next()
  } catch (error) {
    await cleanupPublicResume(req.file)
    req.file = undefined
    return next(error)
  }
}

async function handlePublicUploadErrors(error, req, res, next) {
  if (!error) return next()
  await cleanupPublicResume(req.file)
  req.file = undefined
  if (error instanceof multer.MulterError || error.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Resume PDF must be 1 MB or smaller.' })
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Upload exactly one resume PDF.' })
    }
    return res.status(400).json({ error: 'Invalid resume upload.' })
  }
  if (error.statusCode === 400 || error.code === 'INVALID_PUBLIC_RESUME') {
    return res.status(400).json({ error: error.message })
  }
  return next(error)
}

module.exports = {
  MAX_PUBLIC_RESUME_BYTES,
  PDF_MIME_TYPE,
  PDF_SIGNATURE,
  publicApplicationUpload,
  publicResumeFileFilter,
  cleanupPublicResume,
  hasPdfSignature,
  validatePublicResume,
  handlePublicUploadErrors
}
