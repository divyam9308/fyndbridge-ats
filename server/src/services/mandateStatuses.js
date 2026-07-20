const MANDATE_STATUSES = Object.freeze(['Ongoing (P1)', 'Delivered (P2)', 'Paused (P3)', 'Completed', 'Scrapped'])

const MANDATE_STATUS_LABELS = Object.freeze({
  'Ongoing (P1)': 'Ongoing (P1)',
  'Delivered (P2)': 'Delivered (P2)',
  'Paused (P3)': 'Paused (P3)',
  Completed: 'Completed',
  Scrapped: 'Scrapped'
})

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

function normalizeMandateStatus(value) {
  const text = clean(value)
  const lower = text.toLowerCase()
  if (['p1', 'ongoing', 'ongoing (p1)', 'open', 'active'].includes(lower)) return 'Ongoing (P1)'
  if (['p2', 'delivered', 'delivered (p2)'].includes(lower)) return 'Delivered (P2)'
  if (['p3', 'paused', 'paused (p3)', 'on hold', 'on-hold'].includes(lower)) return 'Paused (P3)'
  if (['completed', 'complete', 'closed', 'filled'].includes(lower)) return 'Completed'
  if (['scrapped', 'scrap', 'cancelled', 'canceled', 'abandoned'].includes(lower)) return 'Scrapped'
  return ''
}

function mandateStatusLabel(value) {
  const status = normalizeMandateStatus(value)
  return MANDATE_STATUS_LABELS[status] || clean(value) || '-'
}

module.exports = {
  MANDATE_STATUSES,
  MANDATE_STATUS_LABELS,
  mandateStatusLabel,
  normalizeMandateStatus
}
