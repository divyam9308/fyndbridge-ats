const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  CANDIDATE_STATUSES,
  DASHBOARD_CANDIDATE_STATUSES,
  REQUIRED_CANDIDATE_STATUS_ERROR,
  candidateStatusError,
  canonicalCandidateStatus,
  normalizeDashboardCandidateStatus
} = require('./candidateStatuses')
const { validateAiFilters } = require('./filterEngine')

const root = path.resolve(__dirname, '../../..')
const candidateController = fs.readFileSync(path.join(root, 'server/src/controllers/candidateController.js'), 'utf8')
const candidatesPage = fs.readFileSync(path.join(root, 'src/pages/CandidatesPage.jsx'), 'utf8')
const frontendStatuses = fs.readFileSync(path.join(root, 'src/utils/candidateStatuses.js'), 'utf8')
const clientDetailPage = fs.readFileSync(path.join(root, 'src/pages/ClientDetailPage.jsx'), 'utf8')
const dashboardController = fs.readFileSync(path.join(root, 'server/src/controllers/dashboardController.js'), 'utf8')
const importScript = fs.readFileSync(path.join(root, 'server/scripts/import-master-database.js'), 'utf8')

test('In Discussion is canonical and immediately follows Interested', () => {
  assert.equal(CANDIDATE_STATUSES[CANDIDATE_STATUSES.indexOf('Interested') + 1], 'In Discussion')
  assert.equal(DASHBOARD_CANDIDATE_STATUSES.at(-1), '-')
  for (const value of ['in discussion', 'In discussion', 'IN DISCUSSION', 'In Discussion']) {
    assert.equal(canonicalCandidateStatus(value), 'In Discussion')
  }
})

test('required candidate status rejects every placeholder form and accepts valid trimmed status', () => {
  for (const value of ['', ' ', '-', null, undefined]) {
    assert.equal(candidateStatusError(value), REQUIRED_CANDIDATE_STATUS_ERROR)
  }
  assert.equal(candidateStatusError(' In Discussion '), '')
  assert.match(candidateStatusError('Unknown Stage'), /^status must be one of:/)
})

test('dashboard groups all incomplete legacy values under the dash category', () => {
  for (const value of ['-', '', ' ', '\t\n', null, undefined]) {
    assert.equal(normalizeDashboardCandidateStatus(value), '-')
  }
  assert.equal(normalizeDashboardCandidateStatus('In Discussion'), 'In Discussion')
  assert.equal(normalizeDashboardCandidateStatus('Interested'), 'Interested')
})

test('candidate AI filtering recognizes In Discussion as an exact status', () => {
  for (const prompt of ['show candidates in discussion', 'status is in discussion']) {
    assert.deepEqual(validateAiFilters('candidates', null, prompt), {
      conditions: [{ field: 'status', operator: 'equals', value: 'In Discussion' }]
    })
  }
})

test('candidate create, edit, resume review and client edit use compulsory status validation', () => {
  assert.match(candidateController, /validateCandidatePayload\(body, \{ partial: true, requireStatus: true \}\)/)
  assert.match(candidateController, /const statusError = candidateStatusError\(body\.status\)/)
  assert.doesNotMatch(candidateController, /nextPayload\.status[\s\S]{0,180}: '-'/)
  assert.match(candidatesPage, /if \(!isCandidateStatusSelected\(f\.status\)\) e\.status = REQUIRED_CANDIDATE_STATUS_ERROR/)
  assert.match(candidatesPage, /errs: parsedErrors/)
  assert.match(candidatesPage, /Status <span className="req">\*<\/span>/)
  assert.match(frontendStatuses, /return status === '-' \? '' : status/)
  assert.match(clientDetailPage, /if \(!isCandidateStatusSelected\(editForm\.status\)\)/)
  assert.match(clientDetailPage, /editErrors\.status \? ' is-error'/)
})

test('dashboard, dash drilldown and import normalization use shared candidate statuses', () => {
  assert.match(dashboardController, /DASHBOARD_CANDIDATE_STATUSES: CANDIDATE_STATUSES/)
  assert.match(candidateController, /status\.match\.\^\\\\s\*\$/)
  assert.match(importScript, /canonicalCandidateStatus\(status\)/)
  assert.doesNotMatch(importScript, /'in discussion': 'Interested'/)
  assert.doesNotMatch(importScript, /status \|\| 'Interested'/)
})
