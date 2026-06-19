import { useState } from 'react'
import {
  Activity,
  Award,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileSignature,
  Loader2,
  Target,
  TrendingUp,
  UserCheck,
  Users
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { DASHBOARD_PERIODS, useDashboardStats } from '../hooks/useDashboardStats'
import './DashboardHome.css'

const OVERALL = 'Overall (All Consultants)'
const chartColors = [
  'var(--modern-chart-1)',
  'var(--modern-chart-2)',
  'var(--modern-chart-3)',
  'var(--modern-chart-4)',
  'var(--modern-chart-5)',
  'var(--modern-chart-6)',
  'var(--modern-chart-7)',
  'var(--modern-chart-8)',
  'var(--modern-chart-5)',
  'var(--modern-chart-3)'
]
const CLIENT_STATUSES = ['-', 'Active', 'Inactive', 'Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
const CANDIDATE_STATUSES = ['Interested', 'Not Interested', 'Rejected by Recruiter', 'Client Submission', 'Interview', 'Rejected by Client', 'Offered', 'Offer Declined', 'Dropout', 'Hired']
const MANDATE_STATUSES = ['Ongoing', 'Completed', 'Scrapped']

const seriesColor = (index) => chartColors[index % chartColors.length]
const TOOLTIP_WIDTH = 236
const TOOLTIP_HEIGHT = 180
const TOOLTIP_GAP = 14

function floatingTooltipStyle(coordinate, viewBox) {
  const x = Number(coordinate?.x) || 0
  const y = Number(coordinate?.y) || 0
  const width = Number(viewBox?.width) || 0
  const height = Number(viewBox?.height) || 0
  const padding = 10
  let tooltipX = x + TOOLTIP_GAP + TOOLTIP_WIDTH <= width - padding
    ? TOOLTIP_GAP
    : -TOOLTIP_WIDTH - TOOLTIP_GAP
  let tooltipY = y + TOOLTIP_GAP + TOOLTIP_HEIGHT <= height - padding
    ? TOOLTIP_GAP
    : -TOOLTIP_HEIGHT - TOOLTIP_GAP

  if (width) {
    if (x + tooltipX < padding) tooltipX = padding - x
    if (x + tooltipX + TOOLTIP_WIDTH > width - padding) tooltipX = width - padding - TOOLTIP_WIDTH - x
  }
  if (height) {
    if (y + tooltipY < padding) tooltipY = padding - y
    if (y + tooltipY + TOOLTIP_HEIGHT > height - padding) tooltipY = height - padding - TOOLTIP_HEIGHT - y
  }

  return {
    '--tooltip-x': `${Math.round(tooltipX)}px`,
    '--tooltip-y': `${Math.round(tooltipY)}px`
  }
}

function SectionTitle({ icon: Icon, title, subtitle, right }) {
  return (
    <div className="ats-dashboard-section-title">
      <div className="ats-dashboard-title-left">
        <span className="ats-dashboard-title-icon gradient-primary shadow-pop"><Icon size={18} /></span>
        <span>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </span>
      </div>
      {right}
    </div>
  )
}

function DashboardTooltip({ active, payload, label, coordinate, viewBox }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(item => {
    const value = Number(item.value || 0)
    const added = Number(item.payload?.raw?.[item.dataKey] || 0)
    return value > 0 || added > 0
  })
  const raw = rows[0]?.payload?.raw || {}
  if (!rows.length) return null
  return (
    <div className="ats-dashboard-tooltip" style={floatingTooltipStyle(coordinate, viewBox)}>
      {label ? <strong>{label}</strong> : null}
      {rows.map(item => (
        <span key={item.name || item.dataKey}>
          <i style={{ background: item.color || item.fill }} />
          <b>{item.name || item.dataKey}</b>
          <em>{Number(item.value || 0).toLocaleString('en-IN')}</em>
          {Number(raw[item.dataKey] || 0) > 0 ? <small>(+{Number(raw[item.dataKey] || 0).toLocaleString('en-IN')} added)</small> : null}
        </span>
      ))}
    </div>
  )
}

function Sparkline({ color = 'rgba(255,255,255,0.95)' }) {
  return (
    <svg className="ats-dashboard-sparkline" viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true">
      <path className="ats-dashboard-sparkline-fill" d="M0 46 C28 34 52 38 78 32 C106 25 132 34 158 23 C190 10 210 28 238 18 C258 12 270 10 280 7 L280 64 L0 64 Z" />
      <path d="M0 46 C28 34 52 38 78 32 C106 25 132 34 158 23 C190 10 210 28 238 18 C258 12 270 10 280 7" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <article className={`ats-dashboard-kpi kpi-3d ${accent}`}>
      <div className="ats-dashboard-kpi-top">
        <span className="ats-dashboard-kpi-icon animate-float"><Icon size={20} /></span>
        <span className="ats-dashboard-kpi-trend"><TrendingUp size={12} /> Live</span>
      </div>
      <strong>{Number(value || 0).toLocaleString('en-IN')}</strong>
      <span>{label}</span>
      <Sparkline />
    </article>
  )
}

function StatusList({ data }) {
  return (
    <div className="ats-dashboard-status-list">
      {data.map((item, index) => (
        <div className="ats-dashboard-status-row" key={item.name}>
          <span className="ats-dashboard-status-name">
            <i style={{ background: chartColors[index % chartColors.length] }} />
            {item.name}
          </span>
          <strong>{Number(item.value || 0).toLocaleString('en-IN')}</strong>
        </div>
      ))}
    </div>
  )
}

function EmptyChart({ label }) {
  return <div className="ats-dashboard-empty-chart">{label}</div>
}

function DonutChart({ data, centerLabel, centerValue }) {
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={58}
          outerRadius={96}
          paddingAngle={2}
          stroke="none"
          activeShape={false}
          isAnimationActive
        >
          {data.map((item, index) => <Cell key={item.name} fill={seriesColor(index)} stroke="transparent" />)}
        </Pie>
        <Tooltip content={<DashboardTooltip />} cursor={false} />
        <text x="50%" y="46%" textAnchor="middle" className="ats-dashboard-donut-label">{centerLabel}</text>
        <text x="50%" y="58%" textAnchor="middle" className="ats-dashboard-donut-value">{Number(centerValue || 0).toLocaleString('en-IN')}</text>
      </PieChart>
    </ResponsiveContainer>
  )
}

function StatusTrendLines({ data, statuses }) {
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: 0 }}>
        <CartesianGrid stroke="var(--modern-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="m" interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} />
        <Tooltip content={<DashboardTooltip />} wrapperStyle={{ zIndex: 9999 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        {statuses.map((status, index) => (
          <Line
            key={status}
            type="monotone"
            dataKey={status}
            name={status}
            stroke={seriesColor(index)}
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--white)', strokeWidth: 2 }}
            filter={`drop-shadow(0 5px 8px ${seriesColor(index)})`}
            isAnimationActive
            animationDuration={2000}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function DashboardHome() {
  const [consultant, setConsultant] = useState(OVERALL)
  const [period, setPeriod] = useState(DASHBOARD_PERIODS[0])
  const [consultantOpen, setConsultantOpen] = useState(false)
  const { loading, error, data } = useDashboardStats({ consultant, period })

  const names = Array.isArray(data?.consultantOptions) ? data.consultantOptions : []
  const consultantOptions = [OVERALL, ...names.filter(Boolean)]

  const kpis = [
    { label: 'Total Clients', value: data?.kpis?.totalClients, icon: Building2, accent: 'gradient-primary' },
    { label: 'Total Candidates', value: data?.kpis?.totalCandidates, icon: Users, accent: 'gradient-info' },
    { label: 'Total Mandates', value: data?.kpis?.totalMandates, icon: Briefcase, accent: 'gradient-warning' }
  ]
  const clientStatusData = data?.clientStatusData || []
  const candidateStatusData = data?.candidateStatusData || []
  const mandateStatusData = data?.mandateStatusData || []
  const billingEntityData = data?.billingEntityData || []
  const clientTrend = data?.clientTrend || []
  const candidateTrend = data?.candidateTrend || []
  const mandateTrend = data?.mandateTrend || []
  const candidateFunnel = data?.candidateFunnel || []
  const consultantPerformance = data?.consultantPerformance || []
  const recentActivity = data?.recentActivity || []
  const maxCandidatesAdded = Math.max(1, ...consultantPerformance.map(item => Number(item.candidatesAdded) || 0))
  const maxCandidatesHired = Math.max(1, ...consultantPerformance.map(item => Number(item.candidatesHired) || 0))
  const mandateTotal = Math.max(1, mandateStatusData.reduce((sum, item) => sum + Number(item.value || 0), 0))
  const mandateRadialData = mandateStatusData.map((item, index) => ({
    ...item,
    fill: seriesColor(index),
    share: Math.round((Number(item.value || 0) / mandateTotal) * 100)
  }))

  return (
    <div className="ats-dashboard-page modern-dashboard" id="page-dashboard">
      <div className="ats-dashboard-filter-row card-3d">
        <div>
          <h2>Recruitment Analytics</h2>
          <p>{consultant} - {period}</p>
        </div>

        <div className="ats-dashboard-controls">
          <div className="ats-dashboard-select">
            <button type="button" onClick={() => setConsultantOpen(open => !open)}>
              <span>{consultant}</span>
              <ChevronDown size={15} />
            </button>
            {consultantOpen ? (
              <div className="ats-dashboard-select-menu">
                {consultantOptions.map(name => (
                  <button
                    type="button"
                    key={name}
                    className={name === consultant ? 'is-selected' : ''}
                    onClick={() => {
                      setConsultant(name)
                      setConsultantOpen(false)
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ats-dashboard-periods">
            {DASHBOARD_PERIODS.map(item => (
              <button
                type="button"
                key={item}
                className={item === period ? 'is-active' : ''}
                onClick={() => setPeriod(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ats-dashboard-state"><Loader2 size={24} className="spin" /> Loading dashboard...</div>
      ) : null}
      {error ? (
        <div className="ats-dashboard-state is-error">{error}</div>
      ) : null}

      <div className="ats-dashboard-kpi-grid">
        {kpis.map(item => <StatCard key={item.label} {...item} />)}
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Building2} title="Clients Analytics" subtitle="Clients by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalClients || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.clients ? <div className="ats-dashboard-section-error">{data.sectionErrors.clients}</div> : null}
          <div className="ats-dashboard-split">
            <div className="ats-dashboard-chart">
              {clientStatusData.some(item => item.value) ? (
                <DonutChart data={clientStatusData} centerLabel="CLIENTS" centerValue={data?.kpis?.totalClients} />
              ) : <EmptyChart label="No client data for this period." />}
            </div>
            <StatusList data={clientStatusData} />
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={FileSignature} title="Active Clients with Contract Signed" subtitle="Billing entity split" />
          <div className="ats-dashboard-billing-grid">
            {billingEntityData.map((item, index) => (
              <div className={`ats-dashboard-billing-card kpi-3d ${index === 0 ? 'gradient-info' : 'gradient-pink'}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{Number(item.value || 0).toLocaleString('en-IN')}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={TrendingUp} title="Client Acquisition Trend" subtitle="Client statuses over time" />
          <div className="ats-dashboard-chart">
            {clientTrend.length ? (
              <StatusTrendLines data={clientTrend} statuses={CLIENT_STATUSES} />
            ) : <EmptyChart label="No client trend data." />}
          </div>
        </section>
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Users} title="Candidates Analytics" subtitle="Candidates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalCandidates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.candidates ? <div className="ats-dashboard-section-error">{data.sectionErrors.candidates}</div> : null}
          <div className="ats-dashboard-split is-vertical">
            <div className="ats-dashboard-chart is-small">
              {candidateStatusData.some(item => item.value) ? (
                <DonutChart data={candidateStatusData} centerLabel="CANDIDATES" centerValue={data?.kpis?.totalCandidates} />
              ) : <EmptyChart label="No candidate data for this period." />}
            </div>
            <StatusList data={candidateStatusData} />
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Activity} title="Candidate Movement Trend" subtitle="Candidate statuses over time" />
          <div className="ats-dashboard-chart">
            {candidateTrend.length ? (
              <StatusTrendLines data={candidateTrend} statuses={CANDIDATE_STATUSES} />
            ) : <EmptyChart label="No candidate trend data." />}
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Target} title="Candidate Funnel" subtitle="ATS stage progression" />
          <div className="ats-dashboard-funnel">
            {candidateFunnel.map((item, index) => (
              <div className="ats-dashboard-funnel-row" key={item.name}>
                <span>{item.name}</span>
                <div style={{ width: `${Math.max(28, 100 - index * 13)}%`, background: chartColors[index % chartColors.length] }}>
                  {Number(item.value || 0).toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Briefcase} title="Mandates Analytics" subtitle="Mandates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalMandates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.mandates ? <div className="ats-dashboard-section-error">{data.sectionErrors.mandates}</div> : null}
          <div className="ats-dashboard-split is-compact">
            <div className="ats-dashboard-chart is-small">
              {mandateStatusData.some(item => item.value) ? (
                <DonutChart data={mandateStatusData} centerLabel="MANDATES" centerValue={data?.kpis?.totalMandates} />
              ) : <EmptyChart label="No mandate data." />}
            </div>
            <StatusList data={mandateStatusData} />
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={TrendingUp} title="Mandates Trend" subtitle="Ongoing, completed, and scrapped mandates" />
          <div className="ats-dashboard-chart">
            {mandateTrend.length ? (
              <StatusTrendLines data={mandateTrend} statuses={MANDATE_STATUSES} />
            ) : <EmptyChart label="No mandate trend data." />}
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={CheckCircle2} title="Mandates Status Split" subtitle="Current mandate pipeline" />
          <div className="ats-dashboard-status-cards">
            {MANDATE_STATUSES.map((status, index) => (
              <div className={`ats-dashboard-billing-card kpi-3d ${['gradient-primary', 'gradient-success', 'gradient-pink'][index]}`} key={status}>
                <span>{status}</span>
                <strong>{Number(mandateStatusData.find(item => item.name === status)?.value || 0).toLocaleString('en-IN')}</strong>
                <small><TrendingUp size={12} /> {status === 'Ongoing' ? 'Active mandates' : 'Finalized mandates'}</small>
              </div>
            ))}
          </div>
          <div className="ats-dashboard-radial">
            <ResponsiveContainer>
              <RadialBarChart innerRadius="36%" outerRadius="96%" data={mandateRadialData} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="share" cornerRadius={12} background={{ fill: 'rgba(238, 238, 248, 0.9)' }} />
                <Tooltip content={<DashboardTooltip />} wrapperStyle={{ zIndex: 9999 }} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="ats-dashboard-radial-share">
            {mandateRadialData.map(item => (
              <span key={item.name}><i style={{ background: item.fill }} />{item.name} share <b>{item.share}%</b></span>
            ))}
          </div>
        </section>
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card card-3d is-wide">
          <SectionTitle icon={Award} title="Consultant Performance" subtitle="Candidates Added, Candidates Hired, Mandates Managed, Active Clients" />
          <div className="ats-dashboard-consultants">
            {consultantPerformance.map(item => (
              <div className="ats-dashboard-consultant-row" key={item.name}>
                <b className="ats-dashboard-rank">#{consultantPerformance.indexOf(item) + 1}</b>
                <span className="ats-dashboard-avatar">{item.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</span>
                <div className="ats-dashboard-consultant-main">
                  <div className="ats-dashboard-consultant-head">
                    <strong>{item.name}</strong>
                    <span>{item.mandatesManaged} mandates - {item.activeClients ?? '-'} active clients</span>
                  </div>
                  <div className="ats-dashboard-bars">
                    <span>Candidates Added <b>{item.candidatesAdded}</b></span>
                    <i><em className="shimmer" style={{ width: `${(Number(item.candidatesAdded || 0) / maxCandidatesAdded) * 100}%` }} /></i>
                    <span>Candidates Hired <b>{item.candidatesHired}</b></span>
                    <i><em className="is-green shimmer" style={{ width: `${(Number(item.candidatesHired || 0) / maxCandidatesHired) * 100}%` }} /></i>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Activity} title="Consultant Performance" subtitle="Comparison chart" />
          <div className="ats-dashboard-chart">
            {consultantPerformance.length ? (
              <ResponsiveContainer>
                <BarChart data={consultantPerformance.map(item => ({
                  name: item.name.split(' ')[0],
                  'Candidates Added': item.candidatesAdded,
                  'Candidates Hired': item.candidatesHired,
                  'Mandates Managed': item.mandatesManaged,
                  'Active Clients': item.activeClients
                }))}>
                  <CartesianGrid stroke="var(--modern-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<DashboardTooltip />} cursor={false} wrapperStyle={{ zIndex: 9999 }} />
                  <Bar dataKey="Candidates Added" fill="var(--modern-chart-1)" radius={[10, 10, 0, 0]} barSize={14} className="ats-dashboard-bar-glow" />
                  <Bar dataKey="Candidates Hired" fill="var(--modern-chart-3)" radius={[10, 10, 0, 0]} barSize={14} className="ats-dashboard-bar-glow" />
                  <Bar dataKey="Mandates Managed" fill="var(--modern-chart-4)" radius={[10, 10, 0, 0]} barSize={14} className="ats-dashboard-bar-glow" />
                  <Bar dataKey="Active Clients" fill="var(--modern-chart-6)" radius={[10, 10, 0, 0]} barSize={14} className="ats-dashboard-bar-glow" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label="No consultant data." />}
          </div>
        </section>
      </div>

      <section className="ats-dashboard-card card-3d">
        <SectionTitle icon={Clock} title="Recent Activity" subtitle="Latest client, candidate, and mandate updates" />
        {recentActivity.length ? (
          <div className="ats-dashboard-activity">
            {recentActivity.map((item, index) => (
              <div className="ats-dashboard-activity-row" key={`${item.text}-${index}`}>
                <span style={{ background: seriesColor(index) }}><UserCheck size={15} /></span>
                <p>{item.text}</p>
                <time>{item.date}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="ats-dashboard-empty-chart">No recent activity for this period.</div>
        )}
      </section>
    </div>
  )
}
