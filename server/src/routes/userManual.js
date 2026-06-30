const express = require('express')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/userManualController')

const router = express.Router()

router.route('/').get(controller.manual).post(upload.single('manual'), handleUploadErrors, controller.manual)

module.exports = router
