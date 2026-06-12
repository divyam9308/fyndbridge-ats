export const CANDIDATE_STATUSES = [
  'Interested',
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

export const CANDIDATE_STATUS_OPTIONS = ['', ...CANDIDATE_STATUSES]

export const CANDIDATE_STATUS_BADGE_MAP = {
  Interested: 'badge-interested',
  'Not Interested': 'badge-not-interested',
  Interview: 'badge-interview',
  'Client Submission': 'badge-client-submission',
  Offered: 'badge-offered',
  Hired: 'badge-hired',
  'Offer Declined': 'badge-offer-declined',
  Dropout: 'badge-dropout',
  'Rejected by Recruiter': 'badge-rejected-recruiter',
  'Rejected by Client': 'badge-rejected-client',
}
