import { CANDIDATE_STATUSES, CANDIDATE_STATUS_BADGE_MAP } from '../../utils/candidateStatuses'
export const ASSIGNMENT_STATUSES = ['Not Contacted', 'Didn’t Pick Up', ...CANDIDATE_STATUSES]
export const ASSIGNMENT_STATUS_BADGE_MAP = { ...CANDIDATE_STATUS_BADGE_MAP, 'Not Contacted': 'badge-status-unset', 'Didn’t Pick Up': 'badge-interview' }
