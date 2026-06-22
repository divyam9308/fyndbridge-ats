import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { fetchAdminMe } from '../services/adminAccessApi'
import { supabase } from '../services/supabaseClient'

const OnlineUsersContext = createContext([])

function initials(name, email) {
  const value = String(name || email || '').trim()
  const parts = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ').split(/\s+/) : value.split(/\s+/)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase()
}

function uniqueUsers(state) {
  const users = new Map()
  Object.entries(state || {}).forEach(([key, presences]) => {
    for (const presence of presences || []) {
      const userId = presence.user_id || key
      const previous = users.get(userId)
      if (userId && (!previous || String(presence.online_at || '') > String(previous.online_at || ''))) {
        users.set(userId, { ...presence, id: userId, user_id: userId, status: 'online' })
      }
    }
  })
  return [...users.values()].sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')))
}

function usePresenceUsers() {
  const { user, session, profile, loadProfile } = useAuth()
  const [onlineUsers, setOnlineUsers] = useState([])
  const loadProfileRef = useRef(loadProfile)
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
    let restoreTimer
    const isActive = () => document.visibilityState === 'visible' && document.hasFocus()

    async function start() {
      const [savedProfile, admin] = await Promise.all([
        profileName ? Promise.resolve({ name: profileName, role: profileRole, designation: profileDesignation }) : loadProfileRef.current().catch(() => null),
        fetchAdminMe().catch(() => null)
      ])
      if (cancelled) return

      const name = String(savedProfile?.name || '').trim()
      if (!name) return
      const email = String(user.email || session.user.email || '').trim()
      const presence = {
        user_id: user.id,
        id: user.id,
        name,
        email,
        role: admin?.isSuperAdmin ? 'Super Admin' : admin?.isAdmin ? 'Admin' : String(savedProfile?.role || savedProfile?.designation || 'Consultant'),
        initials: initials(name, email),
        online_at: new Date().toISOString(),
        status: 'online'
      }

      const stop = () => {
        const current = channel
        channel = undefined
        setOnlineUsers([])
        if (current) {
          current.untrack().catch(() => {})
          supabase.removeChannel(current)
        }
      }
      const open = () => {
        if (cancelled || channel || !isActive()) return
        const current = supabase.channel('online-users', { config: { presence: { key: user.id } } })
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
              current.track({ ...presence, online_at: new Date().toISOString() }).then(result => {
                if (result === 'ok') sync()
                else stop()
              }).catch(stop)
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              stop()
            }
          })
      }
      const restore = () => {
        window.clearTimeout(restoreTimer)
        restoreTimer = window.setTimeout(open, 0)
      }
      const hide = () => {
        window.clearTimeout(restoreTimer)
        stop()
      }
      const visibility = () => document.visibilityState === 'visible' ? restore() : hide()

      document.addEventListener('visibilitychange', visibility)
      window.addEventListener('focus', restore)
      window.addEventListener('blur', hide)
      window.addEventListener('pagehide', hide)
      window.addEventListener('beforeunload', hide)
      open()

      return () => {
        window.clearTimeout(restoreTimer)
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('focus', restore)
        window.removeEventListener('blur', hide)
        window.removeEventListener('pagehide', hide)
        window.removeEventListener('beforeunload', hide)
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
  }, [enabled, profileDesignation, profileName, profileRole, session?.user?.email, user?.email, user?.id])

  return enabled ? onlineUsers : []
}

export function OnlineUsersProvider({ children }) {
  return createElement(OnlineUsersContext.Provider, { value: usePresenceUsers() }, children)
}

export function useOnlineUsers() {
  return useContext(OnlineUsersContext)
}
