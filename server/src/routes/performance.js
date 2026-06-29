const express = require('express')
const controller = require('../controllers/performanceController')

const router = express.Router()

router.route('/permissions').get(controller.permissions).put(controller.permissions)
router.get('/me', controller.me)
router.get('/:employeeUserId', controller.byEmployee)
router.put('/:employeeUserId', controller.save)

module.exports = router
