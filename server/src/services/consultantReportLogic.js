const { CANDIDATE_STATUSES, canonicalCandidateStatus } = require('./candidateStatuses')
const { MANDATE_STATUSES, normalizeMandateStatus } = require('./filterEngine')
const { localDate } = require('./attendanceUtils')

const PAGE_SIZES = new Set([5, 10, 25, 50])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REJECTED_STATUSES = new Set(['Not Interested', 'Rejected by Recruiter', 'Rejected by Client'])
const SUBMISSION_EVIDENCE_STATUSES = new Set(['Client Submission', 'Interview', 'Offered', 'Hired'])
const INTERVIEW_EVIDENCE_STATUSES = new Set(['Interview', 'Offered', 'Hired'])
const STAGES = Object.freeze([
  { key: 'clientSubmission', field: 'client_submission_at', label: 'Mandate → First Client Submission', tone: 'blue' },
  { key: 'interview', field: 'interview_at', label: 'Mandate → First Interview', tone: 'purple' },
  { key: 'offer', field: 'offered_at', label: 'Mandate → First Offer', tone: 'amber' },
  { key: 'hire', field: 'hired_at', label: 'Mandate → First Hire', tone: 'green' }
])

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const same = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase()

function bad(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean)
  const text = clean(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean)
  } catch {
    // Legacy fields may contain comma-separated names rather than JSON.
  }
  return text.split(/[,;|\n]+/).map(clean).filter(Boolean)
}

function canonicalMandateStatus(value) {
  const status = normalizeMandateStatus(value)
  return MANDATE_STATUSES.includes(status) ? status : ''
}

function isValidDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
}

function dateOrdinal(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function daysBetween(start, end) {
  return dateOrdinal(end) - dateOrdinal(start)
}

function parseInteger(value, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (!/^\d+$/.test(String(value))) throw bad(`${label} must be a positive integer.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw bad(`${label} must be a positive integer.`)
  return parsed
}

function parseReportRequest(query = {}, kind = 'main', today = localDate()) {
  const consultantUserId = clean(query.consultant_user_id)
  if (!UUID_PATTERN.test(consultantUserId)) throw bad('Select a valid consultant.')

  const requestedStartDate = clean(query.start_date)
  const requestedEndDate = clean(query.end_date)
  if (!isValidDate(requestedStartDate) || !isValidDate(requestedEndDate)) {
    throw bad('Enter a valid From date and To date in YYYY-MM-DD format.')
  }
  const endDate = requestedEndDate > today ? today : requestedEndDate
  if (requestedStartDate > endDate) throw bad('From date cannot be later than To date.')
  if (daysBetween(requestedStartDate, endDate) > 366) throw bad('Report periods cannot exceed 367 calendar days.')

  const parsed = {
    consultantUserId,
    startDate: requestedStartDate,
    endDate,
    requestedEndDate,
    endDateWasCapped: requestedEndDate !== endDate
  }
  if (kind === 'main') return parsed

  const search = clean(query.search)
  if (search.length > 100) throw bad('Search cannot exceed 100 characters.')
  const status = clean(query.status) || 'all'
  if (status !== 'all' && !MANDATE_STATUSES.includes(status)) throw bad('Unsupported mandate status.')
  const page = parseInteger(query.page, 'Page', 1)
  const pageSize = parseInteger(query.page_size, 'Page size', 10)
  if (!PAGE_SIZES.has(pageSize)) throw bad('Page size must be 5, 10, 25, or 50.')

  const sortAllowlist = kind === 'conversions'
    ? new Set(['newest', 'oldest', 'client', 'age', 'submission'])
    : new Set(['newest', 'oldest', 'client', 'candidates'])
  const sort = clean(query.sort) || 'newest'
  if (!sortAllowlist.has(sort)) throw bad('Unsupported sort field.')
  const sortDirection = clean(query.sort_direction).toLowerCase()
  if (sortDirection && !['asc', 'desc'].includes(sortDirection)) throw bad('Sort direction must be asc or desc.')

  return { ...parsed, search, status, page, pageSize, sort, sortDirection }
}

function consultantMatches(job, consultantName) {
  return parseList(job.consultants).some((name) => same(name, consultantName))
}

function candidateAssociationMatches(association, consultant) {
  const associationUserId = clean(association?.consultant_user_id)
  const consultantUserId = clean(consultant?.user_id)
  if (associationUserId) return Boolean(consultantUserId && associationUserId === consultantUserId)
  return same(association?.consultant_name, consultant?.name)
}

function candidateAssociationDate(association) {
  const createdAt = clean(association?.created_at)
  if (!createdAt) return ''
  const parsed = new Date(createdAt)
  return Number.isNaN(parsed.getTime()) ? '' : localDate(parsed)
}

function mandateDate(job) {
  if (isValidDate(job.allocation_date)) return job.allocation_date
  const createdAt = clean(job.created_at)
  const fallback = createdAt && !Number.isNaN(new Date(createdAt).getTime()) ? localDate(createdAt) : ''
  return isValidDate(fallback) ? fallback : ''
}

function relationRow(value) {
  return Array.isArray(value) ? value[0] || {} : value || {}
}

function emptyStatusCounts() {
  return Object.fromEntries(CANDIDATE_STATUSES.map((status) => [status, 0]))
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function numberLabel(value) {
  if (!Number.isFinite(value)) return 'Not tracked'
  const number = rounded(value)
  return `${Number.isInteger(number) ? number : number.toFixed(1)} ${number === 1 ? 'day' : 'days'}`
}

function percentageLabel(value) {
  const number = rounded(value)
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`
}

function warningCollector() {
  const warnings = new Map()
  return {
    add(code, message, count = 1) {
      const current = warnings.get(code)
      warnings.set(code, { code, message, count: (current?.count || 0) + count })
    },
    values() {
      return [...warnings.values()]
    }
  }
}

function stageTiming(associations, startDate, stage, warnings) {
  const valid = []
  for (const association of associations) {
    const value = association[stage.field]
    if (!value) continue
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      warnings.add('invalid_stage_timestamp', 'Some tracked stage timestamps are invalid and were excluded.')
      continue
    }
    const stageDate = localDate(parsed)
    if (stageDate < startDate) {
      warnings.add('stage_before_mandate_start', 'Some stage timestamps predate mandate allocation and were excluded.')
      continue
    }
    valid.push({ value: parsed.getTime(), days: daysBetween(startDate, stageDate) })
  }
  valid.sort((left, right) => left.value - right.value)
  const days = valid[0]?.days ?? null
  return {
    days,
    label: days === null ? 'Not tracked' : `${days} d`,
    trackingState: days === null ? 'untracked' : 'tracked'
  }
}

function buildCandidatePipeline(overview) {
  const stages = [
    ['total', 'Total Candidates', overview.total],
    ['interested', 'Interested', overview.counts.Interested],
    ['clientSubmission', 'Client Submission', overview.counts['Client Submission']],
    ['interview', 'Interview', overview.counts.Interview],
    ['offered', 'Offered', overview.counts.Offered],
    ['hired', 'Hired', overview.counts.Hired]
  ]
  return stages.map(([key, label, count], index) => {
    const percentage = index === 0 ? (overview.total ? 100 : 0) : (overview.total ? rounded((count / overview.total) * 100) : 0)
    return {
      key,
      label,
      count,
      percentage,
      description: index === 0 ? `${percentageLabel(percentage)} of Total` : `${percentageLabel(percentage)} of Total`
    }
  })
}

function toConversionRow(row) {
  return {
    key: row.key,
    clientName: row.clientName,
    role: row.role,
    status: row.status,
    allocationDate: row.allocationDate,
    firstClientSubmissionDays: row.firstClientSubmissionDays,
    firstClientSubmissionLabel: row.firstClientSubmissionLabel,
    firstClientSubmissionTrackingState: row.firstClientSubmissionTrackingState,
    firstInterviewDays: row.firstInterviewDays,
    firstInterviewLabel: row.firstInterviewLabel,
    firstInterviewTrackingState: row.firstInterviewTrackingState,
    firstOfferDays: row.firstOfferDays,
    firstOfferLabel: row.firstOfferLabel,
    firstOfferTrackingState: row.firstOfferTrackingState,
    firstHireDays: row.firstHireDays,
    firstHireLabel: row.firstHireLabel,
    firstHireTrackingState: row.firstHireTrackingState,
    durationLabel: row.durationLabel,
    ageDays: row.ageDays,
    isAgeingWarning: row.isAgeingWarning
  }
}

function buildConsultantReportFacts({ jobs = [], associations = [], candidateAssociations, consultant, startDate, endDate }) {
  const warnings = warningCollector()
  const scopedJobs = []
  const candidateRows = candidateAssociations === undefined ? associations : candidateAssociations

  for (const job of jobs) {
    if (!consultantMatches(job, consultant.name)) continue
    const allocationDate = mandateDate(job)
    if (!allocationDate) {
      warnings.add('missing_mandate_date', 'Some assigned mandates have no allocation or created date and were excluded.')
      continue
    }
    if (allocationDate < startDate || allocationDate > endDate) continue
    const status = canonicalMandateStatus(job.mandate_status || job.status || job.priority)
    if (!status) {
      warnings.add('unknown_mandate_status', 'Some mandates have an unsupported legacy status and were excluded.')
      continue
    }
    scopedJobs.push({ job, allocationDate, status })
  }

  const scopedJobIds = new Set(scopedJobs.map(({ job }) => job.id))
  const associationsByJob = new Map(scopedJobs.map(({ job }) => [job.id, []]))
  for (const association of associations) {
    if (!scopedJobIds.has(association.job_id)) continue
    const status = canonicalCandidateStatus(association.status)
    associationsByJob.get(association.job_id).push({ ...association, canonicalStatus: status || '' })
  }

  const mandateRows = scopedJobs.map(({ job, allocationDate, status: storedStatus }) => {
    const jobAssociations = associationsByJob.get(job.id) || []
    const validJobAssociations = jobAssociations.filter((association) => association.canonicalStatus)
    const counts = emptyStatusCounts()
    validJobAssociations.forEach((association) => { counts[association.canonicalStatus] += 1 })
    const currentHires = counts.Hired
    const conversion = Object.fromEntries(STAGES.map((stage) => [stage.key, stageTiming(jobAssociations, allocationDate, stage, warnings)]))
    let status = storedStatus
    if (status === 'Ongoing' && (currentHires > 0 || conversion.hire.days !== null)) {
      status = 'Completed'
      warnings.add('ongoing_mandate_with_hire', 'Some Ongoing mandates have current or tracked Hire evidence and were presented as Completed.')
    }
    if (status === 'Scrapped' && currentHires > 0) {
      warnings.add('scrapped_mandate_with_hire', 'Some Scrapped mandates contain a current Hired candidate; the stored Scrapped status was preserved.')
    }

    const ageDays = Math.max(0, daysBetween(allocationDate, endDate))
    const client = relationRow(job.clients)
    const consultants = parseList(job.consultants)
    let durationLabel = '—'
    if (status === 'Ongoing') durationLabel = `${ageDays} d (ongoing)`
    if (status === 'Completed') durationLabel = conversion.hire.days === null ? 'Not tracked' : `${conversion.hire.days} d (final)`

    return {
      key: job.id,
      consultant: consultants.join(', ') || '—',
      teamLead: clean(job.team_lead) || '—',
      clientName: clean(client.client_name || client.name) || '—',
      role: clean(job.title) || '—',
      budget: clean(job.budget) || '—',
      status,
      sector: clean(job.vertical || client.sector) || '—',
      allocationDate,
      candidatesAssigned: jobAssociations.length,
      counts,
      firstClientSubmissionDays: conversion.clientSubmission.days,
      firstClientSubmissionLabel: conversion.clientSubmission.label,
      firstClientSubmissionTrackingState: conversion.clientSubmission.trackingState,
      firstInterviewDays: conversion.interview.days,
      firstInterviewLabel: conversion.interview.label,
      firstInterviewTrackingState: conversion.interview.trackingState,
      firstOfferDays: conversion.offer.days,
      firstOfferLabel: conversion.offer.label,
      firstOfferTrackingState: conversion.offer.trackingState,
      firstHireDays: conversion.hire.days,
      firstHireLabel: conversion.hire.label,
      firstHireTrackingState: conversion.hire.trackingState,
      durationLabel,
      ageDays,
      isAgeingWarning: status === 'Ongoing' && ageDays > 45,
      _associations: jobAssociations,
      _conversion: conversion
    }
  }).sort((left, right) => right.allocationDate.localeCompare(left.allocationDate) || left.key.localeCompare(right.key))

  const mandateSummary = {
    total: mandateRows.length,
    ongoing: mandateRows.filter((row) => row.status === 'Ongoing').length,
    completed: mandateRows.filter((row) => row.status === 'Completed').length,
    scrapped: mandateRows.filter((row) => row.status === 'Scrapped').length
  }

  const conversionSummary = STAGES.map((stage) => {
    const durations = mandateRows.map((row) => row._conversion[stage.key].days).filter(Number.isFinite)
    const averageDays = durations.length ? rounded(durations.reduce((total, value) => total + value, 0) / durations.length) : null
    return {
      key: stage.key,
      label: stage.label,
      averageDays,
      displayValue: numberLabel(averageDays),
      trackedMandates: durations.length,
      untrackedMandates: mandateRows.length - durations.length,
      tone: stage.tone
    }
  })

  const candidateCounts = emptyStatusCounts()
  for (const association of candidateRows) {
    if (!candidateAssociationMatches(association, consultant)) continue
    const addedDate = candidateAssociationDate(association)
    if (!addedDate) {
      warnings.add('missing_candidate_added_date', 'Some candidate associations have no valid added date and were excluded from candidate totals.')
      continue
    }
    if (addedDate < startDate || addedDate > endDate) continue
    const status = canonicalCandidateStatus(association.status)
    if (!status) {
      warnings.add('invalid_candidate_status', 'Some candidate associations have a null or unsupported status and were excluded from current-status totals.')
      continue
    }
    candidateCounts[status] += 1
  }
  const candidateOverview = {
    total: Object.values(candidateCounts).reduce((total, value) => total + value, 0),
    counts: candidateCounts
  }
  const candidatePipeline = buildCandidatePipeline(candidateOverview)

  const hasTrackedStage = (row, stageKeys) => stageKeys.some((key) => row._conversion[key].days !== null)
  const hasSubmissionEvidence = (row) => row._associations.some((association) => (
    SUBMISSION_EVIDENCE_STATUSES.has(association.canonicalStatus)
  )) || hasTrackedStage(row, ['clientSubmission', 'interview', 'offer', 'hire'])
  const hasInterviewEvidence = (row) => row._associations.some((association) => (
    INTERVIEW_EVIDENCE_STATUSES.has(association.canonicalStatus)
  )) || hasTrackedStage(row, ['interview', 'offer', 'hire'])
  const mandatesWithCurrentHire = mandateRows.filter((row) => row.counts.Hired > 0 && row.status === 'Completed').length

  const exceptions = [
    { key: 'withoutCandidates', label: 'Mandates without candidates', value: mandateRows.filter((row) => row.candidatesAssigned === 0).length, tone: 'neutral' },
    { key: 'withoutClientSubmission', label: 'Mandates with candidates but no Client Submission', value: mandateRows.filter((row) => row.candidatesAssigned > 0 && !hasSubmissionEvidence(row)).length, tone: 'blue' },
    { key: 'withoutInterview', label: 'Mandates with Client Submission but no Interview', value: mandateRows.filter((row) => hasSubmissionEvidence(row) && !hasInterviewEvidence(row)).length, tone: 'purple' },
    { key: 'allRejected', label: 'Mandates where every candidate is Not Interested, Rejected by Recruiter or Rejected by Client', value: mandateRows.filter((row) => row.candidatesAssigned > 0 && row._associations.every((association) => REJECTED_STATUSES.has(association.canonicalStatus))).length, tone: 'red' },
    { key: 'ageing', label: 'Ongoing mandates older than 45 days', value: mandateRows.filter((row) => row.isAgeingWarning).length, tone: 'amber' }
  ]
  const positiveOutcomes = [
    { key: 'hiredCandidates', label: 'Hired Candidates', value: candidateCounts.Hired, tone: 'green' },
    { key: 'offeredCandidates', label: 'Offered Candidates', value: candidateCounts.Offered, tone: 'amber' },
    { key: 'completedMandates', label: 'Completed Mandates', value: mandateSummary.completed, tone: 'blue' },
    { key: 'mandatesWithHire', label: 'Mandates with at least one Hire', value: mandatesWithCurrentHire, tone: 'teal' },
    { key: 'clientSubmissions', label: 'Total Client Submissions', value: candidateCounts['Client Submission'], tone: 'cyan' },
    { key: 'interviews', label: 'Total Interviews', value: candidateCounts.Interview, tone: 'purple' }
  ]

  const publicRows = mandateRows.map((row) => {
    const publicRow = { ...row }
    delete publicRow._associations
    delete publicRow._conversion
    return publicRow
  })
  return {
    mandateSummary,
    conversionSummary,
    candidateOverview,
    candidatePipeline,
    exceptions,
    positiveOutcomes,
    mandates: publicRows,
    recentMandates: publicRows.slice(0, 5),
    recentConversions: publicRows.slice(0, 5).map(toConversionRow),
    warnings: warnings.values()
  }
}

function matchesSearch(row, search) {
  if (!search) return true
  const query = search.toLowerCase()
  return [row.consultant, row.teamLead, row.clientName, row.role, row.sector]
    .some((value) => String(value || '').toLowerCase().includes(query))
}

function compareRows(left, right, sort) {
  if (sort === 'oldest') return left.allocationDate.localeCompare(right.allocationDate)
  if (sort === 'client') return left.clientName.localeCompare(right.clientName, undefined, { sensitivity: 'base' })
  if (sort === 'candidates') return right.candidatesAssigned - left.candidatesAssigned
  if (sort === 'age') return right.ageDays - left.ageDays
  if (sort === 'submission') return (left.firstClientSubmissionDays ?? Infinity) - (right.firstClientSubmissionDays ?? Infinity)
  return right.allocationDate.localeCompare(left.allocationDate)
}

function compareRowsByField(left, right, sort) {
  if (['newest', 'oldest'].includes(sort)) return left.allocationDate.localeCompare(right.allocationDate)
  if (sort === 'client') return left.clientName.localeCompare(right.clientName, undefined, { sensitivity: 'base' })
  if (sort === 'candidates') return left.candidatesAssigned - right.candidatesAssigned
  if (sort === 'age') return left.ageDays - right.ageDays
  if (sort === 'submission') return (left.firstClientSubmissionDays ?? Infinity) - (right.firstClientSubmissionDays ?? Infinity)
  return 0
}

function paginateReportRows(rows, params) {
  const filtered = rows.filter((row) => matchesSearch(row, params.search) && (params.status === 'all' || row.status === params.status))
  filtered.sort((left, right) => {
    const compared = params.sortDirection
      ? compareRowsByField(left, right, params.sort) * (params.sortDirection === 'desc' ? -1 : 1)
      : compareRows(left, right, params.sort)
    return compared || left.key.localeCompare(right.key)
  })
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))
  const page = Math.min(params.page, totalPages)
  const offset = (page - 1) * params.pageSize
  return {
    rows: filtered.slice(offset, offset + params.pageSize),
    pagination: { page, pageSize: params.pageSize, total, totalPages }
  }
}

module.exports = {
  CANDIDATE_STATUSES,
  MANDATE_STATUSES,
  STAGES,
  buildConsultantReportFacts,
  buildCandidatePipeline,
  candidateAssociationDate,
  candidateAssociationMatches,
  canonicalMandateStatus,
  consultantMatches,
  daysBetween,
  paginateReportRows,
  parseReportRequest,
  toConversionRow
}
