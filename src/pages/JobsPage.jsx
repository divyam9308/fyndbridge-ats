import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, Loader2, Pencil, Plus, X } from 'lucide-react'
import NewActionDropdown from '../components/NewActionDropdown'
import '../styles/Shared.css'

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const PRIORITIES = ['P1', 'P2', 'P3', 'Scrap', 'Completed']
const SORT_OPTIONS = [
  { field: 'job_id', label: 'Job ID' },
  { field: 'role', label: 'Alphabetic order' }
]
const EMPTY_FORM = {
  id: '',
  job_display_id: '',
  consultants: [],
  team_lead: '',
  client_id: '',
  role: '',
  location: '',
  budget: '',
  priority: '',
  vertical: '',
  allocation_date: ''
}

const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}
const dash = (value) => value || '-'
const clientName = (client) => client?.name || client?.client_name || ''
const canonicalClients = (clients) => {
  const map = new Map()
  clients.forEach(client => {
    const key = String(client?.client_display_id || clientName(client)).trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, client)
  })
  return [...map.values()]
}

export default function JobsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [dbClients, setDbClients] = useState([])
  const [userOptions, setUserOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiError, setAiError] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [consultantOpen, setConsultantOpen] = useState({})
  const modalRef = useRef(null)
  const sortRef = useRef(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (aiFilters) params.set('ai_filters', JSON.stringify(aiFilters))
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      const [jobsRes, clientsRes, usersRes] = await Promise.all([
        fetch(`/api/jobs?${params.toString()}`),
        fetch('/api/clients'),
        fetch('/api/jobs/users/options')
      ])
      if (!jobsRes.ok) throw new Error('Failed to fetch mandates.')
      if (!clientsRes.ok) throw new Error('Failed to fetch clients.')
      const jobsData = await jobsRes.json()
      const clientsData = await clientsRes.json()
      const usersData = usersRes.ok ? await usersRes.json() : { data: [] }
      setJobs(jobsData.data || [])
      setDbClients(clientsData.data || [])
      setUserOptions(usersData.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [aiFilters, sortDirection, sortField])

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => {
      const target = modalRef.current?.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || modalRef.current)?.focus({ preventScroll: true })
    })
    return () => { document.body.style.overflow = previous }
  }, [isOpen])

  useEffect(() => {
    if (!sortOpen) return
    const close = (event) => {
      if (!sortRef.current?.contains(event.target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [sortOpen])

  const fetchNextId = async () => {
    const res = await fetch('/api/jobs/next-display-id')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Unable to load mandate ID')
    return data.job_display_id || ''
  }

  const openModal = useCallback(async () => {
    setEditingJob(null)
    setErrors({})
    setForm({ ...EMPTY_FORM, job_display_id: 'Loading...', allocation_date: todayLocal() })
    setIsOpen(true)
    try {
      const nextId = await fetchNextId()
      setForm(current => current.job_display_id === 'Loading...' ? { ...current, job_display_id: nextId } : current)
    } catch {
      setForm(current => ({ ...current, job_display_id: '' }))
    }
  }, [])

  useEffect(() => {
    const action = location.state?.action
    if (!action) return
    const timer = window.setTimeout(() => {
      navigate(location.pathname, { replace: true, state: {} })
      if (action === 'add-job') openModal()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.state, navigate, openModal])

  const editJob = (job) => {
    setEditingJob(job)
    setErrors({})
    setForm({
      id: job.id,
      job_display_id: job.job_display_id || '',
      consultants: Array.isArray(job.consultants) ? job.consultants : [],
      team_lead: job.team_lead === '-' ? '' : job.team_lead || '',
      client_id: job.client_id || '',
      role: job.role || job.title || '',
      location: job.location || job.city || '',
      budget: job.budget || '',
      priority: job.priority || '',
      vertical: job.vertical || '',
      allocation_date: job.allocation_date || todayLocal()
    })
    setIsOpen(true)
  }

  const sortedUsers = useMemo(() => ['-', ...userOptions.filter(Boolean)], [userOptions])
  const clientOptions = useMemo(() => canonicalClients(dbClients), [dbClients])
  const selectedConsultants = form.consultants || []
  const availableConsultants = userOptions.filter(user => !selectedConsultants.includes(user))

  const validate = () => {
    const next = {}
    if (!form.job_display_id) next.job_display_id = 'Job ID is required'
    if (!form.client_id) next.client_id = 'Client Name is required'
    if (!form.role.trim()) next.role = 'Role is required'
    if (new Set(selectedConsultants).size !== selectedConsultants.length) next.consultants = 'Consultants cannot be duplicated'
    return next
  }

  const saveJob = async () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      const payload = {
        consultants: selectedConsultants,
        team_lead: form.team_lead || null,
        client_id: form.client_id,
        role: form.role,
        location: form.location,
        budget: form.budget,
        priority: form.priority,
        vertical: form.vertical,
        allocation_date: form.allocation_date
      }
      const res = await fetch(editingJob ? `/api/jobs/${editingJob.id}` : '/api/jobs', {
        method: editingJob ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save mandate.')
      setIsOpen(false)
      setEditingJob(null)
      await fetchData()
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setSaving(false)
    }
  }

  const applyAiFilter = async (event) => {
    event.preventDefault()
    setAiError('')
    if (!aiText.trim()) return
    const res = await fetch('/api/jobs/ai-filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: aiText })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setAiFilters(null)
      setAiError(data.error || 'Could not parse Mandate Tracker filter.')
      return
    }
    setAiFilters(data.filters)
  }

  const clearFilters = () => {
    setAiText('')
    setAiFilters(null)
    setAiError('')
  }

  const selectSort = (field) => {
    setSortDirection(current => sortField === field && current === 'asc' ? 'desc' : 'asc')
    setSortField(field)
    setSortOpen(false)
  }

  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    return option ? `${option.label} ${sortDirection === 'desc' ? '↑' : '↓'}` : 'Sort By'
  }

  const addConsultant = () => {
    if (!availableConsultants.length) return
    setForm(current => ({ ...current, consultants: [...current.consultants, availableConsultants[0]] }))
  }

  const updateConsultant = (index, value) => {
    setForm(current => {
      const next = [...current.consultants]
      if (!value || value === '-') next.splice(index, 1)
      else if (!next.includes(value)) next[index] = value
      return { ...current, consultants: next }
    })
  }

  return (
    <div>
      <div className="candidate-columns-toolbar">
        <NewActionDropdown
          onUploadResumes={() => navigate('/dashboard/candidates', { state: { action: 'upload-resumes' } })}
          onAddCandidate={() => navigate('/dashboard/candidates', { state: { action: 'add-candidate' } })}
          onAddClient={() => navigate('/dashboard/clients', { state: { action: 'add-client' } })}
          onAddJob={openModal}
        />
      </div>

      <div className="filter-bar candidates-filter-bar">
        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input className="filter-input candidate-ai-filter-input" value={aiText} onChange={e => setAiText(e.target.value)} />
          <button className="btn-secondary" type="submit" style={{ height: 34, padding: '0 12px' }}>Apply</button>
          <button className="filter-clear" type="button" onClick={clearFilters}>Clear Filters</button>
        </form>
        <div className="filter-divider" />
        <span className="filter-label">Sort By</span>
        <div className="candidate-sort-control" ref={sortRef}>
          <button className="filter-select candidate-sort-btn" type="button" onClick={() => setSortOpen(open => !open)}>
            <span>{sortLabel()}</span><ChevronDown size={13} />
          </button>
          {sortOpen && (
            <div className="filter-dropdown candidate-sort-dropdown">
              {SORT_OPTIONS.map(option => (
                <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>
                  {`${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {aiError && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{aiError}</div>}

      <div className="table-card">
        {loading ? (
          <div className="loading-state"><Loader2 size={32} className="spin" color="var(--gold)" /><p>Loading mandate tracker...</p></div>
        ) : error ? (
          <div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">Error loading data</div><div className="empty-state-desc">{error}</div></div>
        ) : jobs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No mandates found</div><div className="empty-state-desc">Create a mandate to get started.</div></div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table candidates-master-table" aria-label="Mandate Tracker">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Consultant</th>
                  <th>Team Lead</th>
                  <th>Client Name</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Budget</th>
                  <th>Priority</th>
                  <th>Vertical</th>
                  <th>Date of Allocation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{dash(job.job_display_id)}</td>
                    <td>
                      {(job.consultants || []).length <= 1 ? dash(job.consultants?.[0]) : (
                        <div className="candidate-columns-control mandate-consultants-control">
                          <button className="filter-select compact-select" type="button" onClick={() => setConsultantOpen(current => ({ ...current, [job.id]: !current[job.id] }))}>
                            {job.consultants[0]} +{job.consultants.length - 1}
                          </button>
                          {consultantOpen[job.id] && <div className="filter-dropdown mandate-consultants-dropdown">{job.consultants.map(name => <div className="candidate-column-option" key={name}>{name}</div>)}</div>}
                        </div>
                      )}
                    </td>
                    <td>{dash(job.team_lead)}</td>
                    <td>{dash(job.client_name)}</td>
                    <td><Link className="name-text" to={`/dashboard/clients/${job.client_id}/jobs/${job.id}/candidates`}>{dash(job.role)}</Link></td>
                    <td>{dash(job.location)}</td>
                    <td>{dash(job.budget)}</td>
                    <td>{dash(job.priority)}</td>
                    <td>{dash(job.vertical)}</td>
                    <td>{dash(job.allocation_date)}</td>
                    <td><button className="row-action-btn" type="button" title="Edit Mandate" onClick={() => editJob(job)}><Pencil size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOpen && createPortal((
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setIsOpen(false)}>
          <div className="modal-card modal-card-lg" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editingJob ? 'Edit Mandate' : 'Add Mandate'}>
            <div className="modal-header">
              <span className="modal-title">{editingJob ? 'Edit Mandate' : 'Add Mandate'}</span>
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              {errors.form && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{errors.form}</div>}
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Job ID <span className="req">*</span></label>
                  <input className={`form-control${errors.job_display_id ? ' is-error' : ''}`} value={form.job_display_id || 'Auto-generated'} disabled readOnly />
                  {errors.job_display_id && <span className="form-error">{errors.job_display_id}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Date of Allocation</label>
                  <input className="form-control" type="date" value={form.allocation_date} onChange={e => setForm(current => ({ ...current, allocation_date: e.target.value }))} disabled={saving} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Consultant</label>
                  <div className="consultant-picker-list">
                    {selectedConsultants.length === 0 && <span className="sub-text">-</span>}
                    {selectedConsultants.map((name, index) => (
                      <select className="form-control" key={`${name}-${index}`} value={name} onChange={e => updateConsultant(index, e.target.value)} disabled={saving}>
                        {sortedUsers.map(user => <option key={user} value={user === '-' ? '' : user}>{user}</option>)}
                      </select>
                    ))}
                    <button className="row-action-btn" type="button" title="Add Consultant" onClick={addConsultant} disabled={saving || !availableConsultants.length}><Plus size={13} /></button>
                  </div>
                  {errors.consultants && <span className="form-error">{errors.consultants}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Team Lead</label>
                  <select className="form-control" value={form.team_lead} onChange={e => setForm(current => ({ ...current, team_lead: e.target.value }))} disabled={saving}>
                    {sortedUsers.map(user => <option key={user} value={user === '-' ? '' : user}>{user}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Client Name <span className="req">*</span></label>
                  <select className={`form-control${errors.client_id ? ' is-error' : ''}`} value={form.client_id} onChange={e => setForm(current => ({ ...current, client_id: e.target.value }))} disabled={saving}>
                    <option value="">Select client...</option>
                    {clientOptions.map(client => (
                      <option key={client.id} value={client.id}>
                        {clientName(client)}{client.client_display_id ? ` (${client.client_display_id})` : ''}
                      </option>
                    ))}
                  </select>
                  {errors.client_id && <span className="form-error">{errors.client_id}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Role <span className="req">*</span></label>
                  <input className={`form-control${errors.role ? ' is-error' : ''}`} value={form.role} onChange={e => setForm(current => ({ ...current, role: e.target.value }))} disabled={saving} />
                  {errors.role && <span className="form-error">{errors.role}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input className="form-control" value={form.location} onChange={e => setForm(current => ({ ...current, location: e.target.value }))} disabled={saving} />
                </div>
                <div className="form-group">
                  <label className="form-label">Budget</label>
                  <select className="form-control" value={form.budget} onChange={e => setForm(current => ({ ...current, budget: e.target.value }))} disabled={saving}>
                    <option value="">-</option>
                    {BUDGETS.map(value => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-control" value={form.priority} onChange={e => setForm(current => ({ ...current, priority: e.target.value }))} disabled={saving}>
                    <option value="">-</option>
                    {PRIORITIES.map(value => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Vertical</label>
                  <input className="form-control" value={form.vertical} onChange={e => setForm(current => ({ ...current, vertical: e.target.value }))} disabled={saving} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveJob} disabled={saving}>{saving ? 'Saving...' : 'Save Mandate'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
