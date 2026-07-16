const PERFORMANCE_REVIEW_ROW_ORDERS = [1, 2, 3, 4, 5]

const PERFORMANCE_REVIEW_STAGES = [
  ['self', 'self_score'],
  ['ss_ns', 'ss_ns_score'],
  ['ra', 'ra_score']
]

function isPerformanceScoreFilled(value) {
  return value !== null && value !== undefined && value !== ''
}

function completionForField(rowsByOrder, field) {
  const filled = PERFORMANCE_REVIEW_ROW_ORDERS.reduce((count, rowOrder) => (
    count + (isPerformanceScoreFilled(rowsByOrder.get(rowOrder)?.[field]) ? 1 : 0)
  ), 0)

  if (filled === 0) return null
  return {
    state: filled === PERFORMANCE_REVIEW_ROW_ORDERS.length ? 'complete' : 'partial',
    filled,
    total: PERFORMANCE_REVIEW_ROW_ORDERS.length
  }
}

function buildPerformanceCompletion(rows) {
  const rowsByOrder = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowOrder = Number(row?.row_order)
    if (PERFORMANCE_REVIEW_ROW_ORDERS.includes(rowOrder)) rowsByOrder.set(rowOrder, row)
  }

  return Object.fromEntries(PERFORMANCE_REVIEW_STAGES.map(([stage, field]) => (
    [stage, completionForField(rowsByOrder, field)]
  )))
}

module.exports = {
  PERFORMANCE_REVIEW_ROW_ORDERS,
  PERFORMANCE_REVIEW_STAGES,
  buildPerformanceCompletion,
  isPerformanceScoreFilled
}
