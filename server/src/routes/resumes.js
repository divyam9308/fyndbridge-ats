const express = require('express')
const multer = require('multer')
const controller = require('../controllers/resumeController')

const router = express.Router()

const allowedTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])

const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) {
      const error = new Error('Only PDF, DOC, and DOCX files are accepted')
      error.statusCode = 400
      return cb(error)
    }

    return cb(null, true)
  }
})

function handleUploadErrors(err, req, res, next) {
  if (!err) return next()
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each resume must be 10MB or smaller' })
  if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Upload up to 10 resumes at once' })
  return res.status(err.statusCode || 400).json({ error: err.message || 'Upload failed' })
}

router.post('/bulk-parse', upload.array('resumes', 10), handleUploadErrors, controller.bulkParseResumes)
router.get('/open', controller.openResume)
router.get('/open/:encodedPath', controller.openResume)

module.exports = router
