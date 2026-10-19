const { CANDIDATE_STATUSES } = require('./candidateStatuses')
const { normalizeMobile } = require('./candidateCreation')

const NOT_CONTACTED = 'Not Contacted'
const DID_NOT_PICK_UP = 'Didn’t Pick Up'
const ASSIGNED_STATUSES = Object.freeze([NOT_CONTACTED, DID_NOT_PICK_UP, ...CANDIDATE_STATUSES])
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const isContacted = status => ASSIGNED_STATUSES.includes(status) && ![NOT_CONTACTED, DID_NOT_PICK_UP].includes(status)
const rowGroup = row => row.added_at ? 2 : row.status === NOT_CONTACTED ? 0 : row.status === DID_NOT_PICK_UP ? 1 : 2

function validateAssignment(input) {
  const name = String(input.full_name || '').replace(/\s+/g, ' ').trim()
  const mobile = input.mobile_number === '-' ? '-' : normalizeMobile(input.mobile_number)
  if (!name || name.length > 200) throw fail('Enter a candidate name (up to 200 characters).')
  if (mobile !== '-' && !/^\+?\d{7,15}$/.test(mobile)) throw fail('Enter a valid mobile number, or use the existing “-” placeholder if unavailable.')
  if (!ASSIGNED_STATUSES.includes(input.status)) throw fail('Select a valid candidate status.')
  for (const key of ['upload_id', 'client_id', 'job_id', 'assigned_consultant_id']) {
    if (!isUuid(input[key])) throw fail('Select a valid CV, client, mandate and active consultant.')
  }
  return { full_name: name, mobile_number: mobile, status: input.status, upload_id: input.upload_id,
    client_id: input.client_id, job_id: input.job_id, assigned_consultant_id: input.assigned_consultant_id }
}

function assignmentScope(user, admin, requested) {
  if (requested && !isUuid(requested)) throw fail('Select a valid consultant.')
  if (!admin && requested && requested !== user.id) throw fail('You can only view your own assignments.', 403)
  return admin ? requested || null : user.id
}

module.exports = { NOT_CONTACTED, DID_NOT_PICK_UP, ASSIGNED_STATUSES, isUuid, fail, isContacted, rowGroup, validateAssignment, assignmentScope }
