import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCheck, ChevronDown, CalendarClock, History, Info, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { CrmClientForm, CrmDialog, CrmHistory } from '../components/CrmDialogs'
import CrmGmailConnection from '../components/CrmGmailConnection'
import { CrmSummaryContent, summaryPlainText } from '../components/CrmOrganisationSummary'
import PaginationBar from '../components/PaginationBar'
import TablePopover from '../components/TablePopover'
import FormattedDateInput from '../components/FormattedDateInput'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { crmRequest } from '../services/crmApi'
import { CRM_BADGES, CRM_STATUSES, CRM_PROBABILITIES, CRM_SOURCES, commentDate, followUpState, validLinkedIn } from '../utils/crm'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { previewWords } from '../utils/tableText'
import '../styles/Shared.css'
import './CrmPage.css'

const COLUMNS = ['Organisation Name', 'About Organisation', 'Contact Person', 'Mobile', 'Email', 'Designation', 'LinkedIn', 'Sector', 'Connected Through', 'Date', 'Comments', 'Conversion Probability', 'Status', 'Actions']
const WIDTHS = [235, 215, 210, 160, 240, 190, 115, 185, 180, 125, 300, 195, 200, 190]
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
  const [statusUpdateError, setStatusUpdateError] = useState('')
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState(null)
  const [summaryTarget, setSummaryTarget] = useState(null)
  const [selectedContacts, setSelectedContacts] = useState({})
  const [popover, setPopover] = useState(null)
  const [comment, setComment] = useState(null)
  const [expandedComments, setExpandedComments] = useState({})
  const [followEditor, setFollowEditor] = useState(null)
  const [busy, setBusy] = useState({})
  const [readingAll, setReadingAll] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const commentDrafts = useRef(new Map())
  const locks = useRef(new Set())
  const generation = useRef(0)
  const mounted = useRef(true)
  const refreshActivities = useCallback(() => { ++generation.current; setRevision(value => value + 1) }, [])
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
      if (requestGeneration !== generation.current || locks.current.size) return
      setRows(result.data); setTotal(result.total); setToday(result.today); setError('')
      if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)))
    }).catch(failure => { if (!controller.signal.aborted && failure.name !== 'AbortError' && requestGeneration === generation.current && !locks.current.size) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [follow, page, pageSize, query, revision, sort])
  // Re-evaluate company-local follow-up boundaries after midnight / returning to tab.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(value => value + 1) }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  const readAll = async () => {
    if (locks.current.has('read-all')) return
    locks.current.add('read-all'); setReadingAll(true); setError('')
    ++generation.current
    try {
      await crmRequest('/activities/read-all', { method: 'POST', body: '{}' })
      if (mounted.current) refreshActivities()
    } catch (failure) { if (mounted.current) setError(failure.message) }
    finally { locks.current.delete('read-all'); if (mounted.current) setReadingAll(false) }
  }
  // Save responses omit unread metadata. Preserve it until the background list refresh.
  const replace = useCallback(record => setRows(current => current.map(row => row.id === record.id ? { ...row, ...record } : row)), [])
  const reloadRow = async record => {
    if (locks.current.has(record.id)) return
    const requestGeneration = generation.current
    try {
      const { data } = await crmRequest(`/${record.id}`)
      if (requestGeneration !== generation.current || locks.current.has(record.id) || !mounted.current) return
      replace(data); setComment(current => current?.record.id === data.id ? { ...current, record: data } : current); setError('')
    } catch (failure) { if (requestGeneration === generation.current && mounted.current) setError(failure.message) }
  }
  const update = async (record, values) => {
    if (locks.current.has(record.id)) return false
    const instant = Object.keys(values).every(key => ['status', 'conversion_probability', 'connected_through'].includes(key))
    locks.current.add(record.id); setBusy(current => ({ ...current, [record.id]: true })); setError('')
    if (instant) { setStatusUpdateError(''); replace({ id: record.id, ...values }) }
    // Invalidate in-flight list responses so they cannot replace a successful edit.
    ++generation.current
    try {
      const { data } = await crmRequest(`/${record.id}`, { method: 'PATCH', body: JSON.stringify({ ...values, version: record.version }) })
      if (mounted.current) { ++generation.current; replace(data); setRevision(value => value + 1) }
      return true
    } catch (failure) {
      if (mounted.current) {
        if (instant) {
          replace({ id: record.id, ...Object.fromEntries(Object.keys(values).map(key => [key, record[key]])) })
          setStatusUpdateError(failure.message)
        } else setError(failure.message)
      }
      return false
    } finally {
      locks.current.delete(record.id)
      if (mounted.current) { setBusy(current => ({ ...current, [record.id]: false })); if (!locks.current.size) refreshActivities() }
    }
  }
  const openPopover = (record, field, options, element) => setPopover({ record, field, options, anchorRect: element.getBoundingClientRect() })
  const drop = (record, field, options) => <button type="button" className={field === 'connected_through' ? 'filter-select compact-select' : `badge ${CRM_BADGES[record[field]] || 'badge-status-unset'}`} disabled={busy[record.id]} aria-label={`Edit ${field.replaceAll('_', ' ')} for ${record.organisation_name}`} onClick={event => openPopover(record, field, options, event.currentTarget)}>{record[field] || '-'}</button>
  const configure = setter => value => { setLoading(true); setPage(1); setter(value) }
  const saved = record => { replace(record); setRevision(value => value + 1) }
  const deleteContact = async record => {
    const index = selectedContacts[record.id] || 0
    if (record.contacts.length <= 1) return
    if (!window.confirm(`Delete ${record.contacts[index]?.name || 'this contact'}?`)) return
    if (await update(record, { contacts: record.contacts.filter((_, i) => i !== index) })) setSelectedContacts(current => ({ ...current, [record.id]: 0 }))
  }
  const openEdit = record => setForm({ record, refreshLatest: true })
  const deleteOrganisation = async () => {
    const record = deleteTarget
    if (!record || locks.current.has(record.id)) return
    locks.current.add(record.id); setBusy(current => ({ ...current, [record.id]: true })); setDeleteError('')
    ++generation.current
    try {
      await crmRequest(`/${record.id}`, { method: 'DELETE', body: JSON.stringify({ version: record.version }) })
      if (mounted.current) {
        setRows(current => current.filter(row => row.id !== record.id))
        setTotal(current => Math.max(0, current - 1))
        commentDrafts.current.delete(record.id)
        setComment(current => current?.record.id === record.id ? null : current)
        setDeleteTarget(null); setLoading(true); refreshActivities()
      }
    } catch (failure) {
      if (mounted.current) { setDeleteError(failure.message); if (failure.status === 409) refreshActivities() }
    } finally { locks.current.delete(record.id); if (mounted.current) setBusy(current => ({ ...current, [record.id]: false })) }
  }
  return <div className="crm-page">
    <div className="crm-toolbar"><button type="button" className="btn-primary" aria-label="Add Client" onClick={() => setForm({ record: null })}><Plus size={16} /> New</button>
      <div className="crm-search"><Search size={15} /><input className="form-control" aria-label="Search CRM" placeholder="Search CRM..." value={search} onChange={event => setSearch(event.target.value)} /></div>
      <button type="button" className="btn-secondary crm-read-all" disabled={readingAll} aria-busy={readingAll} onClick={readAll}><CheckCheck size={16} />{readingAll ? 'Marking read...' : 'Read all'}</button>
      <select className="filter-select" aria-label="Follow-up filter" value={follow} onChange={event => configure(setFollow)(event.target.value)}><option value="all">All Follow-ups</option>{Object.entries(FOLLOW_LABELS).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select>
      <select className="filter-select" aria-label="Sort CRM" value={sort} onChange={event => configure(setSort)(event.target.value)}><option value="created_at:desc">Newest first</option><option value="created_at:asc">Oldest first</option><option value="conversion_probability:desc">Probability: highest to lowest</option><option value="organisation_name:asc">Organisation A–Z</option><option value="organisation_name:desc">Organisation Z–A</option></select>
      <CrmGmailConnection onSynced={refreshActivities} />
    </div>
    {(error || statusUpdateError) && <div className="crm-error" role="alert">{statusUpdateError || error}<button className="btn-secondary" onClick={() => { setStatusUpdateError(''); setLoading(true); setRevision(value => value + 1) }}>Reload table</button></div>}
    <div className="table-card"><div className="table-wrapper crm-table-scroll"><table className="data-table fb-theme-table crm-table"><colgroup>{WIDTHS.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
      <thead><tr>{COLUMNS.map(label => <th key={label} scope="col">{['Organisation Name', 'Date'].includes(label) ? <button className="crm-sort-heading" onClick={() => configure(setSort)(`${label === 'Organisation Name' ? 'organisation_name' : 'created_at'}:${sort.endsWith('asc') ? 'desc' : 'asc'}`)}>{label} ↕</button> : label}</th>)}</tr></thead>
      <tbody>{loading && !rows.length ? <tr><td colSpan={COLUMNS.length}><div className="crm-empty"><FyndbridgeLoader /></div></td></tr> : !rows.length ? <tr><td colSpan={COLUMNS.length}><div className="crm-empty">{error ? 'Unable to load CRM clients.' : search || follow !== 'all' ? 'No matching CRM clients.' : 'No CRM clients yet.'}</div></td></tr> : rows.map(record => {
        const contactIndex = Math.min(selectedContacts[record.id] || 0, record.contacts.length - 1)
        const contact = record.contacts[contactIndex]
        const state = followUpState(record.next_follow_up_date, today)
        const commentBody = record.latest_comment?.body || ''
        const { isLong, preview } = previewWords(commentBody, 3)
        const about = previewWords(summaryPlainText(record.organisation_summary), 5)
        const expanded = Boolean(record.latest_comment && expandedComments[record.id] === record.latest_comment.id)
        const unreadTone = record.unread_activity_count > 0 && ['positive', 'neutral', 'negative'].includes(record.unread_tone) ? record.unread_tone : null
        return <tr key={record.id} className={unreadTone ? `crm-unread-${unreadTone}` : undefined} aria-busy={Boolean(busy[record.id])}>
          <td><span className="name-text">{record.organisation_name}</span>{unreadTone && <span className="crm-unread-label">{record.unread_activity_count} unread {unreadTone === 'positive' ? 'updates' : `${unreadTone} updates`}</span>}<button className={`crm-follow crm-follow-${state}`} type="button" title={record.next_follow_up_date ? `Next follow-up: ${formatDateDDMMYYYY(record.next_follow_up_date)}` : 'Set follow-up date'} onClick={() => setFollowEditor({ record, value: record.next_follow_up_date || '' })}>{FOLLOW_LABELS[state]}{record.next_follow_up_date ? ` · ${formatDateDDMMYYYY(record.next_follow_up_date)}` : ''}</button></td>
          <td className="crm-summary-cell">{about.preview ? <><span>{about.preview}{about.isLong ? '…' : ''}</span><button type="button" className="table-view-more" aria-label={`View more about ${record.organisation_name}`} aria-haspopup="dialog" onClick={() => setSummaryTarget(record)}>View more</button></> : <span className="sub-text">-</span>}</td>
          <td className="crm-contact-cell"><span className="inline-action-cell">{record.contacts.length > 1 ? <><select className="filter-select compact-select" aria-label={`Contact for ${record.organisation_name}`} value={contactIndex} onChange={event => setSelectedContacts(current => ({ ...current, [record.id]: Number(event.target.value) }))}>{record.contacts.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select><button type="button" className="row-action-btn" title="Delete Contact" disabled={busy[record.id]} onClick={() => deleteContact(record)}><Trash2 size={12} /></button></> : <span className="crm-contact-name">{contact.name}</span>}<button type="button" className="row-action-btn" title="Add Contact" onClick={() => setForm({ record: { ...record, contacts: [...record.contacts, { name: '', mobile: '', email: '', designation: '', linkedin: '' }] } })}><Plus size={12} /></button></span></td>
          <td className="crm-mobile">{contact.mobile || '-'}</td><td className="crm-email">{contact.email || '-'}</td><td>{contact.designation || '-'}</td>
          <td>{contact.linkedin && validLinkedIn(contact.linkedin) ? <a href={contact.linkedin} className="candidate-linkedin-link" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a> : '-'}</td>
          <td>{record.sector || '-'}</td><td>{drop(record, 'connected_through', CRM_SOURCES)}</td><td>{formatDateDDMMYYYY(record.created_at)}</td>
          <td className="crm-comment-cell"><button type="button" className="row-action-btn crm-comment-info" aria-label={`Comment history for ${record.organisation_name}`} onClick={() => setHistory({ record, kind: 'comments' })}><Info size={14} /></button>
            {comment?.record.id === record.id ? <div className="crm-inline-comment"><textarea className="form-control" aria-label="New comment" rows={3} maxLength={10000} value={comment.value} onChange={event => { commentDrafts.current.set(record.id, event.target.value); setComment(current => ({ ...current, value: event.target.value })) }} disabled={busy[record.id]} autoFocus /><div><button className="btn-primary" disabled={busy[record.id] || !comment.value.trim()} onClick={async () => { if (await update(comment.record, { comment: comment.value.trim() })) { commentDrafts.current.delete(record.id); setComment(null) } }}>Save</button><button className="btn-secondary" disabled={busy[record.id]} onClick={() => { commentDrafts.current.delete(record.id); setComment(null) }}>Cancel</button><button className="row-action-btn" title="Reload latest record (keep draft)" onClick={() => reloadRow(record)}>↻</button></div></div> : <div className="table-comment-cell">
              <button type="button" className={`crm-comment-text table-comment-text${expanded ? ' is-expanded' : ''}`} onClick={() => setComment({ record, value: commentDrafts.current.get(record.id) || '' })}>{record.latest_comment ? `${commentDate(record.latest_comment.created_at)} - ${expanded || !isLong ? commentBody : preview}` : 'Add comment'}</button>
              {isLong && <button type="button" className="table-view-more" aria-expanded={expanded} onClick={() => setExpandedComments(current => ({ ...current, [record.id]: expanded ? null : record.latest_comment.id }))}><ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'View less' : 'View more'}</button>}
            </div>}
          </td><td>{drop(record, 'conversion_probability', CRM_PROBABILITIES)}</td><td>{drop(record, 'status', CRM_STATUSES)}</td>
          <td><div className="inline-action-cell"><button type="button" className="row-action-btn" title="Edit Client" onClick={() => openEdit(record)} disabled={busy[record.id]}><Pencil size={14} /></button><button type="button" className="row-action-btn" title="Activity History" onClick={() => setHistory({ record, kind: 'activities' })}><History size={14} /></button><button type="button" className="row-action-btn" title="Edit Follow-up" onClick={() => setFollowEditor({ record, value: record.next_follow_up_date || '' })}><CalendarClock size={14} /></button><button type="button" className="row-action-btn crm-delete-organisation" title="Delete Organisation" aria-label={`Delete organisation ${record.organisation_name}`} disabled={busy[record.id]} onClick={() => { setDeleteError(''); setDeleteTarget(record) }}><Trash2 size={14} /></button></div></td>
        </tr>
      })}</tbody>
    </table></div></div>
    <PaginationBar page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} total={total} pageSize={pageSize} loading={loading || search !== query} onPageChange={value => { setLoading(true); setPage(value) }} onPageSizeChange={configure(setPageSize)} />
    {popover && <TablePopover anchorRect={popover.anchorRect} width={210} onClose={() => setPopover(null)}>{['', ...popover.options].map(option => <button className="candidate-columns-action" key={option} disabled={busy[popover.record.id]} onClick={async () => {
      if (option === (popover.record[popover.field] || '')) { setPopover(null); return }
      setPopover(null)
      void update(popover.record, { [popover.field]: option })
    }}>{option || '-'}</button>)}</TablePopover>}
    {form && <CrmClientForm key={form.record?.id || 'new'} record={form.record} refreshLatest={form.refreshLatest} onClose={() => setForm(null)} onSaved={saved} />}
    {summaryTarget && <CrmDialog title={`About ${summaryTarget.organisation_name}`} onClose={() => setSummaryTarget(null)} footer={<button type="button" className="btn-secondary" onClick={() => setSummaryTarget(null)}>Close</button>}><div className="modal-body crm-summary-popup"><CrmSummaryContent summary={summaryTarget.organisation_summary} /></div></CrmDialog>}
    {history && <CrmHistory key={`${history.record.id}:${history.kind}`} {...history} onRead={refreshActivities} onClose={() => setHistory(null)} />}
    {deleteTarget && <CrmDialog title="Delete Organisation" busy={Boolean(busy[deleteTarget.id])} onClose={() => setDeleteTarget(null)} footer={<><button type="button" className="btn-secondary" disabled={busy[deleteTarget.id]} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="btn-primary crm-confirm-delete" disabled={busy[deleteTarget.id]} onClick={deleteOrganisation}>{busy[deleteTarget.id] ? 'Deleting...' : 'Delete organisation'}</button></>}><div className="modal-body"><p>Permanently delete <strong>{deleteTarget.organisation_name}</strong> and its CRM contacts, comments and activity history?</p><p className="sub-text">This cannot be undone. Linked ATS clients, mandates, candidates and Gmail connections are preserved.</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}</div></CrmDialog>}
    {followEditor && <CrmDialog title="Next Follow-up Date" onClose={() => setFollowEditor(null)} busy={busy[followEditor.record.id]} footer={<><button className="btn-secondary" disabled={busy[followEditor.record.id]} onClick={() => setFollowEditor(null)}>Cancel</button><button className="btn-primary" disabled={busy[followEditor.record.id]} onClick={async () => { if (await update(followEditor.record, { next_follow_up_date: followEditor.value })) setFollowEditor(null) }}>Save</button></>}><div className="modal-body"><label className="form-label" htmlFor="crm-row-follow-up">{followEditor.record.organisation_name}</label><FormattedDateInput floating id="crm-row-follow-up" value={followEditor.value} onChange={value => setFollowEditor(current => ({ ...current, value }))} disabled={busy[followEditor.record.id]} />{error && <p className="form-error" role="alert">{error}</p>}</div></CrmDialog>}
  </div>
}
