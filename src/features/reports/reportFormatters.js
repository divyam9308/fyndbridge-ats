export function formatReportDate(value) {
  if (!value) return '—'
  const parsed = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value)
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}
