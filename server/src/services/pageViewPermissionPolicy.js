function allowsPageView(permission, { isAdmin = false, isSuperAdmin = false } = {}) {
  if (permission === 'everyone') return true
  if (permission === 'admin_only') return Boolean(isAdmin || isSuperAdmin)
  if (permission === 'super_admin_only') return Boolean(isSuperAdmin)
  return false
}

module.exports = { allowsPageView }
