import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { apiFetch } from '../services/apiClient'
import { PRESENCE_LOGOUT_EVENT, PRESENCE_LOGOUT_STORAGE_KEY } from '../services/presenceSession'
import { supabase } from '../services/supabaseClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'

const HEARTBEAT_MS = 60 * 1000
const OFFLINE_CUTOFF_MS = 120 * 1000
const LEADER_LEASE_MS = 45 * 1000
const LEADER_RENEW_MS = 15 * 1000
const FALLBACK_POLL_MS = 60 * 1000
const LOCAL_EXPIRY_SWEEP_MS = 30 * 1000
const TAB_ID_STORAGE_KEY = 'fb_presence_tab_id'

function createPresenceTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function storedPresenceTabId() {
  try {
    const current = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY)
    if (current) return current
    const next = createPresenceTabId()
    window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next)
    return next
  } catch {
    return createPresenceTabId()
  }
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

function parseStoredJson(value) {
  try { return JSON.parse(value || 'null') } catch { return null }
}

function tabRowKey(row) {
  const userId = String(row?.user_id || '').trim()
  const tabId = String(row?.tab_id || '').trim()
  return userId && tabId ? `${userId}:${tabId}` : ''
}

function normalizePresenceTab(row) {
  if (!tabRowKey(row)) return null
  return {
    user_id: row.user_id,
    tab_id: row.tab_id,
    email: row.email || '',
    display_name: row.display_name || row.name || '',
    initials: row.initials || initials(row.display_name || row.name, row.email),
    avatar_color: row.avatar_color || '',
    status: row.status === 'away' ? 'away' : 'online',
    current_path: row.current_path || '',
    last_seen_at: row.last_seen_at,
    updated_at: row.updated_at
  }
}

function aggregatePresenceTabs(rows, now = Date.now()) {
  const cutoff = now - OFFLINE_CUTOFF_MS
  const byUser = new Map()

  for (const value of rows || []) {
    const row = normalizePresenceTab(value)
    const seenAt = new Date(row?.last_seen_at || 0).getTime()
    if (!row || !Number.isFinite(seenAt) || seenAt < cutoff) continue
    const current = byUser.get(row.user_id) || []
    current.push(row)
    byUser.set(row.user_id, current)
  }

  return [...byUser.values()].map((userRows) => {
    const latest = userRows.reduce((best, row) => (
      !best || new Date(row.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? row : best
    ), null)
    return {
      id: latest.user_id,
      user_id: latest.user_id,
      email: latest.email,
      name: latest.display_name || latest.email || 'User',
      display_name: latest.display_name,
      initials: latest.initials,
      avatar_color: latest.avatar_color,
      status: userRows.some(row => row.status === 'online') ? 'online' : 'away',
      current_path: latest.current_path,
      last_seen_at: latest.last_seen_at,
      updated_at: latest.updated_at
    }
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''))
  })
}

function usersSignature(users) {
  return JSON.stringify((users || []).map(user => [
    user.id,
    user.status,
    user.last_seen_at,
    user.current_path,
    user.name,
    user.email
  ]))
}

function usePresenceHeartbeatLeader() {
  const { user, session, profile, loadProfile } = useAuth()
  const location = useLocation()
  const [tabId] = useState(storedPresenceTabId)
  const coordinatorRef = useRef(null)
  const loadProfileRef = useRef(loadProfile)
  const profileRef = useRef(profile)
  const userRef = useRef(user)
  const sessionRef = useRef(session)
  const metadataRef = useRef(null)
  const path = `${location.pathname}${location.search || ''}`
  const pathRef = useRef(path)
  const userId = session?.user?.id || user?.id || ''
  const accessToken = session?.access_token || ''
  const isDashboardEmbed = new URLSearchParams(location.search).get('embed') === 'dashboard'
  const enabled = Boolean(userId && accessToken && !isDashboardEmbed)

  useEffect(() => { loadProfileRef.current = loadProfile }, [loadProfile])
  useEffect(() => { profileRef.current = profile }, [profile])
  useEffect(() => { userRef.current = user }, [user])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { metadataRef.current = null }, [profile?.name, session?.user?.email, user?.email, user?.name])

  useEffect(() => {
    pathRef.current = path
    coordinatorRef.current?.publishLocalState()
  }, [path])

  useEffect(() => {
    if (!enabled) return undefined

    const keyPrefix = `fb_presence:${userId}:`
    const leaderKey = `${keyPrefix}leader`
    const statePrefix = `${keyPrefix}state:`
    const signalKey = `${keyPrefix}signal`
    const ownStateKey = `${statePrefix}${tabId}`
    let destroyed = false
    let suspended = false
    let isLeader = false
    let heartbeatInFlight = false
    let pendingHeartbeat = false
    let lastSuccessfulSignature = ''
    let leaderRenewTimer = null
    let heartbeatTimer = null
    let failoverTimer = null
    let acquisitionTimer = null
    let initialHeartbeatTimer = null
    let storageAvailable = true

    const safeGet = (key) => {
      try { return window.localStorage.getItem(key) } catch {
        storageAvailable = false
        return null
      }
    }
    const safeSet = (key, value) => {
      try { window.localStorage.setItem(key, value); return true } catch {
        storageAvailable = false
        return false
      }
    }
    const safeRemove = (key) => {
      try { window.localStorage.removeItem(key) } catch {
        // Presence coordination remains best effort when storage is unavailable.
      }
    }
    const readLeader = () => parseStoredJson(safeGet(leaderKey))
    const ownsLeadership = () => {
      if (!storageAvailable) return isLeader
      const leader = readLeader()
      return leader?.tab_id === tabId && Number(leader.expires_at || 0) > Date.now()
    }
    const localState = () => ({
      tab_id: tabId,
      status: activeStatus(),
      path: pathRef.current,
      changed_at: Date.now(),
      seen_at: Date.now()
    })
    let lastLocalState = localState()

    const writeSignal = (type) => {
      safeSet(signalKey, JSON.stringify({ type, sender: tabId, at: Date.now(), nonce: Math.random() }))
    }

    const writeLocalState = ({ forceHeartbeat = false, refreshOnly = false } = {}) => {
      const status = activeStatus()
      const currentPath = pathRef.current
      const changed = status !== lastLocalState.status || currentPath !== lastLocalState.path
      if (changed) {
        lastLocalState = { ...lastLocalState, status, path: currentPath, changed_at: Date.now() }
      }
      lastLocalState = {
        ...lastLocalState,
        seen_at: Date.now(),
        force_heartbeat: forceHeartbeat ? createPresenceTabId() : ''
      }
      safeSet(ownStateKey, JSON.stringify(lastLocalState))
      if (isLeader && !refreshOnly && (changed || forceHeartbeat)) {
        heartbeat({ force: forceHeartbeat })
      }
      return changed
    }

    const readBrowserState = () => {
      const states = []
      const cutoff = Date.now() - LEADER_LEASE_MS
      try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index)
          if (!key?.startsWith(statePrefix)) continue
          const state = parseStoredJson(window.localStorage.getItem(key))
          if (!state?.tab_id || Number(state.seen_at || 0) < cutoff) continue
          states.push(state)
        }
      } catch {
        // Ignore an unavailable localStorage implementation and use this tab's state.
      }
      if (!states.some(state => state.tab_id === tabId)) states.push(lastLocalState)
      const online = states.some(state => state.status === 'online')
      const preferred = [...states]
        .filter(state => !online || state.status === 'online')
        .sort((a, b) => Number(b.changed_at || 0) - Number(a.changed_at || 0))[0] || lastLocalState
      return { status: online ? 'online' : 'away', path: preferred.path || pathRef.current }
    }

    const ensureMetadata = async () => {
      if (metadataRef.current) return metadataRef.current
      const currentProfile = profileRef.current?.name
        ? profileRef.current
        : await loadProfileRef.current().catch(() => null)
      const currentUser = userRef.current
      const currentSession = sessionRef.current
      const name = String(currentProfile?.name || currentUser?.name || currentUser?.email || '').trim()
      const email = String(currentUser?.email || currentSession?.user?.email || '').trim()
      metadataRef.current = {
        tab_id: tabId,
        display_name: name,
        email,
        initials: initials(name, email)
      }
      return metadataRef.current
    }

    async function heartbeat({ scheduled = false, force = false } = {}) {
      if (destroyed || suspended || !isLeader) return
      if (!ownsLeadership()) {
        stopLeader({ offline: true })
        scheduleFailover(readLeader())
        return
      }
      const browserState = readBrowserState()
      const signature = `${browserState.status}|${browserState.path}`
      if (!scheduled && !force && signature === lastSuccessfulSignature) return
      if (heartbeatInFlight) {
        if (!scheduled && (force || signature !== lastSuccessfulSignature)) pendingHeartbeat = true
        return
      }

      heartbeatInFlight = true
      try {
        const metadata = await ensureMetadata()
        const response = await apiFetch('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...metadata,
            tab_id: tabId,
            status: browserState.status,
            current_path: browserState.path
          })
        })
        if (response.ok) {
          lastSuccessfulSignature = signature
          if (destroyed || suspended || !isLeader) markTabOffline(tabId)
        }
      } catch {
        // Presence updates are best effort and retry on the next scheduled write.
      } finally {
        heartbeatInFlight = false
        if (pendingHeartbeat) {
          pendingHeartbeat = false
          heartbeat()
        }
      }
    }

    const markTabOffline = (targetTabId) => {
      if (!targetTabId || !accessToken) return
      window.fetch('/api/presence/offline', {
        method: 'POST',
        keepalive: true,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tab_id: targetTabId })
      }).catch(() => {})
    }

    const releaseLeadership = () => {
      if (readLeader()?.tab_id === tabId) safeRemove(leaderKey)
    }

    function stopLeader({ offline = false, release = false } = {}) {
      if (leaderRenewTimer) window.clearInterval(leaderRenewTimer)
      if (heartbeatTimer) window.clearInterval(heartbeatTimer)
      if (initialHeartbeatTimer) window.clearTimeout(initialHeartbeatTimer)
      leaderRenewTimer = null
      heartbeatTimer = null
      initialHeartbeatTimer = null
      const wasLeader = isLeader
      isLeader = false
      if (release) releaseLeadership()
      if (offline && wasLeader) markTabOffline(tabId)
    }

    function scheduleFailover(leader = readLeader()) {
      if (destroyed || suspended || isLeader) return
      if (failoverTimer) window.clearTimeout(failoverTimer)
      const delay = Math.max(80, Number(leader?.expires_at || 0) - Date.now() + 80)
      failoverTimer = window.setTimeout(attemptLeadership, delay)
    }

    function startLeader(previousLeaderTabId = '') {
      if (destroyed || suspended || isLeader) return
      isLeader = true
      writeLocalState({ refreshOnly: true })
      writeSignal('ping')
      if (previousLeaderTabId && previousLeaderTabId !== tabId) markTabOffline(previousLeaderTabId)
      initialHeartbeatTimer = window.setTimeout(() => heartbeat(), 120)
      heartbeatTimer = window.setInterval(() => heartbeat({ scheduled: true }), HEARTBEAT_MS)
      leaderRenewTimer = window.setInterval(() => {
        if (!ownsLeadership()) {
          stopLeader({ offline: true })
          scheduleFailover(readLeader())
          return
        }
        safeSet(leaderKey, JSON.stringify({ tab_id: tabId, expires_at: Date.now() + LEADER_LEASE_MS }))
        writeLocalState({ refreshOnly: true })
        writeSignal('ping')
      }, LEADER_RENEW_MS)
    }

    function attemptLeadership() {
      if (destroyed || suspended || isLeader) return
      const current = readLeader()
      if (current?.tab_id && current.tab_id !== tabId && Number(current.expires_at || 0) > Date.now()) {
        scheduleFailover(current)
        return
      }
      const previousLeaderTabId = current?.tab_id || ''
      const stored = safeSet(leaderKey, JSON.stringify({ tab_id: tabId, expires_at: Date.now() + LEADER_LEASE_MS }))
      if (!stored) {
        startLeader(previousLeaderTabId)
        return
      }
      if (acquisitionTimer) window.clearTimeout(acquisitionTimer)
      acquisitionTimer = window.setTimeout(() => {
        if (ownsLeadership()) startLeader(previousLeaderTabId)
        else scheduleFailover(readLeader())
      }, 60)
    }

    const stopAll = ({ logout = false } = {}) => {
      if (destroyed) return
      destroyed = true
      stopLeader({ release: true })
      if (failoverTimer) window.clearTimeout(failoverTimer)
      if (acquisitionTimer) window.clearTimeout(acquisitionTimer)
      safeRemove(ownStateKey)
      coordinatorRef.current = null
      if (!logout) writeSignal('state-removed')
    }

    const publishLocalState = ({ forceHeartbeat = false } = {}) => {
      if (destroyed || suspended) return
      writeLocalState({ forceHeartbeat })
    }

    const handleStorage = (event) => {
      if (destroyed) return
      if (event.key === PRESENCE_LOGOUT_STORAGE_KEY) {
        const message = parseStoredJson(event.newValue)
        if (message?.user_id === userId) stopAll({ logout: true })
        return
      }
      if (event.key === leaderKey) {
        const leader = parseStoredJson(event.newValue)
        if (isLeader && leader?.tab_id !== tabId) stopLeader({ offline: true })
        if (!isLeader) scheduleFailover(leader)
        return
      }
      if (event.key === signalKey) {
        const signal = parseStoredJson(event.newValue)
        if (signal?.type === 'ping' && signal.sender !== tabId) writeLocalState({ refreshOnly: true })
        return
      }
      if (event.key?.startsWith(statePrefix) && isLeader) {
        const state = parseStoredJson(event.newValue)
        heartbeat({ force: Boolean(state?.force_heartbeat) })
      }
    }

    const handleVisibilityOrFocus = () => publishLocalState()
    const handleOnline = () => publishLocalState()
    const handlePageHide = () => {
      if (destroyed || suspended) return
      suspended = true
      const wasLeader = isLeader
      stopLeader({ release: true })
      safeRemove(ownStateKey)
      writeSignal('state-removed')
      if (wasLeader) markTabOffline(tabId)
    }
    const handlePageShow = () => {
      if (destroyed || !suspended) return
      suspended = false
      lastLocalState = localState()
      writeLocalState({ refreshOnly: true })
      attemptLeadership()
    }
    const handleLogout = (event) => {
      if (!event.detail?.user_id || event.detail.user_id === userId) stopAll({ logout: true })
    }

    coordinatorRef.current = { publishLocalState }
    writeLocalState({ refreshOnly: true })
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', handleVisibilityOrFocus)
    window.addEventListener('blur', handleVisibilityOrFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener(PRESENCE_LOGOUT_EVENT, handleLogout)
    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    attemptLeadership()

    return () => {
      stopAll()
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      window.removeEventListener('blur', handleVisibilityOrFocus)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener(PRESENCE_LOGOUT_EVENT, handleLogout)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
    }
  }, [accessToken, enabled, tabId, userId])
}

function useDashboardPresenceUsers() {
  const { session } = useAuth()
  const [users, setUsers] = useState([])
  const rowsRef = useRef(new Map())
  const rawRowsReadyRef = useRef(false)
  const usersSignatureRef = useRef('[]')
  const loadInFlightRef = useRef(null)
  const eventBufferRef = useRef([])
  const activeRef = useRef(false)
  const sessionUserIdRef = useRef(session?.user?.id || '')
  const sessionUserId = session?.user?.id || ''
  const enabled = Boolean(sessionUserId)

  useEffect(() => {
    sessionUserIdRef.current = sessionUserId
  }, [sessionUserId])

  const publishRows = useCallback(() => {
    const nextUsers = aggregatePresenceTabs([...rowsRef.current.values()])
    const signature = usersSignature(nextUsers)
    if (signature === usersSignatureRef.current) return
    usersSignatureRef.current = signature
    setUsers(nextUsers)
  }, [])

  const applyRealtimeEvent = useCallback((payload) => {
    if (!payload) return
    if (payload.eventType === 'DELETE') {
      const key = tabRowKey(payload.old)
      if (key) rowsRef.current.delete(key)
    } else {
      const row = normalizePresenceTab(payload.new)
      const key = tabRowKey(row)
      if (row && key) rowsRef.current.set(key, row)
    }
    publishRows()
  }, [publishRows])

  const loadPresence = useCallback(() => {
    if (!enabled) return Promise.resolve()
    if (loadInFlightRef.current) return loadInFlightRef.current
    const startedAt = Date.now()
    const request = (async () => {
      try {
        const response = await apiFetch('/api/presence', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !activeRef.current || sessionUserIdRef.current !== sessionUserId) return
        if (Array.isArray(payload.tabs)) {
          rowsRef.current = new Map(payload.tabs.map(row => [tabRowKey(row), normalizePresenceTab(row)]).filter(([key, row]) => key && row))
          rawRowsReadyRef.current = true
          eventBufferRef.current.filter(event => event.at >= startedAt).forEach(event => applyRealtimeEvent(event.payload))
          publishRows()
        } else {
          rawRowsReadyRef.current = false
          const nextUsers = Array.isArray(payload.data) ? payload.data : []
          const signature = usersSignature(nextUsers)
          if (signature !== usersSignatureRef.current) {
            usersSignatureRef.current = signature
            setUsers(nextUsers)
          }
        }
      } catch {
        // The dashboard keeps its last known presence state on transient failures.
      }
    })().finally(() => {
      loadInFlightRef.current = null
      eventBufferRef.current = eventBufferRef.current.filter(event => event.at >= Date.now() - OFFLINE_CUTOFF_MS)
    })
    loadInFlightRef.current = request
    return request
  }, [applyRealtimeEvent, enabled, publishRows, sessionUserId])

  useEffect(() => {
    if (!enabled || !supabase) {
      activeRef.current = false
      const timer = window.setTimeout(() => {
        rowsRef.current.clear()
        rawRowsReadyRef.current = false
        usersSignatureRef.current = '[]'
        setUsers([])
      }, 0)
      return () => window.clearTimeout(timer)
    }

    let active = true
    activeRef.current = true
    let fallbackTimer = null
    let subscribedOnce = false
    const channelName = `realtime:dashboard-presence:${sessionUserId}`
    const stopFallback = () => {
      if (fallbackTimer) window.clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    const startFallback = () => {
      if (!active || fallbackTimer) return
      fallbackTimer = window.setInterval(loadPresence, FALLBACK_POLL_MS)
    }
    const handlePresenceChange = (payload) => {
      if (!active) return
      eventBufferRef.current.push({ at: Date.now(), payload })
      if (!rawRowsReadyRef.current) {
        loadPresence()
        return
      }
      applyRealtimeEvent(payload)
    }

    loadPresence()
    logRealtimeSubscribe({ name: channelName, scope: 'page', tables: ['user_presence'] })
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, handlePresenceChange)
      .subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          stopFallback()
          if (subscribedOnce) loadPresence()
          subscribedOnce = true
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startFallback()
      })
    const expirySweepTimer = window.setInterval(publishRows, LOCAL_EXPIRY_SWEEP_MS)
    const handleOffline = () => startFallback()
    window.addEventListener('offline', handleOffline)

    return () => {
      active = false
      activeRef.current = false
      stopFallback()
      window.clearInterval(expirySweepTimer)
      window.removeEventListener('offline', handleOffline)
      supabase.removeChannel(channel)
      logRealtimeRemove(channelName)
    }
  }, [applyRealtimeEvent, enabled, loadPresence, publishRows, sessionUserId])

  return enabled ? users : []
}

export function OnlineUsersProvider({ children }) {
  usePresenceHeartbeatLeader()
  return children
}

export function useOnlineUsers() {
  return useDashboardPresenceUsers()
}
