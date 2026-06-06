const express = require('express')
const controller = require('../controllers/jobController')

const router = express.Router()

router.get('/', controller.listJobs)
router.post('/', controller.createJob)
router.get('/:id', controller.getJob)
router.patch('/:id', controller.updateJob)
router.delete('/:id', controller.deleteJob)

module.exports = router
