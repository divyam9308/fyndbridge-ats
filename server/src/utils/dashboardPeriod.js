function dashboardPeriodRange(period, currentDate = new Date()) {
  if (!period) return null
  const now = new Date(currentDate)
  const year = now.getFullYear()
  const todayEnd = new Date(year, now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const cappedEnd = requestedEnd => requestedEnd < todayEnd ? requestedEnd : todayEnd
  const financialYear = String(period).match(/^FY (\d{4})-\d{2}$/)
  if (financialYear) {
    const startYear = Number(financialYear[1])
    return { start: new Date(startYear, 3, 1), end: cappedEnd(new Date(startYear + 1, 2, 31, 23, 59, 59, 999)) }
  }
  const financialQuarter = String(period).match(/^FY (\d{4})-\d{2} Q([1-4])$/)
  if (financialQuarter) {
    const startYear = Number(financialQuarter[1])
    const quarter = Number(financialQuarter[2])
    const startMonth = 3 + ((quarter - 1) * 3)
    return {
      start: new Date(startYear, startMonth, 1),
      end: cappedEnd(new Date(startYear, startMonth + 3, 0, 23, 59, 59, 999))
    }
  }
  const month = String(period).match(/^Month (\d{4})-(0[1-9]|1[0-2])$/)
  if (month) {
    const monthYear = Number(month[1])
    const monthIndex = Number(month[2]) - 1
    return { start: new Date(monthYear, monthIndex, 1), end: cappedEnd(new Date(monthYear, monthIndex + 1, 0, 23, 59, 59, 999)) }
  }
  if (period === 'This Month') return { start: new Date(year, now.getMonth(), 1), end: todayEnd }
  if (period === 'Q1') return { start: new Date(year, 3, 1), end: cappedEnd(new Date(year, 5, 30, 23, 59, 59, 999)) }
  if (period === 'Q2') return { start: new Date(year, 6, 1), end: cappedEnd(new Date(year, 8, 30, 23, 59, 59, 999)) }
  if (period === 'Q3') return { start: new Date(year, 9, 1), end: cappedEnd(new Date(year, 11, 31, 23, 59, 59, 999)) }
  if (period === 'Q4') return { start: new Date(year + 1, 0, 1), end: cappedEnd(new Date(year + 1, 2, 31, 23, 59, 59, 999)) }
  if (period === 'Till This Date') return { start: null, end: todayEnd }
  return { start: new Date(year, 0, 1), end: todayEnd }
}

function applyDashboardPeriod(query, column, period, { fallbackColumn = '', dateOnly = false, now } = {}) {
  const range = dashboardPeriodRange(period, now)
  if (!range) return query
  const toDateOnly = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const start = range.start && (dateOnly ? toDateOnly(range.start) : range.start.toISOString())
  const end = dateOnly ? toDateOnly(range.end) : range.end.toISOString()
  if (fallbackColumn) {
    const primary = [start ? `${column}.gte.${start}` : '', `${column}.lte.${end}`].filter(Boolean).join(',')
    const fallback = [`${column}.is.null`, range.start ? `${fallbackColumn}.gte.${range.start.toISOString()}` : '', `${fallbackColumn}.lte.${range.end.toISOString()}`].filter(Boolean).join(',')
    return query.or(`and(${primary}),and(${fallback})`)
  }
  if (start) query = query.gte(column, start)
  return query.lte(column, end)
}

module.exports = { applyDashboardPeriod, dashboardPeriodRange }
