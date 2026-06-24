const express = require('express')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')
const { lookupGstin } = require('../services/gstLookup')

const router = express.Router()

router.post('/lookup', requireAdmin, async (req, res) => {
  try {
    return res.json(await lookupGstin(req.body?.gstin))
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'GST lookup failed. You can enter details manually.' })
  }
})

module.exports = router
