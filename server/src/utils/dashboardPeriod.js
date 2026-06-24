function dashboardPeriodRange(period) {
  if (!period) return null
  const now = new Date()
  const year = now.getFullYear()
  const end = new Date(year, now.getMonth(), now.getDate(), 23, 59, 59, 999)
  if (period === 'This Month') return { start: new Date(year, now.getMonth(), 1), end }
  if (period === 'Q1') return { start: new Date(year, 3, 1), end: new Date(year, 5, 30, 23, 59, 59, 999) }
  if (period === 'Q2') return { start: new Date(year, 6, 1), end: new Date(year, 8, 30, 23, 59, 59, 999) }
  if (period === 'Q3') return { start: new Date(year, 9, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) }
  if (period === 'Q4') return { start: new Date(year + 1, 0, 1), end: new Date(year + 1, 2, 31, 23, 59, 59, 999) }
  if (period === 'Till This Date') return { start: null, end }
  return { start: new Date(year, 0, 1), end }
}

function applyDashboardPeriod(query, column, period, { fallbackColumn = '', dateOnly = false } = {}) {
  const range = dashboardPeriodRange(period)
  if (!range) return query
  const start = range.start && (dateOnly ? range.start.toISOString().slice(0, 10) : range.start.toISOString())
  const end = dateOnly ? range.end.toISOString().slice(0, 10) : range.end.toISOString()
  if (fallbackColumn) {
    const primary = [start ? `${column}.gte.${start}` : '', `${column}.lte.${end}`].filter(Boolean).join(',')
    const fallback = [`${column}.is.null`, range.start ? `${fallbackColumn}.gte.${range.start.toISOString()}` : '', `${fallbackColumn}.lte.${range.end.toISOString()}`].filter(Boolean).join(',')
    return query.or(`and(${primary}),and(${fallback})`)
  }
  if (start) query = query.gte(column, start)
  return query.lte(column, end)
}

module.exports = { applyDashboardPeriod }
