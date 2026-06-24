const express = require('express')
const { requireAdmin } = require('../middleware/adminAccessMiddleware')
const { lookupGstin } = require('../services/gstLookup')

const router = express.Router()

router.post('/lookup', requireAdmin, async (req, res) => {
  try {
    return res.json(await lookupGstin(req.body?.gstin))
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'GST lookup failed. You can enter details manually.', ...(err.fallback ? { fallback: err.fallback } : {}) })
  }
})

module.exports = router
