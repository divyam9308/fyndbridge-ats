const clean = value => String(value || '').trim()
const normalizeEmail = value => clean(value).toLowerCase()

function isSuperAdminRecord(admin) {
  return admin?.role === 'super_admin' || admin?.is_super_admin === true
}

function buildSuperAdminLookup(admins = []) {
  const userIds = new Set()
  const emails = new Set()

  for (const admin of admins) {
    if (!isSuperAdminRecord(admin)) continue
    const userId = clean(admin.user_id)
    const email = normalizeEmail(admin.email)
    if (userId) userIds.add(userId)
    if (email) emails.add(email)
  }

  return { userIds, emails }
}

function isSuperAdminProfile(profile, adminsOrLookup = []) {
  const lookup = Array.isArray(adminsOrLookup)
    ? buildSuperAdminLookup(adminsOrLookup)
    : adminsOrLookup
  const userId = clean(profile?.user_id)
  const email = normalizeEmail(profile?.email)
  return Boolean(
    (userId && lookup.userIds.has(userId)) ||
    (email && lookup.emails.has(email))
  )
}

function excludeSuperAdminProfiles(profiles = [], admins = []) {
  const lookup = buildSuperAdminLookup(admins)
  return profiles.filter(profile => !isSuperAdminProfile(profile, lookup))
}

module.exports = {
  buildSuperAdminLookup,
  excludeSuperAdminProfiles,
  isSuperAdminProfile,
  isSuperAdminRecord
}
