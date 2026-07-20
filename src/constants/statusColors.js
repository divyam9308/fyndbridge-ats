const STATUS_COLORS = {
  neutral: '#64748B',
  active: '#22C55E',
  inactive: '#94A3B8',
  converted: '#14B8A6',
  'not converted': '#EF4444',
  'follow up required': '#EC4899',
  'not hiring': '#3B82F6',
  'not adding consultants': '#EAB308',
  'didnt pick up': '#F97316',
  interested: '#14B8A6',
  'in discussion': '#7C6F9B',
  'not interested': '#A855F7',
  'rejected by recruiter': '#C026D3',
  'client submission': '#06B6D4',
  interview: '#6366F1',
  'rejected by client': '#EF4444',
  offered: '#10B981',
  'offer declined': '#F59E0B',
  dropout: '#92400E',
  hired: '#2563EB',
  'ongoing (p1)': '#0EA5E9',
  'delivered (p2)': '#8B5CF6',
  'paused (p3)': '#F59E0B',
  completed: '#22C55E',
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
