import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, History, Info, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { CrmClientForm, CrmDialog, CrmHistory } from '../components/CrmDialogs'
import PaginationBar from '../components/PaginationBar'
import TablePopover from '../components/TablePopover'
import FormattedDateInput from '../components/FormattedDateInput'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { crmRequest } from '../services/crmApi'
import { CRM_BADGES, CRM_STATUSES, CRM_PROBABILITIES, CRM_SOURCES, commentDate, followUpState, validLinkedIn } from '../utils/crm'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import '../styles/Shared.css'
import './CrmPage.css'

const COLUMNS = ['Organisation Name', 'Contact Person', 'Mobile', 'Email', 'Designation', 'LinkedIn', 'Sector', 'Connected Through', 'Date', 'Comments', 'Conversion Probability', 'Status', 'Actions']
const WIDTHS = [235, 210, 160, 240, 190, 115, 185, 180, 125, 300, 195, 200, 150]
const FOLLOW_LABELS = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', none: 'No Follow-up' }

export default function CrmPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [today, setToday] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState('all')
  const [sort, setSort] = useState('created_at:desc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState(null)
  const [selectedContacts, setSelectedContacts] = useState({})
  const [popover, setPopover] = useState(null)
  const [comment, setComment] = useState(null)
  const [followEditor, setFollowEditor] = useState(null)
  const [busy, setBusy] = useState({})
  const commentDrafts = useRef(new Map())
  const locks = useRef(new Set())
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (search === query) return undefined
    const timer = window.setTimeout(() => { setQuery(search); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [query, search])
  useEffect(() => {
    const controller = new AbortController()
    const requestGeneration = ++generation.current
    const [field, direction] = sort.split(':')
    const params = new URLSearchParams({ search: query, page, pageSize, follow_up: follow, sort: field, direction })
    crmRequest(`?${params}`, { signal: controller.signal }).then(result => {
      if (requestGeneration !== generation.current) return
      setRows(result.data); setTotal(result.total); setToday(result.today); setError('')
      if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)))
    }).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [follow, page, pageSize, query, revision, sort])
  // Re-evaluate company-local follow-up boundaries after midnight / returning to tab.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(value => value + 1) }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const replace = useCallback(record => setRows(current => current.map(row => row.id === record.id ? record : row)), [])
  const reloadRow = async record => {
    try { const { data } = await crmRequest(`/${record.id}`); replace(data); setComment(current => current?.record.id === data.id ? { ...current, record: data } : current); setError('') } catch (failure) { setError(failure.message) }
  }
  const update = async (record, values) => {
    if (locks.current.has(record.id)) return false
    locks.current.add(record.id); setBusy(current => ({ ...current, [record.id]: true })); setError('')
    // Invalidate in-flight list responses so they cannot replace a successful edit.
    ++generation.current
    try {
      const { data } = await crmRequest(`/${record.id}`, { method: 'PATCH', body: JSON.stringify({ ...values, version: record.version }) })
      if (mounted.current) { ++generation.current; replace(data); setRevision(value => value + 1) }
      return true
    } catch (failure) { if (mounted.current) setError(failure.message); return false }
    finally { locks.current.delete(record.id); if (mounted.current) setBusy(current => ({ ...current, [record.id]: false })) }
  }
  const openPopover = (record, field, options, element) => setPopover({ record, field, options, anchorRect: element.getBoundingClientRect() })
  const drop = (record, field, options) => <button type="button" className={field === 'connected_through' ? 'filter-select compact-select' : `badge ${CRM_BADGES[record[field]] || 'badge-status-unset'}`} disabled={busy[record.id]} aria-label={`Edit ${field.replaceAll('_', ' ')} for ${record.organisation_name}`} onClick={event => openPopover(record, field, options, event.currentTarget)}>{record[field] || '-'} ▾</button>
  const configure = setter => value => { setLoading(true); setPage(1); setter(value) }
  const saved = record => { replace(record); setRevision(value => value + 1) }
  const deleteContact = async record => {
    const index = selectedContacts[record.id] || 0
    if (record.contacts.length <= 1) return
    if (!window.confirm(`Delete ${record.contacts[index]?.name || 'this contact'}?`)) return
    if (await update(record, { contacts: record.contacts.filter((_, i) => i !== index) })) setSelectedContacts(current => ({ ...current, [record.id]: 0 }))
  }
  const openEdit = async record => {
    try { const { data } = await crmRequest(`/${record.id}`); setForm({ record: data }) } catch (failure) { setError(failure.message) }
  }
  return <div className="crm-page">
    <div className="page-header"><h1 className="page-title">CRM</h1></div>
    <div className="crm-toolbar"><button type="button" className="btn-primary" onClick={() => setForm({ record: null })}><Plus size={16} /> Add Client</button>
      <div className="crm-search"><Search size={15} /><input className="form-control" aria-label="Search CRM" placeholder="Search CRM..." value={search} onChange={event => setSearch(event.target.value)} /></div>
      <select className="filter-select" aria-label="Follow-up filter" value={follow} onChange={event => configure(setFollow)(event.target.value)}><option value="all">All Follow-ups</option>{Object.entries(FOLLOW_LABELS).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select>
      <select className="filter-select" aria-label="Sort CRM" value={sort} onChange={event => configure(setSort)(event.target.value)}><option value="created_at:desc">Newest first</option><option value="created_at:asc">Oldest first</option><option value="organisation_name:asc">Organisation A–Z</option><option value="organisation_name:desc">Organisation Z–A</option></select>
    </div>
    {error && <div className="crm-error" role="alert">{error}<button className="btn-secondary" onClick={() => { setLoading(true); setRevision(value => value + 1) }}>Reload table</button></div>}
    <div className="table-card"><div className="table-wrapper crm-table-scroll"><table className="data-table fb-theme-table crm-table"><colgroup>{WIDTHS.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
      <thead><tr>{COLUMNS.map((label, index) => <th key={label} scope="col">{[0, 8].includes(index) ? <button className="crm-sort-heading" onClick={() => configure(setSort)(`${index === 0 ? 'organisation_name' : 'created_at'}:${sort.endsWith('asc') ? 'desc' : 'asc'}`)}>{label} ↕</button> : label}</th>)}</tr></thead>
      <tbody>{loading && !rows.length ? <tr><td colSpan={13}><div className="crm-empty"><FyndbridgeLoader /></div></td></tr> : !rows.length ? <tr><td colSpan={13}><div className="crm-empty">{error ? 'Unable to load CRM clients.' : search || follow !== 'all' ? 'No matching CRM clients.' : 'No CRM clients yet.'}</div></td></tr> : rows.map(record => {
        const contactIndex = Math.min(selectedContacts[record.id] || 0, record.contacts.length - 1)
        const contact = record.contacts[contactIndex]
        const state = followUpState(record.next_follow_up_date, today)
        return <tr key={record.id} aria-busy={Boolean(busy[record.id])}>
          <td><span className="name-text">{record.organisation_name}</span><button className={`crm-follow crm-follow-${state}`} type="button" title={record.next_follow_up_date ? `Next follow-up: ${formatDateDDMMYYYY(record.next_follow_up_date)}` : 'Set follow-up date'} onClick={() => setFollowEditor({ record, value: record.next_follow_up_date || '' })}>{FOLLOW_LABELS[state]}{record.next_follow_up_date ? ` · ${formatDateDDMMYYYY(record.next_follow_up_date)}` : ''}</button></td>
          <td><span className="inline-action-cell">{record.contacts.length > 1 ? <><select className="filter-select compact-select" aria-label={`Contact for ${record.organisation_name}`} value={contactIndex} onChange={event => setSelectedContacts(current => ({ ...current, [record.id]: Number(event.target.value) }))}>{record.contacts.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select><button type="button" className="row-action-btn" title="Delete Contact" disabled={busy[record.id]} onClick={() => deleteContact(record)}><Trash2 size={12} /></button></> : contact.name}<button type="button" className="row-action-btn" title="Add Contact" onClick={() => setForm({ record: { ...record, contacts: [...record.contacts, { name: '', mobile: '', email: '', designation: '', linkedin: '' }] } })}><Plus size={12} /></button></span></td>
          <td className="crm-mobile">{contact.mobile}</td><td className="crm-email">{contact.email}</td><td>{contact.designation || '-'}</td>
          <td>{contact.linkedin && validLinkedIn(contact.linkedin) ? <a href={contact.linkedin} className="candidate-linkedin-link" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a> : '-'}</td>
          <td>{record.sector || '-'}</td><td>{drop(record, 'connected_through', CRM_SOURCES)}</td><td>{formatDateDDMMYYYY(record.created_at)}</td>
          <td className="crm-comment-cell"><button type="button" className="row-action-btn crm-comment-info" aria-label={`Comment history for ${record.organisation_name}`} onClick={() => setHistory({ record, kind: 'comments' })}><Info size={14} /></button>
            {comment?.record.id === record.id ? <div className="crm-inline-comment"><textarea className="form-control" aria-label="New comment" rows={3} maxLength={10000} value={comment.value} onChange={event => { commentDrafts.current.set(record.id, event.target.value); setComment(current => ({ ...current, value: event.target.value })) }} disabled={busy[record.id]} autoFocus /><div><button className="btn-primary" disabled={busy[record.id] || !comment.value.trim()} onClick={async () => { if (await update(comment.record, { comment: comment.value.trim() })) { commentDrafts.current.delete(record.id); setComment(null) } }}>Save</button><button className="btn-secondary" disabled={busy[record.id]} onClick={() => { commentDrafts.current.delete(record.id); setComment(null) }}>Cancel</button><button className="row-action-btn" title="Reload latest record (keep draft)" onClick={() => reloadRow(record)}>↻</button></div></div> : <button type="button" className="crm-comment-text" onClick={() => setComment({ record, value: commentDrafts.current.get(record.id) || '' })}>{record.latest_comment ? `${commentDate(record.latest_comment.created_at)} - ${record.latest_comment.body}` : 'Add comment'}</button>}
          </td><td>{drop(record, 'conversion_probability', CRM_PROBABILITIES)}</td><td>{drop(record, 'status', CRM_STATUSES)}</td>
          <td><div className="inline-action-cell"><button type="button" className="row-action-btn" title="Edit Client" onClick={() => openEdit(record)} disabled={busy[record.id]}><Pencil size={14} /></button><button type="button" className="row-action-btn" title="Activity History" onClick={() => setHistory({ record, kind: 'activities' })}><History size={14} /></button><button type="button" className="row-action-btn" title="Edit Follow-up" onClick={() => setFollowEditor({ record, value: record.next_follow_up_date || '' })}><CalendarClock size={14} /></button></div></td>
        </tr>
      })}</tbody>
    </table></div></div>
    <PaginationBar page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} total={total} pageSize={pageSize} loading={loading || search !== query} onPageChange={value => { setLoading(true); setPage(value) }} onPageSizeChange={configure(setPageSize)} />
    {popover && <TablePopover anchorRect={popover.anchorRect} width={210} onClose={() => setPopover(null)}>{['', ...popover.options].map(option => <button className="candidate-columns-action" key={option} disabled={busy[popover.record.id]} onClick={async () => {
      if (option === (popover.record[popover.field] || '')) { setPopover(null); return }
      if (await update(popover.record, { [popover.field]: option })) setPopover(null)
    }}>{option || '-'}</button>)}</TablePopover>}
    {form && <CrmClientForm record={form.record} onClose={() => setForm(null)} onSaved={saved} />}
    {history && <CrmHistory {...history} onClose={() => setHistory(null)} />}
    {followEditor && <CrmDialog title="Next Follow-up Date" onClose={() => setFollowEditor(null)} busy={busy[followEditor.record.id]} footer={<><button className="btn-secondary" disabled={busy[followEditor.record.id]} onClick={() => setFollowEditor(null)}>Cancel</button><button className="btn-primary" disabled={busy[followEditor.record.id]} onClick={async () => { if (await update(followEditor.record, { next_follow_up_date: followEditor.value })) setFollowEditor(null) }}>Save</button></>}><div className="modal-body"><label className="form-label" htmlFor="crm-row-follow-up">{followEditor.record.organisation_name}</label><FormattedDateInput id="crm-row-follow-up" value={followEditor.value} onChange={value => setFollowEditor(current => ({ ...current, value }))} disabled={busy[followEditor.record.id]} />{error && <p className="form-error" role="alert">{error}</p>}</div></CrmDialog>}
  </div>
}
