import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  Briefcase,
  Building2,
  ChevronDown,
  Clock,
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
import { useOnlineUsers } from '../hooks/useOnlineUsers'
import OnlineUsersStrip from '../components/dashboard/OnlineUsersStrip'
import {
  getStatusColor,
  getCandidateStatusColor,
  getClientStatusColor,
  getMandateStatusColor
} from '../constants/statusColors'
import { buildDashboardDrilldownUrl } from '../utils/dashboardDrilldown'
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
const MAIN_CHART_ANIMATION_MS = 1500
const DEFERRED_SECTION_DELAY_MS = 180
const EMPTY_ARRAY = []

const seriesColor = (index) => chartColors[index % chartColors.length]
const TOOLTIP_GAP = 6

function formatActivityDate(value, exact = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-IN', exact
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

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
          <i style={{ background: item.payload?.color || item.color || item.fill }} />
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
    if (!ready || reduceMotion) return undefined

    let frame = 0
    const start = performance.now()
    const duration = 1050
    const easeOut = (t) => 1 - Math.pow(1 - t, 3)
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      setDisplay(Math.round(target * easeOut(progress)))
      if (progress < 1) frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [animationKey, ready, reduceMotion, target])

  return ready ? Number(reduceMotion ? target : display || 0).toLocaleString('en-IN') : '--'
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

function KpiExpandableCard({ item, isReady, consultant, period, onOpen }) {
  return (
    <ExpandableCard
      onOpen={(event) => onOpen(event, {
        type: 'summary',
        id: item.label,
        title: item.label,
        value: item.value,
        icon: item.icon,
        accent: item.accent,
        sparkline: item.sparkline,
        breakdown: item.breakdown,
        onDrilldown: item.onDrilldown
      })}
    >
      <StatCard {...item} isReady={isReady} animationKey={`${item.label}-${consultant}-${period}-${item.sparkline.join(',')}`} />
    </ExpandableCard>
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
        if (event.target !== event.currentTarget) return
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

function StatusList({ data, onItemClick }) {
  return (
    <div className="ats-dashboard-status-list">
      {data.map((item) => (
        <button
          type="button"
          className={`ats-dashboard-status-row${onItemClick ? ' is-clickable' : ''}`}
          key={item.name}
          disabled={!Number(item.value || 0)}
          onClick={(event) => {
            if (!onItemClick || !Number(item.value || 0)) return
            event.stopPropagation()
            onItemClick(item)
          }}
        >
          <span className="ats-dashboard-status-name">
            <i style={{ background: item.color }} />
            {item.name}
          </span>
          <strong>{Number(item.value || 0).toLocaleString('en-IN')}</strong>
        </button>
      ))}
    </div>
  )
}

function StatusShareRows({ data, total }) {
  const denominator = Number(total || 0)
  return (
    <div className="ats-dashboard-share-list">
      {(data || []).map((item) => {
        const percent = denominator > 0 ? Math.round((Number(item.value || 0) / denominator) * 100) : 0
        return (
          <div className="ats-dashboard-share-row" key={item.name}>
            <span><i style={{ background: item.color }} />{item.name} share</span>
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

function ChartContainer({ children }) {
  const ref = useRef(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const update = () => {
      const nextReady = element.clientWidth > 0 && element.clientHeight > 0
      setReady(current => current === nextReady ? current : nextReady)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className="ats-dashboard-chart-content">{ready ? children : null}</div>
}

const DonutChart = memo(function DonutChart({ data, centerLabel, centerValue, modalMode = false, onItemClick }) {
  const chartData = (data || []).filter(item => Number(item.value || 0) > 0)
  if (!chartData.length) return <EmptyChart label="No chart data." />

  return (
    <ChartContainer>
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
          className={onItemClick ? 'is-clickable' : ''}
          onClick={(item, _index, event) => {
            event?.stopPropagation?.()
            const selected = item?.payload || item
            if (onItemClick && Number(selected?.value || 0)) onItemClick(selected)
          }}
        >
          {chartData.map((item) => <Cell key={item.name} fill={item.color} stroke="transparent" style={{ cursor: onItemClick ? 'pointer' : 'default' }} />)}
        </Pie>
        <Tooltip content={<DashboardTooltip />} cursor={false} />
        <text x="50%" y="46%" textAnchor="middle" className="ats-dashboard-donut-label">{centerLabel}</text>
        <text x="50%" y="58%" textAnchor="middle" className="ats-dashboard-donut-value">{Number(centerValue || 0).toLocaleString('en-IN')}</text>
      </PieChart>
    </ResponsiveContainer>
    </ChartContainer>
  )
})

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

const StatusTrendLines = memo(function StatusTrendLines({ data, statuses, modalMode = false }) {
  return (
    <ChartContainer>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: modalMode ? 18 : 12, right: modalMode ? 26 : 16, bottom: 12, left: 0 }}>
        <CartesianGrid stroke="var(--modern-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="m" interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} />
        <Tooltip content={<DashboardTooltip floating />} position={{ x: 0, y: 0 }} wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        {statuses.map((status) => (
          <Line
            key={status}
            type="monotone"
            dataKey={status}
            name={status}
            stroke={getStatusColor(status)}
            strokeWidth={3.5}
            dot={modalMode ? <AnimatedChartDot /> : false}
            activeDot={{ r: 5, stroke: 'var(--white)', strokeWidth: 2 }}
            isAnimationActive
            animationBegin={modalMode ? 100 : 0}
            animationDuration={modalMode ? 1400 : MAIN_CHART_ANIMATION_MS}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
    </ChartContainer>
  )
})

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
              {card.breakdown?.length ? <StatusList data={card.breakdown} onItemClick={card.onDrilldown} /> : null}
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
                      onItemClick={card.onDrilldown}
                    />
                  ) : <div className="ats-dashboard-chart-skeleton"><span>Loading chart</span></div>}
                </div>
              ) : null}
              {card.breakdown?.length ? <StatusList data={card.breakdown} onItemClick={card.onDrilldown} /> : null}
              {card.shareRows ? <StatusShareRows data={card.breakdown || []} total={card.centerValue ?? card.value} /> : null}
            </div>
          ) : null}
          {card.type === 'activity' ? (
            <div className="ats-dashboard-activity-modal-list">
              {card.activities?.length ? card.activities.map((item) => (
                <article className="ats-dashboard-activity-modal-row" key={item.id}>
                  <div>
                    <span className="ats-dashboard-activity-module">{item.module}</span>
                    <strong>{item.text}</strong>
                    <small>{item.actorName || 'Unknown user'}</small>
                  </div>
                  <time>{formatActivityDate(item.date, true)}</time>
                </article>
              )) : <div className="ats-dashboard-empty-chart">No recent activity yet.</div>}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}

function DashboardDrilldownModal({ drilldown, onClose, onOpenFullPage }) {
  const frameRef = useRef(null)
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!drilldown) return null
  const entityLabel = drilldown.type === 'mandates' ? 'Mandates' : drilldown.type[0].toUpperCase() + drilldown.type.slice(1)
  const consultantLabel = drilldown.consultant === OVERALL ? '' : drilldown.consultant
  const source = `${buildDashboardDrilldownUrl(drilldown.type, { consultant: drilldown.consultant, status: drilldown.status, period: drilldown.period })}&embed=dashboard`
  const openFullPage = () => {
    const currentLocation = frameRef.current?.contentWindow?.location
    onOpenFullPage(currentLocation ? `${currentLocation.pathname}${currentLocation.search}` : '')
  }
  const modal = (
    <div className="ats-dashboard-drilldown-layer" role="dialog" aria-modal="true" aria-label={`${entityLabel} drilldown`}>
      <div className="ats-dashboard-drilldown-backdrop" onClick={onClose} />
      <section className="ats-dashboard-drilldown-card">
        <header className="ats-dashboard-drilldown-head">
          <div><h3>{[entityLabel, drilldown.status, consultantLabel].filter(Boolean).join(' · ')}</h3><div className="ats-dashboard-drilldown-chips">{consultantLabel ? <span>Consultant = {consultantLabel}</span> : null}<span>Status = {drilldown.status}</span></div></div>
          <div><button type="button" className="ats-dashboard-drilldown-open" onClick={openFullPage}>Open full page</button><button type="button" className="ats-dashboard-modal-close" onClick={onClose} aria-label="Close drilldown"><X size={18} /></button></div>
        </header>
        <iframe ref={frameRef} className="ats-dashboard-drilldown-frame" title={`${entityLabel} filtered table`} src={source} />
      </section>
    </div>
  )
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}

export default function DashboardHome() {
  const navigate = useNavigate()
  const [consultant, setConsultant] = useState(OVERALL)
  const [period, setPeriod] = useState(DASHBOARD_PERIODS[0])
  const [consultantOpen, setConsultantOpen] = useState(false)
  const [selectedCard, setSelectedCard] = useState(null)
  const [selectedDrilldown, setSelectedDrilldown] = useState(null)
  const [deferredRenderKey, setDeferredRenderKey] = useState('')
  const modalOpenCounter = useRef(0)
  const consultantSelectRef = useRef(null)
  const { loading, error, data } = useDashboardStats({ consultant, period })
  const onlineUsers = useOnlineUsers()

  const consultantOptionSource = data?.consultantOptions || EMPTY_ARRAY
  const consultantOptions = useMemo(() => {
    const names = Array.isArray(consultantOptionSource) ? consultantOptionSource : EMPTY_ARRAY
    return [OVERALL, ...names.filter(Boolean)]
  }, [consultantOptionSource])
  const dashboardAccess = data?.dashboardAccess
  const consultantLocked = Boolean(dashboardAccess?.restrictedToSelf && dashboardAccess?.consultantName)

  useEffect(() => {
    if (!consultantLocked || consultant === dashboardAccess.consultantName) return undefined
    const timer = window.setTimeout(() => setConsultant(dashboardAccess.consultantName), 0)
    return () => window.clearTimeout(timer)
  }, [consultant, consultantLocked, dashboardAccess?.consultantName])

  const clientStatusSource = data?.clientStatusData || EMPTY_ARRAY
  const candidateStatusSource = data?.candidateStatusData || EMPTY_ARRAY
  const mandateStatusSource = data?.mandateStatusData || EMPTY_ARRAY
  const billingEntitySource = data?.billingEntityData || EMPTY_ARRAY
  const clientTrendSource = data?.clientTrend || EMPTY_ARRAY
  const candidateTrendSource = data?.candidateTrend || EMPTY_ARRAY
  const mandateTrendSource = data?.mandateTrend || EMPTY_ARRAY
  const recentActivitySource = data?.recentActivity || EMPTY_ARRAY
  const clientStatusData = useMemo(() => clientStatusSource.map(item => ({
    ...item,
    color: getClientStatusColor(item.name)
  })), [clientStatusSource])
  const candidateStatusData = useMemo(() => candidateStatusSource.map(item => ({
    ...item,
    color: getCandidateStatusColor(item.name)
  })), [candidateStatusSource])
  const mandateStatusData = useMemo(() => mandateStatusSource.map(item => ({
    ...item,
    color: getMandateStatusColor(item.name)
  })), [mandateStatusSource])
  const billingEntityData = useMemo(() => billingEntitySource, [billingEntitySource])
  const clientTrend = useMemo(() => clientTrendSource, [clientTrendSource])
  const candidateTrend = useMemo(() => candidateTrendSource, [candidateTrendSource])
  const mandateTrend = useMemo(() => mandateTrendSource, [mandateTrendSource])
  const recentActivity = useMemo(() => recentActivitySource, [recentActivitySource])
  const recentActivityPreview = useMemo(() => recentActivity.slice(0, 7), [recentActivity])
  const dashboardDataReady = !loading && Boolean(data)
  const billingTotal = useMemo(() => billingEntityData.reduce((sum, item) => sum + Number(item.value || 0), 0), [billingEntityData])
  const mandateTotal = Number(data?.kpis?.totalMandates || 0)
  const drilldown = useCallback((entityType, item) => {
    if (!Number(item?.value || 0)) return
    setSelectedDrilldown({
      type: entityType,
      consultant,
      status: item.name,
      period
    })
  }, [consultant, period])
  const clientDrilldown = useCallback(item => drilldown('clients', item), [drilldown])
  const candidateDrilldown = useCallback(item => drilldown('candidates', item), [drilldown])
  const mandateDrilldown = useCallback(item => drilldown('mandates', item), [drilldown])
  const clientSparkline = useMemo(() => sparklineValues(clientTrend, CLIENT_STATUSES), [clientTrend])
  const candidateSparkline = useMemo(() => sparklineValues(candidateTrend, CANDIDATE_STATUSES), [candidateTrend])
  const mandateSparkline = useMemo(() => sparklineValues(mandateTrend, MANDATE_STATUSES), [mandateTrend])
  const kpis = useMemo(() => [
    { label: 'Total Clients', value: data?.kpis?.totalClients, icon: Building2, accent: 'gradient-primary', sparkline: clientSparkline, breakdown: clientStatusData, onDrilldown: clientDrilldown },
    { label: 'Total Candidates', value: data?.kpis?.totalCandidates, icon: Users, accent: 'gradient-info', sparkline: candidateSparkline, breakdown: candidateStatusData, onDrilldown: candidateDrilldown },
    { label: 'Total Mandates', value: data?.kpis?.totalMandates, icon: Briefcase, accent: 'gradient-warning', sparkline: mandateSparkline, breakdown: mandateStatusData, onDrilldown: mandateDrilldown }
  ], [candidateDrilldown, candidateSparkline, candidateStatusData, clientDrilldown, clientSparkline, clientStatusData, data?.kpis?.totalCandidates, data?.kpis?.totalClients, data?.kpis?.totalMandates, mandateDrilldown, mandateSparkline, mandateStatusData])
  const deferredSectionKey = `${consultant}::${period}::${dashboardDataReady ? 'ready' : 'loading'}::${error ? 'error' : 'ok'}`
  const renderDeferredSections = (dashboardDataReady || error) && deferredRenderKey === deferredSectionKey

  useEffect(() => {
    if (!dashboardDataReady && !error) return undefined

    let idleId = 0
    let timer = 0
    const showDeferredSections = () => setDeferredRenderKey(deferredSectionKey)

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(showDeferredSections, { timeout: 600 })
    } else {
      timer = window.setTimeout(showDeferredSections, DEFERRED_SECTION_DELAY_MS)
    }

    return () => {
      if (idleId && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      window.clearTimeout(timer)
    }
  }, [dashboardDataReady, deferredSectionKey, error])

  useEffect(() => {
    if (!selectedCard && !selectedDrilldown) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedCard(null)
        setSelectedDrilldown(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedCard, selectedDrilldown])

  useEffect(() => {
    if (!consultantOpen) return undefined
    const close = (event) => {
      if (!consultantSelectRef.current?.contains(event.target)) setConsultantOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [consultantOpen])

  const openCard = useCallback((event, card) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    modalOpenCounter.current += 1
    setSelectedCard({ ...card, rect, openKey: modalOpenCounter.current })
  }, [])
  const openRecentActivity = useCallback((event) => openCard(event, {
    type: 'activity',
    title: 'Recent Activity',
    subtitle: 'Latest 50 client, candidate, and mandate changes',
    icon: Clock,
    activities: recentActivity
  }), [openCard, recentActivity])
  const modalContext = useMemo(() => ({ consultant, period }), [consultant, period])

  return (
    <div className="ats-dashboard-page modern-dashboard" id="page-dashboard">
      <div className="ats-dashboard-filter-row card-3d">
        <div>
          <h2>Recruitment Analytics</h2>
        </div>

        <div className="ats-dashboard-controls">
          {consultantLocked ? <div className="ats-dashboard-locked-filter">Showing your dashboard: {dashboardAccess.consultantName}</div> : <div className="ats-dashboard-select" ref={consultantSelectRef}>
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
          </div>}

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

      <div className={`ats-dashboard-state-slot${loading || error ? ' is-visible' : ''}`} aria-hidden={!loading && !error}>
        {loading ? (
          <div className="ats-dashboard-state">
            <span>Loading dashboard</span>
            <span className="ats-dashboard-loading-dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
        ) : error ? (
          <div className="ats-dashboard-state is-error">{error}</div>
        ) : (
          <div className="ats-dashboard-state is-hidden">Loading dashboard</div>
        )}
      </div>

      <OnlineUsersStrip users={onlineUsers} />

      <section className="ats-dashboard-module ats-dashboard-module-mandates" aria-label="Mandates analytics">
      <div className="ats-dashboard-entity-layout">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'mandates-analytics', chart: 'donut', title: 'Mandates Analytics', subtitle: 'Mandates by Status', icon: Briefcase, value: data?.kpis?.totalMandates, centerLabel: 'Mandates', centerValue: data?.kpis?.totalMandates, breakdown: mandateStatusData, shareRows: true, onDrilldown: mandateDrilldown })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Briefcase} title="Mandates Analytics" subtitle="Mandates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalMandates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.mandates ? <div className="ats-dashboard-section-error">{data.sectionErrors.mandates}</div> : null}
          <div className="ats-dashboard-split is-compact">
            <div className="ats-dashboard-chart is-small">
              {!dashboardDataReady ? <ChartSkeleton /> : mandateStatusData.some(item => item.value) ? (
                <DonutChart data={mandateStatusData} centerLabel="MANDATES" centerValue={data?.kpis?.totalMandates} onItemClick={mandateDrilldown} />
              ) : <EmptyChart label="No mandate data." />}
            </div>
            <StatusList data={mandateStatusData} onItemClick={mandateDrilldown} />
          </div>
          <StatusShareRows data={mandateStatusData} total={mandateTotal} />
        </section>
        </ExpandableCard>
        <div className="ats-dashboard-entity-stack">
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
        <KpiExpandableCard item={kpis[2]} isReady={dashboardDataReady} consultant={consultant} period={period} onOpen={openCard} />
        </div>
      </div>
      </section>

      {renderDeferredSections ? <>
      <section className="ats-dashboard-module" aria-label="Candidates analytics">
      <div className="ats-dashboard-entity-layout">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'candidates-analytics', chart: 'donut', title: 'Candidates Analytics', subtitle: 'Candidates by Status', icon: Users, value: data?.kpis?.totalCandidates, centerLabel: 'Candidates', centerValue: data?.kpis?.totalCandidates, breakdown: candidateStatusData, onDrilldown: candidateDrilldown })}>
        <section className="ats-dashboard-card card-3d">
          <SectionTitle icon={Users} title="Candidates Analytics" subtitle="Candidates by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalCandidates || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.candidates ? <div className="ats-dashboard-section-error">{data.sectionErrors.candidates}</div> : null}
          <div className="ats-dashboard-split is-vertical">
            <div className="ats-dashboard-chart is-small">
              {!dashboardDataReady ? <ChartSkeleton /> : candidateStatusData.some(item => item.value) ? (
                <DonutChart data={candidateStatusData} centerLabel="CANDIDATES" centerValue={data?.kpis?.totalCandidates} onItemClick={candidateDrilldown} />
              ) : <EmptyChart label="No candidate data for this period." />}
            </div>
            <StatusList data={candidateStatusData} onItemClick={candidateDrilldown} />
          </div>
        </section>
        </ExpandableCard>
        <div className="ats-dashboard-entity-stack">
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
        <KpiExpandableCard item={kpis[1]} isReady={dashboardDataReady} consultant={consultant} period={period} onOpen={openCard} />
        </div>
      </div>
      </section>

      <section className="ats-dashboard-module" aria-label="Clients analytics">
      <div className="ats-dashboard-entity-layout">
        <ExpandableCard onOpen={(event) => openCard(event, { type: 'breakdown', id: 'clients-analytics', chart: 'donut', title: 'Clients Analytics', subtitle: 'Clients by Status', icon: Building2, value: data?.kpis?.totalClients, centerLabel: 'Clients', centerValue: data?.kpis?.totalClients, breakdown: clientStatusData, onDrilldown: clientDrilldown })}>
        <section className="ats-dashboard-card ats-dashboard-clients-analytics card-3d">
          <SectionTitle icon={Building2} title="Clients Analytics" subtitle="Clients by Status" right={<span className="ats-dashboard-total">Total {Number(data?.kpis?.totalClients || 0).toLocaleString('en-IN')}</span>} />
          {data?.sectionErrors?.clients ? <div className="ats-dashboard-section-error">{data.sectionErrors.clients}</div> : null}
          <div className="ats-dashboard-split">
            <div className="ats-dashboard-chart">
              {!dashboardDataReady ? <ChartSkeleton /> : clientStatusData.some(item => item.value) ? (
                <DonutChart data={clientStatusData} centerLabel="CLIENTS" centerValue={data?.kpis?.totalClients} onItemClick={clientDrilldown} />
              ) : <EmptyChart label="No client data for this period." />}
            </div>
            <StatusList data={clientStatusData} onItemClick={clientDrilldown} />
          </div>
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
        <div className="ats-dashboard-entity-stack">
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
        <KpiExpandableCard item={kpis[0]} isReady={dashboardDataReady} consultant={consultant} period={period} onOpen={openCard} />
        </div>
      </div>
      </section>

      <ExpandableCard onOpen={openRecentActivity}>
      <section className="ats-dashboard-card card-3d">
        <SectionTitle icon={Clock} title="Recent Activity" subtitle="Latest client, candidate, and mandate updates" right={<button type="button" className="ats-dashboard-activity-view-all" onClick={(event) => { event.stopPropagation(); openRecentActivity(event) }}>View all</button>} />
        {!dashboardDataReady ? (
          <div className="ats-dashboard-activity-state"><Loader2 size={16} className="spin" /> Loading recent activity...</div>
        ) : error ? (
          <div className="ats-dashboard-activity-state is-error">Could not load recent activity.</div>
        ) : recentActivity.length ? (
          <div className="ats-dashboard-activity">
            {recentActivityPreview.map((item, index) => (
              <div className="ats-dashboard-activity-row" key={item.id}>
                <span style={{ background: seriesColor(index) }}><UserCheck size={15} /></span>
                <div>
                  <p>{item.text}</p>
                  <small>{item.actorName || 'Unknown user'}</small>
                </div>
                <time>{formatActivityDate(item.date)}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="ats-dashboard-empty-chart">No recent activity yet.</div>
        )}
      </section>
      </ExpandableCard>
      </> : null}
      <DashboardCardModal card={selectedCard} context={modalContext} onClose={() => setSelectedCard(null)} />
      <DashboardDrilldownModal
        drilldown={selectedDrilldown}
        onClose={() => setSelectedDrilldown(null)}
        onOpenFullPage={(currentFramePath = '') => {
          if (!selectedDrilldown) return
          const fallbackPath = buildDashboardDrilldownUrl(selectedDrilldown.type, selectedDrilldown)
          const targetPath = currentFramePath && currentFramePath !== window.location.pathname
            ? currentFramePath
            : fallbackPath
          const [pathname, search = ''] = targetPath.split('?')
          const params = new URLSearchParams(search)
          params.delete('embed')
          navigate(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
          setSelectedDrilldown(null)
        }}
      />
    </div>
  )
}
