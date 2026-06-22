import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Briefcase,
  Building2,
  ChevronDown,
  Clock,
  FileSignature,
  Loader2,
  TrendingUp,
  UserCheck,
  Users,
  X
} from 'lucide-react'
import {
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { DASHBOARD_PERIODS, useDashboardStats } from '../hooks/useDashboardStats'
import OnlineUsersStrip from '../components/dashboard/OnlineUsersStrip'
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
const TOOLTIP_GAP = 6

function floatingTooltipStyle(coordinate, viewBox, size) {
  const x = Number(coordinate?.x) || 0
  const y = Number(coordinate?.y) || 0
  const width = Number(viewBox?.width) || 0
  const height = Number(viewBox?.height) || 0
  const tooltipWidth = size.width || 260
  const tooltipHeight = size.height || 120
  const padding = 4
  let tooltipX = x + TOOLTIP_GAP + tooltipWidth <= width - padding
    ? TOOLTIP_GAP
    : -tooltipWidth - TOOLTIP_GAP
  let tooltipY = y + TOOLTIP_GAP + tooltipHeight <= height - padding
    ? TOOLTIP_GAP
    : -tooltipHeight - TOOLTIP_GAP

  if (width) {
    if (x + tooltipX < padding) tooltipX = padding - x
    if (x + tooltipX + tooltipWidth > width - padding) tooltipX = width - padding - tooltipWidth - x
  }
  if (height) {
    if (y + tooltipY < padding) tooltipY = padding - y
    if (y + tooltipY + tooltipHeight > height - padding) tooltipY = height - padding - tooltipHeight - y
  }

  return {
    '--tooltip-left': `${Math.max(padding, Math.round(x + tooltipX))}px`,
    '--tooltip-top': `${Math.max(padding, Math.round(y + tooltipY))}px`
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

function DashboardTooltip({ active, payload, label, coordinate, viewBox, floating = false }) {
  const tooltipRef = useRef(null)
  const [size, setSize] = useState({ width: 260, height: 120 })
  useLayoutEffect(() => {
    if (!floating || !active || !tooltipRef.current) return
    const rect = tooltipRef.current.getBoundingClientRect()
    setSize(current => (
      Math.round(current.width) === Math.round(rect.width) && Math.round(current.height) === Math.round(rect.height)
        ? current
        : { width: rect.width, height: rect.height }
    ))
  }, [active, floating, payload])

  if (!active || !payload?.length) return null
  const rows = payload.filter(item => {
    const value = Number(item.value || 0)
    const added = Number(item.payload?.raw?.[item.dataKey] || 0)
    return value > 0 || added > 0
  })
  const raw = rows[0]?.payload?.raw || {}
  if (!rows.length) return null
  return (
    <div
      ref={tooltipRef}
      className={`ats-dashboard-tooltip${floating ? ' is-floating' : ''}`}
      style={floating ? floatingTooltipStyle(coordinate, viewBox, size) : undefined}
    >
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

function sparklineValues(trend, statuses) {
  const values = (trend || []).map(row => statuses.reduce((sum, status) => sum + Number(row?.[status] || 0), 0))
  return values.length ? values : []
}

function sparklinePath(values, { width = 280, height = 64, padding = 6 } = {}) {
  const points = values.length > 1 ? values : [values[0] || 0, values[0] || 0]
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min
  const innerHeight = height - padding * 2
  const step = points.length > 1 ? width / (points.length - 1) : width
  const coords = points.map((value, index) => ({
    x: index * step,
    y: span ? padding + ((max - value) / span) * innerHeight : height * 0.58
  }))
  const line = coords.reduce((path, point, index) => {
    if (index === 0) return `M${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    const previous = coords[index - 1]
    const control = (point.x - previous.x) / 2
    return `${path} C${(previous.x + control).toFixed(1)} ${previous.y.toFixed(1)} ${(point.x - control).toFixed(1)} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  }, '')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  return { line, area }
}

function Sparkline({ values, color = 'rgba(255,255,255,0.95)', animationKey = 'sparkline' }) {
  const { line, area } = sparklinePath(values || [])
  return (
    <svg key={animationKey} className="ats-dashboard-sparkline" viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true">
      <path className="ats-dashboard-sparkline-fill" d={area} />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function SparklineSkeleton() {
  return (
    <div className="ats-dashboard-sparkline-loading" aria-hidden="true">
      <i />
      <span><b /><b /><b /></span>
    </div>
  )
}

function CountUpValue({ value, ready, animationKey }) {
  const target = Number(value || 0)
  const [display, setDisplay] = useState(target)
  const reduceMotion = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ), [])

  useEffect(() => {
    if (!ready || reduceMotion) {
      setDisplay(target)
      return undefined
    }

    let frame = 0
    const start = performance.now()
    const duration = 1050
    const easeOut = (t) => 1 - Math.pow(1 - t, 3)
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      setDisplay(Math.round(target * easeOut(progress)))
      if (progress < 1) frame = window.requestAnimationFrame(tick)
    }

    setDisplay(0)
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [animationKey, ready, reduceMotion, target])

  return ready ? Number(display || 0).toLocaleString('en-IN') : '--'
}

function StatCard({ icon: Icon, label, value, accent, sparkline, isReady, animationKey }) {
  return (
    <article className={`ats-dashboard-kpi kpi-3d ${accent}${isReady ? ' is-ready' : ' is-loading'}`}>
      <div className="ats-dashboard-kpi-top">
        <span className="ats-dashboard-kpi-icon animate-float"><Icon size={20} /></span>
        <span className="ats-dashboard-kpi-trend"><TrendingUp size={12} /> Live</span>
      </div>
      <strong><CountUpValue value={value} ready={isReady} animationKey={animationKey} /></strong>
      <span>{label}</span>
      {isReady ? <Sparkline values={sparkline} animationKey={animationKey} /> : <SparklineSkeleton />}
    </article>
  )
}

function ExpandableCard({ children, onOpen, className = '' }) {
  return (
    <div
      className={`ats-dashboard-expandable${className ? ` ${className}` : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(event)
        }
      }}
    >
      {children}
    </div>
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

function StatusShareRows({ data, total }) {
  const denominator = Number(total || 0)
  return (
    <div className="ats-dashboard-share-list">
      {(data || []).map((item, index) => {
        const percent = denominator > 0 ? Math.round((Number(item.value || 0) / denominator) * 100) : 0
        return (
          <div className="ats-dashboard-share-row" key={item.name}>
            <span><i style={{ background: chartColors[index % chartColors.length] }} />{item.name} share</span>
            <strong>{percent}%</strong>
          </div>
        )
      })}
    </div>
  )
}

function EmptyChart({ label }) {
  return <div className="ats-dashboard-empty-chart">{label}</div>
}

function ChartSkeleton() {
  return <div className="ats-dashboard-chart-skeleton"><span>Loading chart</span></div>
}

function DonutChart({ data, centerLabel, centerValue, modalMode = false }) {
  const chartData = (data || []).filter(item => Number(item.value || 0) > 0)
  if (!chartData.length) return <EmptyChart label="No chart data." />

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={modalMode ? 82 : 58}
          outerRadius={modalMode ? 138 : 96}
          paddingAngle={2}
          stroke="none"
          activeShape={false}
          isAnimationActive
          animationBegin={modalMode ? 100 : 100}
          animationDuration={modalMode ? 1000 : 1000}
          animationEasing="ease-out"
        >
          {chartData.map((item, index) => <Cell key={item.name} fill={seriesColor(index)} stroke="transparent" />)}
        </Pie>
        <Tooltip content={<DashboardTooltip />} cursor={false} />
        <text x="50%" y="46%" textAnchor="middle" className="ats-dashboard-donut-label">{centerLabel}</text>
        <text x="50%" y="58%" textAnchor="middle" className="ats-dashboard-donut-value">{Number(centerValue || 0).toLocaleString('en-IN')}</text>
      </PieChart>
    </ResponsiveContainer>
  )
}

function AnimatedChartDot({ cx, cy, stroke, index }) {
  if (cx === undefined || cy === undefined) return null
  return (
    <circle
      className="ats-dashboard-modal-dot"
      cx={cx}
      cy={cy}
      r={3}
      fill={stroke}
      stroke="var(--white)"
      strokeWidth={2}
      style={{ animationDelay: `${180 + (Number(index) || 0) * 35}ms` }}
    />
  )
}

function StatusTrendLines({ data, statuses, modalMode = false }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: modalMode ? 18 : 12, right: modalMode ? 26 : 16, bottom: 12, left: 0 }}>
        <CartesianGrid stroke="var(--modern-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="m" interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} />
        <Tooltip content={<DashboardTooltip floating />} position={{ x: 0, y: 0 }} wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        {statuses.map((status, index) => (
          <Line
            key={status}
            type="monotone"
            dataKey={status}
            name={status}
            stroke={seriesColor(index)}
            strokeWidth={3}
            dot={modalMode ? <AnimatedChartDot /> : false}
            activeDot={{ r: 4, stroke: 'var(--white)', strokeWidth: 2 }}
            filter={`drop-shadow(0 5px 8px ${seriesColor(index)})`}
            isAnimationActive
            animationBegin={modalMode ? 100 : 0}
            animationDuration={modalMode ? 1400 : 2000}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function DashboardCardModal({ card, context, onClose }) {
  const [readyKey, setReadyKey] = useState(null)
  const hasModalChart = Boolean(card && (card.type === 'trend' || card.chart === 'donut'))
  const isChartReady = hasModalChart && readyKey === card?.openKey

  useEffect(() => {
    if (!hasModalChart) return undefined
    let frame = 0
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => setReadyKey(card.openKey))
    }, 360)
    return () => {
      window.clearTimeout(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [card?.openKey, hasModalChart])

  if (!card) return null
  const rect = card.rect || { left: 0, top: 0, width: 1, height: 1 }
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const modalWidth = Math.min(1080, viewportWidth - 48)
  const modalHeight = Math.min(740, viewportHeight - 48)
  const modalStyle = {
    '--origin-x': `${Math.round(rect.left + rect.width / 2 - viewportWidth / 2)}px`,
    '--origin-y': `${Math.round(rect.top + rect.height / 2 - viewportHeight / 2)}px`,
    '--origin-scale-x': Math.max(0.18, rect.width / modalWidth),
    '--origin-scale-y': Math.max(0.18, rect.height / modalHeight)
  }
  const Icon = card.icon || Activity

  const modal = (
    <div className="ats-dashboard-modal-layer" role="dialog" aria-modal="true" aria-label={card.title}>
      <div className="ats-dashboard-modal-backdrop" aria-hidden="true" />
      <section className="ats-dashboard-modal-card" style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <header className="ats-dashboard-modal-head">
          <div className="ats-dashboard-title-left">
            <span className={`ats-dashboard-title-icon ${card.accent || 'gradient-primary'} shadow-pop`}><Icon size={20} /></span>
            <span>
              <h3>{card.title}</h3>
              <p>{card.subtitle || `${context.consultant} - ${context.period}`}</p>
            </span>
          </div>
          <button type="button" className="ats-dashboard-modal-close" onClick={onClose} aria-label="Close expanded dashboard card">
            <X size={18} />
          </button>
        </header>
        <div className="ats-dashboard-modal-body">
          {card.type === 'summary' ? (
            <>
              <div className={`ats-dashboard-modal-summary ${card.accent || 'gradient-primary'}`}>
                <span>{card.title}</span>
                <strong>{Number(card.value || 0).toLocaleString('en-IN')}</strong>
                <Sparkline values={card.sparkline} />
              </div>
              <div className="ats-dashboard-modal-context">
                <span>Filter</span>
                <b>{context.consultant}</b>
                <span>Period</span>
                <b>{context.period}</b>
              </div>
              {card.breakdown?.length ? <StatusList data={card.breakdown} /> : null}
            </>
          ) : null}
          {card.type === 'trend' ? (
            <div className="ats-dashboard-modal-chart">
              {isChartReady ? (
                <StatusTrendLines key={`${card.id || card.title}-${card.openKey}`} data={card.trend || []} statuses={card.statuses || []} modalMode />
              ) : <div className="ats-dashboard-chart-skeleton"><span>Loading chart</span></div>}
            </div>
          ) : null}
          {card.type === 'breakdown' ? (
            <div className="ats-dashboard-modal-breakdown">
              {card.value !== undefined ? <strong>{Number(card.value || 0).toLocaleString('en-IN')}</strong> : null}
              {card.chart === 'donut' ? (
                <div className="ats-dashboard-modal-chart is-donut">
                  {isChartReady ? (
                    <DonutChart
                      key={`${card.id || card.title}-${card.openKey}`}
                      data={card.breakdown || []}
                      centerLabel={card.centerLabel || card.title}
                      centerValue={card.centerValue ?? card.value}
                      modalMode
                    />
                  ) : <div className="ats-dashboard-chart-skeleton"><span>Loading chart</span></div>}
                </div>
              ) : null}
              {card.breakdown?.length ? <StatusList data={card.breakdown} /> : null}
              {card.shareRows ? <StatusShareRows data={card.breakdown || []} total={card.centerValue ?? card.value} /> : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}

export default function DashboardHome() {
  const [consultant, setConsultant] = useState(OVERALL)
  const [period, setPeriod] = useState(DASHBOARD_PERIODS[0])
  const [consultantOpen, setConsultantOpen] = useState(false)
  const [selectedCard, setSelectedCard] = useState(null)
  const modalOpenCounter = useRef(0)
  const { loading, error, data } = useDashboardStats({ consultant, period })

  const names = Array.isArray(data?.consultantOptions) ? data.consultantOptions : []
  const consultantOptions = [OVERALL, ...names.filter(Boolean)]

  const clientStatusData = data?.clientStatusData || []
  const candidateStatusData = data?.candidateStatusData || []
  const mandateStatusData = data?.mandateStatusData || []
  const billingEntityData = data?.billingEntityData || []
  const clientTrend = data?.clientTrend || []
  const candidateTrend = data?.candidateTrend || []
  const mandateTrend = data?.mandateTrend || []
  const recentActivity = data?.recentActivity || []
  const dashboardDataReady = !loading && Boolean(data)
  const billingTotal = billingEntityData.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const mandateTotal = Number(data?.kpis?.totalMandates || 0)
  const kpis = [
    { label: 'Total Clients', value: data?.kpis?.totalClients, icon: Building2, accent: 'gradient-primary', sparkline: sparklineValues(clientTrend, CLIENT_STATUSES), breakdown: clientStatusData },
    { label: 'Total Candidates', value: data?.kpis?.totalCandidates, icon: Users, accent: 'gradient-info', sparkline: sparklineValues(candidateTrend, CANDIDATE_STATUSES), breakdown: candidateStatusData },
    { label: 'Total Mandates', value: data?.kpis?.totalMandates, icon: Briefcase, accent: 'gradient-warning', sparkline: sparklineValues(mandateTrend, MANDATE_STATUSES), breakdown: mandateStatusData }
  ]
  useEffect(() => {
    if (!selectedCard) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedCard(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedCard])

  const openCard = (event, card) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    modalOpenCounter.current += 1
    setSelectedCard({ ...card, rect, openKey: modalOpenCounter.current })
  }

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

      <OnlineUsersStrip />

      <div className="ats-dashboard-kpi-grid">
        {kpis.map(item => (
          <ExpandableCard
            key={item.label}
            onOpen={(event) => openCard(event, {
              type: 'summary',
              id: item.label,
              title: item.label,
              value: item.value,
              icon: item.icon,
              accent: item.accent,
              sparkline: item.sparkline,
              breakdown: item.breakdown
            })}
          >
            <StatCard {...item} isReady={dashboardDataReady} animationKey={`${item.label}-${consultant}-${period}-${item.sparkline.join(',')}`} />
          </ExpandableCard>
        ))}
      </div>

      <div className="ats-dashboard-grid">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'clients-analytics', chart: 'donut', title: 'Clients Analytics', subtitle: 'Clients by Status', icon: Building2, value: data?.kpis?.totalClients, centerLabel: 'Clients', centerValue: data?.kpis?.totalClients, breakdown: clientStatusData })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Building2} title="Clients Analytics" subtitle="Clients by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalClients || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.clients ? <div className="ats-dashboard-section-error">{data.sectionErrors.clients}</div> : null}
          <div className="ats-dashboard-split">
            <div className="ats-dashboard-chart">
              {!dashboardDataReady ? <ChartSkeleton /> : clientStatusData.some(item => item.value) ? (
                <DonutChart data={clientStatusData} centerLabel="CLIENTS" centerValue={data?.kpis?.totalClients} />
              ) : <EmptyChart label="No client data for this period." />}
            </div>
            <StatusList data={clientStatusData} />
          </div>
        </section>
        </ExpandableCard>

        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'billing-entity', title: 'Active Clients with Contract Signed', subtitle: 'Billing entity split', icon: FileSignature, value: billingTotal, breakdown: billingEntityData.map(item => ({ name: item.label, value: item.value })) })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={FileSignature} title="Active Clients with Contract Signed" subtitle="Billing entity split" />
          <div className="ats-dashboard-billing-grid">
            {billingEntityData.map((item, index) => (
              <div className={`ats-dashboard-billing-card kpi-3d ${index === 0 ? 'gradient-fcs-billing' : 'gradient-fcapl-billing'}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{Number(item.value || 0).toLocaleString('en-IN')}</strong>
                <small>{billingTotal ? Math.round((Number(item.value || 0) / billingTotal) * 100) : 0}% of signed</small>
                <i className="ats-dashboard-billing-progress"><em style={{ width: `${billingTotal ? Math.round((Number(item.value || 0) / billingTotal) * 100) : 0}%` }} /></i>
              </div>
            ))}
          </div>
          <div className="ats-dashboard-total-row"><span>Total contracts signed</span><strong>{billingTotal.toLocaleString('en-IN')}</strong></div>
        </section>
        </ExpandableCard>

        <ExpandableCard onOpen={(event) => openCard(event, { type: 'trend', id: 'client-acquisition-trend', title: 'Client Acquisition Trend', subtitle: `${consultant} - ${period}`, icon: TrendingUp, trend: clientTrend, statuses: CLIENT_STATUSES })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={TrendingUp} title="Client Acquisition Trend" subtitle="Client statuses over time" />
          <div className="ats-dashboard-chart">
            {clientTrend.length ? (
              <StatusTrendLines data={clientTrend} statuses={CLIENT_STATUSES} />
            ) : <EmptyChart label="No client trend data." />}
          </div>
        </section>
        </ExpandableCard>
      </div>

      <div className="ats-dashboard-grid">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'candidates-analytics', chart: 'donut', title: 'Candidates Analytics', subtitle: 'Candidates by Status', icon: Users, value: data?.kpis?.totalCandidates, centerLabel: 'Candidates', centerValue: data?.kpis?.totalCandidates, breakdown: candidateStatusData })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Users} title="Candidates Analytics" subtitle="Candidates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalCandidates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.candidates ? <div className="ats-dashboard-section-error">{data.sectionErrors.candidates}</div> : null}
          <div className="ats-dashboard-split is-vertical">
            <div className="ats-dashboard-chart is-small">
              {!dashboardDataReady ? <ChartSkeleton /> : candidateStatusData.some(item => item.value) ? (
                <DonutChart data={candidateStatusData} centerLabel="CANDIDATES" centerValue={data?.kpis?.totalCandidates} />
              ) : <EmptyChart label="No candidate data for this period." />}
            </div>
            <StatusList data={candidateStatusData} />
          </div>
        </section>
        </ExpandableCard>

        <ExpandableCard onOpen={(event) => openCard(event, { type: 'trend', id: 'candidate-movement-trend', title: 'Candidate Movement Trend', subtitle: `${consultant} - ${period}`, icon: Activity, trend: candidateTrend, statuses: CANDIDATE_STATUSES })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Activity} title="Candidate Movement Trend" subtitle="Candidate statuses over time" />
          <div className="ats-dashboard-chart">
            {candidateTrend.length ? (
              <StatusTrendLines data={candidateTrend} statuses={CANDIDATE_STATUSES} />
            ) : <EmptyChart label="No candidate trend data." />}
          </div>
        </section>
        </ExpandableCard>

      </div>

      <div className="ats-dashboard-grid">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'mandates-analytics', chart: 'donut', title: 'Mandates Analytics', subtitle: 'Mandates by Status', icon: Briefcase, value: data?.kpis?.totalMandates, centerLabel: 'Mandates', centerValue: data?.kpis?.totalMandates, breakdown: mandateStatusData, shareRows: true })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Briefcase} title="Mandates Analytics" subtitle="Mandates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalMandates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.mandates ? <div className="ats-dashboard-section-error">{data.sectionErrors.mandates}</div> : null}
          <div className="ats-dashboard-split is-compact">
            <div className="ats-dashboard-chart is-small">
              {!dashboardDataReady ? <ChartSkeleton /> : mandateStatusData.some(item => item.value) ? (
                <DonutChart data={mandateStatusData} centerLabel="MANDATES" centerValue={data?.kpis?.totalMandates} />
              ) : <EmptyChart label="No mandate data." />}
            </div>
            <StatusList data={mandateStatusData} />
          </div>
          <StatusShareRows data={mandateStatusData} total={mandateTotal} />
        </section>
        </ExpandableCard>

        <ExpandableCard onOpen={(event) => openCard(event, { type: 'trend', id: 'mandates-trend', title: 'Mandates Trend', subtitle: `${consultant} - ${period}`, icon: TrendingUp, trend: mandateTrend, statuses: MANDATE_STATUSES })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={TrendingUp} title="Mandates Trend" subtitle="Ongoing, completed, and scrapped mandates" />
          <div className="ats-dashboard-chart">
            {mandateTrend.length ? (
              <StatusTrendLines data={mandateTrend} statuses={MANDATE_STATUSES} />
            ) : <EmptyChart label="No mandate trend data." />}
          </div>
        </section>
        </ExpandableCard>

      </div>

      <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', title: 'Recent Activity', subtitle: 'Latest client, candidate, and mandate updates', icon: Clock, breakdown: recentActivity.map((item, index) => ({ name: item.text, value: index + 1 })) })}>
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
      </ExpandableCard>
      <DashboardCardModal card={selectedCard} context={{ consultant, period }} onClose={() => setSelectedCard(null)} />
    </div>
  )
}
