const express = require('express')
const controller = require('../controllers/authController')

const router = express.Router()

router.get('/me', controller.me)
router.get('/employment-status', controller.employmentStatus)

module.exports = router
