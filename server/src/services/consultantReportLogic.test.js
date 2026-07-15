const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CANDIDATE_STATUSES,
  MANDATE_STATUSES,
  aggregateConsultantReportFacts,
  buildCandidatePipeline,
  buildConsultantReportFacts,
  canonicalMandateStatus,
  consultantMatches,
  paginateReportRows,
  parseReportRequest
} = require('./consultantReportLogic')

const CONSULTANT = { user_id: '11111111-1111-4111-8111-111111111111', name: 'Asha Rao' }
const SECOND_CONSULTANT = { user_id: '22222222-2222-4222-8222-222222222222', name: 'Bina Shah' }
const START = '2026-07-01'
const END = '2026-07-15'

function job(overrides = {}) {
  return {
    id: overrides.id || 'job-1',
    title: 'Backend Engineer',
    consultants: ['Asha Rao'],
    team_lead: 'Team Lead',
    budget: '20 LPA',
    mandate_status: 'Ongoing',
    vertical: 'Technology',
    allocation_date: START,
    created_at: `${START}T00:00:00.000Z`,
    clients: { client_name: 'Acme' },
    ...overrides
  }
}

function association(jobId, status, overrides = {}) {
  return {
    id: `${jobId}-${String(status || 'unset')}`,
    candidate_id: `${jobId}-${String(status || 'unset')}`,
    job_id: jobId,
    status,
    consultant_name: CONSULTANT.name,
    consultant_user_id: CONSULTANT.user_id,
    created_at: `${START}T06:30:00.000Z`,
    client_submission_at: null,
    interview_at: null,
    offered_at: null,
    hired_at: null,
    ...overrides
  }
}

function facts(jobs, associations, overrides = {}) {
  return buildConsultantReportFacts({
    jobs,
    associations,
    candidateAssociations: overrides.candidateAssociations,
    consultant: CONSULTANT,
    startDate: overrides.startDate || START,
    endDate: overrides.endDate || END
  })
}

function byKey(rows) {
  return Object.fromEntries(rows.map((row) => [row.key, row]))
}

test('report uses exactly the shared eleven candidate statuses and three mandate statuses', () => {
  assert.deepEqual(CANDIDATE_STATUSES, [
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
  ])
  assert.equal(MANDATE_STATUSES.length, 3)
  assert.deepEqual([...MANDATE_STATUSES].sort(), ['Completed', 'Ongoing', 'Scrapped'])
  assert.equal(canonicalMandateStatus('open'), 'Ongoing')
  assert.equal(canonicalMandateStatus('P1'), 'Ongoing')
  assert.equal(canonicalMandateStatus('closed'), 'Completed')
  assert.equal(canonicalMandateStatus('Filled'), 'Completed')
  assert.equal(canonicalMandateStatus('scrap'), 'Scrapped')
  assert.equal(canonicalMandateStatus('unknown'), '')
})

test('mandate scope excludes team-lead-only mandates while candidate scope follows association ownership', () => {
  const consultantMandate = job({
    id: 'consultant-owned',
    consultants: ['  ASHA RAO  '],
    team_lead: 'Another Lead'
  })
  const teamLeadOnlyMandate = job({
    id: 'team-lead-only',
    consultants: ['Another Consultant'],
    team_lead: 'Asha Rao'
  })
  const result = facts(
    [consultantMandate, teamLeadOnlyMandate],
    [
      association('consultant-owned', 'Interested'),
      association('team-lead-only', 'Hired')
    ]
  )

  assert.equal(consultantMatches(consultantMandate, CONSULTANT.name), true)
  assert.equal(consultantMatches(teamLeadOnlyMandate, CONSULTANT.name), false)
  assert.deepEqual(result.mandateSummary, { total: 1, ongoing: 1, completed: 0, scrapped: 0 })
  assert.equal(result.candidateOverview.total, 2)
  assert.equal(result.candidateOverview.counts.Interested, 1)
  assert.equal(result.candidateOverview.counts.Hired, 1)
  assert.deepEqual(result.mandates.map((row) => row.key), ['consultant-owned'])
  assert.deepEqual(result.recentMandates.map((row) => row.key), ['consultant-owned'])
  assert.deepEqual(result.recentConversions.map((row) => row.key), ['consultant-owned'])
})

test('candidate aggregation counts association rows at mandate grain and reconciles all eleven statuses', () => {
  const statuses = [...CANDIDATE_STATUSES]
  const result = facts(
    [job({ id: 'job-1' }), job({ id: 'job-2', mandate_status: 'Completed', allocation_date: '2026-07-02' })],
    [
      ...statuses.map((status, index) => association('job-1', status, { candidate_id: `person-${index}` })),
      association('job-2', 'Interested', { candidate_id: 'person-0' })
    ]
  )

  const rows = byKey(result.mandates)
  assert.equal(rows['job-1'].candidatesAssigned, 11)
  assert.deepEqual(rows['job-1'].counts, Object.fromEntries(statuses.map((status) => [status, 1])))
  assert.equal(rows['job-2'].candidatesAssigned, 1)
  assert.equal(result.candidateOverview.total, 12)
  assert.equal(result.candidateOverview.counts.Interested, 2)
  assert.equal(
    result.candidateOverview.total,
    Object.values(result.candidateOverview.counts).reduce((sum, count) => sum + count, 0)
  )

  // The same candidate person legitimately counts once under each association/mandate.
  assert.equal(result.candidateOverview.total, 12)
})

test('candidate overview follows association owner and added date independently from mandate scope', () => {
  const result = facts(
    [job({ id: 'in-period-mandate' })],
    [association('in-period-mandate', 'Interview', { id: 'mandate-workload' })],
    {
      candidateAssociations: [
        association('older-mandate', 'Interested', {
          id: 'older-mandate-current-addition',
          created_at: '2026-07-04T10:00:00.000Z'
        }),
        association('in-period-mandate', 'Hired', {
          id: 'after-report-end',
          created_at: '2026-07-15T20:00:00.000Z'
        }),
        association('in-period-mandate', 'Hired', {
          id: 'different-owner',
          consultant_user_id: '22222222-2222-4222-8222-222222222222',
          consultant_name: 'Another Consultant'
        }),
        association('legacy-mandate', 'Offered', {
          id: 'legacy-name-match',
          consultant_user_id: null,
          consultant_name: '  ASHA   RAO  '
        }),
        association('legacy-mandate', 'Interview', {
          id: 'legacy-name-mismatch',
          consultant_user_id: null,
          consultant_name: 'Another Consultant'
        }),
        association(null, 'Client Submission', { id: 'missing-job-valid-addition' }),
        association('older-mandate', '-', { id: 'unset-status' })
      ]
    }
  )

  assert.deepEqual(result.mandateSummary, { total: 1, ongoing: 1, completed: 0, scrapped: 0 })
  assert.equal(result.mandates[0].candidatesAssigned, 1)
  assert.equal(result.candidateOverview.total, 3)
  assert.equal(result.candidateOverview.counts.Interested, 1)
  assert.equal(result.candidateOverview.counts.Offered, 1)
  assert.equal(result.candidateOverview.counts['Client Submission'], 1)
  assert.equal(result.candidateOverview.counts.Hired, 0)
  assert.equal(result.candidatePipeline.find((stage) => stage.key === 'total').count, 3)
  assert.ok(result.warnings.some((warning) => warning.code === 'invalid_candidate_status' && warning.count === 1))
})

test('candidate added-date scope uses inclusive Asia/Kolkata calendar boundaries', () => {
  const result = facts([], [], {
    candidateAssociations: [
      association('job', 'Interested', { id: 'before-start', created_at: '2026-06-30T18:29:59.999Z' }),
      association('job', 'Interested', { id: 'at-start', created_at: '2026-06-30T18:30:00.000Z' }),
      association('job', 'Interested', { id: 'at-end', created_at: '2026-07-15T18:29:59.999Z' }),
      association('job', 'Interested', { id: 'after-end', created_at: '2026-07-15T18:30:00.000Z' })
    ]
  })

  assert.equal(result.candidateOverview.total, 2)
  assert.equal(result.candidateOverview.counts.Interested, 2)
})

test('candidate additions are not suppressed by an unsupported mandate status', () => {
  const result = facts(
    [job({ id: 'valid' }), job({ id: 'unknown', mandate_status: 'Mystery' })],
    [
      association('valid', 'Interested'),
      association('valid', null),
      association('valid', 'Selected'),
      association('unknown', 'Interested')
    ]
  )

  assert.equal(result.mandateSummary.total, 1)
  assert.deepEqual(result.mandateSummary, { total: 1, ongoing: 1, completed: 0, scrapped: 0 })
  assert.equal(result.candidateOverview.total, 2)
  assert.equal(result.candidateOverview.counts.Interested, 2)
  assert.equal(Object.values(result.candidateOverview.counts).reduce((sum, count) => sum + count, 0), 2)

  const warnings = byKey(result.warnings.map((warning) => ({ ...warning, key: warning.code })))
  assert.equal(warnings.unknown_mandate_status.count, 1)
  assert.equal(warnings.invalid_candidate_status.count, 2)
})

test('created-at fallback applies the company local date at UTC boundaries', () => {
  const result = facts([
    job({ id: 'local-start', allocation_date: null, created_at: '2026-06-30T20:00:00.000Z' }),
    job({ id: 'local-end', allocation_date: null, created_at: '2026-07-15T20:00:00.000Z' })
  ], [])

  assert.deepEqual(result.mandates.map((row) => row.key), ['local-start'])
  assert.equal(result.mandates[0].allocationDate, '2026-07-01')
})

test('invalid current statuses remain linked for workload, exceptions and tracked conversions', () => {
  const result = facts(
    [job({ id: 'invalid-current' })],
    [association('invalid-current', 'Selected', { interview_at: '2026-07-05T12:00:00.000Z' })]
  )
  const row = result.mandates[0]

  assert.equal(row.candidatesAssigned, 1)
  assert.equal(result.candidateOverview.total, 0)
  assert.equal(result.exceptions.find((item) => item.key === 'withoutCandidates').value, 0)
  assert.equal(result.exceptions.find((item) => item.key === 'withoutClientSubmission').value, 0)
  assert.equal(result.exceptions.find((item) => item.key === 'withoutInterview').value, 0)
  assert.equal(row.firstInterviewDays, 4)
  assert.equal(result.conversionSummary.find((item) => item.key === 'interview').trackedMandates, 1)
  assert.ok(result.warnings.some((warning) => warning.code === 'invalid_candidate_status'))
})

test('candidate pipeline uses the candidate total as every stage denominator', () => {
  const overview = {
    total: 20,
    counts: {
      Interested: 10,
      'Client Submission': 8,
      Interview: 4,
      Offered: 2,
      Hired: 1
    }
  }
  const pipeline = byKey(buildCandidatePipeline(overview))

  assert.deepEqual(
    ['total', 'interested', 'clientSubmission', 'interview', 'offered', 'hired'].map((key) => pipeline[key].percentage),
    [100, 50, 40, 20, 10, 5]
  )
  for (const stage of Object.values(pipeline)) {
    assert.match(stage.description, /of Total$/)
    assert.ok(Number.isFinite(stage.percentage))
    assert.ok(stage.percentage >= 0)
  }
})

test('candidate pipeline safely returns finite zero percentages when total is zero', () => {
  const pipeline = buildCandidatePipeline({
    total: 0,
    counts: Object.fromEntries(CANDIDATE_STATUSES.map((status) => [status, 0]))
  })
  assert.deepEqual(pipeline.map((stage) => stage.percentage), [0, 0, 0, 0, 0, 0])
  assert.ok(pipeline.every((stage) => Number.isFinite(stage.percentage) && !stage.description.includes('NaN')))
})

test('conversion uses one earliest valid timestamp per mandate and excludes null or pre-start timestamps', () => {
  const result = facts(
    [
      job({ id: 'job-1' }),
      job({ id: 'job-2', allocation_date: '2026-07-02' }),
      job({ id: 'job-3', allocation_date: '2026-07-03' }),
      job({ id: 'job-4', allocation_date: '2026-07-04' })
    ],
    [
      association('job-1', 'Interested', { client_submission_at: '2026-07-09T12:00:00.000Z' }),
      association('job-1', 'Client Submission', { client_submission_at: '2026-07-05T12:00:00.000Z' }),
      association('job-2', 'Interested'),
      association('job-3', 'Client Submission', { client_submission_at: '2026-07-13T12:00:00.000Z' }),
      association('job-4', 'Client Submission', { client_submission_at: '2026-07-03T12:00:00.000Z' })
    ]
  )

  const rows = byKey(result.mandates)
  assert.equal(rows['job-1'].firstClientSubmissionDays, 4)
  assert.equal(rows['job-2'].firstClientSubmissionDays, null)
  assert.equal(rows['job-3'].firstClientSubmissionDays, 10)
  assert.equal(rows['job-4'].firstClientSubmissionDays, null)
  assert.equal(rows['job-4'].firstClientSubmissionLabel, 'Not tracked')

  const submission = result.conversionSummary.find((stage) => stage.key === 'clientSubmission')
  assert.deepEqual(submission, {
    key: 'clientSubmission',
    label: 'Mandate → First Client Submission',
    averageDays: 7,
    displayValue: '7 days',
    trackedMandates: 2,
    untrackedMandates: 2,
    tone: 'blue'
  })
  assert.ok(result.warnings.some((warning) => warning.code === 'stage_before_mandate_start'))
})

test('conversion averages each mandate once instead of averaging every association timestamp', () => {
  const result = facts(
    [job({ id: 'one' }), job({ id: 'two' })],
    [
      association('one', 'Interview', { interview_at: '2026-07-03T12:00:00.000Z' }),
      association('one', 'Interview', { interview_at: '2026-07-15T12:00:00.000Z' }),
      association('two', 'Interview', { interview_at: '2026-07-11T12:00:00.000Z' })
    ]
  )
  const interview = result.conversionSummary.find((stage) => stage.key === 'interview')

  // Mandate durations are 2 and 10 days, so the mandate-level average is 6.
  assert.equal(interview.averageDays, 6)
  assert.equal(interview.trackedMandates, 2)
  assert.equal(interview.untrackedMandates, 0)
})

test('ongoing age, completed final duration and scrapped duration follow their distinct rules', () => {
  const result = facts(
    [
      job({ id: 'ongoing', allocation_date: '2026-05-01' }),
      job({ id: 'completed', mandate_status: 'Completed', allocation_date: '2026-06-01' }),
      job({ id: 'scrapped', mandate_status: 'Scrapped', allocation_date: '2026-06-10' })
    ],
    [
      association('completed', 'Hired', { hired_at: '2026-06-15T12:00:00.000Z' }),
      association('completed', 'Hired', { hired_at: '2026-06-10T12:00:00.000Z' })
    ],
    { startDate: '2026-05-01', endDate: '2026-07-01' }
  )
  const rows = byKey(result.mandates)

  assert.equal(rows.ongoing.ageDays, 61)
  assert.equal(rows.ongoing.durationLabel, '61 d (ongoing)')
  assert.equal(rows.ongoing.isAgeingWarning, true)
  assert.equal(rows.completed.firstHireDays, 9)
  assert.equal(rows.completed.durationLabel, '9 d (final)')
  assert.equal(rows.scrapped.durationLabel, '—')
  assert.equal(rows.scrapped.isAgeingWarning, false)
})

test('legacy Ongoing plus Hired data is reconciled for display and emits a warning', () => {
  const result = facts(
    [job({ id: 'legacy-hire', mandate_status: 'Ongoing' })],
    [association('legacy-hire', 'Hired')]
  )
  assert.equal(result.mandates[0].status, 'Completed')
  assert.equal(result.mandates[0].counts.Hired, 1)
  assert.equal(result.mandateSummary.ongoing, 0)
  assert.equal(result.mandateSummary.completed, 1)
  assert.ok(result.warnings.some((warning) => warning.code === 'ongoing_mandate_with_hire'))
})

test('valid tracked Hire evidence keeps a mandate Completed after the candidate leaves Hired', () => {
  const result = facts(
    [job({ id: 'tracked-hire', mandate_status: 'Ongoing' })],
    [association('tracked-hire', 'Dropout', { hired_at: '2026-07-06T12:00:00.000Z' })]
  )

  assert.equal(result.mandates[0].status, 'Completed')
  assert.equal(result.mandates[0].counts.Hired, 0)
  assert.equal(result.mandates[0].firstHireDays, 5)
  assert.equal(result.mandates[0].durationLabel, '5 d (final)')
  assert.ok(result.warnings.some((warning) => warning.code === 'ongoing_mandate_with_hire'))
})

test('all exception metrics and positive outcomes use documented current-state evidence', () => {
  const recentDate = '2026-07-01'
  const jobs = [
    job({ id: 'empty', allocation_date: recentDate }),
    job({ id: 'interested', allocation_date: recentDate }),
    job({ id: 'interview', allocation_date: recentDate }),
    job({ id: 'offered', allocation_date: recentDate }),
    job({ id: 'hired', allocation_date: recentDate }),
    job({ id: 'submission', allocation_date: recentDate }),
    job({ id: 'tracked-submission', allocation_date: recentDate }),
    job({ id: 'all-rejected', allocation_date: recentDate }),
    job({ id: 'ageing', allocation_date: '2026-05-01' }),
    job({ id: 'dropout', allocation_date: recentDate }),
    job({ id: 'offer-declined', allocation_date: recentDate })
  ]
  const associations = [
    association('interested', 'Interested'),
    association('interview', 'Interview'),
    association('offered', 'Offered'),
    association('hired', 'Hired'),
    association('submission', 'Client Submission'),
    association('tracked-submission', 'Interested', { client_submission_at: '2026-07-05T12:00:00.000Z' }),
    association('all-rejected', 'Not Interested'),
    association('all-rejected', 'Rejected by Recruiter'),
    association('all-rejected', 'Rejected by Client'),
    association('ageing', 'Interested'),
    association('dropout', 'Dropout'),
    association('offer-declined', 'Offer Declined')
  ]
  const result = facts(jobs, associations, { startDate: '2026-05-01', endDate: END })

  assert.deepEqual(Object.fromEntries(result.exceptions.map((item) => [item.key, item.value])), {
    withoutCandidates: 1,
    withoutClientSubmission: 5,
    withoutInterview: 2,
    allRejected: 1,
    ageing: 1
  })
  assert.deepEqual(Object.fromEntries(result.positiveOutcomes.map((item) => [item.key, item.value])), {
    hiredCandidates: 1,
    offeredCandidates: 1,
    completedMandates: 1,
    mandatesWithHire: 1,
    clientSubmissions: 1,
    interviews: 1
  })
})

test('recent main-report tables contain only the five newest mandates and conversions', () => {
  const jobs = Array.from({ length: 8 }, (_, index) => job({
    id: `job-${index + 1}`,
    allocation_date: `2026-07-${String(index + 1).padStart(2, '0')}`
  }))
  const result = facts(jobs, [])
  const expected = ['job-8', 'job-7', 'job-6', 'job-5', 'job-4']
  assert.deepEqual(result.recentMandates.map((row) => row.key), expected)
  assert.deepEqual(result.recentConversions.map((row) => row.key), expected)
  assert.equal(result.recentMandates.length, 5)
  assert.equal(result.recentConversions.length, 5)
})

test('modal pagination filters, searches, sorts and clamps out-of-range pages', () => {
  const rows = [
    { key: 'a', consultant: 'Asha', teamLead: 'Lead', clientName: 'Zeta', role: 'Engineer', sector: 'Tech', status: 'Ongoing', allocationDate: '2026-07-03', candidatesAssigned: 1, ageDays: 12, firstClientSubmissionDays: null },
    { key: 'b', consultant: 'Asha', teamLead: 'Lead', clientName: 'Beta', role: 'Designer', sector: 'Design', status: 'Completed', allocationDate: '2026-07-02', candidatesAssigned: 9, ageDays: 8, firstClientSubmissionDays: 5 },
    { key: 'c', consultant: 'Asha', teamLead: 'Lead', clientName: 'Alpha', role: 'Analyst', sector: 'Finance', status: 'Completed', allocationDate: '2026-07-01', candidatesAssigned: 3, ageDays: 20, firstClientSubmissionDays: 2 },
    { key: 'd', consultant: 'Asha', teamLead: 'Lead', clientName: 'Gamma', role: 'Engineer', sector: 'Tech', status: 'Ongoing', allocationDate: '2026-07-04', candidatesAssigned: 5, ageDays: 4, firstClientSubmissionDays: 8 },
    { key: 'e', consultant: 'Asha', teamLead: 'Lead', clientName: 'Delta', role: 'Engineer', sector: 'Tech', status: 'Scrapped', allocationDate: '2026-07-05', candidatesAssigned: 0, ageDays: 2, firstClientSubmissionDays: null },
    { key: 'f', consultant: 'Asha', teamLead: 'Lead', clientName: 'Epsilon', role: 'Engineer', sector: 'Tech', status: 'Ongoing', allocationDate: '2026-07-06', candidatesAssigned: 2, ageDays: 1, firstClientSubmissionDays: 1 }
  ]

  const pageTwo = paginateReportRows(rows, { search: '', status: 'all', page: 2, pageSize: 5, sort: 'newest', sortDirection: '' })
  assert.deepEqual(pageTwo.pagination, { page: 2, pageSize: 5, total: 6, totalPages: 2 })
  assert.deepEqual(pageTwo.rows.map((row) => row.key), ['c'])

  const searched = paginateReportRows(rows, { search: 'design', status: 'Completed', page: 1, pageSize: 5, sort: 'client', sortDirection: '' })
  assert.deepEqual(searched.rows.map((row) => row.key), ['b'])

  const candidateSort = paginateReportRows(rows, { search: '', status: 'all', page: 1, pageSize: 5, sort: 'candidates', sortDirection: '' })
  assert.deepEqual(candidateSort.rows.slice(0, 3).map((row) => row.key), ['b', 'd', 'c'])

  const submissionSort = paginateReportRows(rows, { search: '', status: 'all', page: 99, pageSize: 5, sort: 'submission', sortDirection: '' })
  assert.equal(submissionSort.pagination.page, 2)
  assert.deepEqual(submissionSort.rows.map((row) => row.key), ['e'])
})

test('report request parser validates IDs, dates, filters, pagination, sort and future caps', () => {
  const base = {
    consultant_user_id: CONSULTANT.user_id,
    start_date: '2026-07-01',
    end_date: '2026-07-30'
  }
  const parsed = parseReportRequest(base, 'main', '2026-07-15')
  assert.equal(parsed.endDate, '2026-07-15')
  assert.equal(parsed.requestedEndDate, '2026-07-30')
  assert.equal(parsed.endDateWasCapped, true)

  assert.throws(() => parseReportRequest({ ...base, consultant_user_id: 'not-a-uuid' }, 'main', END), /valid consultant/i)
  assert.throws(() => parseReportRequest({ ...base, start_date: '2026-02-30' }, 'main', END), /valid From date/i)
  assert.throws(() => parseReportRequest({ ...base, start_date: '2026-07-16' }, 'main', END), /later than To date/i)
  assert.throws(() => parseReportRequest({ ...base, start_date: '2025-01-01', end_date: '2026-07-15' }, 'main', END), /cannot exceed/i)

  assert.throws(() => parseReportRequest({ ...base, status: 'Joined' }, 'mandates', END), /Unsupported mandate status/)
  assert.throws(() => parseReportRequest({ ...base, page: '0' }, 'mandates', END), /positive integer/)
  assert.throws(() => parseReportRequest({ ...base, page_size: '100' }, 'mandates', END), /Page size must be/)
  assert.throws(() => parseReportRequest({ ...base, sort: 'salary' }, 'mandates', END), /Unsupported sort/)
  assert.throws(() => parseReportRequest({ ...base, sort_direction: 'sideways' }, 'mandates', END), /Sort direction/)
  assert.throws(() => parseReportRequest({ ...base, search: 'x'.repeat(101) }, 'mandates', END), /Search cannot exceed/)

  const modal = parseReportRequest({
    ...base,
    status: 'Completed',
    page: '2',
    page_size: '25',
    search: 'Acme',
    sort: 'submission',
    sort_direction: 'asc'
  }, 'conversions', END)
  assert.deepEqual(
    { status: modal.status, page: modal.page, pageSize: modal.pageSize, search: modal.search, sort: modal.sort, sortDirection: modal.sortDirection },
    { status: 'Completed', page: 2, pageSize: 25, search: 'Acme', sort: 'submission', sortDirection: 'asc' }
  )
})

test('report request parser accepts the explicit overall scope without a consultant UUID', () => {
  const parsed = parseReportRequest({
    scope: ' overall ',
    consultant_user_id: 'not-a-uuid',
    start_date: START,
    end_date: END
  }, 'main', END)

  assert.equal(parsed.scope, 'overall')
  assert.equal(parsed.consultantUserId, 'overall')
  assert.equal(parsed.startDate, START)
  assert.equal(parsed.endDate, END)
})

test('overall facts sum each consultant report and weight conversions by tracked mandates', () => {
  const shared = job({
    id: 'shared',
    title: 'Shared Role',
    consultants: [CONSULTANT.name, SECOND_CONSULTANT.name]
  })
  const ashaOnly = job({
    id: 'asha-only',
    title: 'Asha Role',
    consultants: [CONSULTANT.name],
    mandate_status: 'Completed',
    allocation_date: '2026-07-02'
  })
  const binaOnlyOne = job({
    id: 'bina-only-one',
    title: 'Bina Role One',
    consultants: [SECOND_CONSULTANT.name],
    mandate_status: 'Scrapped',
    allocation_date: '2026-07-03'
  })
  const binaOnlyTwo = job({
    id: 'bina-only-two',
    title: 'Bina Role Two',
    consultants: [SECOND_CONSULTANT.name],
    allocation_date: '2026-07-04'
  })
  const jobs = [shared, ashaOnly, binaOnlyOne, binaOnlyTwo]
  const associations = [
    association('shared', 'Client Submission', {
      client_submission_at: '2026-07-03T12:00:00.000Z'
    }),
    association('asha-only', 'Client Submission', {
      client_submission_at: '2026-07-08T12:00:00.000Z'
    }),
    association('bina-only-one', 'Client Submission', {
      consultant_name: SECOND_CONSULTANT.name,
      consultant_user_id: SECOND_CONSULTANT.user_id,
      client_submission_at: '2026-07-13T12:00:00.000Z'
    }),
    association('bina-only-two', 'Client Submission', {
      consultant_name: SECOND_CONSULTANT.name,
      consultant_user_id: SECOND_CONSULTANT.user_id,
      client_submission_at: '2026-07-14T12:00:00.000Z'
    })
  ]
  const entries = [CONSULTANT, SECOND_CONSULTANT].map((consultant) => ({
    consultant,
    facts: buildConsultantReportFacts({ jobs, associations, consultant, startDate: START, endDate: END })
  }))

  const result = aggregateConsultantReportFacts(entries)
  const submission = result.conversionSummary.find((stage) => stage.key === 'clientSubmission')

  assert.deepEqual(result.mandateSummary, { total: 5, ongoing: 3, completed: 1, scrapped: 1 })
  assert.equal(result.candidateOverview.total, 4)
  assert.equal(result.candidateOverview.counts['Client Submission'], 4)
  assert.equal(submission.trackedMandates, 5)
  assert.equal(submission.untrackedMandates, 0)
  assert.equal(submission.averageDays, 6)
  assert.equal(submission.displayValue, '6 days')
  assert.deepEqual(result._conversionTotals.clientSubmission, { totalDays: 30, trackedMandates: 5 })
  assert.deepEqual(result.mandates, [])
  assert.deepEqual(result.recentMandates, [])
  assert.deepEqual(result.recentConversions, [])
})
