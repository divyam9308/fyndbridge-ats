import { useEffect, useState } from 'react'
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

function uniqueUsers(state, currentUser) {
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
  if (currentUser && !users.has(currentUser.user_id)) users.set(currentUser.user_id, currentUser)
  return [...users.values()].sort((a, b) => {
    if (a.user_id === currentUser?.user_id) return -1
    if (b.user_id === currentUser?.user_id) return 1
    return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''))
  })
}

export function useOnlineUsers() {
  const { user, session, profile, loadProfile } = useAuth()
  const [onlineUsers, setOnlineUsers] = useState([])
  const enabled = Boolean(supabase && session?.user && user?.id)

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    let channel

    async function connect() {
      const [savedProfile, admin] = await Promise.all([profile ? Promise.resolve(profile) : loadProfile().catch(() => null), fetchAdminMe().catch(() => null)])
      if (cancelled) return

      const email = String(user.email || session.user.email || '').trim()
      const emailName = email.includes('@') ? email.split('@')[0] : email
      const name = String(savedProfile?.name || '').trim() || emailName || 'User'
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

      setOnlineUsers([currentUser])
      channel = supabase.channel('online-users', {
        config: { presence: { key: user.id } }
      })
      const sync = () => {
        if (!cancelled) setOnlineUsers(uniqueUsers(channel.presenceState(), currentUser))
      }

      channel
        .on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(async (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            await channel.track(currentUser)
            sync()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setOnlineUsers([currentUser])
          }
        })
    }

    connect()
    return () => {
      cancelled = true
      if (channel) {
        channel.untrack().catch(() => {})
        supabase.removeChannel(channel)
      }
    }
  }, [enabled, loadProfile, profile, session, user?.email, user?.id])

  return enabled ? onlineUsers : []
}
