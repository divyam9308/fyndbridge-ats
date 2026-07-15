function workedTimeLabel(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function attendancePayload(period, balance) {
  const summary = period?.kpis || {}
  const availableBalance = Number(balance?.available_balance) || 0
  return {
    available: true,
    metrics: [
      { key: 'workingDays', label: 'Working Days', value: Number(summary.working_days) || 0, tone: 'blue' },
      { key: 'presentDays', label: 'Present Days', value: Number(summary.present) || 0, tone: 'green' },
      { key: 'leaveDays', label: 'Leave Days', value: Number(summary.leave) || 0, tone: 'purple' },
      { key: 'halfDayLeave', label: 'Half-Day Leave', value: Number(summary.half_day_leave) || 0, tone: 'amber' },
      { key: 'unmarkedDays', label: 'Unmarked Days', value: Number(summary.unmarked) || 0, tone: 'red' },
      { key: 'correctedAttendance', label: 'Corrected Attendance', value: Number(summary.corrected_attendance) || 0, tone: 'cyan' },
      { key: 'pendingCorrections', label: 'Pending Corrections', value: Number(summary.pending_corrections) || 0, tone: 'amber' },
      { key: 'workedTime', label: 'Total Worked Hours', value: workedTimeLabel(summary.total_minutes), numericValue: Number(summary.total_minutes) || 0, tone: 'navy' },
      { key: 'leaveBalance', label: 'Leave Balance', value: `${availableBalance} days`, numericValue: availableBalance, tone: 'teal' },
      { key: 'attendancePercentage', label: 'Attendance Percentage', value: `${Number(summary.attendance_percentage) || 0}%`, numericValue: Number(summary.attendance_percentage) || 0, tone: 'green' }
    ],
    leaveBalance: {
      financialYear: balance?.financial_year || '',
      annualEntitlement: Number(balance?.annual_entitlement) || 0,
      openingCarryForward: Number(balance?.opening_carry_forward) || 0,
      accruedLeave: Number(balance?.accrued_leave) || 0,
      usedLeave: Number(balance?.used_leave) || 0,
      pendingLeave: Number(balance?.pending_leave) || 0,
      availableBalance,
      projectedBalance: Number(balance?.projected_balance) || 0,
      lossOfPayExposure: Number(balance?.loss_of_pay_exposure) || 0
    }
  }
}

function aggregateAttendance(rows = []) {
  const sortedRows = [...(rows || [])].sort((left, right) => (
    String(left?.consultant?.name || '').localeCompare(String(right?.consultant?.name || ''), undefined, { sensitivity: 'base' })
  ))
  const kpis = sortedRows.reduce((total, row) => {
    const summary = row.period?.kpis || {}
    for (const key of ['working_days', 'present', 'leave', 'half_day_leave', 'unmarked', 'corrected_attendance', 'pending_corrections', 'total_minutes']) {
      total[key] += Number(summary[key]) || 0
    }
    return total
  }, {
    working_days: 0,
    present: 0,
    leave: 0,
    half_day_leave: 0,
    unmarked: 0,
    corrected_attendance: 0,
    pending_corrections: 0,
    total_minutes: 0
  })
  kpis.attendance_percentage = kpis.working_days ? Math.round((kpis.present / kpis.working_days) * 100) : 0

  const balance = sortedRows.reduce((total, row) => {
    const current = row.balance || {}
    total.financial_year ||= current.financial_year || ''
    for (const key of ['annual_entitlement', 'opening_carry_forward', 'accrued_leave', 'used_leave', 'pending_leave', 'available_balance', 'projected_balance', 'loss_of_pay_exposure']) {
      total[key] += Number(current[key]) || 0
    }
    return total
  }, {
    financial_year: '',
    annual_entitlement: 0,
    opening_carry_forward: 0,
    accrued_leave: 0,
    used_leave: 0,
    pending_leave: 0,
    available_balance: 0,
    projected_balance: 0,
    loss_of_pay_exposure: 0
  })

  return {
    ...attendancePayload({ kpis }, balance),
    consultants: sortedRows.map((row) => ({
      consultant: row.consultant,
      ...attendancePayload(row.period, row.balance)
    }))
  }
}

module.exports = { aggregateAttendance, attendancePayload, workedTimeLabel }
