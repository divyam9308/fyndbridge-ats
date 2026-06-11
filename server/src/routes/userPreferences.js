const express = require('express')
const controller = require('../controllers/userPreferenceController')

const router = express.Router()

router.get('/:key', controller.getPreference)
router.put('/:key', controller.savePreference)

module.exports = router
