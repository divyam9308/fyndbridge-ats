const { getEmployeeStatus } = require('../services/employeeStatus')

async function requireAuth(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const employment = await getEmployeeStatus(req.user.id)
    if (employment?.status === 'inactive' && !req.originalUrl.startsWith('/api/presence/offline')) {
      return res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account has been deactivated.',
        error: 'Your account has been deactivated.'
      })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

module.exports = requireAuth
