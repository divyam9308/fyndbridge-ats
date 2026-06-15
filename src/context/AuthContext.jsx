import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabaseClient'
import { AuthContext } from './authStore'
import { useAuth } from './useAuth'

function fallbackDisplayName(user) {
  const profileName = String(user?.profile_name || '').trim()
  const metadataName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim()
  const email = String(user?.email || '').trim()
  const prefix = email.includes('@') ? email.split('@')[0] : email
  return profileName || metadataName || prefix || 'Recruiter'
}

function userToSessionUser(user) {
  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    name: fallbackDisplayName(user),
    role: 'HR Recruiter',
  }
}

function syncSessionStorage(user) {
  const sessionUser = userToSessionUser(user)

  if (sessionUser) {
    window.sessionStorage.setItem('fb_user', JSON.stringify(sessionUser))
  } else {
    window.sessionStorage.removeItem('fb_user')
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true

    async function acceptSession(nextSession) {
      const email = nextSession?.user?.email || ''

      if (!email) {
        setSession(null)
        setUser(null)
        syncSessionStorage(null)
        return false
      }

      if (!email.endsWith('@fyndbridge.in')) {
        await supabase.auth.signOut()
        setSession(null)
        setUser(null)
        syncSessionStorage(null)
        navigate('/login?error=domain', { replace: true })
        return false
      }

      let nextUser = nextSession.user
      try {
        const token = nextSession?.access_token || ''
        const params = new URLSearchParams({ user_id: nextUser.id || '', email })
        const response = await fetch(`/api/user-profiles?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        const payload = await response.json().catch(() => ({}))
        const profileName = String(payload.data?.name || '').trim()
        if (profileName) nextUser = { ...nextUser, profile_name: profileName }
      } catch {
        nextUser = { ...nextUser }
      }

      setSession(nextSession)
      setUser(nextUser)
      syncSessionStorage(nextUser)
      return true
    }

    async function initAuth() {
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data } = await supabase.auth.getSession()
      if (mounted) {
        await acceptSession(data.session)
        setLoading(false)
      }
    }

    initAuth()

    if (!supabase) {
      return () => {
        mounted = false
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!mounted) return

      if (event === 'SIGNED_OUT') {
        setSession(null)
        setUser(null)
        syncSessionStorage(null)
        navigate('/login', { replace: true })
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        await acceptSession(nextSession)
      }
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [navigate])

  useEffect(() => {
    const handleProfileNameUpdate = (event) => {
      const nextName = String(event.detail || '').trim()
      if (!nextName) return
      setUser(current => {
        if (!current) return current
        const nextUser = { ...current, profile_name: nextName }
        syncSessionStorage(nextUser)
        return nextUser
      })
    }
    window.addEventListener('fb:profile-name-updated', handleProfileNameUpdate)
    return () => window.removeEventListener('fb:profile-name-updated', handleProfileNameUpdate)
  }, [])

  const value = useMemo(() => ({
    session,
    user,
    loading,
    isAuthenticated: Boolean(session?.user),
    signOut: async () => {
      if (supabase) {
        await supabase.auth.signOut()
      } else {
        syncSessionStorage(null)
        setSession(null)
        setUser(null)
        navigate('/login', { replace: true })
      }
    },
  }), [loading, navigate, session, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function RequireAuth({ children }) {
  const { loading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (loading) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
