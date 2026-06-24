import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabaseClient'
import { API_UNAUTHORIZED_EVENT, apiFetch } from '../services/apiClient'
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
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const profileRequestRef = useRef(null)
  const navigate = useNavigate()

  const loadProfile = useCallback(async ({ force = false } = {}) => {
    if (loading || !session?.user || (!force && profile)) return profile
    if (!force && profileRequestRef.current) return profileRequestRef.current
    setProfileLoading(true)
    const request = (async () => {
      try {
      const response = await apiFetch('/api/user-profiles', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load profile.')
      const nextProfile = payload.data || null
      setProfile(nextProfile)
      const profileName = String(nextProfile?.name || '').trim()
      if (profileName) {
        setUser(current => {
          if (!current) return current
          const nextUser = { ...current, profile_name: profileName }
          syncSessionStorage(nextUser)
          return nextUser
        })
      }
      return nextProfile
      } finally {
        setProfileLoading(false)
        profileRequestRef.current = null
      }
    })()
    profileRequestRef.current = request
    return request
  }, [loading, profile, session])

  useEffect(() => {
    let mounted = true

    async function acceptSession(nextSession) {
      const email = nextSession?.user?.email || ''

      if (!email) {
        setSession(null)
        setUser(null)
        setProfile(null)
        syncSessionStorage(null)
        return false
      }

      if (!email.endsWith('@fyndbridge.in')) {
        await supabase.auth.signOut()
        setSession(null)
        setUser(null)
        setProfile(null)
        syncSessionStorage(null)
        navigate('/login?error=domain', { replace: true })
        return false
      }

      let nextUser = nextSession.user
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
        setProfile(null)
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
      setProfile(current => current ? { ...current, name: nextName } : current)
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

  useEffect(() => {
    const handleUnauthorized = async () => {
      if (supabase) await supabase.auth.signOut()
      syncSessionStorage(null)
      setSession(null)
      setUser(null)
      setProfile(null)
      navigate('/login?error=session', { replace: true })
    }
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [navigate])

  const value = useMemo(() => ({
    session,
    user,
    profile,
    profileLoading,
    loading,
    isAuthenticated: Boolean(session?.user),
    loadProfile,
    setProfile,
    signOut: async () => {
      if (supabase) {
        await supabase.auth.signOut()
      } else {
        syncSessionStorage(null)
        setSession(null)
        setUser(null)
        setProfile(null)
        navigate('/login', { replace: true })
      }
    },
  }), [loadProfile, loading, navigate, profile, profileLoading, session, user])

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
