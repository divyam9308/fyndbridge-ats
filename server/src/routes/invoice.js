const express = require('express')
const controller = require('../controllers/invoiceController')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')

const router = express.Router()

router.use(requireAdmin)
router.get('/entities', controller.listEntities)
router.post('/entities', controller.createEntity)
router.put('/entities/:id', controller.updateEntity)
router.delete('/entities/:id', controller.deleteEntity)
router.get('/next-number', controller.nextNumber)
router.post('/preview', controller.preview)
router.post('/commit-preview', controller.commitPreview)
router.post('/generate', controller.generate)

module.exports = router
