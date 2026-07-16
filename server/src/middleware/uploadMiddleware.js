const multer = require('multer')
const { getDocumentFileMeta } = require('../services/documentFile')

const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20
  },
  fileFilter: (req, file, cb) => {
    req.uploadFileNames = [...(req.uploadFileNames || []), file.originalname]
    try {
      getDocumentFileMeta(file)
      return cb(null, true)
    } catch (error) {
      const namedError = new Error(`${file.originalname}: ${error.message}`)
      namedError.statusCode = error.statusCode
      return cb(namedError)
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
    const fileName = req.uploadFileNames?.at(-1) || 'File'
    return res.status(400).json({ error: `${fileName}: File must be 10 MB or smaller.` })
  }

  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Select up to 20 document files at once.' })
  }

  return res.status(400).json({ error: err.message || 'Upload failed' })
}

module.exports = {
  upload,
  handleUploadErrors
}
