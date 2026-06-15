function requireAuth(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  return next()
}

module.exports = requireAuth

