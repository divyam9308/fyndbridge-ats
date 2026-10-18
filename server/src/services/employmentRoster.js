const { localDate, addDays } = require('./attendanceUtils')
const { normalizeEmploymentStatus } = require('./employeeStatusUtils')
const { excludeSuperAdminProfiles } = require('./attendanceLeaveEligibility')

// Status changes take effect immediately. The existing status timestamp is the
// departure boundary; it must never be inferred from a last attendance record.
function inactiveFrom(employment, today = localDate()) {
  if (normalizeEmploymentStatus(employment?.status) !== 'inactive') return null
  const timestamp = employment?.updated_at || employment?.created_at
  return timestamp && Number.isFinite(new Date(timestamp).getTime()) ? localDate(timestamp) : today
}

function employmentAsOf(employment, asOf = localDate()) {
  const cutoff = inactiveFrom(employment)
  return cutoff && asOf >= cutoff ? addDays(cutoff, -1) : asOf
}

function periodEmployeeProfiles(profiles, statuses, admins, { start, end, today = localDate(), includeInactive = false }) {
  const byUserId = new Map((statuses || []).map(row => [String(row.user_id), row]))
  return excludeSuperAdminProfiles(profiles || [], admins).filter(profile => profile.user_id && String(profile.name || '').trim()).flatMap(profile => {
    const employment = byUserId.get(String(profile.user_id))
    const status = normalizeEmploymentStatus(employment?.status)
    const cutoff = inactiveFrom(employment, today)
    // Current lists omit former staff. Past periods (or the explicit history
    // view for a partial month/year) retain their pre-departure records.
    if (cutoff && !(start < cutoff && (end < today || includeInactive))) return []
    return [{ ...profile, employment_status: status, inactive_from: cutoff }]
  })
}

module.exports = { inactiveFrom, employmentAsOf, periodEmployeeProfiles }
