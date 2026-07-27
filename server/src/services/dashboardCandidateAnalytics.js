const { canonicalCandidateStatus } = require('./candidateStatuses')
const { localDate } = require('./attendanceUtils')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const same = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase()
const isOverall = (value) => !clean(value) || clean(value) === 'Overall (All Consultants)'

function associationMatchesDashboardConsultant(association, consultant, profiles = []) {
  if (isOverall(consultant)) return true
  const target = profiles.find((profile) => same(profile.name, consultant))
  const associationUserId = clean(association?.consultant_user_id)
  if (associationUserId) return Boolean(target?.user_id && clean(target.user_id) === associationUserId)
  return same(association?.consultant_name, target?.name || consultant)
}

function dashboardRangeDates(range) {
  const dateValue = (value) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return ''
    const date = new Date(value)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  return {
    startDate: dateValue(range?.start),
    endDate: dateValue(range?.end)
  }
}

function scopeDashboardCandidateAssociations({ associations = [], consultant, profiles = [], range }) {
  const { startDate, endDate } = dashboardRangeDates(range)
  const scoped = []
  const eligible = []
  const pending = []

  for (const association of associations) {
    if (!associationMatchesDashboardConsultant(association, consultant, profiles)) continue
    const addedDate = association?.created_at && !Number.isNaN(new Date(association.created_at).getTime())
      ? localDate(association.created_at)
      : ''
    if (!addedDate || (startDate && addedDate < startDate) || (endDate && addedDate > endDate)) continue

    const canonicalStatus = canonicalCandidateStatus(association.status)
    const row = {
      ...association,
      addedDate,
      canonicalStatus,
      dashboardStatus: canonicalStatus || '-'
    }
    scoped.push(row)
    if (canonicalStatus) eligible.push(row)
    else pending.push(row)
  }

  return {
    scoped,
    eligible,
    pending,
    pendingCount: pending.length
  }
}

module.exports = {
  associationMatchesDashboardConsultant,
  scopeDashboardCandidateAssociations
}
