const express = require('express')
const controller = require('../controllers/documentController')

const router = express.Router()

router.get('/open/:type', controller.openDocument)

module.exports = router
