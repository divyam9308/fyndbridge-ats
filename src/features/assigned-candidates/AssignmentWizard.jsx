import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Upload, X } from 'lucide-react'
import { apiFetch } from '../../services/apiClient'
import { assignedRequest } from '../../services/assignedCandidatesApi'
import { ASSIGNMENT_STATUSES } from './assignmentStatuses'
import { normalizeMandateStatus } from '../../utils/mandateStatuses'
import { formatDateDDMMYYYY } from '../../utils/dateFormat'
import { lockBodyScroll } from '../../utils/lockBodyScroll'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import AssignmentSelect from './AssignmentSelect'

const validDetails = row => row.full_name.trim() && (row.mobile_number === '-' || /^\+?\d{7,15}$/.test(row.mobile_number.replace(/[\s()-]/g, ''))) && row.client_id && row.job_id && row.assigned_consultant_id

export default function AssignmentWizard({ consultants, defaultConsultant, onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [step, setStep] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [options, setOptions] = useState({ clients: [], jobs: [] })
  const [optionsLoading, setOptionsLoading] = useState(true)
  const rowsRef = useRef(rows)
  const requestLock = useRef(false)
  const inputRef = useRef(null)
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => lockBodyScroll({ preserveScrollbar: true }), [])
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(['/api/clients?options=true', '/api/jobs?options=true'].map(async url => {
      const response = await apiFetch(url, { signal: controller.signal }); const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load clients and mandates.')
      return payload.data || []
    })).then(([clients, jobs]) => {
      const seen = new Set()
      setOptions({ clients: clients.filter(client => { const id = client.client_group_id || client.id; if (seen.has(id)) return false; seen.add(id); return true }), jobs })
    }).catch(err => { if (err.name !== 'AbortError') setError(err.message) }).finally(() => setOptionsLoading(false))
    return () => controller.abort()
  }, [])
  const patch = (id, change) => setRows(current => current.map(row => row.id === id ? { ...row, ...change } : row))
  const upload = async row => {
    patch(row.id, { state: 'Uploading…', upload_error: '' })
    const body = new FormData(); body.append('upload_id', row.id); body.append('cv_file', row.file)
    try {
      const result = await assignedRequest('/uploads', { method: 'POST', body })
      patch(row.id, { ...result, state: result.parse_error ? 'Enter details manually' : 'Ready' })
    } catch (err) { patch(row.id, { state: 'Upload failed', upload_error: err.message }) }
  }
  const processFiles = async files => {
    if (requestLock.current) return
    const added = Array.from(files).map(file => ({ id: crypto.randomUUID(), file, full_name: '', mobile_number: '', client_id: '', job_id: '', status: 'Not Contacted', assigned_consultant_id: defaultConsultant || '', state: 'Waiting', upload_error: '' }))
    for (const row of added) {
      if (!/\.(pdf|docx?)$/i.test(row.file.name)) row.upload_error = 'Only PDF, DOC and DOCX files are supported.'
      else if (!row.file.size || row.file.size > 10 * 1024 * 1024) row.upload_error = 'Each CV must be between 1 byte and 10 MB.'
      if (row.upload_error) row.state = 'Upload failed'
    }
    setRows(current => [...current, ...added]); setError(''); setBusy(true); requestLock.current = true
    let index = 0; const queue = added.filter(row => !row.upload_error)
    try { await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => { while (index < queue.length) { const row = queue[index++]; await upload(row) } })) }
    finally { requestLock.current = false; setBusy(false) }
  }
  const retry = async row => { if (requestLock.current) return; requestLock.current = true; setBusy(true); try { await upload(row) } finally { requestLock.current = false; setBusy(false) } }
  const discard = ids => assignedRequest('/uploads/discard', { method: 'POST', body: JSON.stringify({ ids }) })
  const cancel = () => { if (requestLock.current) return; discard(rowsRef.current.map(row => row.id)).catch(() => {}); onClose() }
  const dialogRef = useDialogFocus(cancel, { closeDisabled: busy || saving })
  const remove = row => { setRows(current => current.filter(item => item.id !== row.id)); discard([row.id]).catch(() => {}) }
  const next = () => {
    if (step === -1 && (!rows.length || rows.some(row => !row.upload_id))) { setError('Upload or remove each failed CV before continuing.'); return }
    if (step >= 0 && !validDetails(rows[step])) { setError('Complete the name, mobile, client, mandate and consultant.'); return }
    setError(''); setStep(current => current + 1)
  }
  const save = async () => {
    if (requestLock.current) return
    const invalid = rows.findIndex(row => !validDetails(row))
    if (invalid !== -1) { setStep(invalid); setError('Complete the required candidate details.'); return }
    requestLock.current = true; setSaving(true); setError('')
    try {
      const result = await assignedRequest('', { method: 'POST', body: JSON.stringify({ rows: rows.map(({ upload_id, full_name, mobile_number, client_id, job_id, status, assigned_consultant_id }) => ({ upload_id, full_name, mobile_number, client_id, job_id, status, assigned_consultant_id })) }) })
      onSaved(result.count)
    } catch (err) { setError(err.message) } finally { requestLock.current = false; setSaving(false) }
  }
  const row = rows[step]
  const update = change => patch(row.id, change)
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg assigned-wizard" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="assigned-wizard-title" aria-busy={busy || saving}>
    <div className="modal-header"><span className="modal-title" id="assigned-wizard-title">Assign New Candidates</span><button className="modal-close" aria-label="Close assignment wizard" disabled={busy || saving} onClick={cancel}><X size={16} /></button></div>
    <div className="modal-body">
      <div className="assigned-progress">{step === -1 ? 'Upload Files' : `Candidate ${step + 1} of ${rows.length}`}<span>{step === -1 ? consultants.find(c => c.id === defaultConsultant)?.name : row.file.name}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {step === -1 ? <>
        <button className="assigned-dropzone" disabled={busy || saving} onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); processFiles(event.dataTransfer.files) }}>
          <Upload size={24} /><strong>Choose CVs or drop files here</strong><span>PDF, DOC, DOCX · Up to 10 MB per file</span>
        </button>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx" aria-label="Upload CVs" hidden onChange={async event => { const input=event.currentTarget; await processFiles(input.files); input.value = '' }} />
        <ul className="assigned-file-list">{rows.map(item => <li key={item.id}><FileText size={19} /><div><strong>{item.file.name}</strong><span>{(item.file.size / 1024).toFixed(1)} KB · {item.state}</span>{item.upload_error && <span className="form-error">{item.upload_error}</span>}</div>
          {item.upload_error && <button className="btn-secondary" disabled={busy} onClick={() => retry(item)}>Retry</button>}<button className="modal-close" aria-label={`Remove ${item.file.name}`} disabled={busy} onClick={() => remove(item)}><X size={14} /></button></li>)}</ul>
      </> : row && <div className="form-grid-2">
        <div className="form-group"><label className="form-label" htmlFor="assigned-name">Name <span className="req">*</span></label><input id="assigned-name" aria-label="Name" className="form-control" maxLength={200} value={row.full_name} onChange={event => update({ full_name: event.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="assigned-mobile">Mobile Number <span className="req">*</span></label><input id="assigned-mobile" aria-label="Mobile Number" className="form-control" value={row.mobile_number} onChange={event => update({ mobile_number: event.target.value })} /></div>
        <AssignmentSelect label="Client" value={row.client_id} options={options.clients.map(client => ({ id: client.client_group_id || client.id, name: client.name || client.client_name, displayId: client.client_display_id }))} onChange={id => update({ client_id: id, job_id: '' })} disabled={optionsLoading} />
        <AssignmentSelect label="Mandate" value={row.job_id} options={options.jobs.filter(job => job.client_id === row.client_id && normalizeMandateStatus(job.mandate_status || job.status || job.priority) !== 'Completed').map(job => ({ id: job.id, name: job.title || job.role, displayId: job.job_display_id }))} onChange={id => update({ job_id: id })} disabled={!row.client_id || optionsLoading} />
        <div className="form-group"><label className="form-label" htmlFor="assignment-status">Status</label><select className="form-control" id="assignment-status" value={row.status} onChange={event => update({ status: event.target.value })}>{ASSIGNMENT_STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
        <AssignmentSelect label="Assign to Consultant" value={row.assigned_consultant_id} options={consultants} onChange={id => update({ assigned_consultant_id: id })} />
        <div className="form-group"><label className="form-label" htmlFor="assigned-date">Assigned Date</label><input id="assigned-date" className="form-control" value={formatDateDDMMYYYY(new Date().toISOString())} readOnly /></div>
      </div>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" disabled={busy || saving} onClick={step < 0 ? cancel : () => { setStep(step - 1); setError('') }}>{step < 0 ? 'Cancel' : 'Back'}</button>
      {step === rows.length - 1 && step >= 0 ? <button className="btn-primary" disabled={busy || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button> : <button className="btn-primary" disabled={busy || !rows.length || optionsLoading} onClick={next}>{busy ? 'Processing…' : 'Next'}</button>}
    </div>
  </div></div>, document.body)
}
