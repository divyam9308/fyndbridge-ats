import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Info, Mail, RefreshCw, X } from 'lucide-react'
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
  no_contacts: 'No valid CRM contact email addresses. Add a contact before importing Gmail history.',
  completed: 'Gmail sync complete. Matching emails are available in Activity History.',
  pending: 'Sync requested. Remaining emails are queued and will continue automatically.',
  quota_paused: 'Email processing is paused by the AI minute limit. Queued emails will retry automatically after about a minute.',
  partial: 'Sync finished. Some emails could not be processed. Contact an administrator.',
  not_connected: 'Gmail was disconnected. Connect again to synchronise.',
  reauthorization_required: 'Gmail access needs to be renewed. Reconnect Gmail to synchronise.'
}
const SYNC_LABELS = { no_contacts: 'No CRM contact emails', pending: 'Sync queued', quota_paused: 'Sync paused', not_connected: 'Reconnect Gmail', reauthorization_required: 'Reconnect Gmail', failed: 'Sync failed' }
export default function CrmGmailConnection({ onSynced }) {
  const { user } = useAuth()
  const [connection, setConnection] = useState(null)
  const [busy, setBusy] = useState('')
  const [syncFeedback, setSyncFeedback] = useState('')
  const synced = ['completed', 'partial'].includes(syncFeedback)
  const syncedTimer = useRef(null)
  const cooldownTimer = useRef(null)
  const oldCooldownTimer = useRef(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [oldCooldownSeconds, setOldCooldownSeconds] = useState(0)
  const [oldPicker, setOldPicker] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clients, setClients] = useState([])
  const [selectedClients, setSelectedClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientError, setClientError] = useState('')
  const [clientRetry, setClientRetry] = useState(0)
  const [oldError, setOldError] = useState('')
  const [oldNotice, setOldNotice] = useState('')
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [notice, setNotice] = useState(() => {
    const url = new URL(window.location.href), result = url.searchParams.get('gmail')
    return result ? { text: CALLBACK_MESSAGES[result] || 'Unable to connect Gmail. Please try again.', success: result === 'connected' } : null
  })
  const [open, setOpen] = useState(() => Boolean(notice))
  const lock = useRef(false)
  useEffect(() => () => { clearTimeout(syncedTimer.current); clearInterval(cooldownTimer.current); clearInterval(oldCooldownTimer.current) }, [])
  useEffect(() => {
    if (!open || !oldPicker || !clientSearch.trim()) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setClientsLoading(true); setClientError('')
      crmRequest(`?pageSize=50&sort=organisation_name&direction=asc&search=${encodeURIComponent(clientSearch)}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setClients(result.data || []) })
        .catch(failure => { if (!controller.signal.aborted) setClientError(failure.message) })
        .finally(() => { if (!controller.signal.aborted) setClientsLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, oldPicker, clientSearch, clientRetry])
  const reload = useCallback(async signal => {
    try { const data = await crmRequest('/gmail/status', { signal }); if (!signal?.aborted) { setConnection(data); setStatusError('') } }
    catch (failure) { if (!signal?.aborted) setStatusError(failure.message) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    crmRequest('/gmail/status', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setConnection(data); setStatusError('') } }).catch(failure => { if (!controller.signal.aborted) setStatusError(failure.message) })
    const refresh = () => reload(controller.signal)
    window.addEventListener('focus', refresh)
    const url = new URL(window.location.href)
    if (url.searchParams.has('gmail')) { url.searchParams.delete('gmail'); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash) }
    return () => { controller.abort(); window.removeEventListener('focus', refresh) }
  }, [reload, user?.id])
  const queueActive = Boolean(connection?.pending_jobs || connection?.discovery_pending)
  useEffect(() => {
    if (!open && !queueActive) return undefined
    const controller = new AbortController()
    let timer
    const refresh = async () => {
      await reload(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2000)
    }
    refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, queueActive, reload])
  const chooseClient = client => {
    setSelectedClients(selected => selected.some(value => value.id === client.id) ? selected : [...selected, { id: client.id, organisation_name: client.organisation_name }])
    clearInterval(oldCooldownTimer.current); setOldCooldownSeconds(0)
    setClientSearch(''); setClients([]); setClientsLoading(false); setClientError(''); setOldError(''); setOldNotice('')
  }
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
    try { await crmRequest('/gmail/disconnect', { method: 'DELETE' }); setConnection({ connected: false, connected_mailboxes: Math.max(0, Number(connection?.connected_mailboxes ?? 1) - 1) }); setOpen(false) }
    catch (failure) { setError(failure.message); setOpen(true) }
    finally { lock.current = false; setBusy('') }
  }
  const syncNow = async () => {
    if (lock.current) return
    clearTimeout(syncedTimer.current); setSyncFeedback('')
    lock.current = true; setBusy('syncing'); setError(''); setNotice(null); setOpen(false)
    try {
      const result = await crmRequest('/gmail/sync', { method: 'POST' })
      setConnection(previous => ({ ...previous, ...result.connection, connected_mailboxes: result.connected_mailboxes ?? (result.connection?.connected ? 1 : 0) }))
      reload()
      onSynced?.()
      setNotice({ text: SYNC_MESSAGES[result.state] || SYNC_MESSAGES.pending, success: !['not_connected', 'reauthorization_required'].includes(result.state) })
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
  const syncOldEmails = async event => {
    event.preventDefault()
    if (lock.current || !selectedClients.length || oldCooldownSeconds > 0) return
    lock.current = true; setBusy('old-sync'); setOldError(''); setOldNotice('')
    try {
      const result = await crmRequest('/gmail/sync-old', { method: 'POST', body: JSON.stringify({ client_ids: selectedClients.map(client => client.id) }) })
      onSynced?.()
      if (['not_connected','reauthorization_required'].includes(result.state)) { setOldError(SYNC_MESSAGES[result.state]); return }
      reload()
      const accepted = (result.results || []).filter(value => value.state !== 'cooldown')
      const cooldown = (result.results || []).filter(value => value.state === 'cooldown')
      const clientName = accepted.length === 1 ? accepted[0].client_name : `${accepted.length} clients`
      setOldNotice(result.state === 'completed' ? `Old email sync completed for ${clientName}.`
        : result.state === 'partial' ? `Old email sync finished for ${clientName}. Some messages could not be processed.`
          : result.state === 'quota_paused' ? `Old emails for ${clientName} are queued. Processing will retry automatically after about a minute.`
            : `Old emails for ${clientName} are queued across connected mailboxes and will continue syncing automatically.`)
      if (cooldown.length) setOldError(`Already requested recently: ${cooldown.map(value => value.client_name).join(', ')}. Other selected clients were accepted.`)
    } catch (failure) {
      const seconds = Math.ceil(Number(failure.retry_after))
      if (failure.status === 429 && Number.isFinite(seconds) && seconds > 0) {
        const until = Date.now() + seconds * 1000
        setOldCooldownSeconds(seconds)
        clearInterval(oldCooldownTimer.current)
        oldCooldownTimer.current = setInterval(() => {
          const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000))
          setOldCooldownSeconds(remaining)
          if (!remaining) clearInterval(oldCooldownTimer.current)
        }, 250)
      } else setOldError(failure.message)
    } finally { lock.current = false; setBusy('') }
  }
  const connectedMailboxes = Number(connection?.connected_mailboxes ?? (connection?.connected ? 1 : 0))
  const cooldownMessage = cooldownSeconds > 0 ? `Please wait ${cooldownSeconds} ${cooldownSeconds === 1 ? 'second' : 'seconds'} before syncing again.` : ''
  const displayError = error || statusError
  const syncDescription = cooldownMessage || displayError || notice?.text || undefined
  const syncButton = connection && <button type="button" className={`btn-secondary crm-gmail-sync${busy === 'syncing' ? ' is-syncing' : synced ? ' is-synced' : ''}`} disabled={Boolean(busy) || cooldownSeconds > 0 || connectedMailboxes === 0} aria-label="Sync Gmail now" aria-description={syncDescription} title={syncDescription} aria-busy={busy === 'syncing'} onClick={syncNow}>
    {synced ? <Check size={16} /> : <RefreshCw size={16} />}<span aria-live="polite">{busy === 'syncing' ? 'Syncing...' : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : synced ? 'Synced' : SYNC_LABELS[syncFeedback] || 'Sync now'}</span>
  </button>
  return <div className="crm-gmail-control">
    <button type="button" className="btn-secondary crm-gmail-button" disabled={busy || (!connection && !displayError)} onClick={() => connection?.connected ? disconnect() : displayError ? setOpen(true) : connect()}>
      <Mail size={16} />{busy === 'disconnecting' ? 'Disconnecting...' : busy === 'connecting' ? 'Connecting...' : !connection && !displayError ? 'Loading Gmail...' : connection?.connected ? 'Disconnect Gmail' : 'Connect Gmail'}
    </button>
    {syncButton}
    {(connection || displayError) && <button type="button" className="row-action-btn" aria-label="Gmail connection details" title={syncDescription} aria-description={syncDescription} disabled={Boolean(busy)} onClick={() => setOpen(true)}><Info size={16} />{connection?.pending_jobs > 0 && <span className="crm-gmail-queue-badge">{connection.pending_jobs}</span>}</button>}
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
      {connection && <>
        <p className="sub-text">Sync now searches current CRM contact emails and processes new mail from all {connectedMailboxes} connected {connectedMailboxes === 1 ? 'mailbox' : 'mailboxes'}.</p>
        {Number.isInteger(connection.pending_jobs) && <p className="crm-gmail-queue-count" aria-live="polite" aria-atomic="true">{connection.pending_jobs} {connection.pending_jobs === 1 ? 'email' : 'emails'} remaining in queue</p>}
        {connection.discovery_pending && <p className="sub-text">Searching for matching emails…</p>}
        {!oldPicker && <button type="button" className="btn-secondary" disabled={Boolean(busy) || connectedMailboxes === 0} onClick={() => setOldPicker(true)}>Sync old emails</button>}
        {oldPicker && <form className="crm-history-sync-form" onSubmit={syncOldEmails}>
          <label className="form-group"><span className="form-label">Search clients</span><input className="form-control" aria-label="Search clients for old emails" autoComplete="off" value={clientSearch} disabled={Boolean(busy) || selectedClients.length >= 25} onChange={event => { setClientSearch(event.target.value); setClients([]); setClientsLoading(Boolean(event.target.value.trim())); setClientError('') }} /></label>
          {clientSearch.trim() && <div className="crm-history-client-results" role="group" aria-label="Matching clients">
            {clientsLoading ? <p className="sub-text">Searching clients…</p> : clients.filter(client => !selectedClients.some(selected => selected.id === client.id)).map(client => <button key={client.id} type="button" className="crm-history-client-result" disabled={Boolean(busy)} onClick={() => chooseClient(client)} aria-label={`Add ${client.organisation_name}`}>{client.organisation_name}<span>Add</span></button>)}
            {!clientsLoading && !clientError && !clients.filter(client => !selectedClients.some(selected => selected.id === client.id)).length && <p className="sub-text">No matching clients found.</p>}
          </div>}
          {clientError && <div className="form-error" role="alert">{clientError}<button type="button" className="btn-secondary" onClick={() => setClientRetry(value => value + 1)}>Retry loading clients</button></div>}
          {selectedClients.length > 0 && <div className="crm-history-selected-clients" role="group" aria-label="Selected clients">{selectedClients.map(client => <span className="crm-history-client-chip" key={client.id}>{client.organisation_name}<button type="button" disabled={Boolean(busy)} aria-label={`Remove ${client.organisation_name}`} onClick={() => { setSelectedClients(selected => selected.filter(value => value.id !== client.id)); clearInterval(oldCooldownTimer.current); setOldCooldownSeconds(0); setOldError(''); setOldNotice('') }}><X size={14} /></button></span>)}</div>}
          <p className="sub-text">Choose up to 25 clients. Searches their current contact emails across all connected consultant mailboxes.</p>
          <button type="submit" className="btn-primary" disabled={Boolean(busy) || connectedMailboxes === 0 || !selectedClients.length || oldCooldownSeconds > 0}>{busy === 'old-sync' ? 'Syncing old emails...' : oldCooldownSeconds > 0 ? `Wait ${oldCooldownSeconds}s` : 'Sync old emails'}</button>
        </form>}
        {oldNotice && <p className="sub-text" role="status">{oldNotice}</p>}
        {oldError && <p className="form-error" role="alert">{oldError}</p>}
      </>}
      {cooldownMessage && <p className="sub-text" role="status">{cooldownMessage}</p>}
      {displayError && <p className="form-error" role="alert">{displayError}</p>}
      {!connection && <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => reload()}>Retry connection status</button>}
    </div></CrmDialog>}
  </div>
}
