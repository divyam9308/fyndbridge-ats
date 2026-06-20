import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminMe, fetchColumnPermissions } from '../services/adminAccessApi'
import { supabase } from '../services/supabaseClient'
import { useRealtimeRefresh } from './useRealtimeRefresh'

const EMPTY = { clients: {}, candidates: {}, jobs: {} }
const SEEDED_ADMIN_EMAILS = new Set(['divyam@fyndbridge.in'])
const SEEDED_SUPER_ADMIN_EMAILS = new Set(['divyam@fyndbridge.in'])

async function currentEmailFallback() {
  try {
    const user = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
    const storedEmail = String(user?.email || '').trim().toLowerCase()
    if (storedEmail) return storedEmail
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    return String(session?.user?.email || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

export function useAdminAccess({ loadPermissions = true } = {}) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [columns, setColumns] = useState({})
  const [permissions, setPermissions] = useState(EMPTY)

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAdminMe()
      const fallbackEmail = await currentEmailFallback()
      const nextIsAdmin = Boolean(me.isAdmin) || SEEDED_ADMIN_EMAILS.has(fallbackEmail)
      setIsSuperAdmin(Boolean(me.isSuperAdmin) || SEEDED_SUPER_ADMIN_EMAILS.has(fallbackEmail))
      setIsAdmin(nextIsAdmin)
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
      const fallbackEmail = await currentEmailFallback()
      setIsAdmin(SEEDED_ADMIN_EMAILS.has(fallbackEmail))
      setIsSuperAdmin(SEEDED_SUPER_ADMIN_EMAILS.has(fallbackEmail))
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

  return useMemo(() => ({ isAdmin, isSuperAdmin, loading, columns, permissions, refresh, setPermissions }), [columns, isAdmin, isSuperAdmin, loading, permissions, refresh])
}

export function isColumnHidden(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_hidden'
}

export function isColumnDisabled(permissions, tableName, columnKey, isAdmin) {
  return !isAdmin && permissions?.[tableName]?.[columnKey] === 'admin_disabled'
}
