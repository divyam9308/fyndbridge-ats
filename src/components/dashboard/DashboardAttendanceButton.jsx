import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, RefreshCw } from 'lucide-react'
import {
  ATTENDANCE_TODAY_CHANGED_EVENT,
  clockIn,
  clockOut,
  getTodayAttendance
} from '../../services/attendanceApi'
import {
  dashboardAttendanceView,
  millisecondsUntilCompanyMidnight
} from '../../features/attendance/dashboardAttendanceState'

const MESSAGE_DURATION_MS = 4500

export default function DashboardAttendanceButton() {
  const [record, setRecord] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const requestInFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const messageTimerRef = useRef(0)

  const showMessage = useCallback((text, tone = 'success') => {
    window.clearTimeout(messageTimerRef.current)
    setMessage({ text, tone })
    messageTimerRef.current = window.setTimeout(() => setMessage(null), MESSAGE_DURATION_MS)
  }, [])

  const loadToday = useCallback(async ({ announceError = false } = {}) => {
    window.clearTimeout(messageTimerRef.current)
    setMessage(null)
    setRecord(undefined)
    setLoading(true)
    try {
      const nextRecord = await getTodayAttendance()
      if (!mountedRef.current) return
      setRecord(nextRecord || null)
    } catch (error) {
      if (!mountedRef.current) return
      if (announceError) showMessage(error.message || 'Unable to load attendance.', 'error')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [showMessage])

  useEffect(() => {
    mountedRef.current = true
    const initialLoadTimer = window.setTimeout(() => loadToday({ announceError: true }), 0)

    const syncAttendance = (event) => {
      if (!mountedRef.current) return
      setRecord(event.detail || null)
      setLoading(false)
    }
    window.addEventListener(ATTENDANCE_TODAY_CHANGED_EVENT, syncAttendance)

    let midnightTimer = 0
    const scheduleMidnightRefresh = () => {
      midnightTimer = window.setTimeout(async () => {
        if (!mountedRef.current) return
        await loadToday({ announceError: true })
        if (mountedRef.current) scheduleMidnightRefresh()
      }, millisecondsUntilCompanyMidnight())
    }
    scheduleMidnightRefresh()

    return () => {
      mountedRef.current = false
      window.clearTimeout(initialLoadTimer)
      window.clearTimeout(midnightTimer)
      window.clearTimeout(messageTimerRef.current)
      window.removeEventListener(ATTENDANCE_TODAY_CHANGED_EVENT, syncAttendance)
    }
  }, [loadToday])

  const view = dashboardAttendanceView(record)
  const initialLoadFailed = !loading && record === undefined
  const disabled = loading || saving || view.mode === 'complete'

  const handleClick = async () => {
    if (requestInFlightRef.current || disabled) return
    if (initialLoadFailed) {
      await loadToday({ announceError: true })
      return
    }

    requestInFlightRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      const nextRecord = view.action === 'clock-out' ? await clockOut() : await clockIn()
      if (!mountedRef.current) return
      setRecord(nextRecord)
      showMessage(view.action === 'clock-out' ? 'Clocked out successfully.' : 'Clocked in successfully.')
    } catch (error) {
      if (mountedRef.current) showMessage(error.message || 'Unable to update attendance.', 'error')
    } finally {
      requestInFlightRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const label = loading ? 'Checking…' : saving ? 'Updating…' : initialLoadFailed ? 'Retry' : view.status
  const ariaLabel = loading ? 'Loading attendance' : saving ? 'Updating attendance' : initialLoadFailed ? 'Retry loading attendance' : view.ariaLabel

  return (
    <div className={`dashboard-attendance-control is-${initialLoadFailed ? 'error' : view.mode}`}>
      <button
        type="button"
        className={`dashboard-attendance-button${view.reminder && !loading && !saving && !initialLoadFailed ? ' is-reminder' : ''}`}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={handleClick}
      >
        {loading || saving ? <LoaderCircle size={18} className="dashboard-attendance-spinner" aria-hidden="true" /> : initialLoadFailed ? <RefreshCw size={17} aria-hidden="true" /> : view.mode === 'complete' ? <Check size={19} aria-hidden="true" /> : view.label}
      </button>
      <span className="dashboard-attendance-status">{label}</span>
      {message ? <span className={`dashboard-attendance-message is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</span> : null}
    </div>
  )
}
