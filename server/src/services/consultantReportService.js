const supabase = require('./supabaseAdmin')
const { isAdmin, isSuperAdmin } = require('./adminAccess')
const { listEmployeeDirectory } = require('./employeeStatus')
const attendanceService = require('./attendanceService')
const { getFinancialYearForDate, localDate, addDays } = require('./attendanceUtils')
const {
  buildConsultantReportFacts,
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
  return {
    key: employee.user_id,
    name: employee.name,
    email: employee.email || '',
    employeeStatus: employeeStatusLabel(employee.status),
    initials: initials(employee.name)
  }
}

function resolveReportAccess({ user, requestedConsultantUserId = '', directory = [], admin = false, superAdmin = false }) {
  const currentEmployee = directory.find((employee) => employee.user_id === user?.id)
  const consultantUserId = requestedConsultantUserId || currentEmployee?.user_id || ''
  const target = directory.find((employee) => employee.user_id === consultantUserId)

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
    scope: superAdmin ? 'super_admin' : admin ? 'admin' : 'self'
  }
}

async function reportAccess(user, requestedConsultantUserId = '') {
  const [directory, admin, superAdmin] = await Promise.all([
    listEmployeeDirectory(),
    isAdmin(user),
    isSuperAdmin(user)
  ])
  return resolveReportAccess({ user, requestedConsultantUserId, directory, admin, superAdmin })
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

async function loadFacts(params, access) {
  const jobs = await fetchJobs(params.startDate, params.endDate)
  const assignedJobIds = jobs
    .filter((job) => {
      const consultantNames = Array.isArray(job.consultants) ? job.consultants : []
      const target = access.target.name.trim().toLowerCase()
      return consultantNames.some((name) => String(name || '').trim().toLowerCase() === target)
        || String(job.team_lead || '').trim().toLowerCase() === target
    })
    .map((job) => job.id)
  const associations = await fetchAssociations(assignedJobIds)
  const facts = buildConsultantReportFacts({
    jobs,
    associations,
    consultant: access.target,
    startDate: params.startDate,
    endDate: params.endDate
  })
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

function workedTimeLabel(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function attendancePayload(period, balance) {
  const summary = period.kpis
  const availableBalance = Number(balance.available_balance) || 0
  return {
    available: true,
    metrics: [
      { key: 'workingDays', label: 'Working Days', value: summary.working_days, tone: 'blue' },
      { key: 'presentDays', label: 'Present Days', value: summary.present, tone: 'green' },
      { key: 'leaveDays', label: 'Leave Days', value: summary.leave, tone: 'purple' },
      { key: 'halfDayLeave', label: 'Half-Day Leave', value: summary.half_day_leave, tone: 'amber' },
      { key: 'unmarkedDays', label: 'Unmarked Days', value: summary.unmarked, tone: 'red' },
      { key: 'correctedAttendance', label: 'Corrected Attendance', value: summary.corrected_attendance, tone: 'cyan' },
      { key: 'pendingCorrections', label: 'Pending Corrections', value: summary.pending_corrections, tone: 'amber' },
      { key: 'workedTime', label: 'Total Worked Hours', value: workedTimeLabel(summary.total_minutes), numericValue: summary.total_minutes, tone: 'navy' },
      { key: 'leaveBalance', label: 'Leave Balance', value: `${availableBalance} days`, numericValue: availableBalance, tone: 'teal' },
      { key: 'attendancePercentage', label: 'Attendance Percentage', value: `${summary.attendance_percentage}%`, numericValue: summary.attendance_percentage, tone: 'green' }
    ],
    leaveBalance: {
      financialYear: balance.financial_year,
      annualEntitlement: Number(balance.annual_entitlement) || 0,
      openingCarryForward: Number(balance.opening_carry_forward) || 0,
      accruedLeave: Number(balance.accrued_leave) || 0,
      usedLeave: Number(balance.used_leave) || 0,
      pendingLeave: Number(balance.pending_leave) || 0,
      availableBalance,
      projectedBalance: Number(balance.projected_balance) || 0,
      lossOfPayExposure: Number(balance.loss_of_pay_exposure) || 0
    }
  }
}

async function loadAttendance(user, targetUserId, params) {
  const today = localDate()
  try {
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
      candidates: 'current candidate-association status under in-scope mandates',
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
  const currentAllowed = options.find((option) => option.key === user.id)
  return {
    options,
    defaultConsultantKey: currentAllowed?.key || options[0]?.key || ''
  }
}

async function getConsultantReport(user, query) {
  const params = parseReportRequest(query, 'main')
  const access = await reportAccess(user, params.consultantUserId)
  const [facts, attendanceResult] = await Promise.all([
    loadFacts(params, access),
    loadAttendance(user, access.target.user_id, params)
  ])
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
    candidatePipeline: facts.candidatePipeline,
    exceptions: facts.exceptions,
    positiveOutcomes: facts.positiveOutcomes,
    attendance: attendanceResult.attendance,
    warnings
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
  getConsultantReport,
  reportAccess,
  resolveReportAccess
}
