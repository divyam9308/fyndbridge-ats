import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../services/apiClient'

export const DASHBOARD_PERIODS = [
  'This Month',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'This Year (YTD)',
  'Till This Date'
]

export function useDashboardStats({ consultant, period }) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    data: null
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadDashboardStats() {
      setState(current => ({ ...current, loading: true, error: '' }))
      try {
        const params = new URLSearchParams({
          consultant: consultant || 'Overall (All Consultants)',
          period: period || DASHBOARD_PERIODS[0]
        })
        const response = await apiFetch(`/api/dashboard?${params.toString()}`, {
          signal: controller.signal
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to load dashboard stats.')
        setState({ loading: false, error: '', data: payload })
      } catch (err) {
        if (err.name === 'AbortError') return
        setState({ loading: false, error: err.message || 'Unable to load dashboard stats.', data: null })
      }
    }

    loadDashboardStats()
    return () => controller.abort()
  }, [consultant, period])

  return useMemo(() => state, [state])
}
