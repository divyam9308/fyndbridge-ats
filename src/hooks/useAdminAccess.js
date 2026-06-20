import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminMe, fetchColumnPermissions } from '../services/adminAccessApi'
import { useRealtimeRefresh } from './useRealtimeRefresh'

const EMPTY = { clients: {}, candidates: {}, jobs: {} }

export function useAdminAccess({ loadPermissions = true } = {}) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [columns, setColumns] = useState({})
  const [permissions, setPermissions] = useState(EMPTY)

  const refreshPermissions = useCallback(async () => {
    const data = await fetchColumnPermissions()
    setColumns(data.columns || {})
    setPermissions(data.permissions || EMPTY)
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
    onChange: refresh
  })

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
