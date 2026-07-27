const COMPANY_TIME_ZONE = 'Asia/Kolkata'
const COMPANY_TIME_OFFSET_MS = 330 * 60 * 1000

export function attendanceTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: COMPANY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}

export function dashboardAttendanceView(record) {
  if (record?.clock_out_at) {
    const clockOutTime = attendanceTime(record.clock_out_at)
    return {
      mode: 'complete',
      action: null,
      label: '✓',
      reminder: false,
      status: clockOutTime ? `Out ${clockOutTime}` : 'Clocked out',
      ariaLabel: clockOutTime ? `Clocked out at ${clockOutTime}` : 'Clocked out'
    }
  }

  if (record?.clock_in_at) {
    const clockInTime = attendanceTime(record.clock_in_at)
    return {
      mode: 'clock-out',
      action: 'clock-out',
      label: 'CO',
      reminder: true,
      status: clockInTime ? `In ${clockInTime}` : 'Clocked in',
      ariaLabel: clockInTime ? `Clock out. Clocked in at ${clockInTime}` : 'Clock out'
    }
  }

  return {
    mode: 'clock-in',
    action: 'clock-in',
    label: 'CI',
    reminder: true,
    status: 'Not clocked in',
    ariaLabel: 'Clock in'
  }
}

export function millisecondsUntilCompanyMidnight(at = Date.now()) {
  const companyNow = new Date(at + COMPANY_TIME_OFFSET_MS)
  const nextMidnight = Date.UTC(
    companyNow.getUTCFullYear(),
    companyNow.getUTCMonth(),
    companyNow.getUTCDate() + 1
  )
  return Math.max(1000, nextMidnight - companyNow.getTime())
}
