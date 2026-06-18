const supabase = require('../services/supabaseAdmin')

const CLIENT_STATUSES = ['-', 'Active', 'Inactive', 'Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
const CANDIDATE_STATUSES = ['Interested', 'Not Interested', 'Rejected by Recruiter', 'Client Submission', 'Interview', 'Rejected by Client', 'Offered', 'Offer Declined', 'Dropout', 'Hired']
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
  candidateFunnel: ['Interested', 'Client Submission', 'Interview', 'Offered', 'Hired'].map((name) => ({ name, value: 0 })),
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
    return text.split(',').map(clean).filter(Boolean)
  }
  return text.split(',').map(clean).filter(Boolean)
}

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(value) {
  const date = toDate(value)
  return date ? date.toISOString().slice(0, 10) : ''
}

function periodRange(period) {
  const now = new Date()
  const year = now.getFullYear()
  const end = new Date(year, now.getMonth(), now.getDate(), 23, 59, 59, 999)
  if (period === 'This Month') return { start: new Date(year, now.getMonth(), 1), end }
  if (period === 'Q1') return { start: new Date(year, 0, 1), end: new Date(year, 2, 31, 23, 59, 59, 999) }
  if (period === 'Q2') return { start: new Date(year, 3, 1), end: new Date(year, 5, 30, 23, 59, 59, 999) }
  if (period === 'Q3') return { start: new Date(year, 6, 1), end: new Date(year, 8, 30, 23, 59, 59, 999) }
  if (period === 'Q4') return { start: new Date(year, 9, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) }
  if (period === 'Till This Date') return { start: null, end }
  return { start: new Date(year, 0, 1), end }
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

function normalizeClientStatus(value) {
  const text = clean(value)
  return CLIENT_STATUSES.includes(text) ? text : '-'
}

function normalizeCandidateStatus(value) {
  const text = clean(value)
  if (same(text, 'Offered Declined')) return CANDIDATE_STATUSES.includes('Offered Declined') ? 'Offered Declined' : 'Offer Declined'
  return CANDIDATE_STATUSES.includes(text) ? text : ''
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

function groupByMonth(rows, getDate, counters) {
  const map = new Map()
  for (const row of rows) {
    const label = monthLabel(getDate(row))
    if (!label) continue
    if (!map.has(label)) map.set(label, { m: label, ...Object.fromEntries(counters.map((key) => [key, 0])) })
    const bucket = map.get(label)
    for (const key of counters) bucket[key] += Number(row[`__${key}`] || 0)
  }
  return [...map.values()]
}

function monthBuckets(range, counters) {
  const now = new Date()
  const start = range.start || new Date(now.getFullYear(), Math.max(0, now.getMonth() - 5), 1)
  const end = range.end || now
  const buckets = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor <= end && buckets.length < 12) {
    buckets.push({
      m: cursor.toLocaleString('en-US', { month: 'short' }),
      ...Object.fromEntries(counters.map((key) => [key, 0]))
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return buckets.length ? buckets : [{ m: now.toLocaleString('en-US', { month: 'short' }), ...Object.fromEntries(counters.map((key) => [key, 0])) }]
}

function withMonthFallback(rows, range, counters) {
  return rows.length ? rows : monthBuckets(range, counters)
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

function buildRecentActivity({ clients, candidates, mandates }) {
  const events = []
  for (const client of clients) {
    events.push({
      date: client.updated_at || client.created_at || client.connected_on_date,
      text: `Client added: ${client.client_name || client.name || 'Unnamed client'}`
    })
    if ((client.contract_signed === true || same(client.contract_signed, 'Yes')) && clean(client.billing_entity)) {
      events.push({
        date: client.updated_at || client.created_at || client.connected_on_date,
        text: `Contract signed with ${client.client_name || client.name || 'client'}`
      })
    }
  }
  for (const item of candidates) {
    const status = normalizeCandidateStatus(item.status)
    if (['Interview', 'Hired', 'Offered'].includes(status)) {
      events.push({
        date: item.updated_at || item.created_at,
        text: `Candidate moved to ${status}: ${item.full_name || 'Candidate'}`
      })
    }
  }
  for (const mandate of mandates) {
    if (normalizeMandateStatus(mandate.mandate_status || mandate.status) === 'Completed') {
      events.push({
        date: mandate.updated_at || mandate.allocation_date || mandate.created_at,
        text: `Mandate completed: ${mandate.title || mandate.role || 'Untitled mandate'}`
      })
    }
  }
  return events
    .filter((item) => toDate(item.date))
    .sort((a, b) => toDate(b.date) - toDate(a.date))
    .slice(0, 8)
    .map((item) => ({ ...item, date: dateKey(item.date) }))
}

async function getDashboardStats(req, res) {
  const consultant = clean(req.query.consultant) || 'Overall (All Consultants)'
  const period = clean(req.query.period) || 'This Month'
  const range = periodRange(period)
  const sectionErrors = {}

  const settled = await Promise.allSettled([
    supabase.from('user_profiles').select('user_id, name, email').not('name', 'is', null).order('name'),
    supabase.from('clients').select('id, client_group_id, client_name, name, status, consultant_name, connected_on_date, created_at, updated_at, contract_signed, billing_entity'),
    supabase.from('candidates').select('id, full_name, created_at, updated_at'),
    supabase.from('candidate_associations').select('id, candidate_id, consultant_name, status, job_title, client_name, created_at, updated_at'),
    supabase.from('jobs').select('id, title, role, consultants, team_lead, mandate_status, status, allocation_date, created_at, updated_at')
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

    const consultantOptions = profiles
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
    const filteredCandidates = candidates
      .filter((row) => withinPeriod(row.created_at, range))
      .filter((row) => isOverall(consultant) || filteredCandidateIds.has(row.id))

    const filteredMandates = jobs
      .filter((row) => withinPeriod(row.allocation_date || row.created_at, range))
      .filter((row) => matchesConsultant(row, consultant, ['consultants', 'team_lead']))

    const activeClients = uniqueClients.filter((client) => normalizeClientStatus(client.status) === 'Active')
    const hiredAssociations = filteredAssociations.filter((row) => normalizeCandidateStatus(row.status) === 'Hired')
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

    const clientTrend = withMonthFallback(groupByMonth(
      uniqueClients.map((row) => ({ ...row, __clients: 1, __active: normalizeClientStatus(row.status) === 'Active' ? 1 : 0 })),
      (row) => row.connected_on_date || row.created_at,
      ['clients', 'active']
    ), range, ['clients', 'active'])
    const candidateTrend = withMonthFallback(groupByMonth(
      filteredAssociations.map((row) => ({ ...row, __added: 1, __hired: normalizeCandidateStatus(row.status) === 'Hired' ? 1 : 0 })),
      (row) => row.created_at,
      ['added', 'hired']
    ), range, ['added', 'hired'])
    const mandateTrend = withMonthFallback(groupByMonth(
      filteredMandates.map((row) => {
        const status = normalizeMandateStatus(row.mandate_status || row.status)
        return { ...row, __ongoing: status === 'Ongoing' ? 1 : 0, __completed: status === 'Completed' ? 1 : 0, __scrapped: status === 'Scrapped' ? 1 : 0 }
      }),
      (row) => row.allocation_date || row.created_at,
      ['ongoing', 'completed', 'scrapped']
    ), range, ['ongoing', 'completed', 'scrapped'])

    const consultantPerformance = consultantOptions.map((name) => {
      const candidateRows = allAssociations.filter((row) => withinPeriod(row.created_at || row.candidate_created_at, range) && matchesConsultant(row, name, ['consultant_name']))
      const mandateRows = jobs.filter((row) => withinPeriod(row.allocation_date || row.created_at, range) && matchesConsultant(row, name, ['consultants', 'team_lead']))
      const clientRows = clientOwnershipAvailable ? allUniqueClients.filter((row) => withinPeriod(row.connected_on_date || row.created_at, range) && matchesConsultant(row, name, ['consultant_name'])) : []
      return {
        name,
        candidatesAdded: new Set(candidateRows.map((row) => row.candidate_id).filter(Boolean)).size,
        candidatesHired: candidateRows.filter((row) => normalizeCandidateStatus(row.status) === 'Hired').length,
        mandatesManaged: mandateRows.length,
        activeClients: clientOwnershipAvailable ? clientRows.filter((row) => normalizeClientStatus(row.status) === 'Active').length : null
      }
    })

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
      candidateStatusData: countByStatus(filteredAssociations, CANDIDATE_STATUSES, (row) => normalizeCandidateStatus(row.status)),
      mandateStatusData: countByStatus(filteredMandates, MANDATE_STATUSES, (row) => normalizeMandateStatus(row.mandate_status || row.status)),
      billingEntityData,
      clientTrend,
      candidateTrend,
      mandateTrend,
      candidateFunnel: ['Interested', 'Client Submission', 'Interview', 'Offered', 'Hired'].map((name) => ({
        name,
        value: filteredAssociations.filter((row) => normalizeCandidateStatus(row.status) === name).length
      })),
      consultantPerformance,
      recentActivity: buildRecentActivity({ clients: uniqueClients, candidates: filteredAssociations, mandates: filteredMandates }),
      sectionErrors,
      clientOwnershipAvailable,
      period,
      consultant
    })
  } catch (err) {
    console.error('getDashboardStats error:', err.message || err)
    return res.json({ ...EMPTY_DASHBOARD, sectionErrors: { dashboard: err.message || 'Unable to load dashboard data.' }, period, consultant })
  }
}

module.exports = { getDashboardStats }
