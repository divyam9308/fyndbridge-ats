import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, RotateCcw, Save, Search, UserRound } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from '../hooks/useAdminAccess'
import {
  CALCULATED_PERFORMANCE_COLUMNS,
  DEFAULT_PERFORMANCE_PERMISSIONS,
  DEFAULT_PERFORMANCE_ROWS,
  PERFORMANCE_COLUMNS,
  PERFORMANCE_PERMISSION_EVENT,
  calculateRating,
  formatRating,
  isPerformanceColumnDisabled,
  isPerformanceColumnHidden,
  normalizePerformanceRows
} from '../utils/performanceReviewStorage'
import { fetchAdminProfileOptions } from '../services/adminAccessApi'
import {
  fetchMyPerformanceReview,
  fetchPerformancePermissions,
  fetchPerformanceReview,
  savePerformanceReview
} from '../services/performanceApi'
import './PerformanceReviewPage.css'

function currentUserId(user) {
  return user?.id || user?.email || 'current-user'
}

function displayName(user) {
  return user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'My Review'
}

function normalizeScoreInput(value) {
  if (value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < 0 || number > 5) return null
  return value
}

function SummaryCard({ label, value, warning }) {
  return (
    <div className={`performance-summary-card${warning ? ' is-warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmployeeSelector({ users, selectedUserId, onSelect }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = users.find(user => user.id === selectedUserId) || users[0]
  const matches = users.filter(user => user.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <section className="performance-employee-card">
      <div>
        <span className="performance-kicker"><UserRound size={14} />Super Admin View</span>
        <h2>Employee Review</h2>
        <p>Each employee review is stored against the selected Supabase user.</p>
      </div>
      <div className="performance-employee-select">
        <button type="button" onClick={() => setOpen(current => !current)} aria-expanded={open}>
          <span>{selected?.name || 'Select employee'}</span>
          <ChevronDown size={16} />
        </button>
        {open && (
          <div className="performance-employee-menu">
            <label>
              <Search size={15} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search employee" autoFocus />
            </label>
            {matches.map(user => (
              <button key={user.id} type="button" className={user.id === selectedUserId ? 'is-selected' : ''} onClick={() => { onSelect(user.id); setOpen(false); setQuery('') }}>
                <strong>{user.name}</strong>
                {user.email ? <small>{user.email}</small> : null}
              </button>
            ))}
            {!matches.length && <span>No employees found.</span>}
          </div>
        )}
      </div>
    </section>
  )
}

function ReviewCell({ row, columnKey, disabled, onChange }) {
  if (columnKey === 'self_rating') return <div className="performance-readonly-cell">{formatRating(calculateRating(row.self_score, row.allocation))}</div>
  if (columnKey === 'ss_ns_rating') return <div className="performance-readonly-cell">{formatRating(calculateRating(row.ss_ns_score, row.allocation))}</div>
  if (columnKey === 'final_rating') return <div className="performance-readonly-cell">{formatRating(calculateRating(row.ra_score, row.allocation))}</div>

  if (columnKey === 'category') {
    return <textarea className="performance-input is-category" value={row.category} disabled={disabled} onChange={event => onChange({ category: event.target.value })} />
  }

  if (columnKey === 'allocation') {
    return (
      <label className="performance-percent-field">
        <input className="performance-input" type="number" min="0" max="100" step="1" value={row.allocation} disabled={disabled} onChange={event => onChange({ allocation: event.target.value === '' ? '' : Number(event.target.value) })} />
        <span>%</span>
      </label>
    )
  }

  if (['work_done', 'ss_ns_feedback', 'ra_feedback'].includes(columnKey)) {
    const placeholders = {
      work_done: 'Describe key work done',
      ss_ns_feedback: 'SS/NS feedback',
      ra_feedback: 'RA feedback'
    }
    return <textarea className="performance-input is-feedback" value={row[columnKey]} disabled={disabled} placeholder={placeholders[columnKey]} onChange={event => onChange({ [columnKey]: event.target.value })} />
  }

  if (['self_score', 'ss_ns_score', 'ra_score'].includes(columnKey)) {
    return <input className="performance-input is-score" type="number" min="0" max="5" step="0.1" value={row[columnKey]} disabled={disabled} onChange={event => { const next = normalizeScoreInput(event.target.value); if (next !== null) onChange({ [columnKey]: next }) }} />
  }

  return null
}

export default function PerformanceReviewPage() {
  const { user } = useAuth()
  const { isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const ownUserId = currentUserId(user)
  const ownName = displayName(user)
  const [selectorUsers, setSelectorUsers] = useState([{ id: ownUserId, name: ownName, email: user?.email || '' }])
  const [selectedUserId, setSelectedUserId] = useState(ownUserId)
  const effectiveUserId = isSuperAdmin ? selectedUserId : ownUserId
  const [rows, setRows] = useState(() => normalizePerformanceRows(DEFAULT_PERFORMANCE_ROWS))
  const [savedRows, setSavedRows] = useState(rows)
  const [permissions, setPermissions] = useState(DEFAULT_PERFORMANCE_PERMISSIONS)
  const [loadingReview, setLoadingReview] = useState(true)
  const [savingReview, setSavingReview] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedUserId(ownUserId)
      setSelectorUsers([{ id: ownUserId, name: ownName, email: user?.email || '' }])
    }, 0)
    return () => window.clearTimeout(timer)
  }, [ownName, ownUserId, user?.email])

  useEffect(() => {
    if (!isSuperAdmin) return undefined
    let active = true
    fetchAdminProfileOptions().then(({ data }) => {
      if (!active) return
      const profiles = (data || []).map(profile => ({ id: profile.user_id, name: profile.name, email: profile.email })).filter(profile => profile.id)
      const byId = new Map([[ownUserId, { id: ownUserId, name: ownName, email: user?.email || '' }]])
      profiles.forEach(profile => byId.set(profile.id, profile))
      setSelectorUsers([...byId.values()])
    }).catch(err => setError(err.message))
    return () => { active = false }
  }, [isSuperAdmin, ownName, ownUserId, user?.email])

  useEffect(() => {
    let active = true
    const loadingTimer = window.setTimeout(() => {
      if (!active) return
      setLoadingReview(true)
      setError('')
    }, 0)
    const request = isSuperAdmin ? fetchPerformanceReview(effectiveUserId) : fetchMyPerformanceReview()
    request.then(({ data }) => {
      if (!active) return
      const loaded = normalizePerformanceRows(data?.rows || [])
      setRows(loaded)
      setSavedRows(loaded)
    }).catch(err => {
      if (active) setError(err.message)
    }).finally(() => {
      if (active) setLoadingReview(false)
    })
    return () => { active = false; window.clearTimeout(loadingTimer) }
  }, [effectiveUserId, isSuperAdmin])

  useEffect(() => {
    const sync = () => fetchPerformancePermissions().then(({ permissions: next }) => setPermissions({ ...DEFAULT_PERFORMANCE_PERMISSIONS, ...(next || {}) })).catch(err => setError(err.message))
    sync()
    window.addEventListener(PERFORMANCE_PERMISSION_EVENT, sync)
    return () => {
      window.removeEventListener(PERFORMANCE_PERMISSION_EVENT, sync)
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const visibleColumns = useMemo(
    () => PERFORMANCE_COLUMNS.filter(column => !isPerformanceColumnHidden(permissions, column.key, isSuperAdmin)),
    [isSuperAdmin, permissions]
  )
  const totals = useMemo(() => rows.reduce((acc, row) => {
    const allocation = Number(row.allocation) || 0
    return {
      allocation: acc.allocation + allocation,
      selfRating: acc.selfRating + calculateRating(row.self_score, allocation),
      ssnsRating: acc.ssnsRating + calculateRating(row.ss_ns_score, allocation),
      finalRating: acc.finalRating + calculateRating(row.ra_score, allocation)
    }
  }, { allocation: 0, selfRating: 0, ssnsRating: 0, finalRating: 0 }), [rows])
  const allocationValid = Math.round(totals.allocation * 100) === 10000
  const scoresValid = rows.every(row => ['self_score', 'ss_ns_score', 'ra_score'].every(key => row[key] === '' || row[key] === null || (Number(row[key]) >= 0 && Number(row[key]) <= 5)))
  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows)
  const canSave = dirty && allocationValid && scoresValid && !savingReview && !loadingReview

  const updateRow = (rowId, patch) => setRows(current => current.map(row => row.id === rowId ? { ...row, ...patch } : row))

  const canSubmitField = (field) => !isPerformanceColumnDisabled(permissions, field, isSuperAdmin) && !isPerformanceColumnHidden(permissions, field, isSuperAdmin)
  const saveRowsPayload = () => rows.map(row => {
    const payload = { row_order: row.row_order }
    if (canSubmitField('category')) payload.category = row.category
    if (canSubmitField('allocation')) payload.allocation = row.allocation
    if (canSubmitField('work_done')) payload.work_done = row.work_done
    if (canSubmitField('self_score')) payload.self_score = row.self_score === '' ? null : row.self_score
    if (canSubmitField('ss_ns_feedback')) payload.ss_ns_feedback = row.ss_ns_feedback
    if (canSubmitField('ss_ns_score')) payload.ss_ns_score = row.ss_ns_score === '' ? null : row.ss_ns_score
    if (canSubmitField('ra_feedback')) payload.ra_feedback = row.ra_feedback
    if (canSubmitField('ra_score')) payload.ra_score = row.ra_score === '' ? null : row.ra_score
    return payload
  })

  const handleSave = async () => {
    if (!canSave) return
    setSavingReview(true)
    setError('')
    try {
      const { data } = await savePerformanceReview(effectiveUserId, saveRowsPayload())
      const loaded = normalizePerformanceRows(data?.rows || rows)
      setRows(loaded)
      setSavedRows(loaded)
      setToast('Performance review saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingReview(false)
    }
  }

  const handleReset = () => {
    setRows(savedRows)
    setToast('Performance review reset to last saved state.')
  }

  return (
    <div className="performance-page">
      {toast && <div className="performance-toast" role="status">{toast}</div>}
      <header className="performance-header">
        <div>
          <h1>Performance Review</h1>
          <p>Track allocation, work done, feedback, and weighted ratings.</p>
        </div>
        {dirty && <span className="performance-unsaved">Unsaved changes</span>}
      </header>

      {isSuperAdmin && <EmployeeSelector users={selectorUsers} selectedUserId={selectedUserId} onSelect={setSelectedUserId} />}
      {error && <div className="performance-warning"><AlertTriangle size={17} /><span>{error}</span></div>}

      <section className="performance-summary-grid">
        <SummaryCard label="Allocation Total" value={`${formatRating(totals.allocation)}%`} warning={!allocationValid} />
        <SummaryCard label="Self Rating Total" value={formatRating(totals.selfRating)} />
        <SummaryCard label="SS/NS Rating Total" value={formatRating(totals.ssnsRating)} />
        <SummaryCard label="Final Rating Total" value={formatRating(totals.finalRating)} />
      </section>

      {(!allocationValid || !scoresValid) && (
        <div className="performance-warning">
          <AlertTriangle size={17} />
          <span>{!allocationValid ? 'Allocation total must equal 100%.' : 'Scores must be numbers from 0 to 5.'}</span>
        </div>
      )}

      <section className="performance-table-card">
        <div className="performance-table-title">
          <div>
            <h2>Review Categories</h2>
            <p>Weighted ratings are calculated automatically from score and allocation.</p>
          </div>
        </div>
        <div className="performance-table-scroll">
          {loadingReview ? <div className="performance-loading">Loading performance review...</div> : <table className="performance-table">
            <colgroup>{visibleColumns.map(column => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
            <thead>
              <tr>{visibleColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id || row.row_order}>
                  {visibleColumns.map(column => {
                    const disabled = CALCULATED_PERFORMANCE_COLUMNS.has(column.key) || isPerformanceColumnDisabled(permissions, column.key, isSuperAdmin)
                    return (
                      <td key={column.key}>
                        <ReviewCell row={row} columnKey={column.key} disabled={disabled} onChange={patch => updateRow(row.id, patch)} />
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="performance-total-row">
                {visibleColumns.map(column => (
                  <td key={column.key}>
                    {column.key === 'category' ? 'Total'
                      : column.key === 'allocation' ? `${formatRating(totals.allocation)}%`
                        : column.key === 'self_rating' ? formatRating(totals.selfRating)
                          : column.key === 'ss_ns_rating' ? formatRating(totals.ssnsRating)
                            : column.key === 'final_rating' ? formatRating(totals.finalRating)
                              : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>}
        </div>
      </section>

      <div className="performance-actions">
        <button className="performance-reset-btn" type="button" onClick={handleReset} disabled={!dirty}><RotateCcw size={16} />Reset</button>
        <button className="performance-save-btn" type="button" onClick={handleSave} disabled={!canSave}><Save size={16} />{savingReview ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  )
}
