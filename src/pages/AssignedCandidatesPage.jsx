import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import FloatingDropdown from '../components/FloatingDropdown'
import PaginationBar from '../components/PaginationBar'
import ReportKpiCard from '../components/ReportKpiCard'
import { CandidateName, ConsultantChip } from '../components/CandidateTableIdentity'
import { DocumentIconGroup } from '../components/DocumentAttachments'
import AssignmentWizard from '../features/assigned-candidates/AssignmentWizard'
import AssignmentTransferWizard from '../features/assigned-candidates/AssignmentTransferWizard'
import AssignmentSelectionDock from '../features/assigned-candidates/AssignmentSelectionDock'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_BADGE_MAP } from '../features/assigned-candidates/assignmentStatuses'
import AssignmentSelect from '../features/assigned-candidates/AssignmentSelect'
import AssignmentEditor from '../features/assigned-candidates/AssignmentEditor'
import { assignedRequest, assignmentsChanged, openAssignedCv } from '../services/assignedCandidatesApi'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { lockBodyScroll } from '../utils/lockBodyScroll'
import '../styles/Shared.css'
import './AssignedCandidatesPage.css'

const CandidateForm = lazy(() => import('./CandidatesPage'))
const ASSIGNMENT_KPIS = [
  ['Total Candidates', 'assigned', 'navy'],
  ['Added Candidates', 'added', 'green'],
  ['Didn’t Pick Up', 'did_not_pick_up', 'amber'],
  ['Not Contacted', 'not_contacted', 'neutral'],
  ['Interested', 'interested', 'blue'],
  ['Not Interested', 'not_interested', 'rose'],
  ['In Discussion', 'in_discussion', 'purple'],
  ['Rejected by Recruiter', 'rejected_by_recruiter', 'red'],
  ['Not Relevant', 'not_relevant', 'orange']
]
const canTransfer = row => !row.added_at && row.status !== 'Not Contacted' && row.status !== 'Didn’t Pick Up' && row.status !== 'Not Relevant'
// Row tone describes contact state; it no longer decides database order.
const rowTone = row => row.added_at ? 4 : row.status === 'Not Contacted' ? 0 : row.status === 'Didn’t Pick Up' ? 1 : row.status === 'Not Relevant' ? 2 : 3
function AssignmentDialog({ title, children, pending, onCancel, onConfirm, confirm = 'Yes, Delete', className = '' }) {
  const ref = useDialogFocus(onCancel, { closeDisabled: pending })
  useEffect(() => lockBodyScroll({ preserveScrollbar: true }), [])
  return createPortal(<div className="modal-overlay"><div className={`modal-card ${className}`} ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="assigned-dialog-title" tabIndex={-1}>
    <div className="modal-header"><span id="assigned-dialog-title" className="modal-title">{title}</span><button className="modal-close" aria-label="Close confirmation" disabled={pending} onClick={onCancel}><X size={16} /></button></div>
    <div className="modal-body">{children}</div><div className="modal-footer"><button className="btn-secondary" disabled={pending} onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={pending} onClick={onConfirm}>{pending ? 'Saving…' : confirm}</button></div>
  </div></div>, document.body)
}
export default function AssignedCandidatesPage() {
  const { user } = useAuth()
  const [scope, setScope] = useState('')
  const [filter, setFilter] = useState('assigned')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [notice, setNotice] = useState('')
  const [cleanupPending, setCleanupPending] = useState(false)
  const [wizard, setWizard] = useState(false)
  const [transfer, setTransfer] = useState(null)
  const [bulkTransfer, setBulkTransfer] = useState(null)
  const [selection, setSelection] = useState(() => new Map())
  const [confirm, setConfirm] = useState(null)
  const [pending, setPending] = useState(false)
  const [dropdown, setDropdown] = useState(null)
  const [menu, setMenu] = useState(null)
  const [reassign, setReassign] = useState(null)
  const [editing, setEditing] = useState(null)
  const [pendingStatuses, setPendingStatuses] = useState(() => new Map())
  const pendingStatusesRef = useRef(new Map())
  const statusRevision = useRef(0)
  const [openingDocument, setOpeningDocument] = useState('')
  const openingCvs = useRef(new Set())
  const [statusMenu, setStatusMenu] = useState(null)
  const statusOptions = useRef(null)
  const abortRef = useRef(null)
  const operationLock = useRef(false)
  const scopeButton = useRef(null)
  const refresh = useCallback(async () => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller
    const revision = statusRevision.current
    try {
      const params = new URLSearchParams({ page, limit, filter, ...(scope ? { consultant_id: scope } : {}) })
      const payload = await assignedRequest(`?${params}`, { signal: controller.signal })
      if (controller.signal.aborted || revision !== statusRevision.current) return
      if (page > payload.totalPages) { setPage(payload.totalPages); return }
      setData(payload); setError('')
      setSelection(current => {
        const next = new Map(current)
        for (const row of payload.data) if (next.has(row.id)) {
          if (!payload.can_manage && row.assigned_consultant_id !== payload.current_user_id) next.delete(row.id)
          else next.set(row.id,row)
        }
        return next
      })
    } catch (err) { if (err.name !== 'AbortError' && revision === statusRevision.current) setError(err.message) } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [page, limit, scope, filter])
  useEffect(() => { const frame=window.requestAnimationFrame(()=>{setLoading(true);refresh()}); return () => {window.cancelAnimationFrame(frame);abortRef.current?.abort()} }, [refresh])
  useEffect(() => {
    const onStorage = event => { if (event.key === 'ats:sidebar-counts-refresh') refresh() }
    window.addEventListener('fb:page-view-permissions-changed', refresh); window.addEventListener('focus', refresh); window.addEventListener('ats:assigned-candidates-updated', refresh); window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('fb:page-view-permissions-changed', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('ats:assigned-candidates-updated', refresh); window.removeEventListener('storage', onStorage) }
  }, [refresh])
  useRealtimeRefresh({ channelName: 'realtime:assigned-candidates', tables: ['assigned_candidates', 'employee_statuses'], onChange: refresh })
  const changed = () => assignmentsChanged()
  const admin = Boolean(data?.can_manage)
  const canCreate = Boolean(data?.can_create)
  const canDeleteAll = Boolean(data?.can_delete_all)
  const canViewOverall = Boolean(data?.can_view_overall)
  const showConsultant = canViewOverall && !scope
  const columnCount = 10 + Number(showConsultant)
  useEffect(() => {
    if (!canCreate) return
    assignedRequest('/uploads/discard', { method: 'POST', body: JSON.stringify({ ids: [] }) })
      .then(result => setCleanupPending(Boolean(result.cleanup_pending))).catch(() => setCleanupPending(true))
  }, [canCreate])
  const consultants = data?.consultants || []
  const canAct = row => admin || row.assigned_consultant_id === data?.current_user_id
  const canManageRow = row => canCreate && canAct(row)
  // Keep optimistic status separate from fetched rows so realtime/focus refreshes
  // cannot replace a pending choice with an older server snapshot.
  const displayRows = (data?.data || []).map(row => pendingStatuses.has(row.id) ? { ...row, status: pendingStatuses.get(row.id) } : row)
  const selectableRows = displayRows.filter(canAct)
  const selectedOnPage = selectableRows.filter(row => selection.has(row.id)).length
  const selectedRows = [...selection.values()].map(row => pendingStatuses.has(row.id) ? { ...row, status: pendingStatuses.get(row.id) } : row)
  const selectionSaving = selectedRows.some(row => pendingStatuses.has(row.id))
  const canAddSelection = selectedRows.length > 0 && !selectionSaving && selectedRows.every(canTransfer)
  const selectRows = (rows,checked) => {
    const next = new Map(selection)
    for (const row of rows) { if (checked) next.set(row.id,row); else next.delete(row.id) }
    if (next.size > 100) { setError('Select up to 100 assignments at a time.'); return }
    setError(''); setSelection(next)
  }
  const transferDetails = row => ({ ...row, consultant_name: row.assigned_consultant_name || consultants.find(c => c.id === row.assigned_consultant_id)?.name || user?.profile_name || user?.user_metadata?.full_name || user?.name || '' })
  const finishBulkTransfer = (ids, complete = false) => {
    setBulkTransfer(null)
    setSelection(current => new Map([...current].filter(([id]) => !ids.includes(id))))
    if (ids.length) setNotice(`${ids.length} Candidates Added Successfully${complete ? '' : '. Remaining candidates have not been saved.'}`)
    assignmentsChanged({ candidates: true })
  }
  const selectedName = consultants.find(c => c.id === scope)?.name || (scope ? 'Selected consultant' : 'Overall (All Consultants)')
  const status = async (row, value) => {
    setStatusMenu(null)
    if (pendingStatusesRef.current.has(row.id) || row.status === value || !canAct(row)) return
    setError('')
    setStatusError('')
    pendingStatusesRef.current.set(row.id, value)
    statusRevision.current += 1
    setPendingStatuses(new Map(pendingStatusesRef.current))
    try {
      await assignedRequest(`/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: value }) })
      setData(current => current ? { ...current, data: current.data.map(item => item.id === row.id ? { ...item, status: value } : item) } : current)
      setSelection(current => {
        if (!current.has(row.id)) return current
        const next = new Map(current)
        const updated = { ...current.get(row.id), status: value }
        next.set(row.id, updated)
        return next
      })
    }
    catch (err) {
      setSelection(current => {
        if (!current.has(row.id)) return current
        const next = new Map(current)
        next.set(row.id, { ...current.get(row.id), status: row.status })
        return next
      })
      setStatusError(`Status change for ${row.full_name} could not be confirmed. ${err.message}`)
    }
    finally {
      pendingStatusesRef.current.delete(row.id)
      statusRevision.current += 1
      setPendingStatuses(new Map(pendingStatusesRef.current))
      // Reconcile ordering, contact timestamps, counts and permissions after the
      // save settles. A failed save removes the overlay and restores server data.
      changed()
    }
  }
  const remove = async () => {
    if (operationLock.current) return
    operationLock.current = true; setPending(true)
    try {
      const result = await assignedRequest('/delete', { method: 'POST', body: JSON.stringify({ consultant_id: scope || null, ...(confirm.all ? { contacted_only: true } : { ids: confirm.ids }) }) })
      setCleanupPending(Boolean(result.cleanup_pending)); setConfirm(null); setSelection(new Map()); setNotice(`${result.deleted} assignments deleted.${result.cleanup_pending ? ' CV cleanup is pending; it will be retried.' : ''}`); changed()
    } catch (err) { setError(err.message) } finally { operationLock.current = false; setPending(false) }
  }
  const move = async () => {
    if (operationLock.current) return
    operationLock.current = true; setPending(true)
    try { await assignedRequest(`/${reassign.id}/consultant`, { method: 'PATCH', body: JSON.stringify({ assigned_consultant_id: reassign.consultant }) }); setReassign(null); changed() }
    catch (err) { setError(err.message) } finally { operationLock.current = false; setPending(false) }
  }
  const viewCv = async (row, key) => {
    if (openingCvs.current.has(row.id)) return
    openingCvs.current.add(row.id); setOpeningDocument(key)
    try { await openAssignedCv(row.id) } catch (err) { setError(err.message) }
    finally { openingCvs.current.delete(row.id); setOpeningDocument(current => current === key ? '' : current) }
  }
  const toggleScope = id => { setScope(id); setPage(1); setSelection(new Map()); setMenu(null); setDropdown(null) }
  const openStatus = (row, element, keyboard = false) => {
    setMenu(null); setDropdown(null)
    setStatusMenu(current => current?.row.id === row.id ? null : { row, element, rect: element.getBoundingClientRect() })
    if (keyboard) window.requestAnimationFrame(() => statusOptions.current?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true }))
  }
  return <div className={`assigned-page${selection.size ? ' has-bulk-selection' : ''}`}>
    <div className="assigned-toolbar"><div className="assigned-controls">
      {canViewOverall && <button ref={scopeButton} className="filter-select assigned-consultant-filter" aria-label="Consultant filter" aria-expanded={Boolean(dropdown)} onClick={() => { setStatusMenu(null); setDropdown(dropdown ? null : {rect:scopeButton.current.getBoundingClientRect(),element:scopeButton.current}) }}>{scope ? <ConsultantChip name={selectedName} /> : selectedName}<ChevronDown size={14} /></button>}
      {canCreate && <button className="btn-primary" onClick={() => setWizard(true)} disabled={loading || !consultants.length}><Plus size={15} />New</button>}
      {canDeleteAll && <button className="btn-secondary" disabled={loading || pendingStatuses.size > 0 || !data?.total} onClick={() => { setError(''); setConfirm({ all: true }) }}>Delete All</button>}
    </div></div>
    {dropdown && <FloatingDropdown fitViewport anchorRect={dropdown.rect} ignoreElement={dropdown.element} width={280} onClose={() => setDropdown(null)} className="assigned-consultant-options">
      {[{ id: '', name: 'Overall (All Consultants)', not_contacted: consultants.reduce((n, c) => n + c.not_contacted, 0) }, ...consultants].map(c => <button key={c.id} className="assigned-consultant-option" onClick={() => toggleScope(c.id)}>{c.id ? <ConsultantChip name={c.name} /> : <span>{c.name}</span>}<span className="sidebar-count-badge">{c.not_contacted}</span></button>)}
    </FloatingDropdown>}
    {notice && <div className="assigned-notice" role="status">{notice}<button className="modal-close" aria-label="Dismiss confirmation" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {canCreate && cleanupPending && <div className="assigned-notice" role="status">CV cleanup is pending.<button className="btn-secondary" onClick={() => assignedRequest('/uploads/discard', { method: 'POST', body: JSON.stringify({ ids: [] }) }).then(result => setCleanupPending(Boolean(result.cleanup_pending))).catch(error => setError(error.message))}>Retry cleanup</button></div>}
    {(error || statusError) && !confirm && !reassign && <div className="form-error" role="alert">{error || statusError}<button className="btn-secondary" onClick={refresh}>{error ? 'Retry' : 'Refresh'}</button></div>}
    <div className="assigned-kpis" role="group" aria-label="Filter assignments by status">{ASSIGNMENT_KPIS.map(([label, key, tone]) => <ReportKpiCard key={key} compact label={label} value={data?.stats?.[key]} tone={tone} loading={loading} selected={filter === key} onClick={() => { setFilter(key); setPage(1); setSelection(new Map()); setStatusMenu(null); setMenu(null) }} />)}</div>
    <div className="table-card"><div className="table-wrapper" tabIndex={0} role="region" aria-label="Assigned candidate details"><table className="data-table fb-theme-table assigned-table" aria-label="Assigned Candidates" aria-busy={loading}>
      <colgroup><col style={{ width: 44 }} />{[220,120,180,210,190,...(showConsultant ? [200] : []),150,150,110,210].map((width,index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead><tr><th className="assigned-selection-cell"><input type="checkbox" aria-label="Select all assignments on this page" disabled={loading || !selectableRows.length} checked={selectedOnPage > 0 && selectedOnPage === selectableRows.length} ref={node => { if (node) node.indeterminate = selectedOnPage > 0 && selectedOnPage < selectableRows.length }} onChange={event => selectRows(selectableRows,event.target.checked)} /></th>{['Name', 'Mobile', 'Client', 'Mandate', 'Status', ...(showConsultant ? ['Consultant'] : []), 'Assigned Date', 'Contacted Date', 'CV', 'Actions'].map(label => <th key={label} style={label === 'CV' ? { textAlign: 'center' } : undefined}>{label}</th>)}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={columnCount} className="table-loading-cell"><FyndbridgeLoader /></td></tr> : displayRows.length ? displayRows.map(row => <tr key={row.id} className={`assigned-group-${rowTone(row)}${row.added_at ? ' assigned-added' : ''}${selection.has(row.id) ? ' is-selected' : ''}`}>
        <td className="assigned-selection-cell"><input type="checkbox" aria-label={`Select ${row.full_name}`} checked={selection.has(row.id)} disabled={!canAct(row)} onChange={event => selectRows([row],event.target.checked)} /></td>
        <td><CandidateName name={row.full_name} /></td><td className="assigned-mobile">{row.mobile_number}</td><td className="cell-ellipsis" title={row.clients?.name || row.clients?.client_name}>{row.clients?.name || row.clients?.client_name || '-'}</td><td className="cell-ellipsis" title={row.jobs?.title}>{row.jobs?.title || '-'}</td>
        <td><div className="candidate-columns-control mandate-status-control"><button type="button" className={`badge ${ASSIGNMENT_STATUS_BADGE_MAP[row.status] || 'badge-status-unset'}`} aria-label={`Status for ${row.full_name}: ${row.status}`} aria-haspopup="menu" aria-expanded={statusMenu?.row.id === row.id} disabled={pendingStatuses.has(row.id) || !canAct(row)} aria-busy={pendingStatuses.has(row.id)} onClick={event => openStatus(row,event.currentTarget,event.detail === 0)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openStatus(row,event.currentTarget,true) } }}>{row.status}</button></div></td>
        {showConsultant && <td><ConsultantChip name={row.assigned_consultant_name || consultants.find(c => c.id === row.assigned_consultant_id)?.name} /></td>}
        <td>{formatDateDDMMYYYY(row.assigned_at)}</td><td>{formatDateDDMMYYYY(row.contacted_at)}</td>
        <td style={{ textAlign: 'center' }}><DocumentIconGroup attachments={[{ path: row.id, name: row.assigned_candidate_uploads?.cv_original_name || `${row.full_name} CV` }]} keyPrefix="assigned-cv" openingKey={openingDocument} onOpen={key => viewCv(row, key)} /></td>
        <td><div className="assigned-row-actions">
          {row.added_at ? <span className="badge badge-status-unset">Added</span> : <button className="assigned-add" disabled={pendingStatuses.has(row.id) || !canAct(row) || !canTransfer(row)} title={row.status === 'Not Relevant' ? 'Not Relevant assignments cannot be added to Candidates' : ['Not Contacted', 'Didn’t Pick Up'].includes(row.status) ? 'Contact the candidate and update their status first' : 'Add to Candidates'} onClick={() => setTransfer(transferDetails(row))}>Add to Candidates</button>}
          {canManageRow(row) && <button className="row-action-btn" disabled={pendingStatuses.has(row.id)} aria-label={`Actions for ${row.full_name}`} onClick={event => setMenu({ row, element: event.currentTarget, anchor: event.currentTarget.getBoundingClientRect() })}><MoreHorizontal size={17} /></button>}</div></td>
      </tr>) : <tr><td colSpan={columnCount} className="table-empty-cell">No assigned candidates{admin ? '. Select a consultant and click New to assign CVs.' : '.'}</td></tr>}</tbody>
    </table></div><PaginationBar page={page} totalPages={data?.totalPages || 1} total={data?.total || 0} pageSize={limit} onPageChange={setPage} onPageSizeChange={value => { setLimit(value); setPage(1); setSelection(new Map()) }} loading={loading} /></div>
    <AssignmentSelectionDock count={selection.size} canDelete={canCreate && !selectionSaving} canAdd={canAddSelection} hidden={loading || Boolean(wizard || transfer || bulkTransfer || confirm || reassign || editing)} onClear={() => setSelection(new Map())}
      onDelete={() => { setError(''); setConfirm({ ids: [...selection.keys()] }) }}
      onAdd={() => { if (canAddSelection) { setError(''); setBulkTransfer(selectedRows.map(transferDetails)) } }} />
    {statusMenu && <FloatingDropdown fitViewport anchorRect={statusMenu.rect} ignoreElement={statusMenu.element} width={200} className="table-portal-popover" onClose={() => setStatusMenu(null)}><div ref={statusOptions} role="menu" aria-label={`Status for ${statusMenu.row.full_name}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setStatusMenu(null); statusMenu.element.focus({ preventScroll: true }) }
      if (['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault()
        const options = [...statusOptions.current.querySelectorAll('button')]
        const index = options.indexOf(document.activeElement)
        const next = options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]
        next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' })
      }
    }}>{ASSIGNMENT_STATUSES.map(value => <button type="button" role="menuitemradio" aria-checked={value === statusMenu.row.status} className="candidate-columns-action" key={value} onClick={() => status(statusMenu.row,value)}>{value}</button>)}</div></FloatingDropdown>}
    {menu && canManageRow(menu.row) && <FloatingDropdown fitViewport anchorRect={menu.anchor} ignoreElement={menu.element} width={190} onClose={() => setMenu(null)}><button className="assigned-consultant-option" onClick={() => { setEditing(menu.row); setMenu(null) }}>Edit assignment</button><button className="assigned-consultant-option" onClick={() => { setReassign({ id: menu.row.id, consultant: menu.row.assigned_consultant_id }); setMenu(null) }}>Reassign consultant</button><button className="assigned-consultant-option" onClick={() => { setConfirm({ ids: [menu.row.id] }); setMenu(null) }}>Delete assignment</button></FloatingDropdown>}
    {editing && <AssignmentEditor row={editing} consultants={consultants} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSelection(new Map()); setNotice('Assignment updated.'); changed() }} />}
    {wizard && <AssignmentWizard consultants={consultants} onClose={() => setWizard(false)} onSaved={count => { setWizard(false); setNotice(`${count} Candidates Assigned Successfully`); changed() }} />}
    {transfer && <Suspense fallback={<div role="status">Loading candidate form…</div>}><CandidateForm assignedCandidate={transfer} onAssignedClose={() => setTransfer(null)} onAssignedSaved={() => { setTransfer(null); setNotice('Candidate Added Successfully. The candidate has been added to the Candidates module.'); assignmentsChanged({ candidates: true }) }} /></Suspense>}
    {bulkTransfer && <AssignmentTransferWizard assignments={bulkTransfer} onClose={ids => finishBulkTransfer(ids)} onSaved={ids => finishBulkTransfer(ids,true)} />}
    {confirm && <AssignmentDialog title={confirm.all ? 'Delete Contacted Assignments?' : `Delete ${confirm.ids.length} Assigned Candidates?`} pending={pending} onCancel={() => setConfirm(null)} onConfirm={remove}>
      <p>{confirm.all ? `This will permanently remove eligible contacted assignments ${scope ? `for ${selectedName}` : canViewOverall ? 'for all consultants' : 'assigned to you'}, excluding Not Contacted and Didn’t Pick Up.` : 'This will permanently remove the selected assignments.'} Existing records in the main Candidates module and shared CV documents will be preserved. This action cannot be undone.</p>{error && <p className="form-error" role="alert">{error}</p>}
    </AssignmentDialog>}
    {reassign && <AssignmentDialog title="Reassign consultant" className="assigned-reassign-dialog" pending={pending} onCancel={() => setReassign(null)} onConfirm={move} confirm="Save"><AssignmentSelect label="Consultant" value={reassign.consultant} options={consultants} onChange={id => setReassign(current => ({ ...current, consultant: id }))} />{error && <p className="form-error" role="alert">{error}</p>}</AssignmentDialog>}
  </div>
}
