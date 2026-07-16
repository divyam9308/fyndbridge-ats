const express = require('express')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/jobController')

const router = express.Router()

router.get('/', controller.listJobs)
router.get('/users/options', controller.listJobUsers)
router.get('/next-display-id', controller.getNextJobDisplayId)
router.post('/ai-filter', controller.buildJobFilters)
const jdUpload = upload.fields([
  { name: 'jd_file', maxCount: 1 },
  { name: 'jd_files', maxCount: 20 }
])

router.post('/', jdUpload, handleUploadErrors, controller.createJob)
router.get('/:id', controller.getJob)
router.patch('/:id', jdUpload, handleUploadErrors, controller.updateJob)
router.delete('/:id', controller.deleteJob)

module.exports = router
