const { getPageViewPermission, isAdmin, isSuperAdmin } = require('../services/adminAccess')
const { allowsPageView } = require('../services/pageViewPermissionPolicy')

function requirePageViewPermission(pageKey, dependencies = {}) {
  const readPermission = dependencies.getPageViewPermission || getPageViewPermission
  const checkAdmin = dependencies.isAdmin || isAdmin
  const checkSuperAdmin = dependencies.isSuperAdmin || isSuperAdmin
  return async function pageViewPermissionMiddleware(req, res, next) {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
      const permission = await readPermission(pageKey, { fresh: true })
      if (!permission) return res.status(403).json({ error: 'Page access denied' })
      if (permission === 'everyone') return next()
      const [admin, superAdmin] = await Promise.all([checkAdmin(req.user), checkSuperAdmin(req.user)])
      if (!allowsPageView(permission, { isAdmin: admin, isSuperAdmin: superAdmin })) {
        return res.status(403).json({ error: 'You do not have permission to view this page.' })
      }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}

module.exports = { requirePageViewPermission }
