import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Info, Mail, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { crmRequest } from '../services/crmApi'
import { CrmDialog } from './CrmDialogs'

const CALLBACK_MESSAGES = {
  connected: 'Gmail connected. New CRM contact emails will synchronise hourly.',
  INVALID_STATE: 'Gmail connection expired or could not be verified. Please connect again.',
  OAUTH_DENIED: 'Gmail access was not granted.',
  ACCOUNT_MISMATCH: 'Select the Gmail account matching your verified FyndBridge work email.',
  WORK_EMAIL_REQUIRED: 'A verified FyndBridge work email is required.',
  WORK_EMAIL_CHANGED: 'Your work email changed. Please connect again.',
  SCOPE_REQUIRED: 'Allow read-only Gmail access to connect your mailbox.',
  OFFLINE_ACCESS_REQUIRED: 'Offline access was not granted. Please reconnect and approve access.',
  ACCESS_DENIED: 'CRM access is required to connect Gmail.',
  CONFIGURATION: 'Gmail integration is not configured. Contact an administrator.'
}
const dateTime = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST' : 'Not yet synchronised'
const SYNC_MESSAGES = {
  completed: 'Gmail sync complete. Matching emails are available in Activity History.',
  pending: 'Sync requested. Remaining emails are queued and will continue automatically.',
  quota_paused: 'Email processing is paused by the AI minute limit. Queued emails will retry automatically after about a minute.',
  partial: 'Sync finished. Some emails could not be processed. Contact an administrator.',
  not_connected: 'Gmail was disconnected. Connect again to synchronise.',
  reauthorization_required: 'Gmail access needs to be renewed. Reconnect Gmail to synchronise.'
}
const SYNC_LABELS = { pending: 'Sync queued', quota_paused: 'Sync paused', not_connected: 'Reconnect Gmail', reauthorization_required: 'Reconnect Gmail', failed: 'Sync failed' }
export default function CrmGmailConnection({ onSynced }) {
  const { user } = useAuth()
  const [connection, setConnection] = useState(null)
  const [busy, setBusy] = useState('')
  const [syncFeedback, setSyncFeedback] = useState('')
  const synced = ['completed', 'partial'].includes(syncFeedback)
  const syncedTimer = useRef(null)
  const cooldownTimer = useRef(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => {
    const url = new URL(window.location.href), result = url.searchParams.get('gmail')
    return result ? { text: CALLBACK_MESSAGES[result] || 'Unable to connect Gmail. Please try again.', success: result === 'connected' } : null
  })
  const [open, setOpen] = useState(() => Boolean(notice))
  const lock = useRef(false)
  useEffect(() => () => { clearTimeout(syncedTimer.current); clearInterval(cooldownTimer.current) }, [])
  const reload = useCallback(async signal => {
    try { const data = await crmRequest('/gmail/status', { signal }); if (!signal?.aborted) { setConnection(data); setError('') } }
    catch (failure) { if (!signal?.aborted) setError(failure.message) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    crmRequest('/gmail/status', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setConnection(data); setError('') } }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    const refresh = () => reload(controller.signal)
    window.addEventListener('focus', refresh)
    const url = new URL(window.location.href)
    if (url.searchParams.has('gmail')) { url.searchParams.delete('gmail'); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash) }
    return () => { controller.abort(); window.removeEventListener('focus', refresh) }
  }, [reload, user?.id])
  const connect = async () => {
    if (lock.current) return
    lock.current = true; setBusy('connecting'); setError(''); setNotice(null)
    try {
      const { url } = await crmRequest('/gmail/connect', { method: 'POST' })
      const target = new URL(url)
      if (target.origin !== 'https://accounts.google.com') throw new Error('Invalid Gmail connection URL.')
      window.location.assign(target.href)
    } catch (failure) { setError(failure.message); setOpen(true); lock.current = false; setBusy('') }
  }
  const disconnect = async () => {
    if (lock.current) return
    lock.current = true; setBusy('disconnecting'); setError(''); setNotice(null)
    try { await crmRequest('/gmail/disconnect', { method: 'DELETE' }); setConnection({ connected: false }); setOpen(false) }
    catch (failure) { setError(failure.message); setOpen(true) }
    finally { lock.current = false; setBusy('') }
  }
  const syncNow = async () => {
    if (lock.current) return
    clearTimeout(syncedTimer.current); setSyncFeedback('')
    lock.current = true; setBusy('syncing'); setError(''); setNotice(null); setOpen(false)
    try {
      const result = await crmRequest('/gmail/sync', { method: 'POST' })
      setConnection(result.connection)
      onSynced?.()
      setNotice({ text: result.state === 'pending' && result.backfill_pending ? 'Importing older matching emails. This will continue automatically in the background.' : SYNC_MESSAGES[result.state] || SYNC_MESSAGES.pending, success: !['not_connected', 'reauthorization_required'].includes(result.state) })
      setSyncFeedback(result.state)
    } catch (failure) {
      const retryAfter = Number(failure.retry_after)
      if (failure.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
        const seconds = Math.ceil(retryAfter), until = Date.now() + seconds * 1000
        setError(''); setCooldownSeconds(seconds); setSyncFeedback('cooldown')
        clearInterval(cooldownTimer.current)
        cooldownTimer.current = setInterval(() => {
          const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000))
          setCooldownSeconds(remaining)
          if (!remaining) clearInterval(cooldownTimer.current)
        }, 250)
      } else { setError(failure.message); setSyncFeedback('failed') }
    }
    finally {
      syncedTimer.current = setTimeout(() => setSyncFeedback(''), 5000)
      lock.current = false; setBusy('')
    }
  }
  const cooldownMessage = cooldownSeconds > 0 ? `Please wait ${cooldownSeconds} ${cooldownSeconds === 1 ? 'second' : 'seconds'} before syncing again.` : ''
  const syncDescription = cooldownMessage || error || notice?.text || undefined
  const syncButton = connection?.connected && <button type="button" className={`btn-secondary crm-gmail-sync${busy === 'syncing' ? ' is-syncing' : synced ? ' is-synced' : ''}`} disabled={Boolean(busy) || cooldownSeconds > 0 || connection.status !== 'connected'} aria-label="Sync Gmail now" aria-description={syncDescription} title={syncDescription} aria-busy={busy === 'syncing'} onClick={syncNow}>
    {synced ? <Check size={16} /> : <RefreshCw size={16} />}<span aria-live="polite">{busy === 'syncing' ? 'Syncing...' : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : synced ? 'Synced' : SYNC_LABELS[syncFeedback] || 'Sync now'}</span>
  </button>
  return <div className="crm-gmail-control">
    <button type="button" className="btn-secondary crm-gmail-button" disabled={busy || (!connection && !error)} onClick={() => connection?.connected ? disconnect() : error ? setOpen(true) : connect()}>
      <Mail size={16} />{busy === 'disconnecting' ? 'Disconnecting...' : busy === 'connecting' ? 'Connecting...' : !connection && !error ? 'Loading Gmail...' : connection?.connected ? 'Disconnect Gmail' : 'Connect Gmail'}
    </button>
    {syncButton}
    {connection?.connected && <button type="button" className="row-action-btn" aria-label="Gmail connection details" title={syncDescription} aria-description={syncDescription} disabled={Boolean(busy)} onClick={() => setOpen(true)}><Info size={16} /></button>}
    {open && <CrmDialog title="Gmail Connection" onClose={() => setOpen(false)} busy={Boolean(busy)} footer={<>
      <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Close</button>
      {syncButton}
      {connection?.connected ? <button className="btn-secondary" disabled={Boolean(busy)} onClick={disconnect}>{busy === 'disconnecting' ? 'Disconnecting...' : 'Disconnect Gmail'}</button> : <button className="btn-primary" disabled={Boolean(busy)} onClick={connect}>Connect Gmail</button>}
    </>}><div className="modal-body">
      {notice && <p className={notice.success ? 'sub-text' : 'form-error'} role={notice.success ? 'status' : 'alert'}>{notice.text}</p>}
      {connection?.connected && <><p className="name-text">{connection.email}</p><p>Status: {connection.status === 'connected' ? 'Connected' : 'Reauthorisation required'}</p><p className="sub-text">Last successful synchronisation: {dateTime(connection.last_sync_at)}</p>
        {connection.last_error && <p className="form-error">{connection.status === 'reauthorization_required' ? 'Gmail access needs to be renewed.' : 'Synchronisation is delayed and will retry automatically.'}</p>}
        {connection.coverage_warning && <p className="form-error">{connection.coverage_warning}</p>}
        {connection.status !== 'connected' && <button className="btn-primary" disabled={Boolean(busy)} onClick={connect}>Reconnect Gmail</button>}
        <p className="sub-text">Read-only access. Only emails matching CRM contacts generate Activity History. Disconnecting keeps existing activities.</p></>}
      {cooldownMessage && <p className="sub-text" role="status">{cooldownMessage}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!connection && <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => reload()}>Retry connection status</button>}
    </div></CrmDialog>}
  </div>
}
