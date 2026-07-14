const { addDays, calculateLeave, localDate, weekday } = require('./attendanceUtils')

function buildAttendancePeriodSummary({
  start,
  end,
  records = [],
  holidayRows = [],
  leaveRequests = [],
  correctionRequests = [],
  today = localDate()
}) {
  const holidaysByDate = new Map(holidayRows.map((holiday) => [holiday.holiday_date, holiday]))
  const holidayDates = [...holidaysByDate.keys()]
  const recordsByDate = new Map(records.map((record) => [record.attendance_date, record]))

  const approvedDates = new Set()
  leaveRequests.filter((row) => row.status === 'approved').forEach((row) => {
    const calculation = calculateLeave({
      startDate: row.start_date,
      endDate: row.end_date,
      durationType: row.duration_type,
      halfDaySession: row.half_day_session,
      holidays: holidayDates,
      balance: 0
    })
    calculation.calculation_breakdown
      .filter((item) => item.charged > 0 && item.date >= start && item.date <= end)
      .forEach((item) => approvedDates.add(item.date))
  })

  const sandwichSundays = new Set()
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (weekday(date) === 0 && approvedDates.has(addDays(date, -1)) && approvedDates.has(addDays(date, 1))) {
      sandwichSundays.add(date)
    }
  }

  const leaveForDate = (date, status) => leaveRequests.find((row) => (
    row.status === status && date >= row.start_date && date <= row.end_date
  )) || null
  const approvedLeaveForDate = (date) => leaveForDate(date, 'approved')
    || (sandwichSundays.has(date) ? { status: 'approved', duration_type: 'full_day', sandwich: true } : null)

  const days = []
  let workingDays = 0
  let unmarkedDays = 0
  let halfDayLeave = 0

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const future = date > today
    const holiday = holidaysByDate.get(date) || null
    const weeklyOff = weekday(date) === 0
    const pendingLeave = leaveForDate(date, 'pending')
    const rejectedLeave = leaveForDate(date, 'rejected')
    const approvedLeave = approvedLeaveForDate(date)
    const record = recordsByDate.get(date) || null

    if (!holiday && !weeklyOff) workingDays += 1
    if (approvedLeave?.duration_type === 'half_day') halfDayLeave += 1
    if (!future && !holiday && !weeklyOff && !record && !pendingLeave && !rejectedLeave && !approvedLeave && date !== today) {
      unmarkedDays += 1
    }

    days.push({
      date,
      record,
      holiday,
      weekly_off: weeklyOff,
      future,
      pending_leave: pendingLeave,
      rejected_leave: rejectedLeave,
      approved_leave: approvedLeave
    })
  }

  const presentRecords = records.filter((record) => ['present', 'corrected'].includes(record.status))
  const leaveDates = new Set([
    ...approvedDates,
    ...sandwichSundays,
    ...records.filter((record) => String(record.status || '').includes('leave')).map((record) => record.attendance_date)
  ])
  const correctedAttendance = records.filter((record) => record.status === 'corrected').length
  const pendingCorrections = correctionRequests.filter((request) => request.status === 'pending').length
  const totalMinutes = presentRecords.reduce((total, record) => total + (Number(record.worked_minutes) || 0), 0)
  const attendancePercentage = workingDays ? Math.round((presentRecords.length / workingDays) * 100) : 0

  return {
    days,
    records,
    holidays: holidayRows,
    leave_requests: leaveRequests,
    correction_requests: correctionRequests,
    kpis: {
      working_days: workingDays,
      present: presentRecords.length,
      leave: leaveDates.size,
      half_day_leave: halfDayLeave,
      corrections: records.filter((record) => ['corrected', 'correction_pending'].includes(record.status)).length,
      corrected_attendance: correctedAttendance,
      pending_corrections: pendingCorrections,
      unmarked: unmarkedDays,
      holidays: holidayRows.length,
      total_minutes: totalMinutes,
      attendance_percentage: attendancePercentage
    }
  }
}

module.exports = { buildAttendancePeriodSummary }
