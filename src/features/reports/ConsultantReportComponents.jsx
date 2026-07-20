import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Search,
  X
} from 'lucide-react'
import CompactPagination from '../../components/CompactPagination'
import { FyndbridgeLoader } from '../../components/FyndbridgeLoader'
import ReportKpiCard from '../../components/ReportKpiCard'
import { CANDIDATE_STATUSES } from '../../utils/candidateStatuses'
import { MANDATE_STATUSES, mandateStatusClassName, mandateStatusLabel } from '../../utils/mandateStatuses'
import { formatReportDate } from './reportFormatters'

const STATUS_SHORT_LABELS = {
  'In Discussion': 'In Discussion',
  'Not Interested': 'Not Interested',
  'Client Submission': 'Client Submission',
  'Offer Declined': 'Offer Declined',
  'Rejected by Recruiter': 'Rejected by Recruiter',
  'Rejected by Client': 'Rejected by Client'
}

const STATUS_TONES = {
  Interested: 'teal',
  'In Discussion': 'purple',
  'Not Interested': 'neutral',
  Interview: 'indigo',
  'Client Submission': 'cyan',
  Offered: 'amber',
  Hired: 'green',
  'Offer Declined': 'orange',
  Dropout: 'brown',
  'Rejected by Recruiter': 'red',
  'Rejected by Client': 'rose'
}

export { ReportKpiCard }

export function ReportSectionHeader({ title, description, action }) {
  return (
    <header className="report-section-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  )
}

function StatusChip({ status }) {
  const value = status || '—'
  const className = mandateStatusClassName(value)
  return <span className={`report-status-chip is-${className}`}>{mandateStatusLabel(value)}</span>
}

function MandateTableHead({ modal = false }) {
  return (
    <thead>
      <tr>
        <th rowSpan="2">Consultant</th>
        <th rowSpan="2">Team Lead</th>
        <th rowSpan="2">Client Name</th>
        <th rowSpan="2">Role</th>
        <th rowSpan="2">Budget</th>
        <th rowSpan="2">{modal ? 'Status' : 'Mandate Status'}</th>
        <th rowSpan="2">Sector</th>
        <th rowSpan="2">{modal ? 'Allocation Date' : 'Date of Allocation'}</th>
        <th rowSpan="2">Candidates Assigned</th>
        <th className="report-status-group" colSpan={CANDIDATE_STATUSES.length}>Candidate Status Split</th>
      </tr>
      <tr>
        {CANDIDATE_STATUSES.map((status) => (
          <th className="report-status-heading" key={status} title={status} aria-label={status}>{STATUS_SHORT_LABELS[status] || status}</th>
        ))}
      </tr>
    </thead>
  )
}

export function RecentMandatesTable({ rows = [], modal = false }) {
  return (
    <div className="report-table-scroll">
      <table className="report-table report-mandates-table">
        <MandateTableHead modal={modal} />
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.key}>
              <td><strong>{row.consultant || '—'}</strong></td>
              <td>{row.teamLead || '—'}</td>
              <td>{row.clientName || '—'}</td>
              <td>{row.role || '—'}</td>
              <td>{row.budget || '—'}</td>
              <td><StatusChip status={row.status} /></td>
              <td>{row.sector || '—'}</td>
              <td>{formatReportDate(row.allocationDate)}</td>
              <td className="report-number-cell">{row.candidatesAssigned ?? 0}</td>
              {CANDIDATE_STATUSES.map((status) => <td className="report-split-cell" key={status}>{row.counts?.[status] ?? 0}</td>)}
            </tr>
          )) : (
            <tr><td className="report-table-empty" colSpan={9 + CANDIDATE_STATUSES.length}>No mandates found for this report scope.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function milestoneLabel(row, field, labelField) {
  if (row[labelField]) return row[labelField]
  return row[field] !== undefined && row[field] !== null && Number.isFinite(Number(row[field])) ? `${Number(row[field])} d` : 'Not tracked'
}

export function MandateConversionTable({ rows = [] }) {
  return (
    <div className="report-table-scroll">
      <table className="report-table report-conversion-table">
        <thead>
          <tr>
            <th>Client Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Allocation Date</th>
            <th>First Client Submission</th>
            <th>First Interview</th>
            <th>First Offer</th>
            <th>First Hire</th>
            <th>Age / Final Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr className={row.isAgeingWarning ? 'is-ageing' : ''} key={row.key}>
              <td><strong>{row.clientName || '—'}</strong></td>
              <td>{row.role || '—'}</td>
              <td><StatusChip status={row.status} /></td>
              <td>{formatReportDate(row.allocationDate)}</td>
              <td>{milestoneLabel(row, 'firstClientSubmissionDays', 'firstClientSubmissionLabel')}</td>
              <td>{milestoneLabel(row, 'firstInterviewDays', 'firstInterviewLabel')}</td>
              <td>{milestoneLabel(row, 'firstOfferDays', 'firstOfferLabel')}</td>
              <td>{milestoneLabel(row, 'firstHireDays', 'firstHireLabel')}</td>
              <td><span className={`report-duration${row.isAgeingWarning ? ' is-ageing' : ''}`}>{row.durationLabel || '—'}</span></td>
            </tr>
          )) : (
            <tr><td className="report-table-empty" colSpan="9">No conversion data found for this report scope.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function modalPagination(value, requestedPage, requestedPageSize) {
  const total = Number(value?.total) || 0
  const pageSize = Number(value?.pageSize ?? value?.page_size) || requestedPageSize
  const totalPages = Math.max(Number(value?.totalPages ?? value?.total_pages) || Math.ceil(total / pageSize), 1)
  const page = Math.min(Math.max(Number(value?.page) || requestedPage, 1), totalPages)
  return { page, pageSize, total, totalPages }
}

export function ReportDataModal({ kind, fetchRows, onClose }) {
  const isMandates = kind === 'mandates'
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const dialogRef = useRef(null)

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery === debouncedQuery) return undefined
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      setDebouncedQuery(normalizedQuery)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [debouncedQuery, query])

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    const appContent = document.querySelector('.dashboard-main, .dashboard-embed')
    const previousOverflow = document.body.style.overflow
    const previousAriaHidden = appContent?.getAttribute('aria-hidden') ?? null
    const contentWasInert = appContent?.hasAttribute('inert') || false

    const focusableElements = () => [...(dialog?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) || [])].filter((element) => !element.hasAttribute('hidden'))
    const handleDialogKeys = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (!focusable.length) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.body.style.overflow = 'hidden'
    appContent?.setAttribute('inert', '')
    appContent?.setAttribute('aria-hidden', 'true')
    document.addEventListener('keydown', handleDialogKeys)
    const focusFrame = window.requestAnimationFrame(() => (focusableElements()[0] || dialog)?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleDialogKeys)
      if (!contentWasInert) appContent?.removeAttribute('inert')
      if (previousAriaHidden === null) appContent?.removeAttribute('aria-hidden')
      else appContent?.setAttribute('aria-hidden', previousAriaHidden)
      previousFocus?.focus?.()
    }
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()

    fetchRows({ search: debouncedQuery, status, sort, page, pageSize }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const nextRows = Array.isArray(result?.rows) ? result.rows : []
        const nextPagination = modalPagination(result?.pagination, page, pageSize)
        setRows(nextRows)
        setPagination(nextPagination)
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError' && !controller.signal.aborted) {
          setRows([])
          setError(requestError?.message || 'Unable to load this report list.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [debouncedQuery, fetchRows, page, pageSize, retryKey, sort, status])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="report-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="report-modal" role="dialog" aria-modal="true" aria-labelledby={`${kind}-modal-title`} tabIndex={-1}>
        <header className="report-modal-header">
          <div>
            <h2 id={`${kind}-modal-title`}>{isMandates ? 'All Mandates' : 'All Mandate Conversion & Ageing'}</h2>
            <p>{isMandates ? 'Review the complete mandate list and candidate status split.' : 'Review conversion milestones and mandate ageing across the full list.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="report-modal-toolbar">
          <label className="report-search-control">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => { setError(''); setQuery(event.target.value); setPage(1) }}
              placeholder={isMandates ? 'Search by client, role, sector or consultant' : 'Search by client or role'}
            />
          </label>
          <label>
            <span>Mandate status</span>
            <select value={status} onChange={(event) => { setLoading(true); setError(''); setStatus(event.target.value); setPage(1) }}>
              <option value="all">All statuses</option>
              {MANDATE_STATUSES.map(value => <option key={value} value={value}>{mandateStatusLabel(value)}</option>)}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => { setLoading(true); setError(''); setSort(event.target.value); setPage(1) }}>
              <option value="newest">Newest allocation</option>
              <option value="oldest">Oldest allocation</option>
              <option value="client">Client A–Z</option>
              {isMandates ? <option value="candidates">Most candidates</option> : <><option value="age">Highest age</option><option value="submission">Fastest submission</option></>}
            </select>
          </label>
        </div>
        <div className="report-modal-body" aria-busy={loading}>
          {loading ? <FyndbridgeLoader size={70} label="Loading report data..." /> : error ? (
            <div className="report-empty-state report-error-state">
              <p>{error}</p>
              <button className="report-secondary-button" type="button" onClick={() => { setLoading(true); setError(''); setRetryKey((value) => value + 1) }}>Try again</button>
            </div>
          ) : rows.length ? (isMandates ? <RecentMandatesTable rows={rows} modal /> : <MandateConversionTable rows={rows} />) : (
            <div className="report-empty-state">No mandates match these filters.</div>
          )}
        </div>
        <footer className="report-modal-footer">
          <label className="report-page-size">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(event) => { setLoading(true); setError(''); setPageSize(Number(event.target.value)); setPage(1) }}>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <span className="report-result-count">{pagination.total} mandate{pagination.total === 1 ? '' : 's'}</span>
          <CompactPagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={(nextPage) => { setLoading(true); setError(''); setPage(nextPage) }} loading={loading} />
          <button className="report-secondary-button" type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function CandidateOverview({ overview }) {
  const total = Number(overview?.total) || 0
  const counts = overview?.counts || {}
  return (
    <div className="candidate-overview-grid">
      <ReportKpiCard label="Total Candidates" value={total} tone="navy" />
      {CANDIDATE_STATUSES.map((status) => (
        <ReportKpiCard key={status} label={status} value={Number(counts[status]) || 0} tone={STATUS_TONES[status]} />
      ))}
    </div>
  )
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}

export function CandidatePipeline({ stages = [], total = 0 }) {
  const safeTotal = Number(total) || 0
  const hasTotalStage = stages.some((stage) => stage.key === 'total' || stage.label === 'Total Candidates')
  const displayedStages = hasTotalStage ? stages : [{ key: 'total', label: 'Total Candidates', count: safeTotal }, ...stages]

  return (
    <div className="candidate-pipeline" aria-label="Candidate pipeline">
      {displayedStages.map((stage, index) => {
        const count = Number(stage.count) || 0
        const isTotal = stage.key === 'total' || stage.label === 'Total Candidates'
        const percentage = isTotal ? (safeTotal ? 100 : 0) : (safeTotal ? count / safeTotal * 100 : 0)
        return (
          <div className="candidate-pipeline-step" key={stage.key || stage.label}>
            <article className={`pipeline-stage stage-${Math.min(index, 5)}`}>
              <span>{stage.label}</span>
              <strong>{count}</strong>
              <small>{formatPercent(percentage)} of Total</small>
            </article>
            {index < displayedStages.length - 1 && <ArrowRight className="pipeline-arrow" size={19} aria-hidden="true" />}
          </div>
        )
      })}
    </div>
  )
}
