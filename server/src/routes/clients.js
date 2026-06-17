const express = require('express')
const multer = require('multer')
const controller = require('../controllers/clientController')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.get('/check-duplicate', controller.checkClientDuplicate)
router.get('/next-display-id', controller.getNextClientDisplayId)
router.post('/ai-filter', controller.buildClientFilters)
router.get('/', controller.listClients)
router.post('/', upload.single('contract_document_file'), controller.createClient)
router.post('/:id/follow-ups', controller.addFollowUp)
router.patch('/:id/follow-ups/:followUpId', controller.updateFollowUp)
router.delete('/:id/follow-ups/:followUpId', controller.deleteFollowUp)
router.get('/:id', controller.getClient)
router.patch('/:id', upload.single('contract_document_file'), controller.updateClient)
router.delete('/:id', controller.deleteClient)

module.exports = router

