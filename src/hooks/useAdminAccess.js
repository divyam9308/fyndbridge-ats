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

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAdminMe()
      setIsSuperAdmin(Boolean(me.isSuperAdmin))
      setIsAdmin(Boolean(me.isAdmin))
      setRole(me.role || null)
      if (!loadPermissions) return
      try {
        const data = await fetchColumnPermissions()
        setColumns(data.columns || {})
        setPermissions(data.permissions || EMPTY)
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
  }, [loadPermissions])

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

  return useMemo(() => ({ isAdmin, isSuperAdmin, role, loading, columns, permissions, refresh, setPermissions }), [columns, isAdmin, isSuperAdmin, role, loading, permissions, refresh])
}

export function isColumnHidden(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_hidden'
}

export function isColumnDisabled(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_disabled'
}
