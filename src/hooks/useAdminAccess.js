import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminMe, fetchColumnPermissions } from '../services/adminAccessApi'
import { invalidateApiJsonCache } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'

const EMPTY = { clients: {}, candidates: {}, jobs: {} }
const PERMISSIONS_CHANGED_EVENT = 'fb:admin-permissions-changed'

const state = {
  isAdmin: false,
  isSuperAdmin: false,
  role: null,
  loadingAdmin: true,
  loadingPermissions: true,
  columns: {},
  permissions: EMPTY,
  adminRequest: null,
  permissionRequest: null,
  adminLoaded: false,
  permissionsLoaded: false,
  adminChannel: null,
  permissionChannel: null,
}
const listeners = new Set()

function emit() {
  listeners.forEach(listener => listener())
}

async function refreshAdminStatus() {
  if (state.adminRequest) return state.adminRequest
  state.loadingAdmin = true
  emit()
  state.adminRequest = (async () => {
    try {
      const me = await fetchAdminMe()
      state.isSuperAdmin = Boolean(me.isSuperAdmin)
      state.isAdmin = Boolean(me.isAdmin)
      state.role = me.role || null
      state.adminLoaded = true
      return me
    } catch {
      state.isAdmin = false
      state.isSuperAdmin = false
      state.role = null
      state.adminLoaded = true
      return null
    } finally {
      state.loadingAdmin = false
      state.adminRequest = null
      emit()
    }
  })()
  return state.adminRequest
}

async function refreshPermissions() {
  if (state.permissionRequest) return state.permissionRequest
  state.loadingPermissions = true
  emit()
  state.permissionRequest = (async () => {
    try {
      const data = await fetchColumnPermissions()
      state.columns = data.columns || {}
      state.permissions = data.permissions || EMPTY
      state.permissionsLoaded = true
      return data
    } catch {
      state.columns = {}
      state.permissions = EMPTY
      state.permissionsLoaded = true
      return { columns: {}, permissions: EMPTY }
    } finally {
      state.loadingPermissions = false
      state.permissionRequest = null
      emit()
    }
  })()
  return state.permissionRequest
}

function ensureGlobalRealtime() {
  if (!supabase) return
  if (!state.adminChannel) {
    const name = 'global:admin-status:admin_users'
    logRealtimeSubscribe({ name, scope: 'global', tables: ['admin_users'] })
    state.adminChannel = supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_users' }, () => {
        invalidateApiJsonCache('/api/admin')
        refreshAdminStatus().catch(() => null)
      })
      .subscribe()
  }
  if (!state.permissionChannel) {
    const name = 'global:column-permissions'
    logRealtimeSubscribe({ name, scope: 'global', tables: ['column_permissions'] })
    state.permissionChannel = supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'column_permissions' }, () => {
        invalidateApiJsonCache('/api/admin/column-permissions')
        refreshPermissions().catch(() => null)
      })
      .subscribe()
  }
}

export function stopAdminAccessRealtime() {
  if (supabase && state.adminChannel) {
    const current = state.adminChannel
    state.adminChannel = null
    supabase.removeChannel(current)
    logRealtimeRemove('global:admin-status:admin_users')
  }
  if (supabase && state.permissionChannel) {
    const current = state.permissionChannel
    state.permissionChannel = null
    supabase.removeChannel(current)
    logRealtimeRemove('global:column-permissions')
  }
}

export function useAdminAccess({ loadPermissions = true, realtime = true } = {}) {
  const [, rerender] = useState(0)

  const refresh = useCallback(async () => {
    const admin = await refreshAdminStatus()
    if (loadPermissions) await refreshPermissions()
    return admin
  }, [loadPermissions])

  const refreshColumns = useCallback(() => refreshPermissions(), [])

  useEffect(() => {
    const listener = () => rerender(value => value + 1)
    listeners.add(listener)
    if (realtime) ensureGlobalRealtime()
    if (!state.adminLoaded) refreshAdminStatus().catch(() => null)
    if (loadPermissions && !state.permissionsLoaded) refreshPermissions().catch(() => null)
    return () => listeners.delete(listener)
  }, [loadPermissions, realtime])

  useEffect(() => {
    if (!loadPermissions) return undefined
    const syncPermissions = () => { refreshPermissions().catch(() => null) }
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, syncPermissions)
    return () => window.removeEventListener(PERMISSIONS_CHANGED_EVENT, syncPermissions)
  }, [loadPermissions])

  const loading = state.loadingAdmin || (loadPermissions && state.loadingPermissions && !state.permissionsLoaded)
  const isAdminSnapshot = state.isAdmin
  const permissionsSnapshot = state.permissions

  const helpers = useMemo(() => {
    const canViewColumn = (tableName, columnKey) => !isColumnHidden(permissionsSnapshot, tableName, columnKey, isAdminSnapshot)
    const canEditColumn = (tableName, columnKey) => !isColumnDisabled(permissionsSnapshot, tableName, columnKey, isAdminSnapshot) && canViewColumn(tableName, columnKey)
    const hidden = (tableName, columnKey) => isColumnHidden(permissionsSnapshot, tableName, columnKey, isAdminSnapshot)
    const disabled = (tableName, columnKey) => isColumnDisabled(permissionsSnapshot, tableName, columnKey, isAdminSnapshot)
    const getVisibleColumns = (tableName, columnList, keyMapper = column => column.key) => columnList.filter(column => canViewColumn(tableName, keyMapper(column)))
    const getEditableColumns = (tableName, columnList, keyMapper = column => column.key) => columnList.filter(column => canEditColumn(tableName, keyMapper(column)))
    return { canViewColumn, canEditColumn, isColumnHidden: hidden, isColumnDisabled: disabled, getVisibleColumns, getEditableColumns }
  }, [isAdminSnapshot, permissionsSnapshot])

  const setPermissions = useCallback((permissions) => {
    state.permissions = permissions || EMPTY
    state.permissionsLoaded = true
    emit()
  }, [])

  return useMemo(() => ({
    isAdmin: state.isAdmin,
    isSuperAdmin: state.isSuperAdmin,
    role: state.role,
    loading,
    columns: state.columns,
    permissions: state.permissions,
    refresh,
    refreshPermissions: refreshColumns,
    setPermissions,
    ...helpers
  }), [helpers, loading, refresh, refreshColumns, setPermissions])
}

export function isColumnHidden(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_hidden'
}

export function isColumnDisabled(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_disabled'
}

export function notifyAdminPermissionsChanged() {
  invalidateApiJsonCache('/api/admin/column-permissions')
  window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT))
  refreshPermissions().catch(() => null)
}
