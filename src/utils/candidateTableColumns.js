export const CANDIDATE_TABLE_COLUMNS = [
  { key: 'candidateDisplayId', label: 'Candidate ID' },
  { key: 'date', label: 'Date' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'client', label: 'Client Name' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'billingEntity', label: 'Billing Entity' },
  { key: 'jobId', label: 'Job ID' },
  { key: 'job', label: 'Role' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'designation', label: 'Designation' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email ID' },
  { key: 'experience', label: 'Experience' },
  { key: 'skills', label: 'Skills' },
  { key: 'salary', label: 'Current CTC' },
  { key: 'location', label: 'Current Location' },
  { key: 'notice', label: 'Notice Period' },
  { key: 'expectedSalary', label: 'Expected CTC' },
  { key: 'relocate', label: 'Open to Relocate' },
  { key: 'comments', label: 'Comments' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'status', label: 'Status' },
  { key: 'offeredCtc', label: 'Offered CTC' },
  { key: 'dateOfJoining', label: 'Date of Joining' },
  { key: 'cv', label: 'CV' },
  { key: 'month', label: 'Month' },
  { key: 'action', label: 'Action' },
]

export const DEFAULT_CANDIDATE_COLUMN_KEYS = CANDIDATE_TABLE_COLUMNS.map(column => column.key)

export const mergeCandidateColumnPreference = (value) => {
  const saved = Array.isArray(value) ? value.filter(key => DEFAULT_CANDIDATE_COLUMN_KEYS.includes(key)) : []
  if (!saved.length) return null
  return [...saved, ...DEFAULT_CANDIDATE_COLUMN_KEYS.filter(key => !saved.includes(key))]
}
