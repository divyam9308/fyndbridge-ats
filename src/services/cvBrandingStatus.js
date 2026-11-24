import { apiFetch } from './apiClient'
import branding from '../../shared/cvBranding.json'
const patterns = branding.pathPatterns.map(pattern => new RegExp(pattern, 'i'))
const entries = new Map()
let timer
const active = entry => entry.listeners.size && !['ready', 'failed', 'cancelled'].includes(entry.status)
const notify = entry => entry.listeners.forEach(listener => listener())
function entryFor(item) {
  const key = `${item.type}:${item.recordId}:${item.path}`
  if (!entries.has(key)) entries.set(key, { item, status: 'checking', listeners: new Set(), due: 0, busy: false })
  return entries.get(key)
}
function plan() {
  clearTimeout(timer)
  const pending = [...entries.values()].filter(entry => active(entry) && !entry.busy)
  if (!pending.length) return
  timer = setTimeout(flush, Math.max(30, Math.min(...pending.map(entry => entry.due)) - Date.now()))
}
async function flush() {
  const selected = [...entries.values()].filter(entry => active(entry) && !entry.busy && entry.due <= Date.now()).slice(0, 100)
  if (!selected.length) { plan(); return }
  selected.forEach(entry => { entry.busy = true })
  try {
    const response = await apiFetch('/api/resumes/branding-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: selected.map(entry => entry.item) }) })
    if (!response.ok) throw new Error('Unable to check CV branding')
    const payload = await response.json()
    const byPath = new Map((payload.data || []).map(row => [row.path, row.status]))
    selected.forEach(entry => { entry.status = byPath.get(entry.item.path) || 'unavailable'; notify(entry) })
  } catch {
    selected.forEach(entry => { entry.status = 'unavailable'; notify(entry) })
  } finally {
    selected.forEach(entry => { entry.busy = false; entry.due = Date.now() + (entry.status === 'unavailable' ? 5000 : 1500) })
    plan()
  }
}
export function brandedCvItem(context, path) {
  return context?.recordId && ['cv', 'assigned'].includes(context.type) && patterns.some(pattern => pattern.test(String(path || '')))
    ? { type: context.type, recordId: context.recordId, path } : null
}
export function getBrandingStatus(item) { return item ? entryFor(item).status : 'ready' }
export function subscribeToBranding(item, listener) {
  if (!item) return () => {}
  const entry = entryFor(item)
  clearTimeout(entry.gc)
  entry.listeners.add(listener)
  plan()
  return () => {
    entry.listeners.delete(listener)
    if (!entry.listeners.size) entry.gc = setTimeout(() => {
      if (!entry.listeners.size) entries.delete(`${item.type}:${item.recordId}:${item.path}`)
    }, 60000)
    plan()
  }
}
export async function retryBranding(item) {
  if (!item) return
  const entry = entryFor(item)
  entry.status = 'checking'; entry.busy = true; notify(entry)
  try {
    const response = await apiFetch('/api/resumes/branding-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [item], retry: true }) })
    if (!response.ok) throw new Error('Unable to retry CV branding')
    const payload = await response.json()
    entry.status = payload.data?.[0]?.status || 'unavailable'
  } catch { entry.status = 'unavailable' }
  finally { entry.busy = false; entry.due = Date.now() + 1500; notify(entry); plan() }
}
