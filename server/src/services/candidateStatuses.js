const CANDIDATE_STATUSES = [
  'Interested',
  'In Discussion',
  'Not Interested',
  'Interview',
  'Client Submission',
  'Offered',
  'Hired',
  'Offer Declined',
  'Dropout',
  'Rejected by Recruiter',
  'Rejected by Client'
]

const DASHBOARD_CANDIDATE_STATUSES = [...CANDIDATE_STATUSES, '-']
const REQUIRED_CANDIDATE_STATUS_ERROR = "Please select a status other than '-'."

function cleanStatus(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function canonicalCandidateStatus(value) {
  const status = cleanStatus(value)
  if (!status) return ''
  if (status.toLowerCase() === 'offered declined') return 'Offer Declined'
  return CANDIDATE_STATUSES.find(candidateStatus => candidateStatus.toLowerCase() === status.toLowerCase()) || ''
}

function candidateStatusError(value) {
  const status = cleanStatus(value)
  if (!status || status === '-') return REQUIRED_CANDIDATE_STATUS_ERROR
  if (!CANDIDATE_STATUSES.includes(status)) return `status must be one of: ${CANDIDATE_STATUSES.join(', ')}`
  return ''
}

function normalizeDashboardCandidateStatus(value) {
  const status = cleanStatus(value)
  if (!status || status === '-') return '-'
  return canonicalCandidateStatus(status) || status
}

module.exports = {
  CANDIDATE_STATUSES,
  DASHBOARD_CANDIDATE_STATUSES,
  REQUIRED_CANDIDATE_STATUS_ERROR,
  candidateStatusError,
  canonicalCandidateStatus,
  cleanStatus,
  normalizeDashboardCandidateStatus
}
