const { localDate } = require('./attendanceUtils')

function quarterRange(period, now = new Date()) {
  const today = localDate(now, 'Asia/Kolkata')
  const month = Number(today.slice(5, 7))
  const year = Number(today.slice(0, 4)) - (month < 4 ? 1 : 0)
  const current = `FY ${year}-${String((year + 1) % 100).padStart(2, '0')} Q${Math.floor(((month + 8) % 12) / 3) + 1}`
  const value = period || current
  const match = String(value).match(/^FY (\d{4})-(\d{2}) Q([1-4])$/)
  if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
    const error = new Error('Invalid activity quarter.')
    error.statusCode = 400
    throw error
  }
  const start = new Date(Date.UTC(Number(match[1]), 3 + (Number(match[3]) - 1) * 3, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0))
  return { period: value, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

async function recordActivity(supabase, userId, intervals) {
  if (intervals == null) return // Older clients can keep sending presence.
  if (!Array.isArray(intervals) || intervals.length > 500 || intervals.some(item =>
    !item || typeof item.start !== 'string' || typeof item.end !== 'string' ||
    !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) < Date.parse(item.start))) {
    const error = new Error('Invalid activity intervals.')
    error.statusCode = 400
    throw error
  }
  if (!intervals.length) return
  const { error } = await supabase.rpc('record_user_activity', { p_user_id: userId, p_intervals: intervals })
  if (error) throw error
}

module.exports = { quarterRange, recordActivity }
