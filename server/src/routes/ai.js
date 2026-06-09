const express = require('express')
const { getAiStatus } = require('../services/aiProvider')

const router = express.Router()

router.get('/status', (req, res) => {
  res.json(getAiStatus())
})

module.exports = router
