const multer = require('multer')
const { getDocumentFileMeta } = require('../services/documentFile')

const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    try {
      getDocumentFileMeta(file)
      return cb(null, true)
    } catch (error) {
      return cb(error)
    }
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

