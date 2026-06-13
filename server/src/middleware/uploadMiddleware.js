const multer = require('multer')

const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ])
    if (!allowedTypes.has(file.mimetype)) {
      const error = new Error('Only PDF, DOC, and DOCX files are accepted')
      error.statusCode = 400
      return cb(error)
    }

    return cb(null, true)
  }
})

function handleUploadErrors(err, req, res, next) {
  if (!err) {
    return next()
  }

  if (err.statusCode === 400) {
    return res.status(400).json({ error: err.message })
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'CV file must be 10MB or smaller' })
  }

  return res.status(400).json({ error: err.message || 'Upload failed' })
}

module.exports = {
  upload,
  handleUploadErrors
}
