const express = require('express')
const controller = require('../controllers/presenceController')

const router = express.Router()

router.get('/', controller.listPresence)
router.post('/heartbeat', controller.heartbeat)
router.post('/offline', controller.offline)

module.exports = router
