const express = require('express')
const controller = require('../controllers/invoiceController')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')

const router = express.Router()

router.use(requireAdmin)
router.get('/entities', controller.listEntities)
router.get('/entities/:id', controller.getEntity)
router.post('/entities', controller.createEntity)
router.put('/entities/:id', controller.updateEntity)
router.delete('/entities/:id', controller.deleteEntity)
router.get('/next-number', controller.nextNumber)
router.post('/preview', controller.preview)
router.post('/commit-preview', controller.commitPreview)
router.post('/generate', controller.generate)
router.post('/entities/:entityId/invoices/:id/cancel', controller.cancelInvoice)
router.get('/invoices/:id/reassignment-number', controller.reassignmentNumber)
router.post('/invoices/:id/regeneration-preview', controller.previewRegeneration)
router.put('/invoices/:id/regenerate', controller.regenerate)
router.delete('/invoice-pdf-versions/:id', controller.deletePdfVersion)

module.exports = router
