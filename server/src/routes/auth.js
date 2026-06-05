const express = require('express')
const controller = require('../controllers/authController')

const router = express.Router()

router.get('/me', controller.me)

module.exports = router
