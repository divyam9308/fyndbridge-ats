import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, X } from 'lucide-react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useStaffDirectory } from '../hooks/useStaffDirectory'
import { useAuth } from '../context/useAuth'
import { lockBodyScroll } from '../utils/lockBodyScroll'
import { CRM_STATUSES, CRM_PROBABILITIES, CRM_SOURCES, commentDate, emptyContact, validateCrm } from '../utils/crm'
import { SECTOR_OPTIONS } from '../utils/sectorOptions'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import FormattedDateInput from './FormattedDateInput'
import { crmRequest } from '../services/crmApi'

export function CrmDialog({ title, onClose, busy = false, large = false, children, footer }) {
  const ref = useDialogFocus(onClose, { closeDisabled: busy })
  useEffect(() => lockBodyScroll({ preserveScrollbar: true }), [])
  return createPortal(<div className="modal-overlay"><div className={`modal-card${large ? ' modal-card-lg' : ''}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-header"><span className="modal-title">{title}</span><button type="button" className="modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button></div>
    {children}{footer && <div className="modal-footer">{footer}</div>}
  </div></div>, document.body)
}

export function CrmClientForm({ record, onClose, onSaved }) {
  const { user, session } = useAuth()
  const { staff, selectableStaff, loading: staffLoading } = useStaffDirectory()
  const [form, setForm] = useState(() => ({ organisation_name: '', contacts: [emptyContact()], sector: '', connected_through: '', conversion_probability: '', status: '', assigned_consultant_id: user?.id || session?.user?.id || '', next_follow_up_date: '', ...record, comment: record?.latest_comment?.body || '' }))
  const [target, setTarget] = useState(record)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const [details, setDetails] = useState(false)
  const [conflict, setConflict] = useState(false)
  const saving = useRef(false)
  const inputRefs = useRef({})
  const set = (key, value) => { setForm(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })) }
  const contactSet = (index, key, value) => set('contacts', form.contacts.map((contact, i) => i === index ? { ...contact, [key]: value } : contact))
  const save = async event => {
    event.preventDefault()
    if (saving.current) return
    const nextErrors = validateCrm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) { inputRefs.current[Object.keys(nextErrors)[0]]?.focus(); return }
    saving.current = true; setBusy(true); setError(''); setConflict(false)
    try {
      const comment = form.comment.trim() === (target?.latest_comment?.body || '') ? '' : form.comment.trim()
      const { data } = await crmRequest(target ? `/${target.id}` : '', { method: target ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, comment, version: target?.version }) })
      onSaved(data); onClose()
    } catch (failure) {
      if (failure.duplicate && failure.existing) setDuplicate(failure.existing)
      else { setError(failure.message); setConflict(failure.status === 409) }
    } finally { saving.current = false; setBusy(false) }
  }
  const selectDuplicate = async () => {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      if (duplicate.source === 'crm') {
        const { data } = await crmRequest(`/${duplicate.id}`)
        setTarget(data)
        setForm({ ...data, contacts: [...data.contacts, ...form.contacts.filter(contact => (contact.name || contact.mobile || contact.email) && !data.contacts.some(existing => existing.email.trim().toLowerCase() === contact.email.trim().toLowerCase() || existing.mobile.replace(/\s+/g, '') === contact.mobile.replace(/\s+/g, '')))], comment: form.comment })
      } else {
        // Select the existing ATS identity, but save only in CRM.
        setForm(current => ({ ...current, organisation_name: duplicate.organisation_name, ats_client_id: duplicate.id }))
      }
      setDuplicate(null); setDetails(false)
    } catch (failure) { setError(failure.message) }
    finally { saving.current = false; setBusy(false) }
  }
  const reload = async () => {
    setBusy(true)
    try { const { data } = await crmRequest(`/${target.id}`); setTarget(data); setForm({ ...data, comment: data.latest_comment?.body || '' }); setError(''); setConflict(false) } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const field = (key, label, { required = false, type = 'text', value = form[key] || '', onChange = value => set(key, value), options, maxLength } = {}) => <div className="form-group" key={key}>
    <label className="form-label" htmlFor={`crm-${key}`}>{label}{required && <span className="required"> *</span>}</label>
    {options ? <select id={`crm-${key}`} className="form-control" disabled={busy} value={value} onChange={event => onChange(event.target.value)}><option value="">-</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select> :
      <input id={`crm-${key}`} ref={node => { inputRefs.current[key] = node }} className={`form-control${errors[key] ? ' is-error' : ''}`} type={type} required={required} maxLength={maxLength || 500} value={value} disabled={busy} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `crm-error-${key}` : undefined} onChange={event => onChange(event.target.value)} />}
    {errors[key] && <span id={`crm-error-${key}`} className="form-error">{errors[key]}</span>}
  </div>
  const assigned = form.assigned_consultant_id || ''
  const historical = assigned && !selectableStaff.some(person => person.user_id === assigned)
  return <CrmDialog key={duplicate ? 'duplicate' : 'form'} title={duplicate ? 'Duplicate Client' : target ? 'Edit Client' : 'Add Client'} onClose={duplicate ? () => { setDuplicate(null); setDetails(false) } : onClose} busy={busy} large={!duplicate} footer={duplicate ? <>
    <button className="btn-secondary" onClick={() => setDetails(value => !value)} disabled={busy}>View More</button>
    <button className="btn-secondary" onClick={() => { setDuplicate(null); setDetails(false) }} disabled={busy}>Cancel</button>
    <button className="btn-primary" onClick={selectDuplicate} disabled={busy}>{duplicate.source === 'crm' ? 'Update Client' : 'Select Existing Client'}</button>
  </> : <><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="crm-client-form" className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></>}>
    {duplicate ? <div className="modal-body">
      <p className="form-error">Client already exists. Select the existing client or add a contact person under that client.</p>
      <div className="duplicate-compare-grid"><div className="duplicate-compare-card"><div className="section-label">Existing Client · {duplicate.source === 'crm' ? 'CRM' : 'ATS Clients'}</div><div className="name-text">{duplicate.organisation_name}</div></div><div className="duplicate-compare-card"><div className="section-label">New Client</div><div className="name-text">{form.organisation_name}</div></div></div>
      {details && <div className="crm-history-entry">{duplicate.contacts?.map((contact, index) => <p key={index}>{contact.name} · {contact.mobile} · {contact.email}</p>)}{duplicate.source === 'clients' && <p>Selecting this client links its existing identity to a separate CRM record. ATS Client details are unchanged.</p>}</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div> : <form id="crm-client-form" className="modal-body" onSubmit={save} noValidate>
      {error && <div className="crm-error" role="alert">{error}{conflict && <button type="button" className="btn-secondary" onClick={reload} disabled={busy}>Reload latest (discard these edits)</button>}</div>}
      <fieldset disabled={busy} className="crm-form-fields"><div className="form-grid-2">
        {field('organisation_name', 'Organisation Name', { required: true, maxLength: 200 })}
        <div className="form-group"><label className="form-label" htmlFor="crm-created">Date</label><input id="crm-created" className="form-control" value={target ? formatDateDDMMYYYY(target.created_at) : 'Automatically set on save'} readOnly /></div>
      </div>
      {form.contacts.map((contact, index) => <section className="crm-contact-form" key={index} aria-label={`Contact ${index + 1}`}>
        <div className="crm-contact-heading"><span className="section-label">Contact {index + 1}</span>{form.contacts.length > 1 && <button type="button" className="row-action-btn" title={`Remove Contact ${index + 1}`} onClick={() => set('contacts', form.contacts.filter((_, i) => i !== index))}><Trash2 size={14} /></button>}</div>
        <div className="form-grid-2">{[['name', 'Contact Person', true], ['mobile', 'Mobile', true], ['email', 'Email', true], ['designation', 'Designation'], ['linkedin', 'LinkedIn']].map(([key, label, required]) => field(`contacts.${index}.${key}`, label, { value: contact[key] || '', required, type: key === 'email' ? 'email' : 'text', maxLength: key === 'name' ? 200 : key === 'mobile' ? 100 : key === 'email' ? 320 : 500, onChange: value => contactSet(index, key, value) }))}</div>
      </section>)}
      <button type="button" className="btn-secondary crm-add-contact" disabled={form.contacts.length >= 50} onClick={() => set('contacts', [...form.contacts, emptyContact()])}><Plus size={14} /> Add Contact Person</button>
      <div className="form-grid-2">
        {field('sector', 'Sector', { options: SECTOR_OPTIONS })}{field('connected_through', 'Connected Through', { options: CRM_SOURCES })}
        {field('conversion_probability', 'Conversion Probability', { options: CRM_PROBABILITIES })}{field('status', 'Status', { options: CRM_STATUSES })}
        <div className="form-group"><label className="form-label" htmlFor="crm-assigned">Assigned Consultant</label><select id="crm-assigned" className="form-control" value={assigned} onChange={event => set('assigned_consultant_id', event.target.value)} disabled={busy || staffLoading}>
          <option value="">-</option>{historical && <option value={assigned}>{staff.find(person => person.user_id === assigned)?.name || (assigned === (user?.id || session?.user?.id) ? user?.profile_name || user?.email : 'Unavailable employee')} {target ? '(inactive / unavailable)' : ''}</option>}
          {selectableStaff.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
        </select></div>
        <div className="form-group"><label className="form-label" htmlFor="crm-follow-up">Next Follow-up Date</label><FormattedDateInput floating id="crm-follow-up" value={form.next_follow_up_date || ''} onChange={value => set('next_follow_up_date', value)} disabled={busy} /></div>
        <div className="form-group full"><label className="form-label" htmlFor="crm-comment">Comments</label><textarea id="crm-comment" className="form-control" rows={3} value={form.comment} maxLength={10000} onChange={event => set('comment', event.target.value)} />{target && <span className="sub-text">Saving a changed comment adds a new history entry. Leave empty to keep the existing comment.</span>}</div>
      </div></fieldset>
    </form>}
  </CrmDialog>
}

const ACTIVITY_LABELS = { created: 'CRM client created', status_changed: 'Status changed', conversion_probability_changed: 'Conversion probability changed', connected_through_changed: 'Connected Through changed', comment_added: 'Comment added', next_follow_up_date_changed: 'Follow-up date changed', assigned_consultant_id_changed: 'Assigned consultant changed', contacts_changed: 'Contact information updated', organisation_name_changed: 'Organisation name changed', sector_changed: 'Sector changed' }
function activityValue(value, type) {
  if (value === null || value === undefined || value === '') return '-'
  if (type === 'contacts_changed') return value.map(contact => [contact.name, contact.mobile, contact.email, contact.designation, contact.linkedin].filter(Boolean).join(' · ')).join('; ')
  if (type === 'next_follow_up_date_changed') return formatDateDDMMYYYY(value)
  return String(value)
}
function EmailActivity({ email }) {
  const date = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST' : '-'
  const label = value => String(value || '').replaceAll('_', ' ')
  return <>
    <strong>{email.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} email · Gmail</strong>
    <div className="sub-text">{date(email.email_at)}</div>
    <p><strong>From:</strong> {email.sender}<br /><strong>To:</strong> {(email.recipients || []).join(', ')}</p>
    <p><strong>Subject:</strong> {email.subject}</p>
    <p><strong>AI summary:</strong> {email.summary}</p>
    {email.meeting && <div className="crm-email-insight crm-email-meeting"><strong>Meeting {label(email.meeting.status)}</strong>{email.meeting.when && <p>{email.meeting.when}</p>}<p>{email.meeting.evidence}</p></div>}
    {email.negative_response && <div className="crm-email-insight crm-email-negative"><strong>{label(email.negative_response.category)} · {label(email.negative_response.permanence)}</strong><p>{email.negative_response.evidence}</p></div>}
    <p><span className={`badge crm-email-sentiment-${['positive','neutral','negative'].includes(email.sentiment?.label) ? email.sentiment.label : 'unknown'}`}>Client interest: {email.sentiment?.label === 'unknown' ? 'Not assessable' : label(email.sentiment?.label || 'unknown')}</span></p>
    {email.sentiment?.evidence && <p className="sub-text">{email.sentiment.evidence}</p>}
  </>
}
export function CrmHistory({ record, kind, onClose }) {
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    crmRequest(`/${record.id}/${kind}?page=${page}`, { signal: controller.signal }).then(result => { setRows(result.data); setTotal(result.total); setError('') }).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [kind, page, record.id, retry])
  return <CrmDialog title={kind === 'comments' ? 'Comment History' : 'Activity History'} onClose={onClose} footer={<>
    <button className="btn-secondary" disabled={page === 1 || loading} onClick={() => { setLoading(true); setPage(value => value - 1) }}>Previous</button><span className="sub-text">Page {page} of {Math.max(1, Math.ceil(total / 25))}</span><button className="btn-secondary" disabled={page * 25 >= total || loading} onClick={() => { setLoading(true); setPage(value => value + 1) }}>Next</button>
  </>}><div className="modal-body"><div className="name-text">{record.organisation_name}</div>{loading ? <p role="status">Loading history...</p> : error ? <div role="alert" className="form-error">{error}<button className="btn-secondary" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Retry</button></div> : !rows.length ? <p className="sub-text">No {kind === 'comments' ? 'comments' : 'activities'} yet.</p> : rows.map(row => <div className="crm-history-entry" key={row.id}>
      <div className="sub-text">{commentDate(row.created_at)}</div>{kind === 'comments' ? <p>{row.body}</p> : row.activity_type === 'gmail_email' && row.email_metadata ? <EmailActivity email={row.email_metadata} /> : <><strong>{ACTIVITY_LABELS[row.activity_type] || row.activity_type}</strong>{row.comment_body ? <p>{row.comment_body}</p> : row.activity_type !== 'created' && <p>{row.previous_label || activityValue(row.previous_value, row.activity_type)} → {row.new_label || activityValue(row.new_value, row.activity_type)}</p>}</>}
      <div className="sub-text">{row.activity_type === 'gmail_email' ? 'Gmail activity for' : 'By'} {row.actor_name}</div>
    </div>)}</div></CrmDialog>
}
