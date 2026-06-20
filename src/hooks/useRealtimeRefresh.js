import { useEffect, useRef } from 'react'
import { supabase } from '../services/supabaseClient'

export function useRealtimeRefresh({ channelName, tables, onChange, enabled = true, debounceMs = 400 }) {
  const onChangeRef = useRef(onChange)
  const timerRef = useRef(null)
  const tableKey = Array.isArray(tables) ? tables.join('|') : ''
  const debugName = String(channelName || '').replace(/^realtime:/, '')
  const debug = (...args) => {
    if (import.meta.env.DEV) console.log(...args)
  }

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled || !supabase || !tableKey) return undefined

    const scheduleRefresh = (payload) => {
      debug(
        `Realtime event ${debugName}:`,
        payload?.table,
        payload?.eventType,
        payload?.new?.id || '',
        payload?.old?.id || ''
      )
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        debug(`Realtime refresh ${debugName} triggered`, new Date().toISOString())
        onChangeRef.current?.()
      }, debounceMs)
    }

    const tableList = tableKey.split('|').filter(Boolean)
    debug(`Realtime subscribing: ${debugName}`, tableList)
    const channel = tableList.reduce((nextChannel, table) => (
      nextChannel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh)
    ), supabase.channel(channelName))

    channel.subscribe((status) => {
      debug(`Realtime status ${debugName}: ${status}`)
    })

    return () => {
      window.clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [channelName, debounceMs, debugName, enabled, tableKey])
}
