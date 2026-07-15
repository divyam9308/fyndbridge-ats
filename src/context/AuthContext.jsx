import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabaseClient'
import { API_INACTIVE_EVENT, API_UNAUTHORIZED_EVENT, apiFetch } from '../services/apiClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'
import { AuthContext } from './authStore'
import { useAuth } from './useAuth'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'
import AuthenticatedShellSkeleton from '../components/AuthenticatedShellSkeleton'
import { preloadAuthenticatedRoute } from '../utils/routePreload'
import { clearPresenceBeforeLogout } from '../services/presenceSession'

const DEACTIVATION_MESSAGE = 'Your account has been deactivated. Please contact an administrator.'
const STATUS_EVENT = 'fb:employee-status-changed'

function fallbackDisplayName(user) {
  const profileName = String(user?.profile_name || '').trim()
  const metadataName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim()
  const email = String(user?.email || '').trim()
  const prefix = email.includes('@') ? email.split('@')[0] : email
  return profileName || metadataName || prefix || 'Recruiter'
}

function userToSessionUser(user) {
  if (!user) return null
  return { id: user.id, email: user.email, name: fallbackDisplayName(user), role: 'HR Recruiter' }
}

function syncSessionStorage(user) {
  const sessionUser = userToSessionUser(user)
  if (sessionUser) window.sessionStorage.setItem('fb_user', JSON.stringify(sessionUser))
  else window.sessionStorage.removeItem('fb_user')
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [employmentStatus, setEmploymentStatus] = useState(null)
  const [employmentStatusLoading, setEmploymentStatusLoading] = useState(true)
  const [employmentStatusError, setEmploymentStatusError] = useState('')
  const [employmentStatusByUserId, setEmploymentStatusByUserId] = useState({})
  const [accountNotice, setAccountNotice] = useState('')
  const profileRequestRef = useRef(null)
  const statusCheckedUserRef = useRef('')
  const inactiveLogoutRef = useRef(false)
  const navigate = useNavigate()

  const registerEmploymentStatuses = useCallback((rows) => {
    const values = Array.isArray(rows) ? rows : [rows]
    setEmploymentStatusByUserId((current) => {
      let changed = false
      const next = { ...current }
      for (const row of values) {
        const userId = String(row?.user_id || row?.id || '').trim()
        const status = row?.status
        if (!userId || !['active', 'on_leave', 'inactive'].includes(status) || next[userId] === status) continue
        next[userId] = status
        changed = true
      }
      return changed ? next : current
    })
  }, [])

  const clearAuthState = useCallback(() => {
    setSession(null)
    setUser(null)
    setProfile(null)
    setEmploymentStatus(null)
    setEmploymentStatusByUserId({})
    syncSessionStorage(null)
  }, [])

  const deactivateAccount = useCallback(async (userId = '') => {
    if (inactiveLogoutRef.current) return
    inactiveLogoutRef.current = true
    const changed = { user_id: userId, status: 'inactive' }
    setAccountNotice(DEACTIVATION_MESSAGE)
    setEmploymentStatus('inactive')
    registerEmploymentStatuses(changed)
    window.sessionStorage.setItem('fb_login_message', DEACTIVATION_MESSAGE)
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: changed }))
    await clearPresenceBeforeLogout(userId)
    if (supabase) await supabase.auth.signOut().catch(() => null)
    clearAuthState()
    navigate('/login?error=inactive', { replace: true })
  }, [clearAuthState, navigate, registerEmploymentStatuses])

  const checkEmploymentStatus = useCallback(async (nextSession) => {
    const userId = nextSession?.user?.id || ''
    if (!userId) return false
    setEmploymentStatusLoading(true)
    setEmploymentStatusError('')
    try {
      const response = await window.fetch('/api/auth/employment-status', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${nextSession.access_token}` }
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to validate account status.')
      const result = payload.data || {}
      const status = result.profile_complete ? result.status || 'active' : null
      setEmploymentStatus(status)
      if (status) registerEmploymentStatuses({ user_id: userId, status })
      if (status === 'inactive') {
        await deactivateAccount(userId)
        return false
      }
      setAccountNotice('')
      return true
    } catch (error) {
      setEmploymentStatusError(error.message || 'Unable to validate account status.')
      return false
    } finally {
      setEmploymentStatusLoading(false)
    }
  }, [deactivateAccount, registerEmploymentStatuses])

  const retryEmploymentStatus = useCallback(() => checkEmploymentStatus(session), [checkEmploymentStatus, session])

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
          setUser((current) => {
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
        clearAuthState()
        setEmploymentStatusLoading(false)
        return false
      }
      if (!email.endsWith('@fyndbridge.in')) {
        await supabase.auth.signOut()
        clearAuthState()
        navigate('/login?error=domain', { replace: true })
        return false
      }
      inactiveLogoutRef.current = false
      setSession(nextSession)
      setUser(nextSession.user)
      syncSessionStorage(nextSession.user)
      if (statusCheckedUserRef.current !== nextSession.user.id) {
        statusCheckedUserRef.current = nextSession.user.id
        return checkEmploymentStatus(nextSession)
      }
      return true
    }

    async function initAuth() {
      if (!supabase) {
        setEmploymentStatusLoading(false)
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
    if (!supabase) return () => { mounted = false }

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        const inactive = inactiveLogoutRef.current
        statusCheckedUserRef.current = ''
        clearAuthState()
        navigate(inactive ? '/login?error=inactive' : '/login', { replace: true })
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
  }, [checkEmploymentStatus, clearAuthState, navigate])

  useEffect(() => {
    if (!supabase || !session?.user?.id || employmentStatusLoading || employmentStatusError) return undefined
    const channelName = 'global:employee-statuses'
    const handleChange = (payload) => {
      const changed = payload.new
      if (!changed?.user_id || !changed?.status) return
      registerEmploymentStatuses(changed)
      window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: changed }))
      if (changed.user_id !== session.user.id) return
      setEmploymentStatus(changed.status)
      if (changed.status === 'inactive') deactivateAccount(changed.user_id)
    }
    logRealtimeSubscribe({ name: channelName, scope: 'global', tables: ['employee_statuses'] })
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_statuses' }, handleChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employee_statuses' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      logRealtimeRemove(channelName)
    }
  }, [deactivateAccount, employmentStatusError, employmentStatusLoading, registerEmploymentStatuses, session?.user?.id])

  useEffect(() => {
    const handleProfileNameUpdate = (event) => {
      const nextName = String(event.detail || '').trim()
      if (!nextName) return
      setProfile((current) => current ? { ...current, name: nextName } : current)
      setUser((current) => {
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
      if (inactiveLogoutRef.current) return
      if (supabase) await supabase.auth.signOut()
      clearAuthState()
      navigate('/login?error=session', { replace: true })
    }
    const handleInactive = () => deactivateAccount(session?.user?.id)
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized)
    window.addEventListener(API_INACTIVE_EVENT, handleInactive)
    return () => {
      window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized)
      window.removeEventListener(API_INACTIVE_EVENT, handleInactive)
    }
  }, [clearAuthState, deactivateAccount, navigate, session?.user?.id])

  const value = useMemo(() => ({
    session,
    user,
    profile,
    profileLoading,
    loading: loading || Boolean(session?.user && employmentStatusLoading),
    isAuthenticated: Boolean(session?.user),
    employmentStatus,
    employmentStatusError,
    employmentStatusByUserId,
    registerEmploymentStatuses,
    retryEmploymentStatus,
    loadProfile,
    setProfile,
    signOut: async () => {
      inactiveLogoutRef.current = false
      await clearPresenceBeforeLogout(session?.user?.id || user?.id || '')
      if (supabase) await supabase.auth.signOut()
      else {
        clearAuthState()
        navigate('/login', { replace: true })
      }
    }
  }), [clearAuthState, employmentStatus, employmentStatusByUserId, employmentStatusError, employmentStatusLoading, loadProfile, loading, navigate, profile, profileLoading, registerEmploymentStatuses, retryEmploymentStatus, session, user])

  return (
    <AuthContext.Provider value={value}>
      {accountNotice && <div className="global-account-notice" role="alert">{accountNotice}</div>}
      {children}
    </AuthContext.Provider>
  )
}

export function RequireAuth({ children }) {
  const { loading, isAuthenticated, employmentStatusError, retryEmploymentStatus, profile, profileLoading, loadProfile, session } = useAuth()
  const adminAccess = useAdminAccess({ loadPermissions: false })
  const pageViews = usePageViewPermissions({ isAdmin: adminAccess.isAdmin, isSuperAdmin: adminAccess.isSuperAdmin })
  const location = useLocation()
  const initialRouteRef = useRef(location.pathname)
  const [initialRouteReady, setInitialRouteReady] = useState(false)
  const [profileReadyUserId, setProfileReadyUserId] = useState('')
  const [profileError, setProfileError] = useState('')

  useEffect(() => {
    let active = true
    preloadAuthenticatedRoute(initialRouteRef.current).then(() => {
      if (active) setInitialRouteReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const userId = session?.user?.id || ''
    if (!isAuthenticated || loading) return undefined
    if (profile) {
      Promise.resolve().then(() => setProfileReadyUserId(userId))
      return undefined
    }
    let active = true
    loadProfile()
      .then(() => { if (active) setProfileReadyUserId(userId) })
      .catch(error => { if (active) setProfileError(error.message || 'Unable to load your profile.') })
    return () => { active = false }
  }, [isAuthenticated, loadProfile, loading, profile, session?.user?.id])

  const retryAuthorization = async () => {
    setProfileError('')
    try {
      await Promise.all([loadProfile({ force: true }), adminAccess.refresh(), pageViews.refresh()])
      setProfileReadyUserId(session?.user?.id || '')
    } catch (error) {
      setProfileError(error.message || 'Unable to load authorization.')
    }
  }

  if (loading) return <AuthenticatedShellSkeleton />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (employmentStatusError) {
    return (
      <div className="route-loading employment-status-error" role="alert">
        <span>{employmentStatusError}</span>
        <button type="button" onClick={retryEmploymentStatus}>Retry</button>
      </div>
    )
  }
  if (profileError || adminAccess.error || pageViews.error) {
    return <div className="route-loading employment-status-error" role="alert"><span>{profileError || adminAccess.error || pageViews.error}</span><button type="button" onClick={retryAuthorization}>Retry</button></div>
  }
  const profileReady = Boolean(profile && profileReadyUserId && profileReadyUserId === session?.user?.id)
  if (profileLoading || !profileReady || adminAccess.loading || pageViews.loading || !initialRouteReady) return <AuthenticatedShellSkeleton />
  return children
}
