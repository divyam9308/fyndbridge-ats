import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'

const dashboardNow = new Date()

export const DASHBOARD_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']

export function dashboardFinancialYearForDate(date) {
  const year = date.getFullYear()
  const start = date.getMonth() >= 3 ? year : year - 1
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function financialYearLabel(start) {
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

const currentFinancialYearStart = Number(dashboardFinancialYearForDate(dashboardNow).slice(3, 7))

export const DASHBOARD_FINANCIAL_YEARS = [-1, 0, 1].map(offset => financialYearLabel(currentFinancialYearStart + offset))

export function dashboardFinancialYearMonths(financialYear) {
  const start = Number(String(financialYear).slice(3, 7))
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(start, 3 + index, 1)
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      value,
      label: date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    }
  })
}

export const dashboardMonthPeriod = month => `Month ${month}`
export const dashboardQuarterPeriod = (financialYear, quarter) => `${financialYear} ${quarter}`

export function dashboardPeriodLabel(period) {
  const month = String(period).match(/^Month (\d{4})-(0[1-9]|1[0-2])$/)
  if (month) {
    return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }
  const quarter = String(period).match(/^(FY \d{4}-\d{2}) (Q[1-4])$/)
  return quarter ? `${quarter[2]} · ${quarter[1]}` : period
}

const DEFAULT_MONTH = `${dashboardNow.getFullYear()}-${String(dashboardNow.getMonth() + 1).padStart(2, '0')}`
export const DEFAULT_DASHBOARD_PERIOD = dashboardMonthPeriod(DEFAULT_MONTH)

const DEFAULT_CONSULTANT = 'Overall (All Consultants)'
const dashboardCache = new Map()
const dashboardInFlight = new Map()
const DEBUG_DASHBOARD = import.meta.env.DEV && import.meta.env.VITE_DEBUG_PERF === 'true'

function debugDashboard(message, details) {
  if (DEBUG_DASHBOARD) console.debug(`[dashboard] ${message}`, details || '')
}

function requestKey({ consultant, period }) {
  return JSON.stringify({
    consultant: consultant || DEFAULT_CONSULTANT,
    period: period || DEFAULT_DASHBOARD_PERIOD
  })
}

function paramsFromKey(key) {
  return JSON.parse(key)
}

async function fetchDashboardByKey(key, signal, reason) {
  const cached = dashboardCache.get(key)
  const existing = dashboardInFlight.get(key)
  if (existing) {
    if (!existing.signal.aborted) {
      debugDashboard('dedupe fetch', { reason, params: paramsFromKey(key) })
      return existing.promise
    }
    dashboardInFlight.delete(key)
  }

  const paramsObject = paramsFromKey(key)
  const params = new URLSearchParams(paramsObject)
  debugDashboard('analytics fetch start', { reason, params: paramsObject })
  const request = apiFetch(`/api/dashboard?${params.toString()}`, {
    cache: 'no-store',
    signal
  })
    .then(async response => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load dashboard stats.')
      dashboardCache.set(key, payload)
      return payload
    })
    .finally(() => {
      if (dashboardInFlight.get(key)?.promise === request) dashboardInFlight.delete(key)
    })

  dashboardInFlight.set(key, { promise: request, signal })
  return cached ? request.catch(() => cached) : request
}

export function useDashboardStats({ consultant, period }) {
  const key = useMemo(() => requestKey({ consultant, period }), [consultant, period])
  const [state, setState] = useState(() => ({
    loading: !dashboardCache.has(key),
    error: '',
    data: dashboardCache.get(key) || null
  }))
  const abortRef = useRef(null)
  const lastFetchedKeyRef = useRef('')
  const realtimeTimerRef = useRef(null)

  const loadDashboardStats = useCallback(async (reason = 'filter_change', { force = false } = {}) => {
    if (!force && lastFetchedKeyRef.current === key && dashboardCache.has(key)) {
      setState(current => current.data ? current : { loading: false, error: '', data: dashboardCache.get(key) })
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    lastFetchedKeyRef.current = key
    const cached = dashboardCache.get(key)
    setState(current => ({
      loading: !current.data && !cached,
      error: '',
      data: current.data || cached || null
    }))

    try {
      const payload = await fetchDashboardByKey(key, controller.signal, reason)
      if (controller.signal.aborted) return
      setState({ loading: false, error: '', data: payload })
    } catch (err) {
      if (err.name === 'AbortError') return
      setState(current => ({
        loading: false,
        error: err.message || 'Unable to load dashboard stats.',
        data: current.data || cached || null
      }))
    }
  }, [key])

  useEffect(() => {
    loadDashboardStats(lastFetchedKeyRef.current ? 'filter_change' : 'initial_load')
    return () => abortRef.current?.abort()
  }, [loadDashboardStats])

  useEffect(() => {
    if (!supabase) return undefined

    const scheduleInvalidation = (reason) => {
      window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        lastFetchedKeyRef.current = ''
        loadDashboardStats(reason, { force: true })
      }, 800)
    }

    const channel = ['clients', 'candidates', 'candidate_associations', 'jobs'].reduce((next, table) => (
      next.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleInvalidation('realtime_invalidation'))
    ), supabase.channel('dashboard-analytics-invalidation'))

    channel.subscribe(status => debugDashboard('realtime status', status))

    const appInvalidation = () => scheduleInvalidation('app_invalidation')
    window.addEventListener('ats:clients-updated', appInvalidation)
    window.addEventListener('ats:candidates-updated', appInvalidation)
    window.addEventListener('ats:jobs-updated', appInvalidation)

    return () => {
      window.clearTimeout(realtimeTimerRef.current)
      window.removeEventListener('ats:clients-updated', appInvalidation)
      window.removeEventListener('ats:candidates-updated', appInvalidation)
      window.removeEventListener('ats:jobs-updated', appInvalidation)
      supabase.removeChannel(channel)
    }
  }, [loadDashboardStats])

  return useMemo(() => ({
    ...state,
    refresh: () => {
      lastFetchedKeyRef.current = ''
      return loadDashboardStats('manual_refresh', { force: true })
    }
  }), [loadDashboardStats, state])
}
