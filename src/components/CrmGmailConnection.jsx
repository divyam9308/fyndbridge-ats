import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Mail } from 'lucide-react'
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
export default function CrmGmailConnection() {
  const { user } = useAuth()
  const [connection, setConnection] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => {
    const url = new URL(window.location.href), result = url.searchParams.get('gmail')
    return result ? { text: CALLBACK_MESSAGES[result] || 'Unable to connect Gmail. Please try again.', success: result === 'connected' } : null
  })
  const lock = useRef(false)
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
    lock.current = true; setBusy(true); setError(''); setNotice(null)
    try {
      const { url } = await crmRequest('/gmail/connect', { method: 'POST' })
      const target = new URL(url)
      if (target.origin !== 'https://accounts.google.com') throw new Error('Invalid Gmail connection URL.')
      window.location.assign(target.href)
    } catch (failure) { setError(failure.message); lock.current = false; setBusy(false) }
  }
  const disconnect = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice(null)
    try { await crmRequest('/gmail/disconnect', { method: 'DELETE' }); setConnection({ connected: false }); setOpen(false) }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="crm-gmail-control">
    <button type="button" className="btn-secondary crm-gmail-button" disabled={busy || (!connection && !error)} onClick={() => connection?.connected || error ? setOpen(true) : connect()}>
      <Mail size={16} />{busy ? 'Connecting...' : !connection && !error ? 'Loading Gmail...' : connection?.connected ? <>Gmail Connected <Check size={14} aria-label="Connected" /></> : 'Connect Gmail'}
    </button>
    {notice && <span className={notice.success ? 'sub-text' : 'form-error'} role={notice.success ? 'status' : 'alert'}>{notice.text}</span>}
    {error && !open && <span className="form-error" role="alert">{error}</span>}
    {open && <CrmDialog title="Gmail Connection" onClose={() => setOpen(false)} busy={busy} footer={<>
      <button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Close</button>
      {connection?.connected ? <button className="btn-secondary" disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting...' : 'Disconnect Gmail'}</button> : <button className="btn-primary" disabled={busy} onClick={connect}>Connect Gmail</button>}
    </>}><div className="modal-body">
      {connection?.connected && <><p className="name-text">{connection.email}</p><p>Status: {connection.status === 'connected' ? 'Connected' : 'Reauthorisation required'}</p><p className="sub-text">Last successful synchronisation: {dateTime(connection.last_sync_at)}</p>
        {connection.last_error && <p className="form-error">{connection.status === 'reauthorization_required' ? 'Gmail access needs to be renewed.' : 'Synchronisation is delayed and will retry automatically.'}</p>}
        {connection.coverage_warning && <p className="form-error">{connection.coverage_warning}</p>}
        {connection.status !== 'connected' && <button className="btn-primary" disabled={busy} onClick={connect}>Reconnect Gmail</button>}
        <p className="sub-text">Read-only access. Only emails matching CRM contacts generate Activity History. Disconnecting keeps existing activities.</p></>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!connection && <button className="btn-secondary" disabled={busy} onClick={() => reload()}>Retry connection status</button>}
    </div></CrmDialog>}
  </div>
}
