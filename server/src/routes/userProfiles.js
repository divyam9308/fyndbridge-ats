const express = require('express')
const controller = require('../controllers/userProfileController')

const router = express.Router()

router.get('/', controller.getProfile)
router.post('/', controller.saveProfile)
router.get('/options', controller.listProfileOptions)

module.exports = router

