import { createContext, createElement, useContext, useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    let channel
    let subscribed = false
    let tracked = false
    let desiredPresence = false
    let reconciling = false

    const isPageActive = () => document.visibilityState === 'visible' && document.hasFocus()

    async function connect() {
      const [savedProfile, admin] = await Promise.all([profile ? Promise.resolve(profile) : loadProfile().catch(() => null), fetchAdminMe().catch(() => null)])
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
          try {
            if (desiredPresence) await channel.track(currentUser)
            else await channel.untrack()
            tracked = desiredPresence
            sync()
          } catch {
            break
          }
        }
        reconciling = false
      }
      const updatePresence = (forceOffline = false) => {
        desiredPresence = !forceOffline && isPageActive()
        reconcilePresence()
      }
      const handlePageState = () => updatePresence()
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

      document.addEventListener('visibilitychange', handlePageState)
      window.addEventListener('focus', handlePageState)
      window.addEventListener('blur', handlePageState)
      window.addEventListener('pagehide', handleExit)
      window.addEventListener('beforeunload', handleExit)

      return () => {
        document.removeEventListener('visibilitychange', handlePageState)
        window.removeEventListener('focus', handlePageState)
        window.removeEventListener('blur', handlePageState)
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
  }, [enabled, loadProfile, profile, session, user?.email, user?.id])

  return enabled ? onlineUsers : []
}

export function OnlineUsersProvider({ children }) {
  const onlineUsers = usePresenceUsers()
  return createElement(OnlineUsersContext.Provider, { value: onlineUsers }, children)
}

export function useOnlineUsers() {
  return useContext(OnlineUsersContext)
}
