const supabase = require('./supabaseAdmin')
const { isAdmin, isSuperAdmin } = require('./adminAccess')
const { listEmployeeDirectory } = require('./employeeStatus')
const attendanceService = require('./attendanceService')
const { getFinancialYearForDate, localDate, addDays } = require('./attendanceUtils')
const { buildAttendancePeriodSummary } = require('./attendancePeriodSummary')
const { buildActiveProfiles } = require('./teamAttendanceToday')
const { aggregateAttendance, attendancePayload } = require('./consultantReportAttendance')
const { buildConsultantReportWorkbook } = require('./consultantReportWorkbook')
const {
  OVERALL_CONSULTANT_KEY,
  canViewOverallConsultantReport,
  getOverallConsultantReportAudience
} = require('./consultantReportAccess')
const {
  aggregateConsultantReportFacts,
  buildConsultantReportFacts,
  consultantMatches,
  paginateReportRows,
  parseReportRequest,
  toConversionRow
} = require('./consultantReportLogic')

const COMPANY_TIME_ZONE = process.env.COMPANY_TIME_ZONE || 'Asia/Kolkata'
const DATABASE_PAGE_SIZE = 1000
const JOB_ID_CHUNK_SIZE = 100

function forbidden(message) {
  const error = new Error(message)
  error.statusCode = 403
  return error
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'
}

function employeeStatusLabel(status) {
  if (status === 'on_leave') return 'On Leave'
  if (status === 'inactive') return 'Inactive'
  return 'Active'
}

function publicConsultant(employee) {
  if (employee?.isOverall) {
    return {
      key: OVERALL_CONSULTANT_KEY,
      name: 'Overall Consultants',
      email: '',
      employeeStatus: '',
      initials: 'OC',
      isOverall: true
    }
  }
  return {
    key: employee.user_id,
    name: employee.name,
    email: employee.email || '',
    employeeStatus: employeeStatusLabel(employee.status),
    initials: initials(employee.name)
  }
}

function resolveReportAccess({
  user,
  requestedConsultantUserId = '',
  directory = [],
  admin = false,
  superAdmin = false,
  overallAudience = 'admins'
}) {
  if (requestedConsultantUserId === OVERALL_CONSULTANT_KEY) {
    if (!canViewOverallConsultantReport({ admin, superAdmin }, overallAudience)) {
      throw forbidden('You do not have permission to view the Overall Consultants report.')
    }
    const consultants = directory.filter((employee) => employee.status !== 'inactive')
    return {
      target: {
        user_id: OVERALL_CONSULTANT_KEY,
        name: 'Overall Consultants',
        status: 'active',
        consultants,
        isOverall: true
      },
      directory,
      isAdmin: admin,
      isSuperAdmin: superAdmin,
      canViewOverall: true,
      overallAudience,
      scope: 'overall'
    }
  }
  const currentEmployee = directory.find((employee) => employee.user_id === user?.id)
  const fallbackEmployee = admin ? directory.find((employee) => employee.status !== 'inactive') : null
  const consultantUserId = requestedConsultantUserId || currentEmployee?.user_id || fallbackEmployee?.user_id || ''
  const target = directory.find((employee) => employee.user_id === consultantUserId)

  if (!target && !requestedConsultantUserId && canViewOverallConsultantReport({ admin, superAdmin }, overallAudience)) {
    return resolveReportAccess({
      user,
      requestedConsultantUserId: OVERALL_CONSULTANT_KEY,
      directory,
      admin,
      superAdmin,
      overallAudience
    })
  }

  if (!admin && consultantUserId !== user?.id) throw forbidden('You can only view your own consultant report.')
  if (!target) {
    const error = new Error('Consultant profile not found.')
    error.statusCode = admin ? 404 : 403
    throw error
  }
  if (target.status === 'inactive') throw forbidden('Inactive employees are unavailable for reporting.')
  if (!admin && !currentEmployee) throw forbidden('A consultant profile is required to view this report.')

  return {
    target,
    directory,
    isAdmin: admin,
    isSuperAdmin: superAdmin,
    canViewOverall: canViewOverallConsultantReport({ admin, superAdmin }, overallAudience),
    overallAudience,
    scope: superAdmin ? 'super_admin' : admin ? 'admin' : 'self'
  }
}

async function reportAccess(user, requestedConsultantUserId = '') {
  const [directory, admin, superAdmin, overallAudience] = await Promise.all([
    listEmployeeDirectory(),
    isAdmin(user),
    isSuperAdmin(user),
    getOverallConsultantReportAudience()
  ])
  return resolveReportAccess({ user, requestedConsultantUserId, directory, admin, superAdmin, overallAudience })
}

async function fetchEveryPage(queryFactory) {
  const rows = []
  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await queryFactory().range(from, from + DATABASE_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < DATABASE_PAGE_SIZE) break
  }
  return rows
}

function jobSelect() {
  return 'id,title,consultants,team_lead,budget,mandate_status,status,vertical,allocation_date,created_at,clients(client_name,name,sector)'
}

async function fetchJobs(startDate, endDate) {
  // allocation_date is already a local date. created_at is timestamptz, so use
  // a one-day UTC guard band and let mandateDate apply the company timezone.
  const fallbackQueryStart = addDays(startDate, -1)
  const fallbackQueryEnd = addDays(endDate, 2)
  const [allocated, fallback] = await Promise.all([
    fetchEveryPage(() => supabase
      .from('jobs')
      .select(jobSelect())
      .gte('allocation_date', startDate)
      .lte('allocation_date', endDate)
      .order('allocation_date', { ascending: false })
      .order('id', { ascending: true })),
    fetchEveryPage(() => supabase
      .from('jobs')
      .select(jobSelect())
      .is('allocation_date', null)
      .gte('created_at', `${fallbackQueryStart}T00:00:00.000Z`)
      .lt('created_at', `${fallbackQueryEnd}T00:00:00.000Z`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }))
  ])
  return [...new Map([...allocated, ...fallback].map((job) => [job.id, job])).values()]
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function fetchAssociations(jobIds) {
  if (!jobIds.length) return []
  const groups = await Promise.all(chunks(jobIds, JOB_ID_CHUNK_SIZE).map((ids) => fetchEveryPage(() => supabase
    .from('candidate_associations')
    .select('id,job_id,status,client_submission_at,interview_at,offered_at,hired_at')
    .in('job_id', ids)
    .order('id', { ascending: true }))))
  return groups.flat()
}

async function fetchCandidateAssociations(startDate, endDate, consultant) {
  // created_at is timestamptz. Fetch a UTC guard band, then let the report
  // logic apply the exact company-local inclusive date range.
  const queryStart = addDays(startDate, -1)
  const queryEnd = addDays(endDate, 2)
  const select = 'id,candidate_id,job_id,status,consultant_name,consultant_user_id,created_at'
  const queryFactory = () => supabase
    .from('candidate_associations')
    .select(select)
    .gte('created_at', `${queryStart}T00:00:00.000Z`)
    .lt('created_at', `${queryEnd}T00:00:00.000Z`)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (consultant.isOverall) return fetchEveryPage(queryFactory)

  const [owned, legacyUnlinked] = await Promise.all([
    fetchEveryPage(() => queryFactory().eq('consultant_user_id', consultant.user_id)),
    fetchEveryPage(() => queryFactory().is('consultant_user_id', null))
  ])

  return [...new Map([...owned, ...legacyUnlinked].map((association) => [association.id, association])).values()]
}

async function loadFacts(params, access) {
  const [jobs, candidateAssociations] = await Promise.all([
    fetchJobs(params.startDate, params.endDate),
    fetchCandidateAssociations(params.startDate, params.endDate, access.target)
  ])
  const assignedJobIds = jobs
    .filter((job) => consultantMatches(job, access.target))
    .map((job) => job.id)
  const associations = await fetchAssociations(assignedJobIds)
  const factInput = { jobs, associations, candidateAssociations, startDate: params.startDate, endDate: params.endDate }
  const facts = access.target.isOverall
    ? aggregateConsultantReportFacts(access.target.consultants.map((consultant) => ({
      consultant,
      facts: buildConsultantReportFacts({ ...factInput, consultant })
    })), { startDate: params.startDate, endDate: params.endDate })
    : buildConsultantReportFacts({ ...factInput, consultant: access.target })
  facts.warnings.forEach((warning) => {
    console.warn('[consultant-report:data-quality]', {
      code: warning.code,
      count: warning.count,
      consultantUserId: access.target.user_id,
      startDate: params.startDate,
      endDate: params.endDate
    })
  })
  return facts
}

function groupByUserId(rows = []) {
  const grouped = new Map()
  for (const row of rows || []) {
    const key = String(row.user_id || '')
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }
  return grouped
}

async function mapWithConcurrency(values, limit, mapper) {
  const result = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      result[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return result
}

async function loadOverallAttendance(params) {
  const today = localDate()
  await attendanceService.expireOpenClockIns(today)
  const [profilesResult, statusesResult, adminsResult] = await Promise.all([
    supabase.from('user_profiles').select('user_id,name,email').not('name', 'is', null).order('name'),
    supabase.from('employee_statuses').select('user_id,status'),
    supabase.from('admin_users').select('user_id,email,role,is_super_admin')
  ])
  for (const result of [profilesResult, statusesResult, adminsResult]) if (result.error) throw result.error
  const profiles = buildActiveProfiles(profilesResult.data, statusesResult.data, adminsResult.data)
  if (!profiles.length) return aggregateAttendance([])

  const userIds = profiles.map((profile) => profile.user_id)
  const [records, leaveRequests, correctionRequests, holidayRows] = await Promise.all([
    fetchEveryPage(() => supabase
      .from('attendance_records')
      .select('id,user_id,attendance_date,status,clock_in_at,clock_out_at,worked_minutes')
      .in('user_id', userIds)
      .gte('attendance_date', params.startDate)
      .lte('attendance_date', params.endDate)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })),
    fetchEveryPage(() => supabase
      .from('leave_requests')
      .select('id,user_id,start_date,end_date,duration_type,half_day_session,status')
      .in('user_id', userIds)
      .in('status', ['pending', 'approved', 'rejected'])
      .lte('start_date', params.endDate)
      .gte('end_date', params.startDate)
      .order('start_date', { ascending: true })
      .order('id', { ascending: true })),
    fetchEveryPage(() => supabase
      .from('attendance_correction_requests')
      .select('id,user_id,attendance_date,status')
      .in('user_id', userIds)
      .gte('attendance_date', params.startDate)
      .lte('attendance_date', params.endDate)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })),
    attendanceService.holidays(params.startDate, params.endDate)
  ])

  const recordsByUser = groupByUserId(records)
  const leavesByUser = groupByUserId(leaveRequests)
  const correctionsByUser = groupByUserId(correctionRequests)
  const financialYear = getFinancialYearForDate(today)
  const rows = await mapWithConcurrency(profiles, 4, async (profile) => {
    const period = buildAttendancePeriodSummary({
      start: params.startDate,
      end: params.endDate,
      records: recordsByUser.get(String(profile.user_id)) || [],
      holidayRows,
      leaveRequests: leavesByUser.get(String(profile.user_id)) || [],
      correctionRequests: correctionsByUser.get(String(profile.user_id)) || [],
      today
    })
    const balance = await attendanceService.leaveBalanceSummary(profile.user_id, financialYear, today)
    return {
      consultant: publicConsultant({ ...profile, status: 'active' }),
      period,
      balance
    }
  })
  return aggregateAttendance(rows)
}

async function loadAttendance(user, target, params) {
  const targetUserId = target.user_id
  const today = localDate()
  try {
    if (target.isOverall) return { attendance: await loadOverallAttendance(params), warnings: [] }
    const period = await attendanceService.periodSummary(user, targetUserId, params.startDate, params.endDate)
    const financialYear = getFinancialYearForDate(today)
    const balance = await attendanceService.leaveBalanceSummary(targetUserId, financialYear, today)
    return { attendance: attendancePayload(period, balance), warnings: [] }
  } catch (error) {
    const permissionDenied = error.statusCode === 403
    console.warn('[consultant-report:attendance]', {
      code: permissionDenied ? 'attendance_permission_denied' : 'attendance_unavailable',
      targetUserId,
      message: error.message
    })
    return {
      attendance: { available: false, metrics: [], leaveBalance: null },
      warnings: [{
        code: permissionDenied ? 'attendance_permission_denied' : 'attendance_unavailable',
        count: 1,
        message: permissionDenied
          ? 'Attendance is hidden because your current Attendance permission does not allow cross-user access.'
          : 'Attendance and leave data are temporarily unavailable.'
      }]
    }
  }
}

function metaFor(params, access, user, warnings, generatedAt) {
  const untracked = {}
  return {
    consultantScope: access.scope,
    startDate: params.startDate,
    endDate: params.endDate,
    requestedEndDate: params.requestedEndDate,
    endDateWasCapped: params.endDateWasCapped,
    generatedAt,
    generatedBy: user?.name || user?.email || 'FYNDBRIDGE User',
    timezone: COMPANY_TIME_ZONE,
    dateConvention: 'Inclusive local calendar dates; future To dates are capped at today.',
    dateFields: {
      mandates: 'allocation_date, with created_at as the established fallback',
      candidates: 'candidate_associations.created_at, attributed by consultant_user_id with a legacy consultant_name fallback; current status as of report generation',
      attendance: 'attendance_date'
    },
    trackingLimitation: 'First-stage timestamps are tracked only after the stage-tracking migration; historical nulls are not estimated.',
    untrackedStageRecords: untracked,
    warnings
  }
}

async function getConsultantOptions(user) {
  const access = await reportAccess(user)
  const allowed = access.isAdmin
    ? access.directory.filter((employee) => employee.status !== 'inactive')
    : [access.target]
  const options = allowed.map(publicConsultant)
  if (access.canViewOverall) options.unshift(publicConsultant({ isOverall: true }))
  const currentAllowed = options.find((option) => option.key === user.id)
  return {
    options,
    defaultConsultantKey: currentAllowed?.key || options[0]?.key || '',
    overallConsultantAccess: access.overallAudience
  }
}

async function getConsultantReport(user, query) {
  const params = parseReportRequest(query, 'main')
  const access = await reportAccess(user, params.consultantUserId)
  const [facts, attendanceResult] = await Promise.all([
    loadFacts(params, access),
    loadAttendance(user, access.target, params)
  ])
  return buildReportResponse({ params, access, user, facts, attendanceResult })
}

function buildReportResponse({ params, access, user, facts, attendanceResult }) {
  const warnings = [...facts.warnings, ...attendanceResult.warnings]
  if (params.endDateWasCapped) warnings.push({ code: 'future_end_date_capped', count: 1, message: 'The To date was capped at today.' })
  const generatedAt = new Date().toISOString()
  const meta = metaFor(params, access, user, warnings, generatedAt)
  meta.untrackedStageRecords = Object.fromEntries(facts.conversionSummary.map((stage) => [stage.key, stage.untrackedMandates]))
  return {
    meta,
    consultant: publicConsultant(access.target),
    mandateSummary: facts.mandateSummary,
    recentMandates: facts.recentMandates,
    conversionSummary: facts.conversionSummary,
    recentConversions: facts.recentConversions,
    candidateOverview: facts.candidateOverview,
    dailyCandidateUploads: facts.dailyCandidateUploads,
    candidatePipeline: facts.candidatePipeline,
    exceptions: facts.exceptions,
    positiveOutcomes: facts.positiveOutcomes,
    attendance: attendanceResult.attendance,
    warnings
  }
}

async function getConsultantReportExport(user, query) {
  const params = parseReportRequest(query, 'main')
  const access = await reportAccess(user, params.consultantUserId)
  const [facts, attendanceResult] = await Promise.all([
    loadFacts(params, access),
    loadAttendance(user, access.target, params)
  ])
  const report = buildReportResponse({ params, access, user, facts, attendanceResult })
  const workbook = await buildConsultantReportWorkbook({
    report,
    mandates: access.target.isOverall ? [] : facts.mandates
  })
  return {
    fileName: workbook.fileName,
    mimeType: workbook.mimeType,
    contentBase64: workbook.buffer.toString('base64'),
    preview: workbook.preview
  }
}

async function getPaginatedReport(user, query, kind) {
  const params = parseReportRequest(query, kind)
  const access = await reportAccess(user, params.consultantUserId)
  const facts = await loadFacts(params, access)
  const paginated = paginateReportRows(facts.mandates, params)
  if (kind === 'conversions') paginated.rows = paginated.rows.map(toConversionRow)
  return {
    meta: metaFor(params, access, user, facts.warnings, new Date().toISOString()),
    ...paginated
  }
}

const getConsultantMandates = (user, query) => getPaginatedReport(user, query, 'mandates')
const getConsultantConversions = (user, query) => getPaginatedReport(user, query, 'conversions')

module.exports = {
  getConsultantConversions,
  getConsultantMandates,
  getConsultantOptions,
  getConsultantReportExport,
  getConsultantReport,
  reportAccess,
  resolveReportAccess
}
