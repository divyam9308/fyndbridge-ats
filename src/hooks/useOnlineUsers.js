import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { fetchAdminMe } from '../services/adminAccessApi'
import { supabase } from '../services/supabaseClient'

function initials(name, email) {
  const value = String(name || email || '').trim()
  if (!value) return 'U'
  const source = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ') : value
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0].slice(0, 2)).toUpperCase()
}

function uniqueUsers(state) {
  const users = new Map()
  Object.entries(state || {}).forEach(([key, presences]) => {
    for (const presence of presences || []) {
      const userId = presence.user_id || key
      if (!userId) continue
      const existing = users.get(userId)
      if (!existing || String(presence.online_at || '') > String(existing.online_at || '')) {
        users.set(userId, {
          ...presence,
          id: userId,
          user_id: userId,
          status: 'online'
        })
      }
    }
  })
  return [...users.values()].sort((a, b) => {
    return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''))
  })
}

const OnlineUsersContext = createContext([])

function usePresenceUsers() {
  const { user, session, profile, loadProfile } = useAuth()
  const [onlineUsers, setOnlineUsers] = useState([])
  const enabled = Boolean(supabase && session?.user && user?.id)
  const loadProfileRef = useRef(loadProfile)
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
    let subscribed = false
    let tracked = false
    let desiredPresence = false
    let reconciling = false
    let activityTimer
    let retryTimer
    let retryCount = 0

    const isPageActive = () => document.visibilityState === 'visible' && document.hasFocus()

    async function connect() {
      const [savedProfile, admin] = await Promise.all([
        profileName
          ? Promise.resolve({ name: profileName, role: profileRole, designation: profileDesignation })
          : loadProfileRef.current().catch(() => null),
        fetchAdminMe().catch(() => null)
      ])
      if (cancelled) return

      const email = String(user.email || session.user.email || '').trim()
      const name = String(savedProfile?.name || '').trim()
      if (!name) return
      const role = admin?.isSuperAdmin ? 'Super Admin' : admin?.isAdmin ? 'Admin' : String(savedProfile?.role || savedProfile?.designation || 'Consultant')
      const currentUser = {
        user_id: user.id,
        id: user.id,
        name,
        email,
        role,
        initials: initials(name, email),
        online_at: new Date().toISOString(),
        status: 'online'
      }

      channel = supabase.channel('online-users', {
        config: { presence: { key: user.id } }
      })
      const sync = () => {
        if (!cancelled) setOnlineUsers(uniqueUsers(channel.presenceState()))
      }
      const reconcilePresence = async () => {
        if (!subscribed || reconciling || cancelled) return
        reconciling = true
        while (!cancelled && subscribed && desiredPresence !== tracked) {
          const shouldTrack = desiredPresence
          try {
            const result = shouldTrack ? await channel.track(currentUser) : await channel.untrack()
            if (result !== 'ok') throw new Error('Presence update failed')
            tracked = shouldTrack
            retryCount = 0
            sync()
          } catch {
            tracked = !shouldTrack
            if (retryCount++ < 3) {
              window.clearTimeout(retryTimer)
              retryTimer = window.setTimeout(reconcilePresence, 500)
            }
            break
          }
        }
        reconciling = false
      }
      const updatePresence = (forceOffline = false) => {
        desiredPresence = !forceOffline && isPageActive()
        reconcilePresence()
      }
      const handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible') {
          updatePresence(true)
          return
        }
        tracked = false
        window.clearTimeout(activityTimer)
        window.clearTimeout(retryTimer)
        activityTimer = window.setTimeout(updatePresence, 0)
      }
      const handleFocus = () => {
        tracked = false
        desiredPresence = document.visibilityState === 'visible'
        reconcilePresence()
      }
      const handleBlur = () => updatePresence(true)
      const handleExit = () => updatePresence(true)

      channel
        .on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(async (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            subscribed = true
            updatePresence()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            subscribed = false
            tracked = false
            setOnlineUsers([])
          }
        })

      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', handleFocus)
      window.addEventListener('blur', handleBlur)
      window.addEventListener('pagehide', handleExit)
      window.addEventListener('beforeunload', handleExit)

      return () => {
        window.clearTimeout(activityTimer)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('focus', handleFocus)
        window.removeEventListener('blur', handleBlur)
        window.removeEventListener('pagehide', handleExit)
        window.removeEventListener('beforeunload', handleExit)
        desiredPresence = false
        if (subscribed && tracked) channel.untrack().catch(() => {})
      }
    }

    let disconnect
    connect().then(cleanup => {
      disconnect = cleanup
      if (cancelled) disconnect?.()
    })
    return () => {
      cancelled = true
      disconnect?.()
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [enabled, profileDesignation, profileName, profileRole, session?.user?.email, user?.email, user?.id])

  return enabled ? onlineUsers : []
}

export function OnlineUsersProvider({ children }) {
  const onlineUsers = usePresenceUsers()
  return createElement(OnlineUsersContext.Provider, { value: onlineUsers }, children)
}

export function useOnlineUsers() {
  return useContext(OnlineUsersContext)
}
