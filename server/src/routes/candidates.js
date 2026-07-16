const express = require('express')
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware')
const controller = require('../controllers/candidateController')

const router = express.Router()

router.post('/parse-resume', upload.single('resume'), handleUploadErrors, controller.parseResumeRoute)
router.post('/ai-filter', controller.buildAiCandidateFilters)

router.get('/check-duplicate', controller.checkCandidateDuplicate)
router.post('/check-cv-duplicate', upload.single('cv_file'), handleUploadErrors, controller.checkCvDuplicate)
router.get('/next-display-id', controller.getNextCandidateDisplayId)
router.get('/', controller.listCandidates)
const candidateCvUpload = upload.fields([
  { name: 'cv_file', maxCount: 1 },
  { name: 'cv_files', maxCount: 20 }
])

router.post('/', candidateCvUpload, handleUploadErrors, controller.createCandidate)
router.get('/by-candidate/:candidateId/associations', controller.listCandidateAssociations)
router.get('/:id', controller.getCandidate)
router.patch('/:id/status', controller.updateCandidateStatus)
router.patch('/:id', candidateCvUpload, handleUploadErrors, controller.updateCandidate)
router.delete('/:id', controller.deleteCandidate)

module.exports = router
