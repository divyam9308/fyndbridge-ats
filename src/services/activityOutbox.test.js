import test from 'node:test'
import assert from 'node:assert/strict'
import { createActivityOutbox, ACTIVITY_BACKLOG_MS } from './activityOutbox.js'
function fixture() {
  const data = new Map(), now = Date.parse('2026-11-25T05:00:00Z')
  let seq = 0
  const storage = { get length() { return data.size }, key: n => [...data.keys()][n], getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  const options = { storage, now: () => now, id: () => String(++seq) }
  return { data, now, options, open: user => createActivityOutbox(user, options), interval: (offset = 60000) => ({ start: new Date(now - offset).toISOString(), end: new Date(now - offset + 10000).toISOString() }) }
}
test('unacknowledged intervals survive recreation, and only the successful snapshot is removed', () => {
  const f = fixture(), first = f.open('persist')
  first.enqueue([f.interval()])
  const pending = first.snapshot()
  assert.equal(f.open('persist').snapshot().intervals.length, 1)
  first.enqueue([f.interval(30000)])
  pending.acknowledge()
  assert.deepEqual(f.open('persist').snapshot().intervals, [f.interval(30000)])
})
test('tabs share pending batches without erasing new work; different accounts stay isolated', () => {
  const f = fixture(), a = f.open('alice'), b = f.open('alice'), other = f.open('bob')
  a.enqueue([f.interval()]); other.enqueue([f.interval()])
  const sent = b.snapshot()
  a.enqueue([f.interval(30000)])
  sent.acknowledge(); sent.acknowledge()
  assert.deepEqual(b.snapshot().intervals, [f.interval(30000)])
  assert.equal(other.snapshot().intervals.length, 1)
})
test('backlog is bounded to 24 hours, future time is excluded and long accumulated activity is split', () => {
  const f = fixture(), box = f.open('bounds')
  box.enqueue([{ start: new Date(f.now - ACTIVITY_BACKLOG_MS - 60000).toISOString(), end: new Date(f.now - ACTIVITY_BACKLOG_MS - 10000).toISOString() },
    { start: new Date(f.now - 600000).toISOString(), end: new Date(f.now - 60000).toISOString() }])
  assert.equal(box.snapshot().intervals.length, 5)
  assert.ok(box.snapshot().intervals.every(item => Date.parse(item.end) - Date.parse(item.start) <= 120000))
  const later = createActivityOutbox('bounds', { ...f.options, now: () => f.now + ACTIVITY_BACKLOG_MS })
  assert.deepEqual(later.snapshot().intervals, [])
})
test('large queues deliver at most 500 intervals and preserve the remaining batches', () => {
  const f = fixture(), box = f.open('large')
  box.enqueue(Array.from({ length: 650 }, () => f.interval()))
  const first = box.snapshot()
  assert.equal(first.intervals.length, 500)
  first.acknowledge()
  assert.equal(box.snapshot().intervals.length, 150)
})
test('storage failures retain a retryable in-memory batch', () => {
  const f = fixture(), box = createActivityOutbox('unavailable', { ...f.options, storage: null })
  box.enqueue([f.interval()])
  const batch = box.snapshot()
  assert.equal(batch.intervals.length, 1)
  batch.acknowledge()
  assert.deepEqual(box.snapshot().intervals, [])
})
