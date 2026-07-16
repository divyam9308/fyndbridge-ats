import {
  AlertTriangle,
  BadgeCheck,
  BadgeIndianRupee,
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Landmark,
  MessageSquareText,
  ReceiptIndianRupee,
  RefreshCw,
  Send,
  Trash2,
  UserCheck,
  UserMinus,
  UserRoundCheck,
  UserRoundX,
  UsersRound
} from 'lucide-react'
import './ReportKpiCard.css'

const METRIC_ICON_PROPS = { size: 16, strokeWidth: 1.9 }

function MetricIcon({ label }) {
  const normalized = String(label || '').toLowerCase()
  if (normalized === 'total bill value') return <ReceiptIndianRupee {...METRIC_ICON_PROPS} />
  if (normalized === 'total tax value') return <Landmark {...METRIC_ICON_PROPS} />
  if (normalized === 'total invoice value') return <BadgeIndianRupee {...METRIC_ICON_PROPS} />
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

export default function ReportKpiCard({ label, value, tone = 'blue', compact = false, detail = '', loading = false }) {
  return (
    <article className={`report-kpi report-tone-${tone}${compact ? ' is-compact' : ''}${loading ? ' is-loading' : ''}`} aria-busy={loading}>
      <div className="report-kpi-top">
        <span className="report-kpi-label">{label}</span>
        <span className="report-kpi-icon" aria-hidden="true"><MetricIcon label={label} /></span>
      </div>
      <div className="report-kpi-value">
        <strong>{loading ? <span className="report-kpi-skeleton" aria-hidden="true" /> : value ?? '—'}</strong>
        {!loading && detail && <small>{detail}</small>}
      </div>
    </article>
  )
}
