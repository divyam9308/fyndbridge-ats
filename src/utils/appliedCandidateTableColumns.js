export const APPLIED_CANDIDATE_TABLE_COLUMNS = [
  { key: 'name', label: 'Candidate Name', width: 200 },
  { key: 'publicRole', label: 'Applied Public Role', width: 190 },
  { key: 'mandateRole', label: 'Internal Mandate/Role', width: 200 },
  { key: 'client', label: 'Client Name', width: 180 },
  { key: 'clientId', label: 'Client ID', width: 110, center: true },
  { key: 'email', label: 'Email', width: 220 },
  { key: 'mobile', label: 'Mobile', width: 145 },
  { key: 'designation', label: 'Current Designation', width: 180 },
  { key: 'organisation', label: 'Current Organization', width: 190 },
  { key: 'experience', label: 'Experience', width: 110, center: true },
  { key: 'location', label: 'Current Location', width: 160 },
  { key: 'skills', label: 'Skills', width: 220 },
  { key: 'currentCtc', label: 'Current CTC', width: 130, center: true },
  { key: 'expectedCtc', label: 'Expected CTC', width: 130, center: true },
  { key: 'noticePeriod', label: 'Notice Period', width: 130, center: true },
  { key: 'relocate', label: 'Open to Relocate', width: 120, center: true },
  { key: 'appliedOn', label: 'Applied On', width: 170, center: true },
  { key: 'status', label: 'Application Status', width: 140, center: true },
  { key: 'cv', label: 'CV', width: 80, center: true },
  { key: 'consultant', label: 'Assigned Consultant', width: 180 },
  { key: 'actions', label: 'Actions', width: 220, center: true },
]

export const DEFAULT_APPLIED_COLUMN_KEYS = APPLIED_CANDIDATE_TABLE_COLUMNS.map(column => column.key)
export const APPLIED_COLUMNS_PREFERENCE_KEY = 'appliedCandidatesTableColumns'

export function mergeAppliedColumnPreference(value) {
  const saved = Array.isArray(value)
    ? [...new Set(value.filter(key => DEFAULT_APPLIED_COLUMN_KEYS.includes(key)))]
    : []
  return saved.length ? saved : null
}
