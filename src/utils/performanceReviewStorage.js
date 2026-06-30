export const PERFORMANCE_TABLE_KEY = 'performance'
export const PERFORMANCE_PERMISSION_EVENT = 'fb:performance-permissions-changed'

export const PERFORMANCE_COLUMNS = [
  { key: 'category', label: 'Category', width: 280 },
  { key: 'allocation', label: 'Allocation', width: 120 },
  { key: 'work_done', label: 'Work Done', width: 260 },
  { key: 'self_score', label: 'Self Score', width: 120 },
  { key: 'self_rating', label: 'Self Rating', width: 130, calculated: true },
  { key: 'ss_ns_feedback', label: 'SS/NS Feedback', width: 260 },
  { key: 'ss_ns_score', label: 'SS/NS Score', width: 120 },
  { key: 'ss_ns_rating', label: 'SS/NS Rating', width: 140, calculated: true },
  { key: 'ra_feedback', label: 'RA Feedback', width: 260 },
  { key: 'ra_score', label: 'RA Score', width: 120 },
  { key: 'final_rating', label: 'Final Rating', width: 140, calculated: true }
]

export const CALCULATED_PERFORMANCE_COLUMNS = new Set(['self_rating', 'ss_ns_rating', 'final_rating'])

export const DEFAULT_PERFORMANCE_ROWS = [
  { row_order: 1, category: 'Revenue and Mandate Lifecycle Management', allocation: 60, work_done: '', self_score: null, ss_ns_feedback: '', ss_ns_score: null, ra_feedback: '', ra_score: null },
  { row_order: 2, category: 'Business Development', allocation: 10, work_done: '', self_score: null, ss_ns_feedback: '', ss_ns_score: null, ra_feedback: '', ra_score: null },
  { row_order: 3, category: 'Business Enablement and Operational Excellence', allocation: 5, work_done: '', self_score: null, ss_ns_feedback: '', ss_ns_score: null, ra_feedback: '', ra_score: null },
  { row_order: 4, category: 'Interpersonal & Organizational Effectiveness', allocation: 10, work_done: '', self_score: null, ss_ns_feedback: '', ss_ns_score: null, ra_feedback: '', ra_score: null },
  { row_order: 5, category: 'Process Compliance', allocation: 15, work_done: '', self_score: null, ss_ns_feedback: '', ss_ns_score: null, ra_feedback: '', ra_score: null }
]

export const PERFORMANCE_PERMISSION_OPTIONS = [
  { value: 'everyone', label: 'Everyone', description: 'Visible and editable to everyone' },
  { value: 'super_admin_disabled', label: 'Super Admin Disabled', description: 'Visible but editable only by Super Admins' },
  { value: 'super_admin_hidden', label: 'Super Admin Hidden', description: 'Hidden from non-super-admins' }
]

export const DEFAULT_PERFORMANCE_PERMISSIONS = PERFORMANCE_COLUMNS.reduce((acc, column) => {
  acc[column.key] = 'everyone'
  return acc
}, {})

function cloneDefaultRows() {
  return DEFAULT_PERFORMANCE_ROWS.map(row => ({ ...row }))
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return cloneDefaultRows()
  return cloneDefaultRows().map((fallback, index) => ({ ...fallback, ...(rows[index] || {}) }))
}

export function formatRating(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : '0.00'
}

export function calculateRating(score, allocation) {
  return (Number(score) || 0) * (Number(allocation) || 0) / 100
}

export function calculateFinalRating(ssNsScore, raScore, allocation) {
  return (calculateRating(ssNsScore, allocation) + calculateRating(raScore, allocation)) / 2
}

export function normalizePerformanceRows(rows) {
  return normalizeRows(rows)
}

export function isPerformanceColumnHidden(permissions, columnKey, isSuperAdmin) {
  return !isSuperAdmin && permissions?.[columnKey] === 'super_admin_hidden'
}

export function isPerformanceColumnDisabled(permissions, columnKey, isSuperAdmin) {
  return !isSuperAdmin && permissions?.[columnKey] === 'super_admin_disabled'
}
