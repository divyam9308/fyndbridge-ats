const express = require('express')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/candidateController')

const router = express.Router()

router.post('/parse-resume', upload.single('resume'), handleUploadErrors, controller.parseResumeRoute)
router.post('/ai-filter', controller.buildAiCandidateFilters)

router.get('/', controller.listCandidates)
router.post('/', controller.createCandidate)
router.get('/:id', controller.getCandidate)
router.patch('/:id/status', controller.updateCandidateStatus)
router.patch('/:id', controller.updateCandidate)
router.delete('/:id', controller.deleteCandidate)

module.exports = router
