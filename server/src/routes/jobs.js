const express = require('express')
const controller = require('../controllers/jobController')

const router = express.Router()

router.get('/', controller.listJobs)
router.get('/users/options', controller.listJobUsers)
router.get('/next-display-id', controller.getNextJobDisplayId)
router.post('/ai-filter', controller.buildJobFilters)
router.post('/', controller.createJob)
router.get('/:id', controller.getJob)
router.patch('/:id', controller.updateJob)
router.delete('/:id', controller.deleteJob)

module.exports = router
