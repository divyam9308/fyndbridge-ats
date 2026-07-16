const express = require('express')
const controller = require('../controllers/clientController')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')

const router = express.Router()

router.get('/check-duplicate', controller.checkClientDuplicate)
router.get('/next-display-id', controller.getNextClientDisplayId)
router.post('/ai-filter', controller.buildClientFilters)
router.post('/contract-uploads', requirePageViewPermission('clients'), controller.prepareContractUploads)
router.delete('/contract-uploads', requirePageViewPermission('clients'), controller.discardContractUploads)
router.get('/', controller.listClients)
router.post('/', controller.createClient)
router.post('/:id/follow-ups', controller.addFollowUp)
router.patch('/:id/follow-ups/:followUpId', controller.updateFollowUp)
router.delete('/:id/follow-ups/:followUpId', controller.deleteFollowUp)
router.get('/:id', controller.getClient)
router.patch('/:id', controller.updateClient)
router.delete('/:id', controller.deleteClient)

module.exports = router
