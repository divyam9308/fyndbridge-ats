import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BriefcaseBusiness, CalendarCheck2, ChevronDown, FileDown, Play, UsersRound } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import FormattedDateInput from '../components/FormattedDateInput'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import {
  CandidateOverview,
  CandidatePipeline,
  MandateConversionTable,
  RecentMandatesTable,
  ReportDataModal,
  ReportKpiCard,
  ReportSectionHeader
} from '../features/reports/ConsultantReportComponents'
import { formatReportDate } from '../features/reports/reportFormatters'
import { getConsultantReport, getConsultantReportOptions, getConsultantReportRows } from '../services/reportApi'
import '../styles/Shared.css'
import './ConsultantReportPage.css'

const TABS = [
  { key: 'mandates', label: 'Mandates', Icon: BriefcaseBusiness },
  { key: 'candidates', label: 'Candidates & Pipeline', Icon: UsersRound },
  { key: 'attendance', label: 'Attendance & Outcomes', Icon: CalendarCheck2 }
]

function localDateValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialDateRange() {
  const today = new Date()
  return {
    fromDate: localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    toDate: localDateValue(today)
  }
}

const INITIAL_DATES = initialDateRange()

function generatedLabel(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function dateRangeLabel(fromDate, toDate) {
  return `${formatReportDate(fromDate)} – ${formatReportDate(toDate)}`
}

function displayEmployeeStatus(value) {
  const normalized = String(value || 'Active').trim().toLowerCase().replaceAll('_', ' ')
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function initials(name) {
  return String(name || 'Consultant').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function normalizeOption(option) {
  const key = option?.key || option?.userId || option?.user_id || option?.id
  return {
    ...option,
    key,
    name: option?.name || option?.email || 'Consultant',
    email: option?.email || '',
    employeeStatus: displayEmployeeStatus(option?.employeeStatus || option?.employee_status || option?.status)
  }
}

function disambiguateOptions(options) {
  const countsByName = options.reduce((counts, option) => {
    const name = option.name.toLowerCase()
    counts.set(name, (counts.get(name) || 0) + 1)
    return counts
  }, new Map())
  return options.map((option) => {
    const duplicateName = countsByName.get(option.name.toLowerCase()) > 1
    return {
      ...option,
      duplicateName,
      inputLabel: duplicateName && option.email ? `${option.name} — ${option.email}` : option.name
    }
  })
}

function generatedByLabel(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value
  if (value?.name) return value.name
  if (value?.email) return value.email
  return fallback
}

function metricValue(item) {
  if (item?.displayValue !== undefined && item?.displayValue !== null) return item.displayValue
  if (item?.value !== undefined && item?.value !== null) return item.value
  if (item?.averageDays !== undefined && item?.averageDays !== null && Number.isFinite(Number(item.averageDays))) return `${Number(item.averageDays)} days`
  return 'Not tracked'
}

function trackedDetail(item) {
  const tracked = Number(item?.trackedMandates) || 0
  const untracked = Number(item?.untrackedMandates) || 0
  if (!tracked && !untracked) return ''
  return `${tracked} tracked${untracked ? ` · ${untracked} not tracked` : ''}`
}

function MandatesReport({ report, openModal }) {
  const summary = report.mandateSummary || {}
  const summaryCards = [
    { label: 'Total Mandates', value: summary.total ?? 0, tone: 'navy' },
    { label: 'Ongoing', value: summary.ongoing ?? 0, tone: 'teal' },
    { label: 'Completed', value: summary.completed ?? 0, tone: 'green' },
    { label: 'Scrapped', value: summary.scrapped ?? 0, tone: 'neutral' }
  ]
  const conversionSummary = Array.isArray(report.conversionSummary) ? report.conversionSummary : []
  const recentMandates = Array.isArray(report.recentMandates) ? report.recentMandates.slice(0, 5) : []
  const recentConversions = Array.isArray(report.recentConversions) ? report.recentConversions.slice(0, 5) : []

  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Mandate Summary" description="Current mandate distribution for the selected consultant and report period." />
        <div className="report-kpi-grid is-four">
          {summaryCards.map((item) => <ReportKpiCard key={item.label} {...item} />)}
        </div>
      </section>

      <section className="report-section report-table-section">
        <ReportSectionHeader
          title="Recent Mandates"
          description="The five most recently allocated mandates and their complete candidate status split."
          action={<button className="report-text-button" type="button" onClick={() => openModal('mandates')}>View All Mandates</button>}
        />
        <RecentMandatesTable rows={recentMandates} />
      </section>

      <section className="report-section">
        <ReportSectionHeader title="Average Conversion Time" description="Average time taken to reach each tracked mandate milestone." />
        {conversionSummary.length ? (
          <div className="report-kpi-grid is-four report-conversion-kpis">
            {conversionSummary.map((item) => (
              <ReportKpiCard
                key={item.key || item.label}
                label={item.label}
                value={metricValue(item)}
                tone={item.tone || 'blue'}
                detail={trackedDetail(item)}
              />
            ))}
          </div>
        ) : <div className="report-empty-state report-inline-empty">No tracked conversion milestones are available for this period.</div>}
        <div className="report-subsection-heading">
          <div>
            <h3>Mandate Conversion & Ageing</h3>
            <p>Latest five mandates. Ongoing mandates older than 45 days are softly highlighted.</p>
          </div>
          <button className="report-text-button" type="button" onClick={() => openModal('conversion')}>View All</button>
        </div>
        <MandateConversionTable rows={recentConversions} />
      </section>
    </div>
  )
}

function CandidatesReport({ report }) {
  const overview = report.candidateOverview || { total: 0, counts: {} }
  const pipeline = Array.isArray(report.candidatePipeline) ? report.candidatePipeline : []
  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Candidate Overview" description={`Complete status distribution for all ${overview.total ?? 0} candidates in this report scope.`} />
        <CandidateOverview overview={overview} />
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Candidate Pipeline" description="Progression through the primary recruitment stages, with every percentage calculated from total candidates." />
        <CandidatePipeline stages={pipeline} total={overview.total} />
      </section>
    </div>
  )
}

function leaveBalanceValue(leaveBalance) {
  const value = leaveBalance?.availableBalance
  if (value === undefined || value === null) return 'Not available'
  if (typeof value === 'number') return `${value} day${value === 1 ? '' : 's'}`
  return String(value)
}

function OutcomesReport({ report }) {
  const exceptions = Array.isArray(report.exceptions) ? report.exceptions : []
  const positiveOutcomes = Array.isArray(report.positiveOutcomes) ? report.positiveOutcomes : []
  const attendance = report.attendance || { available: false, metrics: [] }
  const attendanceMetrics = (Array.isArray(attendance.metrics) ? attendance.metrics : []).filter((item) => {
    const key = String(item?.key || '').toLowerCase()
    const label = String(item?.label || '').toLowerCase()
    return key !== 'latedays' && key !== 'late_days' && key !== 'leavebalance' && key !== 'leave_balance' && label !== 'late days' && label !== 'leave balance'
  })

  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Exceptions" description="Number-only indicators that may need follow-up within the selected period." />
        {exceptions.length ? (
          <div className="report-kpi-grid is-five">
            {exceptions.map((item) => <ReportKpiCard key={item.key || item.label} label={item.label} value={item.value ?? 0} tone={item.tone || 'blue'} compact />)}
          </div>
        ) : <div className="report-empty-state report-inline-empty">No exception metrics are available for this period.</div>}
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Positive Outcomes" description="Key recruitment outcomes recorded in the current report scope." />
        {positiveOutcomes.length ? (
          <div className="report-kpi-grid is-six">
            {positiveOutcomes.map((item) => <ReportKpiCard key={item.key || item.label} label={item.label} value={item.value ?? 0} tone={item.tone || 'blue'} compact />)}
          </div>
        ) : <div className="report-empty-state report-inline-empty">No positive outcome metrics are available for this period.</div>}
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Attendance Snapshot" description="Attendance and combined leave-balance indicators from the ATS attendance service." />
        {attendance.available ? (
          <>
            {attendanceMetrics.length ? (
              <div className="attendance-metric-grid">
                {attendanceMetrics.map((item) => <ReportKpiCard key={item.key || item.label} label={item.label} value={item.value ?? '—'} tone={item.tone || 'blue'} compact />)}
              </div>
            ) : <div className="report-empty-state report-inline-empty">No attendance records were found for this period.</div>}
            <div className="report-subsection-heading">
              <div>
                <h3>Leave Balance</h3>
                <p>Current combined available balance from the ATS leave ledger.</p>
              </div>
            </div>
            <div className="report-leave-balance">
              <ReportKpiCard label="Available Leave Balance" value={leaveBalanceValue(attendance.leaveBalance)} tone="green" compact />
            </div>
          </>
        ) : (
          <div className="report-empty-state report-inline-empty">
            Attendance data is not available for this consultant and period.
          </div>
        )}
      </section>
    </div>
  )
}

export default function ConsultantReportPage() {
  const { user } = useAuth()
  const [options, setOptions] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState('')
  const [optionsRetryKey, setOptionsRetryKey] = useState(0)
  const [draftConsultantName, setDraftConsultantName] = useState('')
  const [consultantMenuOpen, setConsultantMenuOpen] = useState(false)
  const [highlightedConsultantIndex, setHighlightedConsultantIndex] = useState(-1)
  const consultantControlRef = useRef(null)
  const [draftFromDate, setDraftFromDate] = useState(INITIAL_DATES.fromDate)
  const [draftToDate, setDraftToDate] = useState(INITIAL_DATES.toDate)
  const [requestFilters, setRequestFilters] = useState(null)
  const [appliedFilters, setAppliedFilters] = useState(null)
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportRetryKey, setReportRetryKey] = useState(0)
  const announceOnLoad = useRef(false)
  const [activeTab, setActiveTab] = useState('mandates')
  const [modal, setModal] = useState('')
  const [toast, setToast] = useState('')

  const userLabel = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'FYNDBRIDGE User'
  const selectedOption = useMemo(
    () => options.find((option) => option.key === (appliedFilters?.consultantUserId || requestFilters?.consultantUserId)),
    [appliedFilters?.consultantUserId, options, requestFilters?.consultantUserId]
  )
  const consultant = report?.consultant || selectedOption
  const selectedPeriod = appliedFilters ? dateRangeLabel(appliedFilters.startDate, appliedFilters.endDate) : dateRangeLabel(draftFromDate, draftToDate)
  const generatedOn = report?.meta?.generatedAt
  const generatedBy = generatedByLabel(report?.meta?.generatedBy, userLabel)
  const filteredConsultantOptions = useMemo(() => {
    const query = draftConsultantName.trim().toLowerCase()
    const isExactSelection = options.some((option) => option.inputLabel.toLowerCase() === query)
    if (!query || isExactSelection) return options
    return options.filter((option) => (
      option.name.toLowerCase().includes(query)
      || option.email.toLowerCase().includes(query)
      || option.inputLabel.toLowerCase().includes(query)
    ))
  }, [draftConsultantName, options])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!consultantMenuOpen) return undefined
    const closeOnOutsidePress = (event) => {
      if (!consultantControlRef.current?.contains(event.target)) {
        setConsultantMenuOpen(false)
        setHighlightedConsultantIndex(-1)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [consultantMenuOpen])

  useEffect(() => {
    const controller = new AbortController()

    getConsultantReportOptions({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        const nextOptions = disambiguateOptions(
          (Array.isArray(result?.options) ? result.options : []).map(normalizeOption).filter((option) => option.key)
        )
        if (!nextOptions.length) throw new Error('No consultants are available for reporting.')
        const defaultKey = result?.defaultConsultantKey || result?.default_consultant_key
        const defaultOption = nextOptions.find((option) => option.key === defaultKey) || nextOptions[0]
        setOptions(nextOptions)
        setDraftConsultantName(defaultOption.inputLabel)
        setReportLoading(true)
        setReportError('')
        setRequestFilters({
          consultantUserId: defaultOption.key,
          startDate: INITIAL_DATES.fromDate,
          endDate: INITIAL_DATES.toDate
        })
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError' && !controller.signal.aborted) {
          setOptionsError(requestError?.message || 'Unable to load consultant options.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false)
      })

    return () => controller.abort()
  }, [optionsRetryKey])

  useEffect(() => {
    if (!requestFilters) return undefined
    const controller = new AbortController()

    getConsultantReport(requestFilters, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setReport(result)
        const appliedEndDate = result?.meta?.endDate || requestFilters.endDate
        setAppliedFilters({
          consultantUserId: result?.consultant?.key || requestFilters.consultantUserId,
          startDate: result?.meta?.startDate || requestFilters.startDate,
          endDate: appliedEndDate
        })
        if (result?.meta?.endDateWasCapped) setDraftToDate(appliedEndDate)
        if (announceOnLoad.current) {
          setToast(`Report updated for ${result?.consultant?.name || 'the selected consultant'}.`)
          announceOnLoad.current = false
        }
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError' && !controller.signal.aborted) {
          setReportError(requestError?.message || 'Unable to generate the consultant report.')
          announceOnLoad.current = false
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportLoading(false)
      })

    return () => controller.abort()
  }, [reportRetryKey, requestFilters])

  const generateReport = () => {
    if (!draftFromDate || !draftToDate) {
      setToast('Choose both a From date and a To date.')
      return
    }
    if (draftFromDate > draftToDate) {
      setToast('From date cannot be later than To date.')
      return
    }
    const normalized = draftConsultantName.trim().toLowerCase()
    const match = options.find((option) => (
      option.inputLabel.toLowerCase() === normalized
      || option.email.toLowerCase() === normalized
      || (!option.duplicateName && option.name.toLowerCase() === normalized)
    ))
    if (!match) {
      setToast('Choose a consultant from the available list.')
      return
    }
    setDraftConsultantName(match.inputLabel)
    setConsultantMenuOpen(false)
    setHighlightedConsultantIndex(-1)
    setModal('')
    announceOnLoad.current = true
    setReportLoading(true)
    setReportError('')
    setRequestFilters({ consultantUserId: match.key, startDate: draftFromDate, endDate: draftToDate })
  }

  const selectConsultant = (option) => {
    setDraftConsultantName(option.inputLabel)
    setConsultantMenuOpen(false)
    setHighlightedConsultantIndex(-1)
  }

  const handleConsultantKeyDown = (event) => {
    if (event.key === 'Escape') {
      setConsultantMenuOpen(false)
      setHighlightedConsultantIndex(-1)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setConsultantMenuOpen(true)
      setHighlightedConsultantIndex((current) => {
        if (!filteredConsultantOptions.length) return -1
        if (event.key === 'ArrowDown') return current >= filteredConsultantOptions.length - 1 ? 0 : current + 1
        return current <= 0 ? filteredConsultantOptions.length - 1 : current - 1
      })
      return
    }
    const highlightedOption = filteredConsultantOptions[highlightedConsultantIndex]
    if (event.key === 'Enter' && consultantMenuOpen && highlightedOption) {
      event.preventDefault()
      selectConsultant(highlightedOption)
    }
  }

  const fetchModalRows = useCallback((controls, signal) => {
    if (!appliedFilters || !modal) return Promise.resolve({ rows: [], pagination: { page: 1, pageSize: controls.pageSize, total: 0, totalPages: 1 } })
    return getConsultantReportRows(modal, { ...appliedFilters, ...controls }, { signal })
  }, [appliedFilters, modal])
  const closeModal = useCallback(() => setModal(''), [])

  const warnings = Array.isArray(report?.meta?.warnings) ? report.meta.warnings : []
  const status = displayEmployeeStatus(consultant?.employeeStatus || consultant?.employee_status)
  const avatarInitials = consultant?.initials || initials(consultant?.name)

  return (
    <div className="consultant-report-page">
      {toast && <div className="report-toast" role="status" aria-live="polite">{toast}</div>}
      <header className="report-page-header">
        <div className="report-title-block">
          <span className="report-eyebrow">Consultant performance</span>
          <h1>Consultant-Wise Report</h1>
          <div className="report-generation-meta">
            <span>Generated on <strong>{generatedLabel(generatedOn)}</strong></span>
            <i aria-hidden="true" />
            <span>Generated by <strong>{generatedBy}</strong></span>
          </div>
        </div>
        <div className="report-header-actions">
          <div className={`report-control report-consultant-control${consultantMenuOpen ? ' is-open' : ''}`} ref={consultantControlRef}>
            <label className="report-control-label" htmlFor="report-consultant-input">Consultant</label>
            <div className="report-consultant-field">
              <input
                id="report-consultant-input"
                value={draftConsultantName}
                onChange={(event) => {
                  setDraftConsultantName(event.target.value)
                  setConsultantMenuOpen(true)
                  setHighlightedConsultantIndex(0)
                }}
                onFocus={() => {
                  setConsultantMenuOpen(true)
                  setHighlightedConsultantIndex(0)
                }}
                onKeyDown={handleConsultantKeyDown}
                placeholder={optionsLoading ? 'Loading consultants...' : 'Search consultant'}
                aria-label="Search and select consultant"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="report-consultant-options"
                aria-expanded={consultantMenuOpen}
                aria-activedescendant={consultantMenuOpen && highlightedConsultantIndex >= 0 ? `report-consultant-option-${highlightedConsultantIndex}` : undefined}
                disabled={optionsLoading || !options.length}
              />
              <button
                className="report-consultant-toggle"
                type="button"
                aria-label={consultantMenuOpen ? 'Close consultant options' : 'Open consultant options'}
                aria-expanded={consultantMenuOpen}
                disabled={optionsLoading || !options.length}
                onClick={() => {
                  setConsultantMenuOpen((isOpen) => !isOpen)
                  setHighlightedConsultantIndex(0)
                }}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {consultantMenuOpen && (
                <div className="report-consultant-options" id="report-consultant-options" role="listbox" aria-label="Consultants">
                  {filteredConsultantOptions.length ? filteredConsultantOptions.map((option, index) => (
                    <button
                      className={`report-consultant-option${highlightedConsultantIndex === index ? ' is-highlighted' : ''}`}
                      id={`report-consultant-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={option.inputLabel === draftConsultantName}
                      key={option.key}
                      onMouseEnter={() => setHighlightedConsultantIndex(index)}
                      onClick={() => selectConsultant(option)}
                    >
                      <span>{option.name}</span>
                      {option.email && <small>{option.email}</small>}
                    </button>
                  )) : <div className="report-consultant-empty">No matching consultants</div>}
                </div>
              )}
            </div>
          </div>
          <div className="report-date-range" aria-label="Report period date range">
            <div className="report-control">
              <label className="report-control-label" htmlFor="report-from-date">From date</label>
              <FormattedDateInput id="report-from-date" value={draftFromDate} onChange={setDraftFromDate} className="report-date-input" name="report-from-date" />
            </div>
            <div className="report-control">
              <label className="report-control-label" htmlFor="report-to-date">To date</label>
              <FormattedDateInput id="report-to-date" value={draftToDate} onChange={setDraftToDate} className="report-date-input" name="report-to-date" />
            </div>
          </div>
          <button className="report-primary-button" type="button" disabled={optionsLoading || reportLoading || !options.length} onClick={generateReport}>
            <Play size={16} fill="currentColor" />{reportLoading ? 'Generating...' : 'Generate Report'}
          </button>
          <button className="report-secondary-button" type="button" onClick={() => setToast('Export will be connected in a future update.')}><FileDown size={17} />Export Report</button>
        </div>
      </header>

      <section className={`consultant-identity-card${consultant ? '' : ' is-placeholder'}`} aria-label="Consultant report scope">
        {consultant ? (
          <div className="consultant-identity-primary">
            <div className="consultant-report-avatar">{avatarInitials}</div>
            <div>
              <div className="consultant-name-row">
                <h2>{consultant.name}</h2>
                <span className={`employee-status-chip${status === 'On Leave' ? ' is-leave' : ''}`}>{status}</span>
              </div>
              {consultant.email && <a href={`mailto:${consultant.email}`}>{consultant.email}</a>}
            </div>
          </div>
        ) : (
          <div className="consultant-identity-primary" aria-hidden="true">
            <div className="consultant-report-avatar is-placeholder" />
            <div className="report-identity-placeholder-copy">
              <span className="report-skeleton-line is-name" />
              <span className="report-skeleton-line is-email" />
            </div>
          </div>
        )}
        <dl className="consultant-scope-details is-report-only">
          <div><dt>Report Period</dt><dd>{selectedPeriod}</dd></div>
        </dl>
      </section>

      {report && (reportLoading || optionsLoading || reportError || optionsError || warnings.length > 0) && (
        <div className="report-notice-stack">
          {(reportLoading || optionsLoading || reportError || optionsError) && (
            <div className={`report-refresh-banner${reportError || optionsError ? ' is-error' : ''}`} role="status">
              {reportLoading ? 'Updating the report…' : optionsLoading ? 'Reloading consultant access…' : (reportError || optionsError)}
              {!reportLoading && reportError && (
                <button className="report-text-button" type="button" onClick={() => { setReportLoading(true); setReportError(''); setReportRetryKey((value) => value + 1) }}>Try again</button>
              )}
              {!reportLoading && optionsError && (
                <button className="report-text-button" type="button" onClick={() => { setOptionsLoading(true); setOptionsError(''); setOptionsRetryKey((value) => value + 1) }}>Reload consultants</button>
              )}
            </div>
          )}
          {warnings.length > 0 && (
            <aside className="report-warning-panel" role="status">
              {warnings.map((warning, index) => <p key={`${typeof warning === 'string' ? warning : warning?.message}-${index}`}>{typeof warning === 'string' ? warning : warning?.message}</p>)}
            </aside>
          )}
        </div>
      )}

      <nav className="report-tabs" aria-label="Consultant report sections" role="tablist">
        {TABS.map(({ key, label, Icon }) => (
          <button
            className={activeTab === key ? 'is-active' : ''}
            type="button"
            role="tab"
            id={`consultant-report-tab-${key}`}
            key={key}
            aria-controls={`consultant-report-panel-${key}`}
            aria-selected={activeTab === key}
            disabled={!report}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={17} />{label}
          </button>
        ))}
      </nav>

      <div className="report-tab-stage" aria-busy={optionsLoading || reportLoading}>
        {optionsError && !report ? (
          <section className="report-load-state report-error-panel" role="alert">
            <h2>Consultants could not be loaded</h2>
            <p>{optionsError}</p>
            <button className="report-secondary-button" type="button" onClick={() => { setOptionsLoading(true); setOptionsError(''); setOptionsRetryKey((value) => value + 1) }}>Try again</button>
          </section>
        ) : (optionsLoading || reportLoading) && !report ? (
          <section className="report-load-state"><FyndbridgeLoader size={82} label={optionsLoading ? 'Loading report access...' : 'Generating consultant report...'} /></section>
        ) : reportError && !report ? (
          <section className="report-load-state report-error-panel" role="alert">
            <h2>Report could not be generated</h2>
            <p>{reportError}</p>
            <button className="report-secondary-button" type="button" onClick={() => { setReportLoading(true); setReportError(''); setReportRetryKey((value) => value + 1) }}>Try again</button>
          </section>
        ) : report ? (
          <>
            <section
              className={`report-tab-view${activeTab === 'mandates' ? ' is-active' : ''}`}
              id="consultant-report-panel-mandates"
              role="tabpanel"
              aria-labelledby="consultant-report-tab-mandates"
              aria-hidden={activeTab !== 'mandates'}
            >
              <MandatesReport report={report} openModal={setModal} />
            </section>
            <section
              className={`report-tab-view${activeTab === 'candidates' ? ' is-active' : ''}`}
              id="consultant-report-panel-candidates"
              role="tabpanel"
              aria-labelledby="consultant-report-tab-candidates"
              aria-hidden={activeTab !== 'candidates'}
            >
              <CandidatesReport report={report} />
            </section>
            <section
              className={`report-tab-view${activeTab === 'attendance' ? ' is-active' : ''}`}
              id="consultant-report-panel-attendance"
              role="tabpanel"
              aria-labelledby="consultant-report-tab-attendance"
              aria-hidden={activeTab !== 'attendance'}
            >
              <OutcomesReport report={report} />
            </section>
          </>
        ) : null}
      </div>

      <footer className="report-page-footer">
        <span>Report period: <strong>{selectedPeriod}</strong></span>
        <span>As of {formatReportDate(generatedOn)}</span>
      </footer>

      {modal && <ReportDataModal kind={modal} fetchRows={fetchModalRows} onClose={closeModal} />}
    </div>
  )
}
