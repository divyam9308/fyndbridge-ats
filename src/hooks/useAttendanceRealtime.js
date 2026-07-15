import { useEffect, useRef } from 'react'
import { supabase } from '../services/supabaseClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'

const USER_SCOPED_TABLES = Object.freeze([
  'leave_requests',
  'attendance_correction_requests',
  'attendance_records',
  'leave_ledger'
])
const ATTENDANCE_REALTIME_TABLES = Object.freeze([...USER_SCOPED_TABLES, 'company_holidays'])

export function attendanceRefreshScopes(events, { userId = '', isAdmin = false, isSuperAdmin = false, tab = 'attendance' } = {}) {
  const scopes = new Set()
  const personalAttendanceEnabled = Boolean(userId && !isSuperAdmin)

  for (const payload of events || []) {
    const table = payload?.table
    const affectedUserId = String(payload?.new?.user_id || payload?.old?.user_id || '')
    const affectsCurrentUser = Boolean(personalAttendanceEnabled && affectedUserId === userId)

    if (table === 'reconnect') {
      if (personalAttendanceEnabled) {
        scopes.add('personal-attendance')
        scopes.add('personal-requests')
        scopes.add('leave-balance')
      }
      if (isAdmin) scopes.add('approvals')
      scopes.add('holidays')
      if (tab === 'team') scopes.add('team')
      if (tab === 'leave-balances') scopes.add('managed-balances')
      continue
    }

    if (table === 'leave_requests') {
      if (affectsCurrentUser) {
        scopes.add('personal-attendance')
        scopes.add('personal-requests')
        scopes.add('leave-balance')
      }
      if (isAdmin) scopes.add('approvals')
      if (tab === 'team') scopes.add('team')
      if (tab === 'leave-balances') scopes.add('managed-balances')
      continue
    }

    if (table === 'attendance_correction_requests') {
      if (affectsCurrentUser) {
        scopes.add('personal-attendance')
        scopes.add('personal-requests')
      }
      if (isAdmin) scopes.add('approvals')
      if (tab === 'team') scopes.add('team')
      continue
    }

    if (table === 'attendance_records') {
      if (affectsCurrentUser) scopes.add('personal-attendance')
      if (tab === 'team') scopes.add('team')
      continue
    }

    if (table === 'leave_ledger') {
      if (affectsCurrentUser) scopes.add('leave-balance')
      if (tab === 'team') scopes.add('team')
      if (tab === 'leave-balances') scopes.add('managed-balances')
      continue
    }

    if (table === 'company_holidays') {
      scopes.add('holidays')
      if (personalAttendanceEnabled) {
        scopes.add('personal-attendance')
        scopes.add('leave-balance')
      }
      if (tab === 'team') scopes.add('team')
      if (tab === 'leave-balances') scopes.add('managed-balances')
    }
  }

  return [...scopes]
}

export function useAttendanceRealtime({ userId, isAdmin, onEvents, enabled = true, debounceMs = 350 }) {
  const onEventsRef = useRef(onEvents)
  const eventsRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => {
    onEventsRef.current = onEvents
  }, [onEvents])

  useEffect(() => {
    if (!enabled || !supabase || !userId) return undefined

    const channelName = `realtime:attendance-page:${isAdmin ? 'admin' : 'employee'}:${userId}`
    const schedule = (payload) => {
      eventsRef.current.push(payload)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        const events = eventsRef.current
        eventsRef.current = []
        onEventsRef.current?.(events)
      }, debounceMs)
    }
    const scopedConfig = (table, event) => ({
      event,
      schema: 'public',
      table,
      ...(!isAdmin ? { filter: `user_id=eq.${userId}` } : {})
    })

    logRealtimeSubscribe({ name: channelName, scope: 'page', tables: ATTENDANCE_REALTIME_TABLES })
    let channel = supabase.channel(channelName)
    for (const table of USER_SCOPED_TABLES) {
      channel = channel
        .on('postgres_changes', scopedConfig(table, 'INSERT'), schedule)
        .on('postgres_changes', scopedConfig(table, 'UPDATE'), schedule)
    }
    channel = channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'company_holidays' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'company_holidays' }, schedule)

    let subscribedOnce = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      if (subscribedOnce) schedule({ table: 'reconnect', eventType: 'RECONNECT' })
      subscribedOnce = true
    })

    return () => {
      window.clearTimeout(timerRef.current)
      eventsRef.current = []
      supabase.removeChannel(channel)
      logRealtimeRemove(channelName)
    }
  }, [debounceMs, enabled, isAdmin, userId])
}

export { ATTENDANCE_REALTIME_TABLES }
