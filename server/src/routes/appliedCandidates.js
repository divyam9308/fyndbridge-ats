const express = require('express')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')
const controller = require('../controllers/appliedCandidatesController')

const router = express.Router()

router.use(requirePageViewPermission('applied_candidates'))
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store')
  return next()
})
router.param('id', (req, res, next, id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(404).json({ error: 'Application not found.' })
  }
  return next()
})
router.get('/', controller.listAppliedCandidates)
router.get('/count', controller.countAppliedCandidates)
router.get('/:id', controller.getAppliedCandidate)
router.get('/:id/cv', controller.getAppliedCandidateCv)
router.post('/:id/convert', controller.convertAppliedCandidate)
router.patch('/:id/status', controller.updateAppliedCandidateStatus)
router.patch('/:id/rejection', controller.rejectAppliedCandidate)

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  console.error('applied candidates route:', error?.message || error)
  return res.status(500).json({ error: 'Internal server error' })
})

module.exports = router
