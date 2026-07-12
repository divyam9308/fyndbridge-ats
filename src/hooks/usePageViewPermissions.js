import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../services/supabaseClient'
import { PAGE_VIEW_DEFAULTS, canViewPage, firstPermittedPageRoute } from '../utils/pageViewPermissions'

const EVENT = 'fb:page-view-permissions-changed'
const state = { permissions: PAGE_VIEW_DEFAULTS, loaded: false, loading: false, request: null }
const listeners = new Set()

function emit() { listeners.forEach(listener => listener()) }

async function refreshPageViewPermissions() {
  if (state.request) return state.request
  state.loading = true
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
    .catch(() => { state.permissions = PAGE_VIEW_DEFAULTS; state.loaded = true; return state.permissions })
    .finally(() => { state.loading = false; state.request = null; emit() })
  return state.request
}

export function setPageViewPermissions(permissions) {
  state.permissions = { ...PAGE_VIEW_DEFAULTS, ...(permissions || {}) }
  state.loaded = true
  emit()
  window.dispatchEvent(new Event(EVENT))
}

export function usePageViewPermissions(access = {}) {
  const { isAdmin = false, isSuperAdmin = false } = access
  const [, rerender] = useState(0)
  useEffect(() => {
    const listener = () => rerender(value => value + 1)
    listeners.add(listener)
    if (!state.loaded) refreshPageViewPermissions()
    return () => listeners.delete(listener)
  }, [])
  const refresh = useCallback(() => refreshPageViewPermissions(), [])
  return useMemo(() => ({
    permissions: state.permissions,
    loading: state.loading || !state.loaded,
    refresh,
    canView: (pageKey) => canViewPage({ isAdmin, isSuperAdmin }, state.permissions[pageKey] || PAGE_VIEW_DEFAULTS[pageKey]),
    firstPermittedRoute: (excludedKey) => firstPermittedPageRoute({ isAdmin, isSuperAdmin }, state.permissions, excludedKey)
  }), [isAdmin, isSuperAdmin, refresh])
}
