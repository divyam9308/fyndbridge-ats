const express = require('express')
const controller = require('../controllers/clientController')

const router = express.Router()

router.get('/', controller.listClients)
router.post('/', controller.createClient)
router.get('/:id', controller.getClient)
router.patch('/:id', controller.updateClient)
router.delete('/:id', controller.deleteClient)

module.exports = router
