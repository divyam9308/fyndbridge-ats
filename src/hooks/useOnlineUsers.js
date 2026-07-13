import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from './useAdminAccess'
import { apiFetch } from '../services/apiClient'

const OnlineUsersContext = createContext([])
const HEARTBEAT_MS = 25000
const PRESENCE_POLL_MS = 5000
const MIN_WRITE_MS = 2000
const STATUS_EVENT = 'fb:employee-status-changed'

function createPresenceTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function initials(name, email) {
  const value = String(name || email || '').trim()
  const source = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ') : value
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase()
}

function activeStatus() {
  return document.visibilityState === 'visible' && document.hasFocus() ? 'online' : 'away'
}

function usePresenceUsers() {
  const { user, session, profile, loadProfile } = useAuth()
  const { isAdmin, isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const location = useLocation()
  const [presenceUsers, setPresenceUsers] = useState([])
  const loadProfileRef = useRef(loadProfile)
  const metadataRef = useRef(null)
  const lastWriteRef = useRef({ status: '', path: '', at: 0 })
  const tabIdRef = useRef(createPresenceTabId())
  const accessToken = session?.access_token || ''
  const enabled = Boolean(session?.user && user?.id)

  useEffect(() => {
    loadProfileRef.current = loadProfile
  }, [loadProfile])

  const loadPresence = useCallback(async () => {
    if (!enabled) {
      setPresenceUsers([])
      return
    }
    try {
      const payload = await apiFetch('/api/presence', { cache: 'no-store' }).then(response => response.json().catch(() => ({})))
      setPresenceUsers(Array.isArray(payload.data) ? payload.data : [])
    } catch {
      // Presence should never interrupt app usage.
    }
  }, [enabled])

  const ensureMetadata = useCallback(async () => {
    if (metadataRef.current) return metadataRef.current
    const savedProfile = profile?.name ? profile : await loadProfileRef.current().catch(() => null)
    const name = String(savedProfile?.name || user?.name || user?.email || '').trim()
    const email = String(user?.email || session?.user?.email || '').trim()
    metadataRef.current = {
      tab_id: tabIdRef.current,
      display_name: name,
      email,
      initials: initials(name, email),
      role: isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : String(savedProfile?.role || savedProfile?.designation || 'Consultant')
    }
    return metadataRef.current
  }, [isAdmin, isSuperAdmin, profile, session?.user?.email, user?.email, user?.name])

  const heartbeat = useCallback(async ({ force = false } = {}) => {
    if (!enabled) return
    const status = activeStatus()
    const path = `${location.pathname}${location.search || ''}`
    const now = Date.now()
    const previous = lastWriteRef.current
    if (!force && status === previous.status && path === previous.path && now - previous.at < MIN_WRITE_MS) return
    lastWriteRef.current = { status, path, at: now }

    try {
      const metadata = await ensureMetadata()
      await apiFetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...metadata, tab_id: tabIdRef.current, status, current_path: path })
      })
      loadPresence()
    } catch {
      // Presence updates are best effort.
    }
  }, [enabled, ensureMetadata, loadPresence, location.pathname, location.search])

  const markCurrentTabOffline = useCallback(() => {
    if (!enabled || !accessToken) return
    window.fetch('/api/presence/offline', {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tab_id: tabIdRef.current })
    }).catch(() => {})
  }, [accessToken, enabled])

  useEffect(() => {
    const handleStatusChange = (event) => {
      if (event.detail?.user_id === user?.id && event.detail?.status === 'inactive') markCurrentTabOffline()
    }
    window.addEventListener(STATUS_EVENT, handleStatusChange)
    return () => window.removeEventListener(STATUS_EVENT, handleStatusChange)
  }, [markCurrentTabOffline, user?.id])

  useEffect(() => {
    if (!enabled) {
      const resetTimer = window.setTimeout(() => setPresenceUsers([]), 0)
      return () => window.clearTimeout(resetTimer)
    }

    const initialTimer = window.setTimeout(() => {
      heartbeat({ force: true })
      loadPresence()
    }, 0)

    const writeStatus = () => heartbeat({ force: true })
    const heartbeatTimer = window.setInterval(() => heartbeat({ force: true }), HEARTBEAT_MS)
    const pollTimer = window.setInterval(loadPresence, PRESENCE_POLL_MS)

    document.addEventListener('visibilitychange', writeStatus)
    window.addEventListener('focus', writeStatus)
    window.addEventListener('blur', writeStatus)
    window.addEventListener('pageshow', writeStatus)
    window.addEventListener('online', writeStatus)
    window.addEventListener('pagehide', markCurrentTabOffline)
    window.addEventListener('beforeunload', markCurrentTabOffline)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', writeStatus)
      window.removeEventListener('focus', writeStatus)
      window.removeEventListener('blur', writeStatus)
      window.removeEventListener('pageshow', writeStatus)
      window.removeEventListener('online', writeStatus)
      window.removeEventListener('pagehide', markCurrentTabOffline)
      window.removeEventListener('beforeunload', markCurrentTabOffline)
    }
  }, [enabled, heartbeat, loadPresence, markCurrentTabOffline])

  useEffect(() => {
    if (!enabled) return undefined
    const routeTimer = window.setTimeout(() => heartbeat({ force: true }), 0)
    return () => window.clearTimeout(routeTimer)
  }, [enabled, heartbeat])

  return enabled ? presenceUsers : []
}

export function OnlineUsersProvider({ children }) {
  return createElement(OnlineUsersContext.Provider, { value: usePresenceUsers() }, children)
}

export function useOnlineUsers() {
  return useContext(OnlineUsersContext)
}
