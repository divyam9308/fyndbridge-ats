const supabase = require('../services/supabaseAdmin')
const { getDashboardAccess } = require('../services/dashboardAccess')
const { DASHBOARD_CANDIDATE_STATUSES: CANDIDATE_STATUSES, normalizeDashboardCandidateStatus } = require('../services/candidateStatuses')
const { dashboardPeriodRange } = require('../utils/dashboardPeriod')

const CLIENT_STATUSES = ['-', 'Active', 'Inactive', 'Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
const MANDATE_STATUSES = ['Ongoing', 'Completed', 'Scrapped']
const EMPTY_DASHBOARD = {
  consultantOptions: [],
  kpis: { totalClients: 0, totalCandidates: 0, totalMandates: 0, activeClients: 0, placements: 0 },
  clientStatusData: CLIENT_STATUSES.map((name) => ({ name, value: 0 })),
  candidateStatusData: CANDIDATE_STATUSES.map((name) => ({ name, value: 0 })),
  mandateStatusData: MANDATE_STATUSES.map((name) => ({ name, value: 0 })),
  billingEntityData: [{ label: 'FCS Billing Entity', value: 0 }, { label: 'FCAPL Billing Entity', value: 0 }],
  clientTrend: [],
  candidateTrend: [],
  mandateTrend: [],
  candidateFunnel: ['Interested', 'In Discussion', 'Client Submission', 'Interview', 'Offered', 'Hired'].map((name) => ({ name, value: 0 })),
  consultantPerformance: [],
  recentActivity: [],
  sectionErrors: {}
}

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase()
const isOverall = (value) => !clean(value) || clean(value) === 'Overall (All Consultants)'

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean)
  const text = clean(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean)
  } catch {
    return text.split(/[,;|\n]+/).map(clean).filter(Boolean)
  }
  return text.split(/[,;|\n]+/).map(clean).filter(Boolean)
}

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function withinPeriod(value, range) {
  const date = toDate(value)
  if (!date) return false
  if (range.start && date < range.start) return false
  return date <= range.end
}

function monthLabel(value) {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleString('en-US', { month: 'short' })
}

function dayLabel(value) {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleString('en-US', { day: 'numeric', month: 'short' })
}

function normalizeClientStatus(value) {
  const text = clean(value)
  return CLIENT_STATUSES.includes(text) ? text : '-'
}

function normalizeMandateStatus(value) {
  const text = clean(value)
  if (text === 'Completed') return 'Completed'
  if (text === 'Scrapped' || text === 'Scrap') return 'Scrapped'
  if (text === 'Ongoing') return 'Ongoing'
  return 'Ongoing'
}

function matchesConsultant(record, consultant, fields) {
  if (isOverall(consultant)) return true
  return fields.some((field) => {
    const values = parseList(record[field])
    if (values.length) return values.some((value) => same(value, consultant))
    return same(record[field], consultant)
  })
}

function countByStatus(rows, statuses, getStatus) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]))
  for (const row of rows) {
    const status = getStatus(row)
    if (status && Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1
  }
  return statuses.map((name) => ({ name, value: counts[name] || 0 }))
}

function bucketKey(date, period) {
  if (isMonthPeriod(period)) return date.toISOString().slice(0, 10)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function bucketLabel(date, period) {
  return isMonthPeriod(period) ? dayLabel(date) : monthLabel(date)
}

function isMonthPeriod(period) {
  return period === 'This Month' || /^Month \d{4}-(0[1-9]|1[0-2])$/.test(String(period))
}

function addMonths(date, count) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + count)
  return next
}

function addDays(date, count) {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

function buildBuckets(period, range, rows, getDate, statuses) {
  const now = new Date()
  const rowDates = rows.map((row) => toDate(getDate(row))).filter(Boolean).sort((a, b) => a - b)
  const startDate = range.start || rowDates[0] || new Date(now.getFullYear(), now.getMonth(), 1)
  const cursor = isMonthPeriod(period)
    ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
    : new Date(startDate.getFullYear(), startDate.getMonth(), 1)
  const end = range.end || now
  const buckets = []
  while (cursor <= end) {
    const raw = Object.fromEntries(statuses.map((status) => [status, 0]))
    buckets.push({
      key: bucketKey(cursor, period),
      m: bucketLabel(cursor, period),
      raw,
      ...Object.fromEntries(statuses.map((status) => [status, 0]))
    })
    const next = isMonthPeriod(period) ? addDays(cursor, 1) : addMonths(cursor, 1)
    cursor.setTime(next.getTime())
  }
  return buckets
}

function statusTrend(rows, statuses, getStatus, getDate, period, range) {
  const buckets = buildBuckets(period, range, rows, getDate, statuses)
  const map = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  for (const row of rows) {
    const date = toDate(getDate(row))
    const status = getStatus(row)
    if (!date || !statuses.includes(status)) continue
    const bucket = map.get(bucketKey(date, period))
    if (bucket) bucket.raw[status] += 1
  }
  const running = Object.fromEntries(statuses.map((status) => [status, 0]))
  for (const bucket of buckets) {
    for (const status of statuses) {
      running[status] += bucket.raw[status] || 0
      bucket[status] = running[status]
    }
  }
  return buckets
}

function dedupeClients(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const key = row.client_group_id || row.id
    const current = map.get(key) || { ...row, ids: [] }
    current.ids.push(row.id)
    current.status = clean(current.status) ? current.status : row.status
    current.consultant_name = clean(current.consultant_name) ? current.consultant_name : row.consultant_name
    current.connected_on_date = current.connected_on_date || row.connected_on_date || row.created_at
    current.contract_signed = current.contract_signed || row.contract_signed
    current.billing_entity = clean(current.billing_entity) ? current.billing_entity : row.billing_entity
    map.set(key, current)
  }
  return [...map.values()]
}

function hasUpdatedSinceCreation(row) {
  const created = toDate(row.created_at)
  const updated = toDate(row.updated_at)
  return Boolean(created && updated && updated.getTime() - created.getTime() > 1000)
}

function activityActor({ userId, name, email }, profilesById) {
  const profile = userId ? profilesById.get(userId) : null
  const actorName = clean(profile?.name || name || profile?.email || email) || 'Unknown user'
  return { actorName, actorEmail: clean(profile?.email || email) }
}

function buildRecentActivity({ clients, candidates, mandates, profiles }) {
  const profilesById = new Map((profiles || []).map((profile) => [profile.user_id, profile]))
  const events = []
  for (const client of clients) {
    const updated = hasUpdatedSinceCreation(client)
    const actor = activityActor({ userId: client.consultant_user_id, name: client.consultant_name || client.consultant }, profilesById)
    const clientName = client.client_name || client.name || 'Unnamed client'
    events.push({
      date: client.updated_at || client.created_at || client.connected_on_date,
      module: (client.contract_signed === true || same(client.contract_signed, 'Yes')) ? 'Contract' : 'Client',
      text: (client.contract_signed === true || same(client.contract_signed, 'Yes'))
        ? `Contract signed with ${clientName}`
        : `Client ${updated ? 'updated' : 'added'}: ${clientName}`,
      ...actor,
      id: `client-${client.id}`
    })
  }
  for (const candidate of candidates) {
    const updated = hasUpdatedSinceCreation(candidate)
    events.push({
      date: candidate.updated_at || candidate.created_at,
      module: 'Candidate',
      text: `Candidate ${updated ? 'updated' : 'added'}: ${candidate.full_name || 'Unnamed candidate'}`,
      ...activityActor({ userId: candidate.updated_by || candidate.created_by }, profilesById),
      id: `candidate-${candidate.id}`
    })
  }
  for (const mandate of mandates) {
    const updated = hasUpdatedSinceCreation(mandate)
    events.push({
      date: mandate.updated_at || mandate.created_at || mandate.allocation_date,
      module: 'Mandate',
      text: `Mandate ${updated ? 'updated' : 'added'}: ${mandate.title || 'Untitled mandate'}`,
      ...activityActor({ name: mandate.team_lead || parseList(mandate.consultants)[0] }, profilesById),
      id: `mandate-${mandate.id}`
    })
  }
  return events
    .filter((item) => toDate(item.date))
    .sort((a, b) => toDate(b.date) - toDate(a.date))
    .slice(0, 50)
}

async function getDashboardStats(req, res) {
  const access = await getDashboardAccess(req.user)
  const requestedConsultant = clean(req.query.consultant) || 'Overall (All Consultants)'
  const consultant = access.restrictedToSelf && access.consultantName ? access.consultantName : requestedConsultant
  const period = clean(req.query.period) || 'This Month'
  const range = dashboardPeriodRange(period)
  const sectionErrors = {}

  const settled = await Promise.allSettled([
    supabase.from('user_profiles').select('user_id, name, email').order('name'),
    supabase.from('clients').select('id, client_group_id, client_name, name, status, consultant_name, connected_on_date, created_at, updated_at, contract_signed, billing_entity'),
    supabase.from('candidates').select('id, full_name, created_by, updated_by, created_at, updated_at'),
    supabase.from('candidate_associations').select('id, candidate_id, consultant_name, status, job_title, client_name, created_at, updated_at'),
    supabase.from('jobs').select('id, title, consultants, team_lead, mandate_status, status, allocation_date, created_at, updated_at')
  ])

  const readResult = (index, key) => {
    const result = settled[index]
    if (result.status === 'rejected') {
      sectionErrors[key] = result.reason?.message || 'Unable to load data.'
      return []
    }
    if (result.value.error) {
      sectionErrors[key] = result.value.error.message || 'Unable to load data.'
      return []
    }
    return result.value.data || []
  }

  try {
    const profiles = readResult(0, 'consultants')
    const clients = readResult(1, 'clients')
    const candidates = readResult(2, 'candidates')
    const associations = readResult(3, 'candidates')
    const jobs = readResult(4, 'mandates')

    const consultantOptions = (access.restrictedToSelf ? profiles.filter(row => same(row.name, consultant)) : profiles)
      .map((row) => clean(row.name))
      .filter(Boolean)
      .filter((name, index, list) => list.findIndex((item) => same(item, name)) === index)

    const candidateById = new Map(candidates.map((row) => [row.id, row]))
    const allUniqueClients = dedupeClients(clients)
    const clientOwnershipAvailable = allUniqueClients.length > 0 && allUniqueClients.every((row) => clean(row.consultant_name))
    const uniqueClients = allUniqueClients
      .filter((client) => withinPeriod(client.connected_on_date || client.created_at, range))
      .filter((client) => !clientOwnershipAvailable || matchesConsultant(client, consultant, ['consultant_name']))

    const allAssociations = associations.map((row) => ({
      ...row,
      full_name: candidateById.get(row.candidate_id)?.full_name || '',
      candidate_created_at: candidateById.get(row.candidate_id)?.created_at || row.created_at
    }))
    const filteredAssociations = allAssociations
      .filter((row) => withinPeriod(row.created_at || row.candidate_created_at, range))
      .filter((row) => matchesConsultant(row, consultant, ['consultant_name']))

    const filteredCandidateIds = new Set(
      filteredAssociations.map((row) => row.candidate_id).filter(Boolean)
    )
    const filteredCandidates = candidates.filter((row) => filteredCandidateIds.has(row.id))

    const filteredMandates = jobs
      .filter((row) => withinPeriod(row.allocation_date || row.created_at, range))
      .filter((row) => matchesConsultant(row, consultant, ['consultants', 'team_lead']))

    const activeClients = uniqueClients.filter((client) => normalizeClientStatus(client.status) === 'Active')
    const hiredAssociations = filteredAssociations.filter((row) => normalizeDashboardCandidateStatus(row.status) === 'Hired')
    const billingEntityData = [
      {
        label: 'FCS Billing Entity',
        value: activeClients.filter((client) => (client.contract_signed === true || same(client.contract_signed, 'Yes')) && same(client.billing_entity, 'FCS')).length
      },
      {
        label: 'FCAPL Billing Entity',
        value: activeClients.filter((client) => (client.contract_signed === true || same(client.contract_signed, 'Yes')) && same(client.billing_entity, 'FCAPL')).length
      }
    ]

    const clientTrend = statusTrend(uniqueClients, CLIENT_STATUSES, (row) => normalizeClientStatus(row.status), (row) => row.connected_on_date || row.created_at, period, range)
    const candidateTrend = statusTrend(filteredAssociations, CANDIDATE_STATUSES, (row) => normalizeDashboardCandidateStatus(row.status), (row) => row.created_at || row.candidate_created_at, period, range)
    const mandateTrend = statusTrend(filteredMandates, MANDATE_STATUSES, (row) => normalizeMandateStatus(row.mandate_status || row.status), (row) => row.allocation_date || row.created_at, period, range)

    return res.json({
      consultantOptions,
      kpis: {
        totalClients: uniqueClients.length,
        totalCandidates: filteredCandidates.length,
        totalMandates: filteredMandates.length,
        activeClients: activeClients.length,
        placements: hiredAssociations.length
      },
      clientStatusData: countByStatus(uniqueClients, CLIENT_STATUSES, (row) => normalizeClientStatus(row.status)),
      candidateStatusData: countByStatus(filteredAssociations, CANDIDATE_STATUSES, (row) => normalizeDashboardCandidateStatus(row.status)),
      mandateStatusData: countByStatus(filteredMandates, MANDATE_STATUSES, (row) => normalizeMandateStatus(row.mandate_status || row.status)),
      billingEntityData,
      clientTrend,
      candidateTrend,
      mandateTrend,
      recentActivity: buildRecentActivity({ clients, candidates, mandates: jobs, profiles }),
      sectionErrors,
      clientOwnershipAvailable,
      period,
      consultant
      ,dashboardAccess: access
    })
  } catch (err) {
    console.error('getDashboardStats error:', err.message || err)
    return res.json({ ...EMPTY_DASHBOARD, sectionErrors: { dashboard: err.message || 'Unable to load dashboard data.' }, period, consultant })
  }
}

module.exports = { getDashboardStats }
