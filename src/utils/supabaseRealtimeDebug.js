const activeChannels = new Map()
const globalTables = new Map()

const dev = () => import.meta.env.DEV

export function logRealtimeSubscribe({ name, scope = 'page', tables = [] }) {
  if (!dev()) return
  const tableList = tables.filter(Boolean)
  activeChannels.set(name, { scope, tables: tableList })
  tableList.forEach(table => {
    if (!table) console.warn('[Supabase Debug] realtime subscription without table', { name })
    if (scope === 'global') {
      const existing = globalTables.get(table)
      if (existing && existing !== name) console.warn('[Supabase Debug] duplicate global realtime table', { table, existing, name })
      globalTables.set(table, name)
    }
  })
  console.debug('[Supabase Debug] realtime subscribe', { name, scope, tables: tableList, active: activeChannels.size })
}

export function logRealtimeRemove(name) {
  if (!dev()) return
  const current = activeChannels.get(name)
  activeChannels.delete(name)
  if (current?.scope === 'global') {
    current.tables.forEach(table => {
      if (globalTables.get(table) === name) globalTables.delete(table)
    })
  }
  console.debug('[Supabase Debug] realtime remove', { name, active: activeChannels.size })
}
