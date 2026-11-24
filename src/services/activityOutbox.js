export const ACTIVITY_BACKLOG_MS = 24 * 60 * 60 * 1000
const MAX_INTERVAL_MS = 120 * 1000
const volatile = new Map()
const browserStorage = () => { try { return globalThis.localStorage } catch { return null } }

// Immutable batches let any tab acknowledge a snapshot without deleting activity
// appended by another tab while its request was in flight.
export function createActivityOutbox(userId, { storage = browserStorage(), now = Date.now,
  id = () => globalThis.crypto.randomUUID() } = {}) {
  const prefix = `fb_activity_outbox:${userId}:`
  function remove(key) {
    volatile.delete(key)
    try { storage?.removeItem(key) } catch { /* Keep retries available in memory when storage is blocked. */ }
  }
  function records() {
    const found = new Map([...volatile].filter(([key]) => key.startsWith(prefix)))
    try {
      for (let i = 0; i < storage?.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(prefix)) {
          try { found.set(key, JSON.parse(storage.getItem(key))) } catch { remove(key) }
        }
      }
    } catch { /* A blocked store falls back to this page's memory. */ }
    return found
  }
  function enqueue(intervals) {
    const pending = []
    for (const interval of intervals || []) {
      let start = Math.max(Date.parse(interval.start), now() - ACTIVITY_BACKLOG_MS)
      const end = Math.min(Date.parse(interval.end), now())
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      while (start < end) {
        const stop = Math.min(end, start + MAX_INTERVAL_MS)
        pending.push({ start: new Date(start).toISOString(), end: new Date(stop).toISOString() })
        start = stop
      }
    }
    while (pending.length) {
      const key = prefix + id(), batch = pending.splice(0, 100)
      try { storage.setItem(key, JSON.stringify(batch)) }
      catch { volatile.set(key, batch) }
    }
  }
  function snapshot() {
    const selected = [], intervals = [], cutoff = now() - ACTIVITY_BACKLOG_MS
    const entries = [...records()].sort((a, b) => String(a[1]?.[0]?.start || '').localeCompare(String(b[1]?.[0]?.start || '')))
    for (const [key, batch] of entries) {
      if (!Array.isArray(batch) || batch.length > 100 || batch.some(item => !item || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) <= Date.parse(item.start) || Date.parse(item.end) - Date.parse(item.start) > MAX_INTERVAL_MS)) { remove(key); continue }
      const valid = batch.filter(item => Date.parse(item.end) > cutoff && Date.parse(item.start) < now())
      if (!valid.length) { remove(key); continue }
      if (intervals.length + valid.length > 500) break
      selected.push(key); intervals.push(...valid)
    }
    return { intervals, acknowledge() { selected.forEach(remove) } }
  }
  return { enqueue, snapshot }
}
