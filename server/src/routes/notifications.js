const express = require('express')
const controller = require('../controllers/notificationController')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')

const router = express.Router()

router.get('/', controller.listNotifications)
router.post('/cleanup-old', requireAdmin, controller.cleanupOldNotifications)
router.delete('/read', controller.clearReadNotifications)
router.patch('/:id/read', controller.markNotificationRead)

module.exports = router
