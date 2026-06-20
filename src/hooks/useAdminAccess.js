import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminMe, fetchColumnPermissions } from '../services/adminAccessApi'
import { useRealtimeRefresh } from './useRealtimeRefresh'

const EMPTY = { clients: {}, candidates: {}, jobs: {} }
const PERMISSIONS_CHANGED_EVENT = 'fb:admin-permissions-changed'
const PERMISSIONS_CHANGED_STORAGE_KEY = 'fb_admin_permissions_changed_at'
const PERMISSIONS_POLL_MS = 5000
let cachedColumns = {}
let cachedPermissions = EMPTY

export function useAdminAccess({ loadPermissions = true } = {}) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [columns, setColumns] = useState(cachedColumns)
  const [permissions, setPermissions] = useState(cachedPermissions)

  const refreshPermissions = useCallback(async () => {
    const data = await fetchColumnPermissions()
    cachedColumns = data.columns || {}
    cachedPermissions = data.permissions || EMPTY
    setColumns(cachedColumns)
    setPermissions(cachedPermissions)
    return data
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAdminMe()
      setIsSuperAdmin(Boolean(me.isSuperAdmin))
      setIsAdmin(Boolean(me.isAdmin))
      setRole(me.role || null)
      if (!loadPermissions) return
      try {
        await refreshPermissions()
      } catch {
        setColumns({})
        setPermissions(EMPTY)
      }
    } catch {
      setIsAdmin(false)
      setIsSuperAdmin(false)
      setRole(null)
    } finally {
      setLoading(false)
    }
  }, [loadPermissions, refreshPermissions])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) refresh()
    })
    return () => { active = false }
  }, [refresh])

  useRealtimeRefresh({
    channelName: loadPermissions ? 'realtime:admin-access-permissions' : 'realtime:admin-access-me',
    tables: loadPermissions ? ['admin_users', 'column_permissions'] : ['admin_users'],
    onChange: loadPermissions ? refreshPermissions : refresh
  })

  useEffect(() => {
    if (!loadPermissions) return undefined

    const syncPermissions = () => { refreshPermissions().catch(() => null) }
    const syncStoragePermissions = (event) => {
      if (event.key === PERMISSIONS_CHANGED_STORAGE_KEY) syncPermissions()
    }
    const poll = window.setInterval(syncPermissions, PERMISSIONS_POLL_MS)

    window.addEventListener(PERMISSIONS_CHANGED_EVENT, syncPermissions)
    window.addEventListener('storage', syncStoragePermissions)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, syncPermissions)
      window.removeEventListener('storage', syncStoragePermissions)
    }
  }, [loadPermissions, refreshPermissions])

  const helpers = useMemo(() => {
    const canViewColumn = (tableName, columnKey) => !isColumnHidden(permissions, tableName, columnKey, isAdmin)
    const canEditColumn = (tableName, columnKey) => !isColumnDisabled(permissions, tableName, columnKey, isAdmin) && canViewColumn(tableName, columnKey)
    const hidden = (tableName, columnKey) => isColumnHidden(permissions, tableName, columnKey, isAdmin)
    const disabled = (tableName, columnKey) => isColumnDisabled(permissions, tableName, columnKey, isAdmin)
    const getVisibleColumns = (tableName, columnList, keyMapper = column => column.key) => columnList.filter(column => canViewColumn(tableName, keyMapper(column)))
    const getEditableColumns = (tableName, columnList, keyMapper = column => column.key) => columnList.filter(column => canEditColumn(tableName, keyMapper(column)))
    return { canViewColumn, canEditColumn, isColumnHidden: hidden, isColumnDisabled: disabled, getVisibleColumns, getEditableColumns }
  }, [isAdmin, permissions])

  return useMemo(() => ({ isAdmin, isSuperAdmin, role, loading, columns, permissions, refresh, refreshPermissions, setPermissions, ...helpers }), [columns, helpers, isAdmin, isSuperAdmin, role, loading, permissions, refresh, refreshPermissions])
}

export function isColumnHidden(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_hidden'
}

export function isColumnDisabled(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_disabled'
}

export function notifyAdminPermissionsChanged() {
  window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT))
  window.localStorage.setItem(PERMISSIONS_CHANGED_STORAGE_KEY, String(Date.now()))
}
