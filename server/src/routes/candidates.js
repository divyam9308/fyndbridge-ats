const express = require('express')
const authMiddleware = require('../middleware/authMiddleware')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/candidateController')

const router = express.Router()

router.use(authMiddleware)

router.get('/', controller.listCandidates)
router.post('/', controller.createCandidate)
router.post('/parse-resume', upload.single('resume'), handleUploadErrors, controller.parseResumeRoute)
router.get('/:id', controller.getCandidate)
router.patch('/:id', controller.updateCandidate)
router.patch('/:id/status', controller.updateCandidateStatus)
router.delete('/:id', controller.deleteCandidate)

module.exports = router
