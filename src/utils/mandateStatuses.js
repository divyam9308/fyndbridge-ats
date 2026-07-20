export const MANDATE_STATUSES = ['Ongoing (P1)', 'Delivered (P2)', 'Paused (P3)', 'Completed', 'Scrapped']

export const MANDATE_STATUS_OPTIONS = ['', ...MANDATE_STATUSES]

export const MANDATE_STATUS_LABELS = {
  'Ongoing (P1)': 'Ongoing (P1)',
  'Delivered (P2)': 'Delivered (P2)',
  'Paused (P3)': 'Paused (P3)',
  Completed: 'Completed',
  Scrapped: 'Scrapped',
}

export const MANDATE_STATUS_BADGE_MAP = {
  'Ongoing (P1)': 'badge-mandate-p1',
  'Delivered (P2)': 'badge-mandate-p2',
  'Paused (P3)': 'badge-mandate-p3',
  Scrapped: 'badge-mandate-scrapped',
  Completed: 'badge-mandate-completed',
}

export const normalizeMandateStatus = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (['p1', 'ongoing', 'ongoing (p1)', 'open', 'active'].includes(text)) return 'Ongoing (P1)'
  if (['p2', 'delivered', 'delivered (p2)'].includes(text)) return 'Delivered (P2)'
  if (['p3', 'paused', 'paused (p3)', 'on hold', 'on-hold'].includes(text)) return 'Paused (P3)'
  if (['completed', 'complete', 'closed', 'filled'].includes(text)) return 'Completed'
  if (['scrapped', 'scrap', 'cancelled', 'canceled', 'abandoned'].includes(text)) return 'Scrapped'
  return '-'
}

export const mandateStatusLabel = (value) => {
  const status = normalizeMandateStatus(value)
  return MANDATE_STATUS_LABELS[status] || String(value || '').trim() || '-'
}

export const mandateStatusClassName = (value) => {
  const status = normalizeMandateStatus(value)
  if (status === 'Ongoing (P1)') return 'p1'
  if (status === 'Delivered (P2)') return 'p2'
  if (status === 'Paused (P3)') return 'p3'
  return status === '-' ? 'unset' : status.toLowerCase()
}
