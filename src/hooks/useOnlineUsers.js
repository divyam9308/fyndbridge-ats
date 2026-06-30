import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from './useAdminAccess'
import { supabase } from '../services/supabaseClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'

const OnlineUsersContext = createContext([])
const PRESENCE_REFRESH_MS = 25000

function createPresenceTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function initials(name, email) {
  const value = String(name || email || '').trim()
  const parts = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ').split(/\s+/) : value.split(/\s+/)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase()
}

function uniqueUsers(state) {
  const tabsByUser = new Map()
  const users = new Map()
  Object.entries(state || {}).forEach(([key, presences]) => {
    for (const presence of presences || []) {
      const userId = presence.user_id || key
      if (!userId) continue
      const status = presence.status === 'away' ? 'away' : 'online'
      const tabId = presence.tab_id || presence.phx_ref || presence.presence_ref || `${userId}:${presence.online_at || ''}`
      const userTabs = tabsByUser.get(userId) || new Map()
      const previousTab = userTabs.get(tabId)
      if (!previousTab || String(presence.online_at || '') >= String(previousTab.online_at || '')) {
        userTabs.set(tabId, { ...presence, id: userId, user_id: userId, status })
        tabsByUser.set(userId, userTabs)
      }
    }
  })

  tabsByUser.forEach((tabs, userId) => {
    const tabPresences = [...tabs.values()]
    const latest = tabPresences.reduce((best, presence) => (
      !best || String(presence.online_at || '') > String(best.online_at || '') ? presence : best
    ), null)
    if (!latest) return
    users.set(userId, {
      ...latest,
      id: userId,
      user_id: userId,
      status: tabPresences.some(presence => presence.status === 'online') ? 'online' : 'away'
    })
  })

  return [...users.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''))
  })
}

function usePresenceUsers() {
  const { user, session, profile, loadProfile } = useAuth()
  const { isAdmin, isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const [onlineUsers, setOnlineUsers] = useState([])
  const loadProfileRef = useRef(loadProfile)
  const tabIdRef = useRef(createPresenceTabId())
  const enabled = Boolean(supabase && session?.user && user?.id)
  const profileName = String(profile?.name || '').trim()
  const profileRole = profile?.role
  const profileDesignation = profile?.designation

  useEffect(() => {
    loadProfileRef.current = loadProfile
  }, [loadProfile])

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    let channel
    let openTimer
    let refreshTimer
    let lastTrackedStatus = ''
    let lastTrackedAt = 0
    const isActive = () => document.visibilityState === 'visible' && document.hasFocus()

    async function start() {
      const savedProfile = profileName ? { name: profileName, role: profileRole, designation: profileDesignation } : await loadProfileRef.current().catch(() => null)
      if (cancelled) return

      const name = String(savedProfile?.name || '').trim()
      if (!name) return
      const email = String(user.email || session.user.email || '').trim()
      const presenceBase = {
        user_id: user.id,
        id: user.id,
        tab_id: tabIdRef.current,
        name,
        email,
        role: isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : String(savedProfile?.role || savedProfile?.designation || 'Consultant'),
        initials: initials(name, email)
      }
      const presence = (status = 'online') => ({ ...presenceBase, online_at: new Date().toISOString(), status })

      const stop = () => {
        const current = channel
        channel = undefined
        window.clearInterval(refreshTimer)
        setOnlineUsers([])
        if (current) {
          current.untrack().catch(() => {})
          supabase.removeChannel(current)
          logRealtimeRemove('presence:online-users')
        }
      }
      const trackStatus = (status) => {
        const current = channel
        if (!current) return
        const now = Date.now()
        if (status === lastTrackedStatus && now - lastTrackedAt < 10000) return
        lastTrackedStatus = status
        lastTrackedAt = now
        current.track(presence(status)).then(result => {
          if (result === 'ok' && !cancelled && channel === current) setOnlineUsers(uniqueUsers(current.presenceState()))
        }).catch(stop)
      }
      const open = () => {
        if (cancelled || channel) return
        logRealtimeSubscribe({ name: 'presence:online-users', scope: 'global', tables: ['presence'] })
        const current = supabase.channel('online-users', { config: { presence: { key: tabIdRef.current } } })
        channel = current
        const sync = () => {
          if (!cancelled && channel === current) setOnlineUsers(uniqueUsers(current.presenceState()))
        }
        current
          .on('presence', { event: 'sync' }, sync)
          .on('presence', { event: 'join' }, sync)
          .on('presence', { event: 'leave' }, sync)
          .subscribe(status => {
            if (cancelled || channel !== current) return
            if (status === 'SUBSCRIBED') {
              current.track(presence(isActive() ? 'online' : 'away')).then(result => {
                if (result === 'ok') sync()
                else stop()
              }).catch(stop)
              window.clearInterval(refreshTimer)
              refreshTimer = window.setInterval(() => {
                if (!cancelled && channel === current) trackStatus(isActive() ? 'online' : 'away')
              }, PRESENCE_REFRESH_MS)
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              stop()
            }
          })
      }
      const ensureOpen = () => {
        window.clearTimeout(openTimer)
        openTimer = window.setTimeout(open, 0)
      }
      const updateActivity = () => {
        if (!channel) {
          ensureOpen()
          return
        }
        trackStatus(isActive() ? 'online' : 'away')
      }

      document.addEventListener('visibilitychange', updateActivity)
      window.addEventListener('focus', updateActivity)
      window.addEventListener('blur', updateActivity)
      window.addEventListener('pageshow', updateActivity)
      window.addEventListener('pagehide', stop)
      window.addEventListener('beforeunload', stop)
      window.addEventListener('mousemove', updateActivity, { passive: true })
      window.addEventListener('keydown', updateActivity)
      window.addEventListener('pointerdown', updateActivity, { passive: true })
      open()

      return () => {
        window.clearTimeout(openTimer)
        window.clearInterval(refreshTimer)
        document.removeEventListener('visibilitychange', updateActivity)
        window.removeEventListener('focus', updateActivity)
        window.removeEventListener('blur', updateActivity)
        window.removeEventListener('pageshow', updateActivity)
        window.removeEventListener('pagehide', stop)
        window.removeEventListener('beforeunload', stop)
        window.removeEventListener('mousemove', updateActivity)
        window.removeEventListener('keydown', updateActivity)
        window.removeEventListener('pointerdown', updateActivity)
        stop()
      }
    }

    let cleanup
    start().then(result => {
      cleanup = result
      if (cancelled) cleanup?.()
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [enabled, isAdmin, isSuperAdmin, profileDesignation, profileName, profileRole, session?.user?.email, user?.email, user?.id])

  return enabled ? onlineUsers : []
}

export function OnlineUsersProvider({ children }) {
  return createElement(OnlineUsersContext.Provider, { value: usePresenceUsers() }, children)
}

export function useOnlineUsers() {
  return useContext(OnlineUsersContext)
}
