import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { apiFetch } from '../../services/apiClient'
import { assignedRequest } from '../../services/assignedCandidatesApi'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { lockBodyScroll } from '../../utils/lockBodyScroll'
import AssignmentSelect from './AssignmentSelect'
import { ASSIGNMENT_STATUSES } from './assignmentStatuses'

const editableValues = row => Object.fromEntries(['full_name', 'mobile_number', 'client_id', 'job_id', 'status', 'assigned_consultant_id'].map(key => [key, row[key]]))
export default function AssignmentEditor({ row, consultants, onClose, onSaved }) {
  const [form, setForm] = useState(() => editableValues(row))
  const [version, setVersion] = useState(row.version)
  const [options, setOptions] = useState({ clients: [], jobs: [] })
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [failureKind, setFailureKind] = useState('')
  const lock = useRef(false)
  const dialog = useDialogFocus(onClose, { closeDisabled: pending })
  useEffect(() => lockBodyScroll({ preserveScrollbar: true }), [])
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(['/api/clients?options=true', '/api/jobs?options=true'].map(async url => {
      const response = await apiFetch(url, { signal: controller.signal }), data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load clients and mandates.')
      return data.data || []
    })).then(([clients, jobs]) => { if (!controller.signal.aborted) { setOptions({ clients, jobs }); setError(''); setFailureKind('') } })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure.message); setFailureKind('options') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  const save = async event => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setPending(true); setError('')
    try { await assignedRequest(`/${row.id}`, { method: 'PATCH', body: JSON.stringify({ ...form, expected_version: version }) }); onSaved() }
    catch (failure) { setError(failure.message); setFailureKind(failure.status === 409 ? 'conflict' : 'save') }
    finally { lock.current = false; setPending(false) }
  }
  const reload = async () => {
    if (lock.current) return
    lock.current = true; setPending(true)
    try { const { data } = await assignedRequest(`/${row.id}`); setForm(editableValues(data)); setVersion(data.version); setError(''); setFailureKind('') }
    catch (failure) { setError(failure.message) }
    finally { lock.current = false; setPending(false) }
  }
  const uniqueClients = new Map(options.clients.map(client => [client.client_group_id || client.id, { id: client.client_group_id || client.id, name: client.name || client.client_name, displayId: client.client_display_id }]))
  const employees = consultants.some(person => person.id === row.assigned_consultant_id) ? consultants : [...consultants, { id: row.assigned_consultant_id, name: row.assigned_consultant_name || 'Current consultant (inactive)' }]
  const disabled = loading || pending
  return createPortal(<div className="modal-overlay"><form className="modal-card modal-card-lg assigned-wizard assigned-edit-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="Edit assigned candidate" tabIndex={-1} onSubmit={save}>
    <div className="modal-header"><span className="modal-title">Edit assigned candidate</span><button type="button" className="modal-close" aria-label="Close edit" disabled={pending} onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body"><div className="form-grid-2">
      <label className="form-group"><span className="form-label">Name <span className="req">*</span></span><input className="form-control" aria-label="Name" value={form.full_name} required maxLength={200} disabled={disabled} onChange={event => setForm(current => ({ ...current, full_name: event.target.value }))} /></label>
      <label className="form-group"><span className="form-label">Mobile <span className="req">*</span></span><input className="form-control" aria-label="Mobile" value={form.mobile_number} required maxLength={30} disabled={disabled} onChange={event => setForm(current => ({ ...current, mobile_number: event.target.value }))} /></label>
      <AssignmentSelect label="Client" value={form.client_id} options={[...uniqueClients.values()]} disabled={disabled} onChange={client_id => setForm(current => ({ ...current, client_id, job_id: '' }))} />
      <AssignmentSelect label="Mandate" value={form.job_id} options={options.jobs.filter(job => job.client_id === form.client_id).map(job => ({ id: job.id, name: job.title || job.role, displayId: job.job_display_id }))} disabled={disabled} onChange={job_id => setForm(current => ({ ...current, job_id }))} />
      <AssignmentSelect label="Status" value={form.status} options={ASSIGNMENT_STATUSES.map(value => ({ id: value, name: value }))} disabled={disabled} onChange={status => setForm(current => ({ ...current, status }))} />
      <AssignmentSelect label="Consultant" value={form.assigned_consultant_id} options={employees} disabled={disabled} onChange={assigned_consultant_id => setForm(current => ({ ...current, assigned_consultant_id }))} />
    </div>{loading && <p role="status">Loading clients and mandates…</p>}{error && <div className="form-error" role="alert">{error}{failureKind === 'conflict' && <button type="button" className="btn-secondary" disabled={pending} onClick={reload}>Reload latest (discard edits)</button>}{failureKind === 'options' && <button type="button" className="btn-secondary" disabled={pending} onClick={() => { setLoading(true); setAttempt(value => value + 1) }}>Reload options</button>}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={disabled || !form.client_id || !form.job_id || !form.assigned_consultant_id}>{pending ? 'Saving…' : 'Save changes'}</button></div>
  </form></div>, document.body)
}
