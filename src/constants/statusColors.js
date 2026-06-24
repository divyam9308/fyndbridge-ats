const STATUS_COLORS = {
  neutral: '#64748B',
  active: '#16A34A',
  inactive: '#94A3B8',
  converted: '#0F766E',
  'not converted': '#DC2626',
  'follow up required': '#C026D3',
  'not hiring': '#0284C7',
  'not adding consultants': '#CA8A04',
  'didnt pick up': '#F97316',
  interested: '#16A34A',
  'not interested': '#64748B',
  'rejected by recruiter': '#DB2777',
  'client submission': '#0891B2',
  interview: '#4F46E5',
  'rejected by client': '#B91C1C',
  offered: '#0D9488',
  'offer declined': '#D97706',
  dropout: '#92400E',
  hired: '#2563EB',
  ongoing: '#2563EB',
  completed: '#059669',
  scrapped: '#64748B'
}

export function normalizeStatus(status) {
  const value = String(status ?? '').trim()
  if (!value || value === '-') return '-'
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[â€™'’]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getStatusColor(status) {
  const key = normalizeStatus(status)
  return key === '-' ? STATUS_COLORS.neutral : STATUS_COLORS[key] || STATUS_COLORS.neutral
}

export const getClientStatusColor = getStatusColor
export const getCandidateStatusColor = getStatusColor
export const getMandateStatusColor = getStatusColor
