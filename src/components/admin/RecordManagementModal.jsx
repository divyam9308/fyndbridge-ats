import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Briefcase, Building2, Check, ChevronLeft, ChevronRight, Search, Trash2, Users, X } from 'lucide-react'
import { deleteRecords, fetchDeletionRecords, previewRecordDeletion } from '../../services/adminAccessApi'

const ENTITY_META = {
  candidate: {
    title: 'Delete Candidates',
    singular: 'candidate row',
    plural: 'candidate rows',
    Icon: Users,
    description: 'Delete selected candidate rows while preserving their clients, mandates and uploaded resume files.'
  },
  mandate: {
    title: 'Delete Mandates',
    singular: 'mandate',
    plural: 'mandates',
    Icon: Briefcase,
    description: 'Delete selected mandates and choose whether candidate rows linked to those mandates should be retained or deleted.'
  },
  client: {
    title: 'Delete Clients',
    singular: 'client',
    plural: 'clients',
    Icon: Building2,
    description: 'Delete selected clients and all mandates under them, with the option to retain or delete candidate rows linked to those mandates.'
  }
}

function display(value) {
  const text = String(value ?? '').trim()
  return text && text !== 'null' ? text : '-'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function RecordDetails({ entityType, row }) {
  if (entityType === 'candidate') {
    return (
      <>
        <strong>{display(row.label)} {row.display_id ? <em>{row.display_id}</em> : null}</strong>
        <span>{display(row.mandate)} · {display(row.client)}</span>
        <small>{display(row.consultant)} · {display(row.mobile_number)} · {display(row.email)} · {display(row.status)}</small>
      </>
    )
  }
  if (entityType === 'mandate') {
    return (
      <>
        <strong>{display(row.label)} {row.display_id ? <em>{row.display_id}</em> : null}</strong>
        <span>{display(row.client)} · {display(row.status)}</span>
        <small>{display(row.consultants || row.team_lead)} · {Number(row.candidate_count || 0)} candidate rows · {formatDate(row.allocation_date || row.created_at)}</small>
      </>
    )
  }
  return (
    <>
      <strong>{display(row.label)} {row.display_id ? <em>{row.display_id}</em> : null}</strong>
      <span>{display(row.consultant)} · {display(row.status)} · {display(row.location)}</span>
      <small>{Number(row.mandate_count || 0)} mandates · {Number(row.candidate_count || 0)} candidate rows</small>
    </>
  )
}

function confirmationText(entityType, preview, deleteLinked) {
  const candidates = Number(preview?.candidateRowsAffected || 0)
  const mandates = Number(preview?.mandatesDeleted || 0)
  const clients = Number(preview?.clientsDeleted || 0)
  if (entityType === 'candidate') {
    return `You are about to permanently delete ${candidates} selected candidate ${candidates === 1 ? 'row' : 'rows'} and their row-specific notifications and dependencies. Their clients and mandates will remain.`
  }
  if (entityType === 'mandate' && deleteLinked) {
    return `You are about to permanently delete ${mandates} ${mandates === 1 ? 'mandate' : 'mandates'} and ${candidates} candidate rows linked specifically to those mandates. Other rows belonging to the same people under different mandates will remain.`
  }
  if (entityType === 'mandate') {
    return `You are about to permanently delete ${mandates} ${mandates === 1 ? 'mandate' : 'mandates'}. ${candidates} linked candidate rows will remain, but their deleted mandate value will display as “-”. Their clients will be preserved.`
  }
  if (deleteLinked) {
    return `You are about to permanently delete ${clients} ${clients === 1 ? 'client' : 'clients'}, ${mandates} mandates and ${candidates} candidate rows linked to those mandates. Candidate rows belonging to the same people elsewhere will remain.`
  }
  return `You are about to permanently delete ${clients} ${clients === 1 ? 'client' : 'clients'} and ${mandates} mandates under them. ${candidates} linked candidate rows will remain with Client and Mandate shown as “-”.`
}

function successText(result) {
  const parts = []
  if (result.clientsDeleted) parts.push(`${result.clientsDeleted} ${result.clientsDeleted === 1 ? 'client' : 'clients'}`)
  if (result.mandatesDeleted) parts.push(`${result.mandatesDeleted} ${result.mandatesDeleted === 1 ? 'mandate' : 'mandates'}`)
  if (result.candidatesDeleted) parts.push(`${result.candidatesDeleted} candidate ${result.candidatesDeleted === 1 ? 'row' : 'rows'}`)
  if (result.candidatesRetained) parts.push(`${result.candidatesRetained} candidate ${result.candidatesRetained === 1 ? 'row retained' : 'rows retained'}`)
  return `${result.candidatesDeleted || result.mandatesDeleted || result.clientsDeleted ? 'Deleted' : 'Updated'} ${parts.join(', ')}. Uploaded resume files were preserved.`
}

export default function RecordManagementModal({ open, onClose, onSuccess }) {
  const [entityType, setEntityType] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState(() => new Map())
  const [deleteLinked, setDeleteLinked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const requestRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!open || !entityType) return undefined
    const requestId = ++requestRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      fetchDeletionRecords(entityType, { search: debouncedSearch, page, limit: 25 })
        .then(payload => {
          if (requestId !== requestRef.current) return
          setRows(payload.data || [])
          setTotal(Number(payload.total) || 0)
          setTotalPages(Number(payload.totalPages) || 1)
          if (page > (Number(payload.totalPages) || 1)) setPage(Number(payload.totalPages) || 1)
        })
        .catch(nextError => {
          if (requestId === requestRef.current) setError(nextError.message)
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false)
        })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current += 1
    }
  }, [debouncedSearch, entityType, open, page])

  const reset = () => {
    setEntityType('')
    setSearch('')
    setDebouncedSearch('')
    setPage(1)
    setRows([])
    setSelected(new Map())
    setDeleteLinked(false)
    setError('')
    setPreview(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const selectedIds = useMemo(() => [...selected.keys()], [selected])
  const pageSelected = rows.length > 0 && rows.every(row => selected.has(row.id))
  const meta = ENTITY_META[entityType]
  const searchPlaceholder = entityType === 'candidate'
    ? 'Search by candidate, CA ID, mandate, client, email or mobile'
    : entityType === 'mandate'
      ? 'Search by mandate, JB ID, client, consultant or status'
      : 'Search by client, CL ID, consultant, location or status'

  const toggleRow = (row) => {
    setSelected(current => {
      const next = new Map(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.set(row.id, row)
      return next
    })
  }

  const togglePage = () => {
    setSelected(current => {
      const next = new Map(current)
      if (pageSelected) rows.forEach(row => next.delete(row.id))
      else rows.forEach(row => next.set(row.id, row))
      return next
    })
  }

  const openPreview = async () => {
    if (!selectedIds.length) return
    setPreviewing(true)
    setError('')
    try {
      const payload = await previewRecordDeletion(entityType, selectedIds, deleteLinked)
      setPreview(payload.data)
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setPreviewing(false)
    }
  }

  const confirmDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setError('')
    try {
      const payload = await deleteRecords(entityType, selectedIds, deleteLinked)
      const result = payload.data || {}
      window.dispatchEvent(new Event('ats:candidates-updated'))
      window.dispatchEvent(new Event('ats:jobs-updated'))
      window.dispatchEvent(new Event('ats:clients-updated'))
      window.dispatchEvent(new Event('ats:reports-updated'))
      onSuccess?.(successText(result))
      close()
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  return createPortal((
    <div className="modal-overlay admin-record-overlay">
      {!entityType ? (
        <div className="modal-card admin-record-type-modal" role="dialog" aria-modal="true" aria-labelledby="record-management-title">
          <div className="modal-header">
            <div>
              <span className="modal-title" id="record-management-title">Delete Records</span>
              <p>Choose the record type to manage permanently.</p>
            </div>
            <button className="modal-close" type="button" onClick={close} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="modal-body admin-record-type-grid">
            {Object.entries(ENTITY_META).map(([key, item]) => (
              <button className="admin-record-type-card" type="button" key={key} onClick={() => { setEntityType(key); setPage(1) }}>
                <span><item.Icon size={22} /></span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <em><Trash2 size={14} />Permanent action</em>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="modal-card modal-card-lg admin-record-selection-modal" role="dialog" aria-modal="true" aria-labelledby="record-selection-title">
          <div className="modal-header">
            <div>
              <span className="modal-title" id="record-selection-title">{meta.title}</span>
              <p>Select exact database rows. Technical IDs are never shown.</p>
            </div>
            <button className="modal-close" type="button" onClick={close} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="admin-record-toolbar">
            <label>
              <Search size={17} />
              <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder={searchPlaceholder} autoFocus />
            </label>
            <span>{selected.size} selected</span>
            <button type="button" onClick={() => setSelected(new Map())} disabled={!selected.size}>Clear selection</button>
          </div>
          {error && <div className="admin-record-error" role="alert">{error}</div>}
          <div className="admin-record-table-head">
            <button type="button" className={`admin-record-check${pageSelected ? ' is-checked' : ''}`} onClick={togglePage} aria-label={pageSelected ? 'Deselect current page' : 'Select current page'}>
              {pageSelected ? <Check size={14} /> : null}
            </button>
            <span>Select all rows on this page</span>
            <small>{total} results</small>
          </div>
          <div className="admin-record-list" aria-busy={loading}>
            {loading ? <div className="admin-record-state">Loading records…</div> : null}
            {!loading && !rows.length ? <div className="admin-record-state">No matching records found.</div> : null}
            {!loading && rows.map(row => {
              const checked = selected.has(row.id)
              return (
                <div
                  className={`admin-record-row${checked ? ' is-selected' : ''}`}
                  key={row.id}
                  role="checkbox"
                  aria-checked={checked}
                  tabIndex={0}
                  onClick={() => toggleRow(row)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleRow(row)
                    }
                  }}
                >
                  <button type="button" className={`admin-record-check${checked ? ' is-checked' : ''}`} tabIndex={-1} aria-hidden="true">
                    {checked ? <Check size={14} /> : null}
                  </button>
                  <div><RecordDetails entityType={entityType} row={row} /></div>
                </div>
              )
            })}
          </div>
          <div className="admin-record-pagination">
            <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1 || loading}><ChevronLeft size={16} />Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading}>Next<ChevronRight size={16} /></button>
          </div>
          {entityType !== 'candidate' ? (
            <label className="admin-record-linked-option">
              <input type="checkbox" checked={deleteLinked} onChange={event => setDeleteLinked(event.target.checked)} />
              <span>
                <strong>{entityType === 'mandate' ? 'Delete candidate rows linked to the selected mandates' : 'Delete candidate rows linked to this client’s mandates'}</strong>
                <small>When enabled, only candidate rows linked to these records will be deleted. Other rows belonging to the same person remain untouched. Uploaded resume files will not be deleted.</small>
              </span>
            </label>
          ) : null}
          <div className="modal-footer admin-record-footer">
            <button className="admin-footer-cancel" type="button" onClick={() => setEntityType('')} disabled={previewing}>Back</button>
            <button className="admin-record-delete-btn" type="button" onClick={openPreview} disabled={!selected.size || previewing}>
              <Trash2 size={16} />{previewing ? 'Calculating impact…' : `Delete Selected (${selected.size})`}
            </button>
          </div>
          <div className="admin-record-action-status" role="status" aria-live="polite">
            {previewing ? 'Checking the latest database records and calculating the deletion impact…' : !selected.size ? 'Select at least one row to continue.' : 'Selected rows are ready for impact preview.'}
          </div>
        </div>
      )}

      {preview ? (
        <div className="modal-overlay admin-record-confirm-overlay">
          <div className="modal-card admin-record-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="record-confirm-title">
            <div className="modal-header">
              <div>
                <span className="modal-title" id="record-confirm-title">Confirm permanent deletion</span>
                <p>{meta.title}</p>
              </div>
              <button className="modal-close" type="button" onClick={() => setPreview(null)} disabled={deleting} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p className="admin-record-confirm-copy">{confirmationText(entityType, preview, deleteLinked)}</p>
              <div className="admin-record-impact-grid">
                <span><small>Selected</small><strong>{preview.selectedCount}</strong></span>
                {entityType !== 'candidate' ? <span><small>Mandates deleted</small><strong>{preview.mandatesDeleted}</strong></span> : null}
                <span><small>Candidate rows {deleteLinked || entityType === 'candidate' ? 'deleted' : 'retained'}</small><strong>{deleteLinked || entityType === 'candidate' ? preview.candidateRowsDeleted : preview.candidateRowsRetained}</strong></span>
                <span><small>Dependencies removed</small><strong>{Number(preview.notificationsDeleted || 0) + Number(preview.followUpsDeleted || 0)}</strong></span>
              </div>
              <div className="admin-record-labels">
                {(preview.labels || []).slice(0, 8).map(item => <span key={item.id}>{display(item.label)}</span>)}
                {(preview.labels || []).length > 8 ? <span>+{preview.labels.length - 8} more</span> : null}
              </div>
              <ul className="admin-record-warnings">
                <li>Uploaded resume files will be preserved.</li>
                <li>Database and display IDs will not be renumbered.</li>
                <li>This deletion is permanent and cannot be undone.</li>
              </ul>
              {error && <div className="admin-record-error" role="alert">{error}</div>}
            </div>
            <div className="modal-footer admin-record-footer">
              <button className="admin-footer-cancel" type="button" onClick={() => setPreview(null)} disabled={deleting}>Cancel</button>
              <button className="admin-record-delete-btn" type="button" onClick={confirmDelete} disabled={deleting}>
                <Trash2 size={16} />{deleting ? 'Deleting records…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ), document.body)
}
