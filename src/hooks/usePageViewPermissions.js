import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import { PAGE_VIEW_DEFAULTS, INDIVIDUAL_ACCESS_KEYS, canViewPage, firstPermittedPageRoute } from '../utils/pageViewPermissions'
import { useAuth } from '../context/useAuth'

const EVENT = 'fb:page-view-permissions-changed'
const state = { permissions: PAGE_VIEW_DEFAULTS, consultantAccess: {}, loaded: false, loading: false, request: null, userId: '', error: '' }
const listeners = new Set()

function emit() { listeners.forEach(listener => listener()) }

function resetPageViewState(userId) {
  if (state.userId === userId) return
  state.userId = userId
  state.permissions = PAGE_VIEW_DEFAULTS
  state.consultantAccess = {}
  state.loaded = false
  state.loading = Boolean(userId)
  state.request = null
  state.error = ''
  emit()
}

async function refreshPageViewPermissions(force = false) {
  if (state.request) return state.request
  if (state.loaded && !force) return state.permissions
  // Background refresh must preserve open forms; first load still blocks access.
  state.loading = !state.loaded
  state.error = ''
  emit()
  const requestUser = state.userId
  const request = supabase
    ? supabase.from('page_view_permissions').select('page_key, view_permission, allowed_user_ids')
    : Promise.resolve({ data: [], error: null })
  state.request = Promise.resolve(request)
    .then(({ data, error }) => {
      if (requestUser !== state.userId) return state.permissions
      if (error) throw error
      const permissions = Object.fromEntries((data || []).map(row => [row.page_key, row.view_permission]))
      state.permissions = { ...PAGE_VIEW_DEFAULTS, ...permissions }
      state.consultantAccess = Object.fromEntries((data || []).filter(row=>INDIVIDUAL_ACCESS_KEYS.includes(row.page_key)).map(row => [row.page_key, row.allowed_user_ids || []]))
      state.loaded = true
      return state.permissions
    })
    .catch((error) => { if (requestUser !== state.userId) return state.permissions; state.consultantAccess = {}; state.permissions = PAGE_VIEW_DEFAULTS; state.loaded = true; state.error = error.message || 'Unable to load page permissions.'; return state.permissions })
    .finally(() => { if (requestUser !== state.userId) return; state.loading = false; state.request = null; emit() })
  return state.request
}

export function setPageViewPermissions(permissions, consultantAccess = state.consultantAccess) {
  state.permissions = { ...PAGE_VIEW_DEFAULTS, ...(permissions || {}) }
  state.consultantAccess = consultantAccess || {}
  state.loaded = true
  state.error = ''
  emit()
  window.dispatchEvent(new Event(EVENT))
}

export function usePageViewPermissions(access = {}) {
  const { isAdmin = false, isSuperAdmin = false } = access
  const [, rerender] = useState(0)
  const { isAuthenticated, loading: authLoading, session } = useAuth()
  const userId = session?.user?.id || ''
  useEffect(() => {
    const listener = () => rerender(value => value + 1)
    listeners.add(listener)
    resetPageViewState(userId)
    if (isAuthenticated && !authLoading && !state.loaded) refreshPageViewPermissions()
    return () => listeners.delete(listener)
  }, [authLoading, isAuthenticated, userId])
  useEffect(() => {
    if (!isAuthenticated || authLoading) return
    const refreshOnFocus = () => refreshPageViewPermissions(true)
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [isAuthenticated, authLoading])
  const refresh = useCallback(() => refreshPageViewPermissions(true), [])
  return {
    permissions: state.permissions,
    consultantAccess: state.consultantAccess,
    loading: authLoading || (isAuthenticated && (state.loading || !state.loaded)),
    error: state.error,
    refresh,
    canView: (pageKey) => !(pageKey === 'crm' && state.error) && canViewPage({ isAdmin, isSuperAdmin, userId }, state.permissions[pageKey] || PAGE_VIEW_DEFAULTS[pageKey], state.consultantAccess[pageKey] || []),
    firstPermittedRoute: (excludedKey) => firstPermittedPageRoute({ isAdmin, isSuperAdmin, userId }, state.permissions, excludedKey, state.consultantAccess)
  }
}
