const express = require('express')
const controller = require('../controllers/consultantReportController')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')

const router = express.Router()

router.use(requirePageViewPermission('report'))
router.get('/consultant/options', controller.options)
router.get('/consultant/mandates', controller.mandates)
router.get('/consultant/conversions', controller.conversions)
router.get('/consultant', controller.report)

module.exports = router
