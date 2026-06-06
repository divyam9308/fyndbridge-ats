import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabaseClient'
import { AuthContext } from './authStore'
import { useAuth } from './useAuth'

function userToSessionUser(user) {
  if (!user) return null

  const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Recruiter'

  return {
    id: user.id,
    email: user.email,
    name: fullName,
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

async function upsertUserProfile(user) {
  if (!supabase || !user?.email) return

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || user.email.split('@')[0],
  }, { onConflict: 'id' })

  if (error) {
    console.error('upsertUserProfile:', error.message)
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

      setSession(nextSession)
      setUser(nextSession.user)
      syncSessionStorage(nextSession.user)
      await upsertUserProfile(nextSession.user)
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
