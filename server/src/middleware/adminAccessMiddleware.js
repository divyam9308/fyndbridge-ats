const { isAdmin } = require('../services/adminAccess')

async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    if (!(await isAdmin(req.user))) return res.status(403).json({ error: 'Admin access required' })
    return next()
  } catch (err) {
    return next(err)
  }
}

module.exports = { requireAdmin }
