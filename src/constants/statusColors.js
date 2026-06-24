const CHART = [
  'var(--modern-chart-1)',
  'var(--modern-chart-2)',
  'var(--modern-chart-3)',
  'var(--modern-chart-4)',
  'var(--modern-chart-5)',
  'var(--modern-chart-6)',
  'var(--modern-chart-7)',
  'var(--modern-chart-8)'
]

export const CLIENT_STATUS_COLORS = {
  '-': CHART[0],
  Active: CHART[1],
  Inactive: CHART[2],
  Converted: CHART[3],
  'Not Converted': CHART[4],
  'Follow Up Required': CHART[5],
  'Not Hiring': CHART[6],
  'Not Adding Consultants': CHART[7],
  "Didn't Pick Up": CHART[4]
}

export const CANDIDATE_STATUS_COLORS = {
  Interested: CHART[0],
  'Not Interested': CHART[1],
  'Rejected by Recruiter': CHART[2],
  'Client Submission': CHART[3],
  Interview: CHART[4],
  'Rejected by Client': CHART[5],
  Offered: CHART[6],
  'Offer Declined': CHART[7],
  Dropout: CHART[4],
  Hired: CHART[2]
}

export const MANDATE_STATUS_COLORS = {
  Ongoing: CHART[0],
  Completed: CHART[1],
  Scrapped: CHART[2]
}

export function normalizeStatus(status) {
  const value = String(status ?? '').trim()
  if (!value || value === '-') return '-'
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const lookup = (colors) => Object.fromEntries(
  Object.entries(colors).map(([status, color]) => [normalizeStatus(status), color])
)
const CLIENT_COLOR_LOOKUP = lookup(CLIENT_STATUS_COLORS)
const CANDIDATE_COLOR_LOOKUP = lookup(CANDIDATE_STATUS_COLORS)
const MANDATE_COLOR_LOOKUP = lookup(MANDATE_STATUS_COLORS)
const DEFAULT_STATUS_COLOR = 'var(--modern-chart-1)'

export const getClientStatusColor = (status) => CLIENT_COLOR_LOOKUP[normalizeStatus(status)] || DEFAULT_STATUS_COLOR
export const getCandidateStatusColor = (status) => CANDIDATE_COLOR_LOOKUP[normalizeStatus(status)] || DEFAULT_STATUS_COLOR
export const getMandateStatusColor = (status) => MANDATE_COLOR_LOOKUP[normalizeStatus(status)] || DEFAULT_STATUS_COLOR
