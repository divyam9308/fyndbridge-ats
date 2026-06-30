const express = require('express')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/performanceController')

const router = express.Router()

router.route('/permissions').get(controller.permissions).put(controller.permissions)
router.route('/handbook').get(controller.handbook).post(upload.single('handbook'), handleUploadErrors, controller.handbook)
router.get('/me', controller.me)
router.get('/:employeeUserId', controller.byEmployee)
router.put('/:employeeUserId', controller.save)

module.exports = router
