import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'
import { logRealtimeRemove, logRealtimeSubscribe } from '../utils/supabaseRealtimeDebug'

let staff = []
let loading = false
let loaded = false
let request = null
let channel = null
const listeners = new Set()

const normalize = (rows) => (Array.isArray(rows) ? rows : [])
  .map(user => ({ id: user.id || user.user_id || '', user_id: user.user_id || user.id || '', name: String(user.name || user.display_name || '').trim(), email: user.email || '' }))
  .filter(user => user.name)
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

function emit() {
  listeners.forEach(listener => listener())
}

export async function refreshStaffDirectory() {
  if (request) return request
  loading = true
  emit()
  request = (async () => {
    try {
      const response = await apiFetch('/api/user-profiles/options', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load staff directory.')
      staff = normalize(payload.data)
      loaded = true
      return staff
    } finally {
      loading = false
      request = null
      emit()
    }
  })()
  return request
}

function ensureStaffRealtime() {
  if (!supabase || channel) return
  const name = 'global:staff-directory:user_profiles'
  logRealtimeSubscribe({ name, scope: 'global', tables: ['user_profiles'] })
  channel = supabase
    .channel(name)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, () => {
      refreshStaffDirectory().catch(() => null)
    })
    .subscribe()
}

export function stopStaffDirectoryRealtime() {
  if (!supabase || !channel) return
  const current = channel
  channel = null
  supabase.removeChannel(current)
  logRealtimeRemove('global:staff-directory:user_profiles')
}

export function useStaffDirectory({ enabled = true } = {}) {
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    const listener = () => rerender(value => value + 1)
    listeners.add(listener)
    ensureStaffRealtime()
    if (!loaded && !loading) refreshStaffDirectory().catch(() => null)
    return () => listeners.delete(listener)
  }, [enabled])

  const refresh = useCallback(() => refreshStaffDirectory(), [])
  return { staff, loading, refresh }
}
