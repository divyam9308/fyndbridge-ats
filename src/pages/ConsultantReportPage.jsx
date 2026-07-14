import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, CalendarCheck2, ChevronDown, FileDown, Play, UsersRound } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import FormattedDateInput from '../components/FormattedDateInput'
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
import {
  MOCK_REPORT_DATE,
  attendanceMetrics,
  conversionAverages,
  exceptionMetrics,
  leaveBalances,
  mockConsultants,
  mockMandates,
  positiveOutcomeMetrics
} from '../features/reports/mockConsultantReportData'
import '../styles/Shared.css'
import './ConsultantReportPage.css'

const TABS = [
  { key: 'mandates', label: 'Mandates', Icon: BriefcaseBusiness },
  { key: 'candidates', label: 'Candidates & Pipeline', Icon: UsersRound },
  { key: 'attendance', label: 'Attendance & Outcomes', Icon: CalendarCheck2 }
]

function generatedLabel(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
}

function dateRangeLabel(fromDate, toDate) {
  return `${formatReportDate(fromDate)} – ${formatReportDate(toDate)}`
}

function MandatesReport({ rows, openModal }) {
  const summary = [
    { label: 'Total Mandates', value: rows.length, tone: 'navy' },
    { label: 'Ongoing', value: rows.filter((row) => row.status === 'Ongoing').length, tone: 'teal' },
    { label: 'Completed', value: rows.filter((row) => row.status === 'Completed').length, tone: 'green' },
    { label: 'Scrapped', value: rows.filter((row) => row.status === 'Scrapped').length, tone: 'neutral' }
  ]
  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Mandate Summary" description="Current mandate distribution for the selected consultant and report period." />
        <div className="report-kpi-grid is-four">
          {summary.map((item) => <ReportKpiCard key={item.label} {...item} />)}
        </div>
      </section>

      <section className="report-section report-table-section">
        <ReportSectionHeader
          title="Recent Mandates"
          description="The five most recently allocated mandates and their complete candidate status split."
          action={<button className="report-text-button" type="button" onClick={() => openModal('mandates')}>View All Mandates</button>}
        />
        <RecentMandatesTable rows={rows.slice(0, 5)} />
      </section>

      <section className="report-section">
        <ReportSectionHeader title="Average Conversion Time" description="Average time taken to reach each major mandate milestone." />
        <div className="report-kpi-grid is-four report-conversion-kpis">
          {conversionAverages.map((item) => <ReportKpiCard key={item.label} {...item} />)}
        </div>
        <div className="report-subsection-heading">
          <div>
            <h3>Mandate Conversion & Ageing</h3>
            <p>Latest five mandates. Ongoing mandates older than 45 days are softly highlighted.</p>
          </div>
          <button className="report-text-button" type="button" onClick={() => openModal('conversion')}>View All</button>
        </div>
        <MandateConversionTable rows={rows.slice(0, 5)} />
      </section>
    </div>
  )
}

function CandidatesReport() {
  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Candidate Overview" description="Complete status distribution for all 90 candidates in this report scope." />
        <CandidateOverview />
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Candidate Pipeline" description="Progression through the primary recruitment stages, calculated from the overview above." />
        <CandidatePipeline />
      </section>
    </div>
  )
}

function OutcomesReport() {
  return (
    <div className="report-tab-panel">
      <section className="report-section">
        <ReportSectionHeader title="Exceptions" description="Number-only indicators that may need follow-up within the selected period." />
        <div className="report-kpi-grid is-five">
          {exceptionMetrics.map((item) => <ReportKpiCard key={item.label} {...item} compact />)}
        </div>
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Positive Outcomes" description="Key recruitment outcomes recorded in the current report scope." />
        <div className="report-kpi-grid is-six">
          {positiveOutcomeMetrics.map((item) => <ReportKpiCard key={item.label} {...item} compact />)}
        </div>
      </section>
      <section className="report-section">
        <ReportSectionHeader title="Attendance Snapshot" description="Attendance and leave indicators using the ATS attendance terminology." />
        <div className="attendance-metric-grid">
          {attendanceMetrics.map((item) => <ReportKpiCard key={item.label} {...item} compact />)}
        </div>
        <div className="report-subsection-heading">
          <div>
            <h3>Leave Balance</h3>
            <p>Entitlement, usage and current available balance by leave type.</p>
          </div>
        </div>
        <div className="report-table-scroll leave-balance-table-wrap">
          <table className="report-table leave-balance-table">
            <thead><tr><th>Leave Type</th><th>Entitled</th><th>Used</th><th>Balance</th></tr></thead>
            <tbody>
              {leaveBalances.map((row) => (
                <tr key={row.type}><td><strong>{row.type}</strong></td><td>{row.entitled} days</td><td>{row.used} days</td><td><span className="leave-balance-value">{row.balance} days</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default function ConsultantReportPage() {
  const { user } = useAuth()
  const [draftConsultantName, setDraftConsultantName] = useState(mockConsultants[0].name)
  const [draftFromDate, setDraftFromDate] = useState('2026-07-01')
  const [draftToDate, setDraftToDate] = useState('2026-07-15')
  const [selectedConsultant, setSelectedConsultant] = useState(mockConsultants[0])
  const [selectedFromDate, setSelectedFromDate] = useState('2026-07-01')
  const [selectedToDate, setSelectedToDate] = useState('2026-07-15')
  const [generatedOn, setGeneratedOn] = useState(MOCK_REPORT_DATE)
  const [activeTab, setActiveTab] = useState('mandates')
  const [modal, setModal] = useState('')
  const [toast, setToast] = useState('')

  const generatedBy = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'FYNDBRIDGE User'
  const scopedMandates = useMemo(() => mockMandates.map((row) => ({ ...row, consultant: selectedConsultant.name })), [selectedConsultant.name])
  const selectedPeriod = dateRangeLabel(selectedFromDate, selectedToDate)

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

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
    const match = mockConsultants.find((consultant) => consultant.name.toLowerCase() === normalized)
      || mockConsultants.find((consultant) => consultant.name.toLowerCase().startsWith(normalized))
      || selectedConsultant
    setDraftConsultantName(match.name)
    setSelectedConsultant(match)
    setSelectedFromDate(draftFromDate)
    setSelectedToDate(draftToDate)
    setGeneratedOn(new Date().toISOString())
    setToast(`Report updated for ${match.name}.`)
  }

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
          <label className="report-control report-consultant-control">
            <span className="report-control-label">Consultant</span>
            <div>
              <input
                list="report-consultants"
                value={draftConsultantName}
                onChange={(event) => setDraftConsultantName(event.target.value)}
                placeholder="Search consultant"
                aria-label="Search and select consultant"
              />
              <ChevronDown size={16} aria-hidden="true" />
              <datalist id="report-consultants">
                {mockConsultants.map((consultant) => <option key={consultant.key} value={consultant.name}>{consultant.designation}</option>)}
              </datalist>
            </div>
          </label>
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
          <button className="report-primary-button" type="button" onClick={generateReport}><Play size={16} fill="currentColor" />Generate Report</button>
          <button className="report-secondary-button" type="button" onClick={() => setToast('Export will be connected in a future update.')}><FileDown size={17} />Export Report</button>
        </div>
      </header>

      <section className="consultant-identity-card" aria-label="Consultant report scope">
        <div className="consultant-identity-primary">
          <div className="consultant-report-avatar">{selectedConsultant.initials}</div>
          <div>
            <div className="consultant-name-row">
              <h2>{selectedConsultant.name}</h2>
              <span className={`employee-status-chip${selectedConsultant.employeeStatus === 'On Leave' ? ' is-leave' : ''}`}>{selectedConsultant.employeeStatus}</span>
            </div>
            <a href={`mailto:${selectedConsultant.email}`}>{selectedConsultant.email}</a>
          </div>
        </div>
        <dl className="consultant-scope-details">
          <div><dt>Employee ID</dt><dd>{selectedConsultant.employeeId}</dd></div>
          <div><dt>Designation</dt><dd>{selectedConsultant.designation}</dd></div>
          <div><dt>Department</dt><dd>{selectedConsultant.department}</dd></div>
          <div><dt>Report Period</dt><dd>{selectedPeriod}</dd></div>
        </dl>
      </section>

      <nav className="report-tabs" aria-label="Consultant report sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            className={activeTab === key ? 'is-active' : ''}
            type="button"
            key={key}
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={17} />{label}
          </button>
        ))}
      </nav>

      {activeTab === 'mandates' && <MandatesReport rows={scopedMandates} openModal={setModal} />}
      {activeTab === 'candidates' && <CandidatesReport />}
      {activeTab === 'attendance' && <OutcomesReport />}

      <footer className="report-page-footer">
        <span>Report period: <strong>{selectedPeriod}</strong></span>
        <span>As of {formatReportDate(generatedOn)}</span>
      </footer>

      {modal && <ReportDataModal kind={modal} rows={scopedMandates} onClose={() => setModal('')} />}
    </div>
  )
}
