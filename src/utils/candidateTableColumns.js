export const CANDIDATE_TABLE_COLUMNS = [
  { key: 'candidateDisplayId', label: 'Candidate ID', width: 130 },
  { key: 'date', label: 'Date', width: 130 },
  { key: 'consultant', label: 'Consultant', width: 180 },
  { key: 'client', label: 'Client Name', width: 220 },
  { key: 'clientId', label: 'Client ID', width: 130 },
  { key: 'jobId', label: 'Job ID', width: 130 },
  { key: 'job', label: 'Role', width: 220 },
  { key: 'name', label: 'Candidate Name', width: 240 },
  { key: 'organisation', label: 'Organisation', width: 220 },
  { key: 'designation', label: 'Designation', width: 220 },
  { key: 'mobile', label: 'Mobile', width: 150 },
  { key: 'email', label: 'Email ID', width: 240 },
  { key: 'experience', label: 'Experience', width: 130 },
  { key: 'skills', label: 'Skills', width: 280 },
  { key: 'salary', label: 'Current CTC', width: 150 },
  { key: 'notice', label: 'Notice Period', width: 160 },
  { key: 'expectedSalary', label: 'Expected CTC', width: 160 },
  { key: 'relocate', label: 'Open to Relocate', width: 170 },
  { key: 'comments', label: 'Comments', width: 260 },
  { key: 'linkedin', label: 'LinkedIn', width: 130 },
  { key: 'status', label: 'Status', width: 180 },
  { key: 'offeredCtc', label: 'Offered CTC', width: 150 },
  { key: 'dateOfJoining', label: 'Date of Joining', width: 160 },
  { key: 'cv', label: 'CV', width: 110 },
  { key: 'month', label: 'Month', width: 130 },
  { key: 'action', label: 'Action', width: 130 },
]

export const DEFAULT_CANDIDATE_COLUMN_KEYS = CANDIDATE_TABLE_COLUMNS.map(column => column.key)
const REMOVED_CANDIDATE_COLUMN_KEYS = new Set(['location', 'region'])

export const mergeCandidateColumnPreference = (value) => {
  const saved = Array.isArray(value)
    ? value.filter(key => !REMOVED_CANDIDATE_COLUMN_KEYS.has(key) && DEFAULT_CANDIDATE_COLUMN_KEYS.includes(key))
    : []
  if (!saved.length) return null
  return saved
}
