import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../context/useAuth'

const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

async function authHeaders() {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function playPing() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.24)
  } catch {
    // Browser may block audio until user interaction.
  }
}

export default function NotificationBell() {
  const { user, isAuthenticated } = useAuth()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [toast, setToast] = useState(null)
  const [toastPaused, setToastPaused] = useState(false)
  const [clearingRead, setClearingRead] = useState(false)
  const rootRef = useRef(null)
  const toastedIdsRef = useRef(new Set())

  const showNotificationToast = useCallback((notification) => {
    if (!notification?.id || notification.status !== 'pending') return
    if (toastedIdsRef.current.has(notification.id)) return
    toastedIdsRef.current.add(notification.id)
    setToast(notification)
    playPing()
  }, [])

  const loadNotifications = useCallback(async () => {
    if (!isAuthenticated) return
    const res = await fetch('/api/notifications', { headers: await authHeaders() })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      const rows = data.data || []
      setNotifications(rows)
      rows
        .filter(item => item.action_type === 'client_follow_up_due')
        .forEach(showNotificationToast)
    }
  }, [isAuthenticated, showNotificationToast])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  useEffect(() => {
    if (!supabase || !user?.id) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${user.id}` }, payload => {
        if (payload.eventType === 'INSERT' && payload.new) {
          showNotificationToast(payload.new)
        }
        loadNotifications()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadNotifications, showNotificationToast, user?.id])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!toast || toastPaused) return undefined
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast, toastPaused])

  const markRead = async (notification) => {
    if (!notification?.id) return
    const res = await fetch(`/api/notifications/${notification.id}/read`, {
      method: 'PATCH',
      headers: await authHeaders()
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return
    const next = data.data || { ...notification, status: 'read', read_at: new Date().toISOString() }
    setNotifications(current => current.map(item => item.id === notification.id ? { ...item, ...next } : item))
    if (toast?.id === notification.id) setToast(null)
  }

  const clearRead = async () => {
    if (clearingRead) return
    const hasRead = notifications.some(item => item.status === 'read')
    if (!hasRead) return
    setClearingRead(true)
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'DELETE',
        headers: await authHeaders()
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to clear notifications.')
      setNotifications(current => current.filter(item => item.status !== 'read'))
    } catch {
      // Keep panel stable on failure.
    } finally {
      setClearingRead(false)
    }
  }

  const pendingCount = notifications.filter(item => item.status === 'pending').length
  const hasReadNotifications = notifications.some(item => item.status === 'read')

  return (
    <div className="notification-root" ref={rootRef}>
      <button className="notification-bell" type="button" onClick={() => setOpen(value => !value)} aria-label="Notifications">
        <Bell size={17} />
        {pendingCount > 0 && <span className="notification-badge">{pendingCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <div className="notification-dropdown-title">Notifications</div>
            <button className="notification-clear-btn" type="button" onClick={clearRead} disabled={!hasReadNotifications || clearingRead}>
              Clear All
            </button>
          </div>
          {notifications.length ? notifications.map(item => (
            <div className={`notification-item ${item.status === 'read' ? 'is-read' : ''}`} key={item.id}>
              <div className="notification-item-title">{item.title || 'Notification'}</div>
              <div className="notification-message">{item.message}</div>
              <div className="notification-meta">{item.sender_name || 'System'} • {formatDateTime(item.created_at)}</div>
              <div className={`notification-status ${item.status === 'read' ? 'is-read' : 'is-pending'}`}>
                Status: {item.status === 'read' ? 'Read' : 'Pending'}
              </div>
              {item.status === 'pending' ? (
                <button className="notification-read-btn" type="button" onClick={() => markRead(item)}>Mark as Read</button>
              ) : (
                <div className="notification-read-state">{formatDateTime(item.read_at)}</div>
              )}
            </div>
          )) : (
            <div className="notification-empty">No notifications</div>
          )}
        </div>
      )}

      {toast && (
        <div className="notification-toast" onMouseEnter={() => setToastPaused(true)} onMouseLeave={() => setToastPaused(false)}>
          <button className="notification-toast-close" type="button" onClick={() => setToast(null)} aria-label="Close notification"><X size={14} /></button>
          <div className="notification-item-title">{toast.title || 'Notification'}</div>
          <div className="notification-message">{toast.message}</div>
          {toast.status === 'pending' && <button className="notification-read-btn" type="button" onClick={() => markRead(toast)}>Mark as Read</button>}
        </div>
      )}
    </div>
  )
}
