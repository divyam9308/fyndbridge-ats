import test from 'node:test'
import assert from 'node:assert/strict'
import { createActivityTracker, ACTIVITY_IDLE_MS, presenceQuarterPeriod, activityDate, formatActiveTime } from './presenceActivity.js'

function tracker() {
  let tick = 0, visible = true
  const epoch = Date.parse('2026-11-21T05:00:00Z')
  const activity = createActivityTracker({ now: () => epoch + tick, monotonic: () => tick, foreground: () => visible })
  return { sample: activity.sample, advance(ms) { tick += ms }, foreground(value) { visible = value } }
}
const seconds = state => state.intervals.reduce((sum, x) => sum + (Date.parse(x.end) - Date.parse(x.start)) / 1000, 0)

test('active time pauses on blur, continues on return, and ignores suspension', () => {
  const t = tracker()
  t.advance(30000); t.foreground(false)
  assert.equal(seconds(t.sample()), 30)
  t.advance(60000); t.foreground(true)
  assert.equal(seconds(t.sample(true)), 30)
  t.advance(10000)
  assert.equal(seconds(t.sample()), 40)
  t.advance(10 * 60000)
  assert.equal(seconds(t.sample()), 40) // Unsent activity is retained; suspension adds nothing.
})

test('sleep with either a paused or advancing monotonic clock resumes fresh activity without crediting sleep', () => {
  for (const tickDuringSleep of [false, true]) {
    let tick = 0, wall = Date.parse('2026-11-25T04:00:00Z')
    const t = createActivityTracker({ now: () => wall, monotonic: () => tick, foreground: () => true })
    tick += 30000; wall += 30000; t.sample(true)
    assert.equal(seconds({ intervals: t.takeIntervals() }), 30)
    wall += 600000; tick += tickDuringSleep ? 600000 : 1000
    assert.equal(t.sample().status, 'away')
    assert.equal(seconds({ intervals: t.takeIntervals() }), 0)
    t.sample(true)
    tick += 30000; wall += 30000
    assert.equal(seconds(t.sample()), 30)
    assert.equal(t.takeIntervals()[0].end, new Date(wall).toISOString())
  }
})

test('forward and backward clock changes discard their gap and reanchor subsequent intervals', () => {
  for (const jump of [-600000, 600000]) {
    let tick = 0, wall = Date.parse('2026-11-25T04:00:00Z')
    const t = createActivityTracker({ now: () => wall, monotonic: () => tick, foreground: () => true })
    tick += 15000; wall += 15000; t.sample(true); t.takeIntervals()
    tick += 15000; wall += 15000 + jump
    t.sample(true)
    assert.deepEqual(t.takeIntervals(), [])
    tick += 15000; wall += 15000
    assert.deepEqual(t.sample().intervals, [{ start: new Date(wall - 15000).toISOString(), end: new Date(wall).toISOString() }])
  }
})

test('idle cutoff does not credit the gap when interaction resumes', () => {
  const t = tracker()
  for (let i = 0; i < ACTIVITY_IDLE_MS / 60000; i++) { t.advance(60000); t.sample() }
  assert.equal(t.sample().status, 'away')
  t.advance(60000)
  const before = seconds(t.sample())
  assert.equal(t.sample(true).status, 'online')
  assert.equal(seconds(t.sample()), before)
  t.advance(10000)
  assert.equal(seconds(t.sample()), before + 10)
})

test('frequent input merges intervals instead of dropping time at the queue limit', () => {
  const t = tracker()
  for (let i = 0; i < 10000; i++) { t.advance(5); t.sample(true) }
  const state = t.sample()
  assert.equal(state.intervals.length, 1)
  assert.equal(seconds(state), 50)
})

test('quarter selection follows fiscal Q1-Q4 and maps month/FY filters to a quarter', () => {
  assert.equal(presenceQuarterPeriod('FY 2026-27 Q1', 'FY 2026-27'), 'FY 2026-27 Q1')
  assert.equal(presenceQuarterPeriod('Month 2027-02', 'FY 2026-27'), 'FY 2026-27 Q4')
  assert.equal(presenceQuarterPeriod('FY 2026-27', 'FY 2026-27', '2026-11-21'), 'FY 2026-27 Q3')
  assert.equal(presenceQuarterPeriod('', 'FY 2026-27', '2026-04-01'), 'FY 2026-27 Q1')
})

test('IST date rolls over independently of browser timezone and duration is readable', () => {
  assert.equal(activityDate(new Date('2026-11-20T18:29:59Z')), '2026-11-20')
  assert.equal(activityDate(new Date('2026-11-20T18:30:00Z')), '2026-11-21')
  assert.deepEqual([null, 0, 35, 3600, 8100].map(formatActiveTime), ['—', '0m', '<1m', '1h 0m', '2h 15m'])
})
