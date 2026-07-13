const normalize = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[–—]/g, '-')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')

export function attendanceStatusTone(status) {
  const value = normalize(status)
  if (['present', 'clocked in'].includes(value)) return 'present'
  if (['leave', 'on leave', 'half day', 'half day leave'].includes(value)) return 'leave'
  if (value.includes('leave pending') || value === 'pending correction' || value === 'correction pending' || value === 'pending review') return 'pending'
  if (value === 'corrected') return 'corrected'
  if (value === 'holiday' || value.endsWith(' holiday')) return 'holiday'
  if (value === 'weekly off') return 'weekly'
  if (value.includes('leave rejected') || value === 'future') return 'future'
  if (['not marked', 'unmarked'].includes(value)) return 'unmarked'
  if (['approved', 'rejected', 'cancelled'].includes(value)) return value
  return 'neutral'
}

export const ATTENDANCE_LEGEND_STATUSES = [
  'Present',
  'Leave',
  'Half Day Leave',
  'Leave - Pending Approval',
  'Leave - Rejected',
  'Corrected',
  'Pending Correction',
  'Holiday',
  'Weekly Off',
  'Not Marked',
  'Future'
]
