const express = require('express')
const controller = require('../controllers/publicRolesController')
const {
  publicApplicationUpload,
  validatePublicResume,
  handlePublicUploadErrors
} = require('../middleware/publicApplicationUpload')
const { requirePublicRateLimit } = require('../services/publicApplicationAbuse')

const router = express.Router()

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  return next()
})
router.get('/open-roles', controller.listOpenRoles)
router.get('/open-roles/:slug', controller.getOpenRole)
router.post(
  '/applications/parse-resume',
  requirePublicRateLimit('parse'),
  publicApplicationUpload.single('resume'),
  handlePublicUploadErrors,
  validatePublicResume,
  controller.parsePublicResume
)
router.post(
  '/applications',
  requirePublicRateLimit('submit'),
  publicApplicationUpload.single('resume'),
  handlePublicUploadErrors,
  validatePublicResume,
  controller.submitPublicApplication
)

router.use(controller.publicRouteErrorHandler)

module.exports = router
