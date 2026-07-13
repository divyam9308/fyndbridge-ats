const { normalizeEmploymentStatus } = require('./employeeStatusUtils')
const { weekday } = require('./attendanceUtils')

const clean = value => String(value || '').trim()
const normalizedStatus = value => clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

function buildActiveProfiles(profiles, employeeStatuses, admins) {
  const statusByUserId = new Map((employeeStatuses || []).map(row => [clean(row.user_id), normalizeEmploymentStatus(row.status)]))
  const excludedUserIds = new Set()
  const excludedEmails = new Set()
  for (const row of admins || []) {
    if (row.role !== 'super_admin' && !row.is_super_admin) continue
    if (clean(row.user_id)) excludedUserIds.add(clean(row.user_id))
    if (clean(row.email)) excludedEmails.add(clean(row.email).toLowerCase())
  }

  return (profiles || []).filter(profile => {
    const userId = clean(profile.user_id)
    return Boolean(
      userId &&
      clean(profile.name) &&
      (statusByUserId.get(userId) || 'active') === 'active' &&
      !excludedUserIds.has(userId) &&
      !excludedEmails.has(clean(profile.email).toLowerCase())
    )
  })
}

function personFromProfile(profile, status) {
  return {
    user_id: clean(profile.user_id),
    name: clean(profile.name) || 'Employee',
    role: clean(profile.role || profile.designation),
    avatar_url: clean(profile.avatar_url || profile.photo_url),
    status
  }
}

function approvedLeaveStatus(leave) {
  return normalizedStatus(leave?.duration_type) === 'half day' ? 'Half Day Leave' : 'Leave'
}

function buildTodayAttendanceSummary({ date, profiles, attendanceRecords = [], approvedLeaves = [], pendingCorrections = [], holidays = [] }) {
  const attendanceByUserId = new Map(attendanceRecords.map(row => [clean(row.user_id), row]))
  const leaveByUserId = new Map(approvedLeaves
    .filter(row => normalizedStatus(row.status || 'approved') === 'approved')
    .map(row => [clean(row.user_id), row]))
  const correctionByUserId = new Map(pendingCorrections.map(row => [clean(row.user_id), row]))
  const isHoliday = holidays.some(row => row.holiday_date === date)
  const isWeeklyOff = weekday(date) === 0
  const summary = { date, present: [], leave: [], unmarked: [] }

  for (const profile of profiles || []) {
    const userId = clean(profile.user_id)
    const record = attendanceByUserId.get(userId)
    const recordStatus = normalizedStatus(record?.status)
    const leave = leaveByUserId.get(userId)
    const correction = correctionByUserId.get(userId)

    if (['present', 'corrected'].includes(recordStatus)) {
      summary.present.push(personFromProfile(profile, 'Present'))
      continue
    }
    if (['on leave', 'leave', 'half day leave'].includes(recordStatus)) {
      summary.leave.push(personFromProfile(profile, recordStatus === 'half day leave' ? 'Half Day Leave' : 'Leave'))
      continue
    }
    if (leave) {
      summary.leave.push(personFromProfile(profile, approvedLeaveStatus(leave)))
      continue
    }
    if (recordStatus === 'correction pending') {
      if (correction?.existing_clock_in_at && correction?.existing_clock_out_at) {
        summary.present.push(personFromProfile(profile, 'Present'))
      } else if (!correction?.existing_clock_in_at && !isHoliday && !isWeeklyOff) {
        summary.unmarked.push(personFromProfile(profile, 'Unmarked'))
      }
      continue
    }
    if (record && !['not marked', 'absent'].includes(recordStatus)) continue
    if (!isHoliday && !isWeeklyOff) summary.unmarked.push(personFromProfile(profile, 'Unmarked'))
  }

  return summary
}

module.exports = { buildActiveProfiles, buildTodayAttendanceSummary }
