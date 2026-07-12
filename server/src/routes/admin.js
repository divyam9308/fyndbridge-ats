const express = require('express')
const controller = require('../controllers/adminController')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')

const router = express.Router()

router.get('/me', controller.me)
router.route('/dashboard-visibility').get(controller.dashboardVisibility).patch(controller.dashboardVisibility)
router.get('/column-permissions', controller.columnPermissions)
router.route('/page-view-permissions').get(controller.pageViewPermissions).patch(controller.pageViewPermissions)
router.use(requireAdmin)
router.get('/bootstrap', controller.bootstrap)
router.get('/users', controller.users)
router.get('/user-profiles', controller.userProfiles)
router.post('/users', controller.addUser)
router.patch('/users/:email/role', controller.updateUserRole)
router.delete('/users/:email', controller.removeUser)
router.patch('/column-permissions', controller.updateColumnPermission)
router.get('/locked-records', controller.lockedRecords)
router.patch('/locks/:table/:id', controller.setLock)

module.exports = router
