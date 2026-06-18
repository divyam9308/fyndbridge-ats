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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
const chartColors = ['#001264', '#DAB111', '#28A745', '#DC3545', '#17A2B8', '#6F42C1', '#F59E0B', '#64748B', '#0EA5E9', '#155724']

function SectionTitle({ icon: Icon, title, subtitle, right }) {
  return (
    <div className="ats-dashboard-section-title">
      <div className="ats-dashboard-title-left">
        <span className="ats-dashboard-title-icon"><Icon size={18} /></span>
        <span>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </span>
      </div>
      {right}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <article className={`ats-dashboard-kpi ${accent}`}>
      <div className="ats-dashboard-kpi-top">
        <span className="ats-dashboard-kpi-icon"><Icon size={20} /></span>
        <span className="ats-dashboard-kpi-trend"><TrendingUp size={12} /> Live</span>
      </div>
      <strong>{Number(value || 0).toLocaleString('en-IN')}</strong>
      <span>{label}</span>
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

export default function DashboardHome() {
  const [consultant, setConsultant] = useState(OVERALL)
  const [period, setPeriod] = useState(DASHBOARD_PERIODS[0])
  const [consultantOpen, setConsultantOpen] = useState(false)
  const { loading, error, data } = useDashboardStats({ consultant, period })

  const names = Array.isArray(data?.consultantOptions) ? data.consultantOptions : []
  const consultantOptions = [OVERALL, ...names.filter(Boolean)]

  const kpis = [
    { label: 'Total Clients', value: data?.kpis?.totalClients, icon: Building2, accent: 'is-blue' },
    { label: 'Total Candidates', value: data?.kpis?.totalCandidates, icon: Users, accent: 'is-gold' },
    { label: 'Total Mandates', value: data?.kpis?.totalMandates, icon: Briefcase, accent: 'is-green' },
    { label: 'Active Clients', value: data?.kpis?.activeClients, icon: CheckCircle2, accent: 'is-teal' },
    { label: 'Placements', value: data?.kpis?.placements, icon: Award, accent: 'is-red' }
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

  return (
    <div className="ats-dashboard-page" id="page-dashboard">
      <div className="ats-dashboard-filter-row">
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
        <section className="ats-dashboard-card is-wide">
          <SectionTitle icon={Building2} title="Clients Analytics" subtitle="Client status distribution" />
          <div className="ats-dashboard-split">
            <div className="ats-dashboard-chart">
              {clientStatusData.some(item => item.value) ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={clientStatusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={98} paddingAngle={2} stroke="none">
                      {clientStatusData.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart label="No client data for this period." />}
            </div>
            <StatusList data={clientStatusData} />
          </div>
        </section>

        <section className="ats-dashboard-card">
          <SectionTitle icon={FileSignature} title="Active Clients with Contract Signed" subtitle="Billing entity split" />
          <div className="ats-dashboard-billing-grid">
            {billingEntityData.map((item, index) => (
              <div className={`ats-dashboard-billing-card ${index === 0 ? 'is-blue' : 'is-gold'}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{Number(item.value || 0).toLocaleString('en-IN')}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="ats-dashboard-card">
          <SectionTitle icon={TrendingUp} title="Client Acquisition Trend" subtitle="Clients and active clients by month" />
          <div className="ats-dashboard-chart">
            {clientTrend.length ? (
              <ResponsiveContainer>
                <AreaChart data={clientTrend}>
                  <CartesianGrid stroke="#E2E2DE" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="m" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="clients" name="Clients" stroke="#001264" fill="#001264" fillOpacity={0.18} strokeWidth={2} />
                  <Area type="monotone" dataKey="active" name="Active" stroke="#DAB111" fill="#DAB111" fillOpacity={0.2} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart label="No client trend data." />}
          </div>
        </section>
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card">
          <SectionTitle icon={Users} title="Candidates Analytics" subtitle="Candidates by Status" />
          <StatusList data={candidateStatusData} />
        </section>

        <section className="ats-dashboard-card">
          <SectionTitle icon={Activity} title="Candidate Movement Trend" subtitle="Candidates added and hired by month" />
          <div className="ats-dashboard-chart">
            {candidateTrend.length ? (
              <ResponsiveContainer>
                <LineChart data={candidateTrend}>
                  <CartesianGrid stroke="#E2E2DE" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="m" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="added" name="Candidates Added" stroke="#001264" strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="hired" name="Hired" stroke="#28A745" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart label="No candidate trend data." />}
          </div>
        </section>

        <section className="ats-dashboard-card">
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
        <section className="ats-dashboard-card">
          <SectionTitle icon={Briefcase} title="Mandates Analytics" subtitle="Mandates by Status" />
          <div className="ats-dashboard-split is-compact">
            <div className="ats-dashboard-chart is-small">
              {mandateStatusData.some(item => item.value) ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={mandateStatusData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={3} stroke="none">
                      {mandateStatusData.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart label="No mandate data." />}
            </div>
            <StatusList data={mandateStatusData} />
          </div>
        </section>

        <section className="ats-dashboard-card">
          <SectionTitle icon={TrendingUp} title="Mandates Trend" subtitle="Ongoing, completed, and scrapped mandates" />
          <div className="ats-dashboard-chart">
            {mandateTrend.length ? (
              <ResponsiveContainer>
                <BarChart data={mandateTrend}>
                  <CartesianGrid stroke="#E2E2DE" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="m" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="ongoing" name="Ongoing" fill="#001264" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#28A745" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="scrapped" name="Scrapped" fill="#DC3545" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label="No mandate trend data." />}
          </div>
        </section>

        <section className="ats-dashboard-card">
          <SectionTitle icon={CheckCircle2} title="Mandates Status Split" subtitle="Ongoing vs finalized mandates" />
          <div className="ats-dashboard-mandate-split">
            <div className="ats-dashboard-billing-card is-blue">
              <span>Ongoing</span>
              <strong>{Number(mandateStatusData.find(item => item.name === 'Ongoing')?.value || 0).toLocaleString('en-IN')}</strong>
            </div>
            <div className="ats-dashboard-billing-card is-green">
              <span>Completed + Scrapped</span>
              <strong>{Number((mandateStatusData.find(item => item.name === 'Completed')?.value || 0) + (mandateStatusData.find(item => item.name === 'Scrapped')?.value || 0)).toLocaleString('en-IN')}</strong>
            </div>
          </div>
          <div className="ats-dashboard-radial">
            <ResponsiveContainer>
              <RadialBarChart innerRadius="42%" outerRadius="100%" data={[
                { name: 'Finalized', value: (mandateStatusData.find(item => item.name === 'Completed')?.value || 0) + (mandateStatusData.find(item => item.name === 'Scrapped')?.value || 0), fill: '#28A745' },
                { name: 'Ongoing', value: mandateStatusData.find(item => item.name === 'Ongoing')?.value || 0, fill: '#001264' }
              ]}>
                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#F0F0EE' }} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="ats-dashboard-grid">
        <section className="ats-dashboard-card is-wide">
          <SectionTitle icon={Award} title="Consultant Performance" subtitle="Candidates Added, Candidates Hired, Mandates Managed, Active Clients" />
          <div className="ats-dashboard-consultants">
            {consultantPerformance.map(item => (
              <div className="ats-dashboard-consultant-row" key={item.name}>
                <span className="ats-dashboard-avatar">{item.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</span>
                <div className="ats-dashboard-consultant-main">
                  <div className="ats-dashboard-consultant-head">
                    <strong>{item.name}</strong>
                    <span>{item.mandatesManaged} mandates - {item.activeClients} active clients</span>
                  </div>
                  <div className="ats-dashboard-bars">
                    <span>Candidates Added <b>{item.candidatesAdded}</b></span>
                    <i><em style={{ width: `${(Number(item.candidatesAdded || 0) / maxCandidatesAdded) * 100}%` }} /></i>
                    <span>Candidates Hired <b>{item.candidatesHired}</b></span>
                    <i><em className="is-green" style={{ width: `${(Number(item.candidatesHired || 0) / maxCandidatesHired) * 100}%` }} /></i>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ats-dashboard-card">
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
                  <CartesianGrid stroke="#E2E2DE" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="Candidates Added" fill="#001264" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Candidates Hired" fill="#28A745" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Mandates Managed" fill="#DAB111" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Active Clients" fill="#17A2B8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label="No consultant data." />}
          </div>
        </section>
      </div>

      <section className="ats-dashboard-card">
        <SectionTitle icon={Clock} title="Recent Activity" subtitle="Latest client, candidate, and mandate updates" />
        {recentActivity.length ? (
          <div className="ats-dashboard-activity">
            {recentActivity.map((item, index) => (
              <div className="ats-dashboard-activity-row" key={`${item.text}-${index}`}>
                <span><UserCheck size={15} /></span>
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
