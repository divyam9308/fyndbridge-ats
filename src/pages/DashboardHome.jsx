import { Users, Briefcase, Building2, TrendingUp } from 'lucide-react'
import './DashboardHome.css'

const stats = [
  {
    label: 'Total Candidates',
    value: '284',
    Icon: Users,
    accent: '#17A2B8',
    iconBg: 'rgba(23,162,184,0.1)',
    iconColor: '#17A2B8',
    trend: '↑ 12 this week',
  },
  {
    label: 'Open Mandates',
    value: '17',
    Icon: Briefcase,
    accent: '#F5A623',
    iconBg: 'rgba(245,166,35,0.12)',
    iconColor: '#E09315',
    trend: '↑ 3 this week',
  },
  {
    label: 'Active Clients',
    value: '12',
    Icon: Building2,
    accent: '#6C757D',
    iconBg: 'rgba(108,117,125,0.1)',
    iconColor: '#6C757D',
    trend: 'Stable',
  },
  {
    label: 'Hired This Month',
    value: '6',
    Icon: TrendingUp,
    accent: '#28A745',
    iconBg: 'rgba(40,167,69,0.1)',
    iconColor: '#28A745',
    trend: '↑ 2 vs last month',
  },
]

const candidates = [
  { initials: 'AR', name: 'Arjun Rao',      job: 'Backend Engineer',  status: 'Interview', badge: 'badge-interview', date: '2 Jun 2025' },
  { initials: 'PK', name: 'Priya Kapoor',   job: 'Product Designer',  status: 'Offered',   badge: 'badge-offered',   date: '1 Jun 2025' },
  { initials: 'MS', name: 'Mohammed Salim', job: 'Data Analyst',      status: 'Screening', badge: 'badge-screening', date: '31 May 2025' },
  { initials: 'TS', name: 'Tanvi Shah',     job: 'DevOps Engineer',   status: 'Hired',     badge: 'badge-hired',     date: '29 May 2025' },
  { initials: 'RN', name: 'Ritika Nair',    job: 'QA Lead',           status: 'Interview', badge: 'badge-interview', date: '28 May 2025' },
]

const pipeline = [
  { title: 'Backend Engineer',    client: 'Zeta FinTech',      status: 'Open',   badge: 'badge-open',   pct: 68 },
  { title: 'Product Designer',    client: 'Lumino Health',     status: 'Open',   badge: 'badge-open',   pct: 45 },
  { title: 'Data Analyst',        client: 'Nexara Analytics',  status: 'Open',   badge: 'badge-open',   pct: 30 },
  { title: 'Senior React Dev',    client: 'CloudBridge Labs',  status: 'Filled', badge: 'badge-filled', pct: 100 },
  { title: 'DevOps Engineer',     client: 'Infra Systems Co.', status: 'Open',   badge: 'badge-open',   pct: 55 },
]

const pipelineBarColor = (pct) => {
  if (pct === 100) return 'var(--success)'
  if (pct >= 60)  return 'var(--gold)'
  if (pct >= 30)  return 'var(--info)'
  return 'var(--gray-400)'
}

export default function DashboardHome() {
  return (
    <div>
      {/* Stat Cards */}
      <div className="stat-cards">
        {stats.map(({ label, value, Icon, accent, iconBg, iconColor, trend }) => (
          <div className="stat-card" key={label}>
            <div className="stat-card-accent" style={{ background: accent }} />
            <div className="stat-card-top">
              <div>
                <div className="stat-number">{value}</div>
                <div className="stat-label">{label}</div>
                <div className="stat-trend">{trend}</div>
              </div>
              <div className="stat-icon-wrap" style={{ background: iconBg }}>
                <Icon size={20} color={iconColor} strokeWidth={1.8} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Panels */}
      <div className="dashboard-panels">

        {/* Recent Candidates */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Recent Candidates</span>
            <span className="panel-action">View all →</span>
          </div>
          <table className="candidates-table" aria-label="Recent candidates">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mandate</th>
                <th>Status</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.name}>
                  <td>
                    <div className="cand-name">
                      <div className="cand-initials">{c.initials}</div>
                      {c.name}
                    </div>
                  </td>
                  <td><span className="cand-job">{c.job}</span></td>
                  <td><span className={`badge ${c.badge}`}>{c.status}</span></td>
                  <td><span className="cand-date">{c.date}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mandate Pipeline */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Mandate Pipeline</span>
            <span className="panel-action">View all →</span>
          </div>
          <ul className="pipeline-list" aria-label="Mandate pipeline">
            {pipeline.map((job) => (
              <li className="pipeline-item" key={job.title}>
                <div className="pipeline-info">
                  <div className="pipeline-job">{job.title}</div>
                  <div className="pipeline-client">{job.client}</div>
                </div>
                <div className="pipeline-right">
                  <span className={`badge ${job.badge}`}>{job.status}</span>
                  <div>
                    <div className="progress-bar-wrap">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${job.pct}%`,
                          background: pipelineBarColor(job.pct),
                        }}
                      />
                    </div>
                  </div>
                  <span className="pipeline-pct">{job.pct}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  )
}
