const express = require('express')
const controller = require('../controllers/cvController')

const router = express.Router()

router.get('/', controller.listCvs)
router.post('/', controller.saveCvs)
router.patch('/:id/imported', controller.markCvImported)
router.patch('/:id', controller.updateCv)

module.exports = router
