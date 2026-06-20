import { useEffect, useRef } from 'react'
import { supabase } from '../services/supabaseClient'

export function useRealtimeRefresh({ channelName, tables, onChange, enabled = true, debounceMs = 400 }) {
  const onChangeRef = useRef(onChange)
  const timerRef = useRef(null)
  const tableKey = Array.isArray(tables) ? tables.join('|') : ''

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled || !supabase || !tableKey) return undefined

    const scheduleRefresh = () => {
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        onChangeRef.current?.()
      }, debounceMs)
    }

    const tableList = tableKey.split('|').filter(Boolean)
    const channel = tableList.reduce((nextChannel, table) => (
      nextChannel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh)
    ), supabase.channel(channelName))

    channel.subscribe()

    return () => {
      window.clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [channelName, debounceMs, enabled, tableKey])
}
