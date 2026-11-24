export const ACTIVITY_IDLE_MS = 5 * 60 * 1000
const ACTIVITY_WINDOW_MS = 120 * 1000

// Sampling uses elapsed monotonic time; wall-clock jumps cannot create work time.
export function createActivityTracker({ now = Date.now, monotonic = () => performance.now(), foreground = () => document.visibilityState === 'visible' && document.hasFocus() } = {}) {
  let sampledAt = monotonic()
  let sampledWall = now()
  let lastInteraction = sampledAt
  let wasForeground = foreground()
  let intervals = []
  function sample(interaction = false) {
    const tick = monotonic()
    const wall = now()
    const elapsed = tick - sampledAt
    const discontinuity = elapsed < 0 || elapsed > ACTIVITY_WINDOW_MS || Math.abs(wall - sampledWall - elapsed) > 5000
    const activeElapsed = wasForeground ? Math.max(0, Math.min(tick, lastInteraction + ACTIVITY_IDLE_MS) - sampledAt) : 0
    // Ignore a suspended computer/tab gap, rather than crediting sleep time.
    if (activeElapsed > 0 && !discontinuity) {
      const start = new Date(sampledWall).toISOString()
      const end = new Date(sampledWall + activeElapsed).toISOString()
      const last = intervals.at(-1)
      if (last && last.end >= start) last.end = end
      else intervals.push({ start, end })
    }
    if (discontinuity) lastInteraction = -Infinity
    if (interaction) lastInteraction = tick
    wasForeground = foreground()
    sampledAt = tick
    sampledWall = wall
    return { status: wasForeground && tick - lastInteraction < ACTIVITY_IDLE_MS ? 'online' : 'away', intervals }
  }
  return { sample, takeIntervals() { const pending = intervals; intervals = []; return pending } }
}

export function activityDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function presenceQuarterPeriod(period, financialYear, today = activityDate()) {
  if (/^FY \d{4}-\d{2} Q[1-4]$/.test(period)) return period
  const month = Number((String(period).match(/^Month \d{4}-(\d{2})$/)?.[1]) || today.slice(5, 7))
  return `${financialYear} Q${Math.floor(((month + 8) % 12) / 3) + 1}`
}

export function formatActiveTime(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const minutes = Math.floor(Math.max(0, Number(seconds)) / 60)
  if (minutes < 1) return Number(seconds) > 0 ? '<1m' : '0m'
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
