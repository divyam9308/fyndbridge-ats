import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserCheck,
  UserMinus,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
  X
} from 'lucide-react'
import CompactPagination from '../../components/CompactPagination'
import { CANDIDATE_STATUSES, MOCK_REPORT_DATE, candidateOverviewCounts, candidateTotal } from './mockConsultantReportData'
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

const METRIC_ICON_PROPS = { size: 16, strokeWidth: 1.9 }

function MetricIcon({ label }) {
  const normalized = label.toLowerCase()
  if (normalized === 'total mandates' || normalized.includes('completed mandates') || normalized.includes('mandates with')) return <BriefcaseBusiness {...METRIC_ICON_PROPS} />
  if (normalized === 'ongoing') return <RefreshCw {...METRIC_ICON_PROPS} />
  if (normalized === 'completed') return <CheckCircle2 {...METRIC_ICON_PROPS} />
  if (normalized === 'scrapped') return <Trash2 {...METRIC_ICON_PROPS} />
  if (normalized === 'total candidates') return <UsersRound {...METRIC_ICON_PROPS} />
  if (normalized === 'interested') return <UserRoundCheck {...METRIC_ICON_PROPS} />
  if (normalized.includes('discussion')) return <MessageSquareText {...METRIC_ICON_PROPS} />
  if (normalized === 'not interested' || normalized.includes('rejected')) return <UserRoundX {...METRIC_ICON_PROPS} />
  if (normalized.includes('interview')) return <CalendarCheck2 {...METRIC_ICON_PROPS} />
  if (normalized.includes('client submission')) return <Send {...METRIC_ICON_PROPS} />
  if (normalized.includes('offered') || normalized === 'offered') return <BadgeCheck {...METRIC_ICON_PROPS} />
  if (normalized.includes('hired') || normalized.includes('hire')) return <UserCheck {...METRIC_ICON_PROPS} />
  if (normalized.includes('declined') || normalized.includes('dropout')) return <UserMinus {...METRIC_ICON_PROPS} />
  if (normalized.includes('attendance') || normalized.includes('days') || normalized.includes('hours') || normalized.includes('leave')) return <Clock3 {...METRIC_ICON_PROPS} />
  if (normalized.includes('without') || normalized.includes('older') || normalized.includes('exceptions')) return <AlertTriangle {...METRIC_ICON_PROPS} />
  return <BarChart3 {...METRIC_ICON_PROPS} />
}

export function ReportKpiCard({ label, value, tone = 'blue', compact = false }) {
  return (
    <article className={`report-kpi report-tone-${tone}${compact ? ' is-compact' : ''}`}>
      <div className="report-kpi-top">
        <span className="report-kpi-label">{label}</span>
        <span className="report-kpi-icon" aria-hidden="true"><MetricIcon label={label} /></span>
      </div>
      <strong>{value}</strong>
    </article>
  )
}

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
  return <span className={`report-status-chip is-${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>
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

export function RecentMandatesTable({ rows, modal = false }) {
  return (
    <div className="report-table-scroll">
      <table className="report-table report-mandates-table">
        <MandateTableHead modal={modal} />
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td><strong>{row.consultant}</strong></td>
              <td>{row.teamLead}</td>
              <td>{row.clientName}</td>
              <td>{row.role}</td>
              <td>{row.budget}</td>
              <td><StatusChip status={row.status} /></td>
              <td>{row.sector}</td>
              <td>{formatReportDate(row.allocationDate)}</td>
              <td className="report-number-cell">{row.candidatesAssigned}</td>
              {CANDIDATE_STATUSES.map((status) => <td className="report-split-cell" key={status}>{row.counts[status]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function daysFromAllocation(date) {
  const start = new Date(`${date}T00:00:00Z`)
  const end = new Date(MOCK_REPORT_DATE)
  return Math.floor((end - start) / 86400000)
}

function durationLabel(row) {
  if (row.status === 'Ongoing') return `${daysFromAllocation(row.allocationDate)} d (ongoing)`
  if (row.status === 'Completed') return `${row.firstHireDays} d (final)`
  return '—'
}

const timingLabel = (value) => Number.isFinite(value) ? `${value} d` : '—'

export function MandateConversionTable({ rows }) {
  return (
    <div className="report-table-scroll">
      <table className="report-table report-conversion-table">
        <thead>
          <tr>
            <th>Mandate Name</th>
            <th>Client Name</th>
            <th>Role</th>
            <th>First Client Submission</th>
            <th>First Interview</th>
            <th>First Offer</th>
            <th>First Hire</th>
            <th>Age / Final Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ageing = row.status === 'Ongoing' && daysFromAllocation(row.allocationDate) > 45
            return (
              <tr className={ageing ? 'is-ageing' : ''} key={row.key}>
                <td><strong>{row.mandateName}</strong></td>
                <td>{row.clientName}</td>
                <td>{row.role}</td>
                <td>{timingLabel(row.firstClientSubmissionDays)}</td>
                <td>{timingLabel(row.firstInterviewDays)}</td>
                <td>{timingLabel(row.firstOfferDays)}</td>
                <td>{timingLabel(row.firstHireDays)}</td>
                <td><span className={`report-duration${ageing ? ' is-ageing' : ''}`}>{durationLabel(row)}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function matchesQuery(row, query) {
  if (!query) return true
  return [row.consultant, row.teamLead, row.clientName, row.role, row.sector, row.mandateName]
    .some((value) => String(value || '').toLowerCase().includes(query))
}

function sortRows(rows, sort, kind) {
  const sorted = [...rows]
  if (sort === 'oldest') return sorted.sort((a, b) => a.allocationDate.localeCompare(b.allocationDate))
  if (sort === 'client') return sorted.sort((a, b) => a.clientName.localeCompare(b.clientName))
  if (sort === 'candidates') return sorted.sort((a, b) => b.candidatesAssigned - a.candidatesAssigned)
  if (sort === 'age') return sorted.sort((a, b) => daysFromAllocation(b.allocationDate) - daysFromAllocation(a.allocationDate))
  if (sort === 'submission') return sorted.sort((a, b) => (a.firstClientSubmissionDays ?? Infinity) - (b.firstClientSubmissionDays ?? Infinity))
  if (kind === 'conversion') return sorted.sort((a, b) => b.allocationDate.localeCompare(a.allocationDate))
  return sorted.sort((a, b) => b.allocationDate.localeCompare(a.allocationDate))
}

export function ReportDataModal({ kind, rows, onClose }) {
  const isMandates = kind === 'mandates'
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const next = rows.filter((row) => matchesQuery(row, normalizedQuery) && (status === 'all' || row.status === status))
    return sortRows(next, sort, kind)
  }, [kind, query, rows, sort, status])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="report-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby={`${kind}-modal-title`}>
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
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search by client, role, sector or consultant" />
          </label>
          <label>
            <span>Mandate status</span>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <option value="all">All statuses</option>
              <option>Ongoing</option>
              <option>Completed</option>
              <option>Scrapped</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
              <option value="newest">Newest allocation</option>
              <option value="oldest">Oldest allocation</option>
              <option value="client">Client A–Z</option>
              {isMandates ? <option value="candidates">Most candidates</option> : <><option value="age">Highest age</option><option value="submission">Fastest submission</option></>}
            </select>
          </label>
        </div>
        <div className="report-modal-body">
          {pagedRows.length ? (isMandates ? <RecentMandatesTable rows={pagedRows} modal /> : <MandateConversionTable rows={pagedRows} />) : (
            <div className="report-empty-state">No mandates match these filters.</div>
          )}
        </div>
        <footer className="report-modal-footer">
          <label className="report-page-size">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>
              <option value="5">5</option>
              <option value="10">10</option>
            </select>
          </label>
          <span className="report-result-count">{filtered.length} mandate{filtered.length === 1 ? '' : 's'}</span>
          <CompactPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
          <button className="report-secondary-button" type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function CandidateOverview() {
  return (
    <div className="candidate-overview-grid">
      <ReportKpiCard label="Total Candidates" value={candidateTotal} tone="navy" />
      {CANDIDATE_STATUSES.map((status) => (
        <ReportKpiCard key={status} label={status} value={candidateOverviewCounts[status]} tone={STATUS_TONES[status]} />
      ))}
    </div>
  )
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}

export function CandidatePipeline() {
  const stages = [
    { label: 'Total Candidates', count: candidateTotal, detail: '100% of Total' },
    { label: 'Interested', count: candidateOverviewCounts.Interested, detail: `${formatPercent(candidateOverviewCounts.Interested / candidateTotal * 100)} of Total` },
    { label: 'Client Submission', count: candidateOverviewCounts['Client Submission'], detail: `${formatPercent(candidateOverviewCounts['Client Submission'] / candidateTotal * 100)} of Total` },
    { label: 'Interview', count: candidateOverviewCounts.Interview, detail: `${formatPercent(candidateOverviewCounts.Interview / candidateTotal * 100)} of Total` },
    { label: 'Offered', count: candidateOverviewCounts.Offered, detail: `${formatPercent(candidateOverviewCounts.Offered / candidateTotal * 100)} of Total` },
    { label: 'Hired', count: candidateOverviewCounts.Hired, detail: `${formatPercent(candidateOverviewCounts.Hired / candidateTotal * 100)} of Total` }
  ]
  return (
    <div className="candidate-pipeline" aria-label="Candidate pipeline">
      {stages.map((stage, index) => (
        <div className="candidate-pipeline-step" key={stage.label}>
          <article className={`pipeline-stage stage-${index}`}>
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
            <small>{stage.detail}</small>
          </article>
          {index < stages.length - 1 && <ArrowRight className="pipeline-arrow" size={19} aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}
