const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { scopeDashboardCandidateAssociations } = require('./dashboardCandidateAnalytics')
const { buildConsultantReportFacts } = require('./consultantReportLogic')
const { fetchEveryPage } = require('./supabasePagination')
const { dashboardPeriodRange } = require('../utils/dashboardPeriod')

const NOW = new Date('2026-07-27T12:00:00+05:30')
const RANGE = dashboardPeriodRange('FY 2026-27', NOW)
const RIA = { user_id: '11111111-1111-4111-8111-111111111111', name: 'Ria' }
const MOHIT = { user_id: '22222222-2222-4222-8222-222222222222', name: 'Mohit' }
const PROFILES = [RIA, MOHIT]
const dashboardControllerSource = fs.readFileSync(
  path.resolve(__dirname, '../controllers/dashboardController.js'),
  'utf8'
)

function association(id, candidateId, consultant, status, overrides = {}) {
  return {
    id,
    candidate_id: candidateId,
    consultant_user_id: consultant.user_id,
    consultant_name: consultant.name,
    status,
    created_at: '2026-07-10T06:30:00.000Z',
    ...overrides
  }
}

function scope(associations, consultant) {
  return scopeDashboardCandidateAssociations({
    associations,
    consultant,
    profiles: PROFILES,
    range: RANGE
  })
}

test('the same candidate counts once for each consultant association and twice overall', () => {
  const associations = [
    association('ria-association', 'candidate-1', RIA, 'Interested'),
    association('mohit-association', 'candidate-1', MOHIT, 'Interview')
  ]

  assert.equal(scope(associations, RIA.name).eligible.length, 1)
  assert.equal(scope(associations, MOHIT.name).eligible.length, 1)
  assert.equal(scope(associations, 'Overall (All Consultants)').eligible.length, 2)
})

test('two associations for the same consultant retain their separate statuses', () => {
  const result = scope([
    association('mohit-interested', 'candidate-1', MOHIT, 'Interested'),
    association('mohit-hired', 'candidate-1', MOHIT, 'Hired')
  ], MOHIT.name)
  const counts = result.eligible.reduce((total, row) => {
    total[row.canonicalStatus] = (total[row.canonicalStatus] || 0) + 1
    return total
  }, {})

  assert.equal(result.eligible.length, 2)
  assert.deepEqual(counts, { Interested: 1, Hired: 1 })
})

test('ownership uses consultant_user_id first and name only for legacy rows', () => {
  const result = scope([
    association('id-wins', 'candidate-1', MOHIT, 'Interested', { consultant_name: RIA.name }),
    association('legacy-match', 'candidate-2', RIA, 'Interview', { consultant_user_id: null }),
    association('legacy-other', 'candidate-3', MOHIT, 'Hired', { consultant_user_id: null })
  ], RIA.name)

  assert.deepEqual(result.eligible.map((row) => row.id), ['legacy-match'])
})

test('dashboard and consultant report count the same eligible association rows', () => {
  const associations = [
    association('valid-1', 'candidate-1', RIA, 'Interested'),
    association('valid-2', 'candidate-1', RIA, 'offered declined'),
    association('pending-dash', 'candidate-2', RIA, '-'),
    association('pending-null', 'candidate-3', RIA, null),
    association('unsupported', 'candidate-4', RIA, 'Selected'),
    association('other-owner', 'candidate-5', MOHIT, 'Hired'),
    association('after-company-day-end', 'candidate-6', RIA, 'Hired', {
      created_at: '2026-07-27T18:30:00.000Z'
    })
  ]
  const dashboard = scope(associations, RIA.name)
  const report = buildConsultantReportFacts({
    jobs: [],
    associations: [],
    candidateAssociations: associations,
    consultant: RIA,
    startDate: '2026-04-01',
    endDate: '2026-07-27'
  })

  assert.equal(dashboard.eligible.length, 2)
  assert.equal(dashboard.pendingCount, 3)
  assert.equal(dashboard.eligible.length, report.candidateOverview.total)
  assert.deepEqual(
    dashboard.eligible.map((row) => row.canonicalStatus).sort(),
    ['Interested', 'Offer Declined']
  )
})

test('pagination loads more than 1,000 candidates and associations without a fixed maximum', async () => {
  const candidates = Array.from({ length: 1005 }, (_, index) => ({
    id: `candidate-${String(index).padStart(4, '0')}`
  }))
  const associations = candidates.map((candidate, index) => association(
    `association-${String(index).padStart(4, '0')}`,
    candidate.id,
    RIA,
    index % 2 ? 'Interested' : 'Interview'
  ))
  const candidateRanges = []
  const associationRanges = []
  const queryFactory = (rows, ranges) => () => ({
    async range(from, to) {
      ranges.push([from, to])
      return { data: rows.slice(from, to + 1), error: null }
    }
  })

  const loadedCandidates = await fetchEveryPage(queryFactory(candidates, candidateRanges))
  const loadedAssociations = await fetchEveryPage(queryFactory(associations, associationRanges))
  const dashboard = scope(loadedAssociations, RIA.name)

  assert.equal(loadedCandidates.length, 1005)
  assert.equal(loadedAssociations.length, 1005)
  assert.equal(dashboard.eligible.length, 1005)
  assert.deepEqual(candidateRanges, [[0, 999], [1000, 1999]])
  assert.deepEqual(associationRanges, [[0, 999], [1000, 1999]])
})

test('candidate totals do not depend on a related candidates-table row', () => {
  const result = scope([
    association('association-only', 'candidate-not-in-loaded-table', RIA, 'Interested')
  ], RIA.name)

  assert.equal(result.eligible.length, 1)
})

test('dashboard controller uses the eligible association scope for every main candidate metric', () => {
  assert.doesNotMatch(dashboardControllerSource, /filteredCandidateIds|filteredCandidates/)
  assert.match(dashboardControllerSource, /totalCandidates: filteredAssociations\.length/)
  assert.match(dashboardControllerSource, /hiredAssociations = filteredAssociations\.filter/)
  assert.match(dashboardControllerSource, /candidateTrend = statusTrend\(filteredAssociations/)
  assert.match(dashboardControllerSource, /candidateStatusData: countByStatus\(filteredAssociations/)
})

test('all dashboard table reads page deterministically and the backend fallback is the current FY', () => {
  for (const table of ['clients', 'candidates', 'candidate_associations', 'jobs']) {
    assert.match(
      dashboardControllerSource,
      new RegExp(`fetchEveryPage\\(\\(\\) => supabase\\.from\\('${table}'\\)[\\s\\S]*?\\.order\\('id'\\)`)
    )
  }
  assert.match(dashboardControllerSource, /clean\(req\.query\.period\) \|\| currentDashboardFinancialYear\(\)/)
})
