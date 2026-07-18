import test from 'node:test'
import assert from 'node:assert/strict'
import { leaveRangeHasSundayBoundary } from './attendanceData.js'

test('leave submission is blocked when the range starts or ends on Sunday',()=>{
  assert.equal(leaveRangeHasSundayBoundary('2026-10-09','2026-10-11'),true)
  assert.equal(leaveRangeHasSundayBoundary('2026-10-11','2026-10-12'),true)
  assert.equal(leaveRangeHasSundayBoundary('2026-10-11','2026-10-11'),true)
})

test('leave submission allows Sunday inside a range with non-Sunday boundaries',()=>{
  assert.equal(leaveRangeHasSundayBoundary('2026-10-09','2026-10-10'),false)
  assert.equal(leaveRangeHasSundayBoundary('2026-10-09','2026-10-12'),false)
  assert.equal(leaveRangeHasSundayBoundary('2026-10-10','2026-10-12'),false)
  assert.equal(leaveRangeHasSundayBoundary('2026-10-12','2026-10-12'),false)
})
