import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import { PAGE_VIEW_DEFAULTS, canViewPage, firstPermittedPageRoute } from '../utils/pageViewPermissions'
import { useAuth } from '../context/useAuth'

const EVENT = 'fb:page-view-permissions-changed'
const state = { permissions: PAGE_VIEW_DEFAULTS, loaded: false, loading: false, request: null, userId: '', error: '' }
const listeners = new Set()

function emit() { listeners.forEach(listener => listener()) }

function resetPageViewState(userId) {
  if (state.userId === userId) return
  state.userId = userId
  state.permissions = PAGE_VIEW_DEFAULTS
  state.loaded = false
  state.loading = Boolean(userId)
  state.request = null
  state.error = ''
  emit()
}

async function refreshPageViewPermissions(force = false) {
  if (state.request) return state.request
  if (state.loaded && !force) return state.permissions
  state.loading = true
  state.error = ''
  emit()
  const request = supabase
    ? supabase.from('page_view_permissions').select('page_key, view_permission')
    : Promise.resolve({ data: [], error: null })
  state.request = Promise.resolve(request)
    .then(({ data, error }) => {
      if (error) throw error
      const permissions = Object.fromEntries((data || []).map(row => [row.page_key, row.view_permission]))
      state.permissions = { ...PAGE_VIEW_DEFAULTS, ...permissions }
      state.loaded = true
      return state.permissions
    })
    .catch((error) => { state.permissions = PAGE_VIEW_DEFAULTS; state.loaded = true; state.error = error.message || 'Unable to load page permissions.'; return state.permissions })
    .finally(() => { state.loading = false; state.request = null; emit() })
  return state.request
}

export function setPageViewPermissions(permissions) {
  state.permissions = { ...PAGE_VIEW_DEFAULTS, ...(permissions || {}) }
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
  const refresh = useCallback(() => refreshPageViewPermissions(true), [])
  return {
    permissions: state.permissions,
    loading: authLoading || (isAuthenticated && (state.loading || !state.loaded)),
    error: state.error,
    refresh,
    canView: (pageKey) => canViewPage({ isAdmin, isSuperAdmin }, state.permissions[pageKey] || PAGE_VIEW_DEFAULTS[pageKey]),
    firstPermittedRoute: (excludedKey) => firstPermittedPageRoute({ isAdmin, isSuperAdmin }, state.permissions, excludedKey)
  }
}
