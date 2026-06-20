const express = require('express')
const controller = require('../controllers/adminController')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')

const router = express.Router()

router.get('/me', controller.me)
router.use(requireAdmin)
router.get('/users', controller.users)
router.post('/users', controller.addUser)
router.patch('/users/:email/role', controller.updateUserRole)
router.delete('/users/:email', controller.removeUser)
router.get('/column-permissions', controller.columnPermissions)
router.patch('/column-permissions', controller.updateColumnPermission)
router.get('/locked-records', controller.lockedRecords)
router.patch('/locks/:table/:id', controller.setLock)

module.exports = router
