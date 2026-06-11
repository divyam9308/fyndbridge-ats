const express = require('express')
const multer = require('multer')
const controller = require('../controllers/clientController')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.get('/check-duplicate', controller.checkClientDuplicate)
router.get('/', controller.listClients)
router.post('/', upload.single('contract_document_file'), controller.createClient)
router.get('/:id', controller.getClient)
router.patch('/:id', upload.single('contract_document_file'), controller.updateClient)
router.post('/:id/follow-ups', controller.addFollowUp)
router.delete('/:id', controller.deleteClient)

module.exports = router
