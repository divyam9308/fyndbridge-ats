const test = require('node:test')
const assert = require('node:assert/strict')

const { buildPerformanceCompletion, isPerformanceScoreFilled } = require('./performanceCompletion')

function rows(overrides = {}) {
  return Array.from({ length: 5 }, (_, index) => ({
    row_order: index + 1,
    self_score: null,
    ss_ns_score: null,
    ra_score: null,
    ...(overrides[index + 1] || {})
  }))
}

test('no editable scores produces no completion dots', () => {
  assert.deepEqual(buildPerformanceCompletion(rows()), {
    self: null,
    ss_ns: null,
    ra: null
  })
})

test('zero is filled and two of five self scores is partial', () => {
  assert.equal(isPerformanceScoreFilled(0), true)
  assert.equal(isPerformanceScoreFilled('0'), true)
  assert.equal(isPerformanceScoreFilled(''), false)
  assert.deepEqual(buildPerformanceCompletion(rows({
    1: { self_score: 0 },
    2: { self_score: 3.5 }
  })).self, { state: 'partial', filled: 2, total: 5 })
})

test('all five self scores is complete', () => {
  assert.deepEqual(buildPerformanceCompletion(rows(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [index + 1, { self_score: index }])
  ))).self, { state: 'complete', filled: 5, total: 5 })
})

test('self and SS/NS retain independent completion states', () => {
  const result = buildPerformanceCompletion(rows(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [index + 1, {
      self_score: 4,
      ss_ns_score: index < 3 ? 3 : null
    }])
  )))

  assert.deepEqual(result.self, { state: 'complete', filled: 5, total: 5 })
  assert.deepEqual(result.ss_ns, { state: 'partial', filled: 3, total: 5 })
  assert.equal(result.ra, null)
})

test('complete self and SS/NS stages produce two complete states without an RA state', () => {
  const result = buildPerformanceCompletion(rows(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [index + 1, {
      self_score: index,
      ss_ns_score: 5 - index
    }])
  )))

  assert.deepEqual(result.self, { state: 'complete', filled: 5, total: 5 })
  assert.deepEqual(result.ss_ns, { state: 'complete', filled: 5, total: 5 })
  assert.equal(result.ra, null)
})

test('all stages complete independently', () => {
  const result = buildPerformanceCompletion(rows(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [index + 1, {
      self_score: index,
      ss_ns_score: index,
      ra_score: index
    }])
  )))

  for (const stage of ['self', 'ss_ns', 'ra']) {
    assert.deepEqual(result[stage], { state: 'complete', filled: 5, total: 5 })
  }
})

test('RA can be partial and rows outside the five categories are ignored', () => {
  const result = buildPerformanceCompletion([
    ...rows({ 1: { ra_score: 0 }, 5: { ra_score: 2 } }),
    { row_order: 6, self_score: 5, ss_ns_score: 5, ra_score: 5 }
  ])

  assert.equal(result.self, null)
  assert.equal(result.ss_ns, null)
  assert.deepEqual(result.ra, { state: 'partial', filled: 2, total: 5 })
})
