import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, FileText, Loader2, Pencil, Plus, Search, X } from 'lucide-react'
import NewActionDropdown from '../components/NewActionDropdown'
import TablePopover from '../components/TablePopover'
import '../styles/Shared.css'
import { MANDATE_STATUSES, MANDATE_STATUS_BADGE_MAP, normalizeMandateStatus } from '../utils/mandateStatuses'
import { SECTOR_OPTIONS } from '../utils/sectorOptions'

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const SORT_OPTIONS = [
  { field: 'job_id', label: 'Job ID' },
  { field: 'role', label: 'Alphabetic order' }
]
const MANDATE_TABLE_COLUMNS = [
  { key: 'jobId', label: 'Job ID' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'teamLead', label: 'Team Lead' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'role', label: 'Role' },
  { key: 'location', label: 'Location' },
  { key: 'budget', label: 'Budget' },
  { key: 'mandateStatus', label: 'Mandate Status' },
  { key: 'sector', label: 'Sector' },
  { key: 'allocationDate', label: 'Date of Allocation' },
  { key: 'jd', label: 'JD' },
  { key: 'action', label: 'Action' }
]
const DEFAULT_MANDATE_COLUMN_KEYS = MANDATE_TABLE_COLUMNS.map(column => column.key)
const EMPTY_FORM = {
  id: '',
  job_display_id: '',
  consultants: [],
  team_lead: '',
  client_id: '',
  role: '',
  location: '',
  budget: '',
  mandate_status: '',
  vertical: '',
  allocation_date: '',
  jd_url: '',
  jd_storage_path: ''
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
  return [...map.values()].sort((a, b) => clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' }))
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
  const [aiLoading, setAiLoading] = useState(false)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_MANDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_MANDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const [clientSearch, setClientSearch] = useState('')
  const [jdFile, setJdFile] = useState(null)
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const [roleSuggestionsOpen, setRoleSuggestionsOpen] = useState(false)
  const [addingNewRole, setAddingNewRole] = useState(false)
  const [sectorSearch, setSectorSearch] = useState('')
  const [sectorOpen, setSectorOpen] = useState(false)
  const [teamLeadSearch, setTeamLeadSearch] = useState('')
  const [teamLeadOpen, setTeamLeadOpen] = useState(false)
  const [consultantSearch, setConsultantSearch] = useState({})
  const [consultantPickerOpen, setConsultantPickerOpen] = useState({})
  const modalRef = useRef(null)
  const roleInputRef = useRef(null)
  const sortRef = useRef(null)
  const columnsDropdownRef = useRef(null)

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
    const timer = window.setTimeout(async () => {
      try {
        const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
        const userId = currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/mandates_columns_preference?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = Array.isArray(payload.data?.value) ? payload.data.value.filter(key => DEFAULT_MANDATE_COLUMN_KEYS.includes(key)) : null
        if (value?.length) {
          setVisibleColumns(value)
          setPendingColumns(value)
          setSavedColumns(value)
        }
      } catch {
        setVisibleColumns(DEFAULT_MANDATE_COLUMN_KEYS)
        setPendingColumns(DEFAULT_MANDATE_COLUMN_KEYS)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const refreshClientOptions = useCallback(async () => {
    const res = await fetch('/api/clients')
    const data = await res.json().catch(() => ({}))
    if (res.ok) setDbClients(data.data || [])
  }, [])

  useEffect(() => {
    const refreshClients = () => refreshClientOptions()
    const refreshJobs = () => fetchData()
    window.addEventListener('ats:clients-updated', refreshClients)
    window.addEventListener('ats:jobs-updated', refreshJobs)
    return () => {
      window.removeEventListener('ats:clients-updated', refreshClients)
      window.removeEventListener('ats:jobs-updated', refreshJobs)
    }
  }, [fetchData, refreshClientOptions])

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

  useEffect(() => {
    if (!columnsOpen) return
    const close = (event) => {
      if (!columnsDropdownRef.current?.contains(event.target)) {
        setPendingColumns(visibleColumns)
        setColumnsOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [columnsOpen, visibleColumns])

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
    setClientSearch('')
    setRoleSearch('')
    setSectorSearch('')
    setTeamLeadSearch('')
    setAddingNewRole(false)
    setJdFile(null)
    setClientSuggestionsOpen(false)
    setRoleSuggestionsOpen(false)
    setIsOpen(true)
    try {
      await refreshClientOptions()
      const nextId = await fetchNextId()
      setForm(current => current.job_display_id === 'Loading...' ? { ...current, job_display_id: nextId } : current)
    } catch {
      setForm(current => ({ ...current, job_display_id: '' }))
    }
  }, [refreshClientOptions])

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
      mandate_status: normalizeMandateStatus(job.mandate_status || job.status || job.priority) === '-' ? '' : normalizeMandateStatus(job.mandate_status || job.status || job.priority),
      vertical: job.vertical || '',
      allocation_date: job.allocation_date || todayLocal(),
      jd_url: job.jd_url || '',
      jd_storage_path: job.jd_storage_path || ''
    })
    setJdFile(null)
    setClientSearch(job.client_name || '')
    setRoleSearch(job.role || job.title || '')
    setSectorSearch(job.vertical || '')
    setTeamLeadSearch(job.team_lead === '-' ? '' : job.team_lead || '')
    setAddingNewRole(false)
    setClientSuggestionsOpen(false)
    setRoleSuggestionsOpen(false)
    refreshClientOptions()
    setIsOpen(true)
  }

  const sortedUsers = useMemo(() => ['-', ...userOptions.filter(Boolean)], [userOptions])
  const clientOptions = useMemo(() => canonicalClients(dbClients), [dbClients])
  const matchingClients = useMemo(() => clientOptions
    .filter(client => `${clientName(client)} ${client.client_display_id || ''}`.toLowerCase().includes(clientSearch.trim().toLowerCase())), [clientOptions, clientSearch])
  const roleOptions = useMemo(() => {
    const map = new Map()
    jobs.forEach(job => {
      const role = (job.role || job.title || '').trim()
      if (!role) return
      const key = role.toLowerCase()
      if (!map.has(key)) map.set(key, { role, job_display_id: job.job_display_id || job.job_id || '' })
    })
    return [...map.values()].sort((a, b) => a.role.localeCompare(b.role, undefined, { sensitivity: 'base' }))
  }, [jobs])
  const matchingRoles = useMemo(() => roleOptions
    .filter(job => `${job.role} ${job.job_display_id || ''}`.toLowerCase().includes(roleSearch.trim().toLowerCase())), [roleOptions, roleSearch])
  const matchingSectors = useMemo(() => SECTOR_OPTIONS.filter(value => value.toLowerCase().includes(sectorSearch.trim().toLowerCase())), [sectorSearch])
  const matchingTeamLeads = useMemo(() => sortedUsers.filter(user => user !== '-' && user.toLowerCase().includes(teamLeadSearch.trim().toLowerCase())), [sortedUsers, teamLeadSearch])
  const selectedConsultants = form.consultants || []
  const availableConsultants = userOptions.filter(user => !selectedConsultants.includes(user))
  const activeColumns = MANDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))

  const togglePendingColumn = (key) => {
    setPendingColumns(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const proceedColumns = () => {
    setVisibleColumns(pendingColumns.length ? pendingColumns : DEFAULT_MANDATE_COLUMN_KEYS)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
      const userId = currentUser?.id || currentUser?.email || 'anonymous'
      const value = pendingColumns.length ? pendingColumns : DEFAULT_MANDATE_COLUMN_KEYS
      const response = await fetch('/api/user-preferences/mandates_columns_preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, value })
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail || payload.error || 'Unable to save column preference.')
      }
      setSavedColumns(value)
    } catch (err) {
      setError(err.message)
    }
  }

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
        mandate_status: form.mandate_status || null,
        vertical: form.vertical,
        allocation_date: form.allocation_date,
        jd_url: form.jd_url || '',
        jd_storage_path: form.jd_storage_path || ''
      }
      const body = new FormData()
      Object.entries(payload).forEach(([key, value]) => body.append(key, Array.isArray(value) ? value.join(',') : value ?? ''))
      if (jdFile) body.append('jd_file', jdFile)
      const res = await fetch(editingJob ? `/api/jobs/${editingJob.id}` : '/api/jobs', {
        method: editingJob ? 'PATCH' : 'POST',
        body
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save mandate.')
      setIsOpen(false)
      setEditingJob(null)
      await fetchData()
      window.dispatchEvent(new Event('ats:jobs-updated'))
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
    setAiLoading(true)
    try {
      const res = await fetch('/api/jobs/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiText })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAiFilters(null)
      setAiError(data.error || 'Could not parse Mandates filter.')
        return
      }
      setAiFilters(data.filters)
    } finally {
      setAiLoading(false)
    }
  }

  const clearFilters = () => {
    setAiText('')
    setAiFilters(null)
    setAiError('')
    setAiLoading(false)
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
  const matchingConsultants = (index) => sortedUsers.filter(user => user !== '-' && !selectedConsultants.some((selected, selectedIndex) => selectedIndex !== index && selected === user) && user.toLowerCase().includes(String(consultantSearch[index] || '').trim().toLowerCase()))

  const openMandateCandidates = (job) => {
    if (!job?.client_id || !job?.id) return
    navigate(`/dashboard/clients/${job.client_id}`, {
      state: {
        selectedJobId: job.id,
        selectedJobTitle: job.role || job.title || ''
      }
    })
  }

  const updateMandateStatus = async (job, status) => {
    setStatusSaving(current => ({ ...current, [job.id]: true }))
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mandate_status: status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update mandate status.')
      setJobs(rows => rows.map(row => row.id === job.id ? { ...row, mandate_status: status, status } : row))
      setTablePopover(null)
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setStatusSaving(current => ({ ...current, [job.id]: false }))
    }
  }

  const toggleTablePopover = (type, id, element) => {
    if (!element) return
    const anchorRect = element.getBoundingClientRect()
    setTablePopover(current => current?.type === type && current.id === id ? null : { type, id, anchorRect })
  }

  const renderMandateCell = (column, job) => {
    switch (column.key) {
      case 'jobId':
        return <td key={column.key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{dash(job.job_display_id)}</td>
      case 'consultant':
        return <td key={column.key}>{(job.consultants || []).length <= 1 ? dash(job.consultants?.[0]) : <div className="candidate-columns-control mandate-consultants-control"><button className="filter-select compact-select" type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('consultants', job.id, event.currentTarget)}>{job.consultants[0]} +{job.consultants.length - 1}</button></div>}</td>
      case 'teamLead':
        return <td key={column.key}>{dash(job.team_lead)}</td>
      case 'clientId':
        return <td key={column.key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{dash(job.client_display_id)}</td>
      case 'clientName':
        return <td key={column.key}>{dash(job.client_name)}</td>
      case 'role':
        return <td key={column.key}><button className="table-link-button name-text" type="button" onClick={() => openMandateCandidates(job)}>{dash(job.role)}</button></td>
      case 'location':
        return <td key={column.key}>{dash(job.location)}</td>
      case 'budget':
        return <td key={column.key}>{dash(job.budget)}</td>
      case 'mandateStatus':
        return <td key={column.key}><div className="candidate-columns-control mandate-status-control"><button className={`badge ${MANDATE_STATUS_BADGE_MAP[normalizeMandateStatus(job.mandate_status || job.status || job.priority)] || ''}`} type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('status', job.id, event.currentTarget)} disabled={statusSaving[job.id]}>{dash(normalizeMandateStatus(job.mandate_status || job.status || job.priority))}</button></div></td>
      case 'sector':
        return <td key={column.key}>{dash(job.vertical)}</td>
      case 'allocationDate':
        return <td key={column.key}>{dash(job.allocation_date)}</td>
      case 'jd':
        return <td key={column.key}>{job.jd_url ? <a href={job.jd_url} target="_blank" rel="noreferrer" className="cv-table-link" title="Open JD"><FileText size={15} /></a> : '-'}</td>
      case 'action':
        return <td key={column.key}><button className="row-action-btn" type="button" title="Edit Mandate" onClick={() => editJob(job)}><Pencil size={13} /></button></td>
      default:
        return null
    }
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
        <div className="candidate-columns-control" ref={columnsDropdownRef}>
          <button className="filter-select candidate-columns-btn" type="button" onClick={() => { setPendingColumns(visibleColumns); setColumnsOpen(open => !open) }}>
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
          {columnsOpen && (
            <div className="filter-dropdown candidate-columns-dropdown">
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(DEFAULT_MANDATE_COLUMN_KEYS)}>Select All</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(savedColumns?.length ? savedColumns : DEFAULT_MANDATE_COLUMN_KEYS)}>Reset to Saved Preference</button>
              <div className="candidate-columns-divider" />
              {MANDATE_TABLE_COLUMNS.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="filter-bar candidates-filter-bar">
        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input className="filter-input candidate-ai-filter-input" value={aiText} onChange={e => { setAiText(e.target.value); setAiError('') }} />
          <button className="btn-secondary" type="submit" disabled={aiLoading} style={{ height: 34, padding: '0 12px' }}>
            {aiLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            Apply
          </button>
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

      <div className="table-card table-card-popovers">
        {loading ? (
          <div className="loading-state"><Loader2 size={32} className="spin" color="var(--gold)" /><p>Loading mandates...</p></div>
        ) : error ? (
          <div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">Error loading data</div><div className="empty-state-desc">{error}</div></div>
        ) : jobs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No mandates found</div><div className="empty-state-desc">Create a mandate to get started.</div></div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table candidates-master-table" aria-label="Mandates">
              <thead>
                <tr>
                  {activeColumns.map(column => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    {activeColumns.map(column => renderMandateCell(column, job))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tablePopover && (() => {
        const job = jobs.find(item => item.id === tablePopover.id)
        if (!job) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={tablePopover.type === 'status' ? 150 : 180} onClose={() => setTablePopover(null)}>
            {tablePopover.type === 'consultants' ? (
              job.consultants.map(name => <div className="candidate-column-option" key={name}>{name}</div>)
            ) : (
              MANDATE_STATUSES.map(status => (
                <button className="candidate-columns-action" type="button" key={status} onClick={() => updateMandateStatus(job, status)}>
                  {status}
                </button>
              ))
            )}
          </TablePopover>
        )
      })()}

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
                      <div className="client-search-wrap" key={`${name}-${index}`}>
                        <input
                          className="form-control"
                          value={consultantSearch[index] ?? name}
                          onChange={e => {
                            setConsultantSearch(current => ({ ...current, [index]: e.target.value }))
                            setConsultantPickerOpen(current => ({ ...current, [index]: true }))
                          }}
                          onFocus={() => {
                            setConsultantSearch(current => ({ ...current, [index]: current[index] ?? name }))
                            setConsultantPickerOpen(current => ({ ...current, [index]: true }))
                          }}
                          onBlur={() => window.setTimeout(() => setConsultantPickerOpen(current => ({ ...current, [index]: false })), 120)}
                          disabled={saving}
                          autoComplete="off"
                        />
                        {consultantPickerOpen[index] && (
                          <div className="client-suggestions manual-suggestions is-open">
                            {matchingConsultants(index).length ? matchingConsultants(index).map(user => (
                              <button type="button" key={user} onMouseDown={event => {
                                event.preventDefault()
                                updateConsultant(index, user)
                                setConsultantSearch(current => ({ ...current, [index]: user }))
                                setConsultantPickerOpen(current => ({ ...current, [index]: false }))
                              }}><span>{user}</span></button>
                            )) : <div className="candidate-column-option">No results found</div>}
                          </div>
                        )}
                      </div>
                    ))}
                    <button className="row-action-btn" type="button" title="Add Consultant" onClick={addConsultant} disabled={saving || !availableConsultants.length}><Plus size={13} /></button>
                  </div>
                  {errors.consultants && <span className="form-error">{errors.consultants}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Team Lead</label>
                  <div className="client-search-wrap">
                    <input className="form-control" value={teamLeadSearch || form.team_lead} onChange={e => {
                      setTeamLeadSearch(e.target.value)
                      setForm(current => ({ ...current, team_lead: '' }))
                      setTeamLeadOpen(true)
                    }} onFocus={() => setTeamLeadOpen(true)} onBlur={() => window.setTimeout(() => setTeamLeadOpen(false), 120)} disabled={saving} autoComplete="off" />
                    {teamLeadOpen && (
                      <div className="client-suggestions manual-suggestions is-open">
                        {matchingTeamLeads.length ? matchingTeamLeads.map(user => (
                          <button type="button" key={user} onMouseDown={event => {
                            event.preventDefault()
                            setTeamLeadSearch(user)
                            setForm(current => ({ ...current, team_lead: user }))
                            setTeamLeadOpen(false)
                          }}><span>{user}</span></button>
                        )) : <div className="candidate-column-option">No results found</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Client Name <span className="req">*</span></label>
                  <div className="client-search-wrap">
                    <input
                      className={`form-control${errors.client_id ? ' is-error' : ''}`}
                      value={clientSearch}
                      onChange={e => {
                        setClientSearch(e.target.value)
                        setForm(current => ({ ...current, client_id: '' }))
                        setClientSuggestionsOpen(true)
                      }}
                      onFocus={() => {
                        setClientSuggestionsOpen(true)
                        refreshClientOptions()
                      }}
                      onBlur={() => window.setTimeout(() => setClientSuggestionsOpen(false), 120)}
                      placeholder={dbClients.length ? 'Search client...' : 'Loading clients...'}
                      disabled={saving}
                      autoComplete="off"
                    />
                    {clientSuggestionsOpen && (
                    <div className="client-suggestions manual-suggestions is-open">
                      {matchingClients.map(client => (
                        <button type="button" key={client.id} onMouseDown={(event) => {
                          event.preventDefault()
                          setClientSearch(clientName(client))
                          setForm(current => ({ ...current, client_id: client.id }))
                          setClientSuggestionsOpen(false)
                        }}>
                          <span>{clientName(client)}</span>
                          <small>{client.client_display_id || ''}</small>
                        </button>
                      ))}
                    </div>
                    )}
                  </div>
                  {errors.client_id && <span className="form-error">{errors.client_id}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Client ID</label>
                  <input className="form-control" value={clientOptions.find(client => client.id === form.client_id)?.client_display_id || ''} placeholder="Auto-filled after selecting client" disabled readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Role <span className="req">*</span></label>
                  <div className="client-search-wrap">
                    {addingNewRole && (
                      <div className="sub-text" style={{ marginBottom: 6 }}>
                        Adding new role
                        <button type="button" className="filter-clear" style={{ marginLeft: 8 }} onMouseDown={(event) => {
                          event.preventDefault()
                          setAddingNewRole(false)
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '' }))
                          setRoleSuggestionsOpen(true)
                        }}>Switch</button>
                      </div>
                    )}
                    <input
                      ref={roleInputRef}
                      className={`form-control${errors.role ? ' is-error' : ''}`}
                      value={roleSearch}
                      onChange={e => {
                        setRoleSearch(e.target.value)
                        setForm(current => ({ ...current, role: e.target.value }))
                        if (!addingNewRole) setRoleSuggestionsOpen(true)
                      }}
                      onFocus={() => !addingNewRole && setRoleSuggestionsOpen(true)}
                      onBlur={() => window.setTimeout(() => setRoleSuggestionsOpen(false), 120)}
                      disabled={saving}
                      autoComplete="off"
                    />
                    {roleSuggestionsOpen && !addingNewRole && (
                      <div className="client-suggestions manual-suggestions is-open">
                        <button type="button" onMouseDown={(event) => {
                          event.preventDefault()
                          setAddingNewRole(true)
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '' }))
                          setRoleSuggestionsOpen(false)
                          window.setTimeout(() => roleInputRef.current?.focus(), 0)
                        }}>
                          <span>Add New Role</span>
                        </button>
                        {matchingRoles.map(job => (
                          <button type="button" key={`${job.role}-${job.job_display_id}`} onMouseDown={(event) => {
                            event.preventDefault()
                            setRoleSearch(job.role)
                            setForm(current => ({ ...current, role: job.role }))
                            setAddingNewRole(false)
                            setRoleSuggestionsOpen(false)
                          }}>
                            <span>{job.role}</span>
                            <small>{job.job_display_id || ''}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
                  <label className="form-label">Mandate Status</label>
                  <select className="form-control" value={form.mandate_status} onChange={e => setForm(current => ({ ...current, mandate_status: e.target.value }))} disabled={saving}>
                    <option value="">-</option>
                    {MANDATE_STATUSES.map(value => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Sector</label>
                  <div className="client-search-wrap">
                    <input className="form-control" value={sectorSearch || form.vertical} onChange={e => {
                      setSectorSearch(e.target.value)
                      setForm(current => ({ ...current, vertical: '' }))
                      setSectorOpen(true)
                    }} onFocus={() => setSectorOpen(true)} onBlur={() => window.setTimeout(() => setSectorOpen(false), 120)} disabled={saving} autoComplete="off" />
                    {sectorOpen && (
                      <div className="client-suggestions manual-suggestions is-open">
                        {matchingSectors.length ? matchingSectors.map(value => (
                          <button type="button" key={value} onMouseDown={event => {
                            event.preventDefault()
                            setSectorSearch(value)
                            setForm(current => ({ ...current, vertical: value }))
                            setSectorOpen(false)
                          }}><span>{value}</span></button>
                        )) : <div className="candidate-column-option">No results found</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">JD File</label>
                  <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="form-control" onChange={e => setJdFile(e.target.files?.[0] || null)} disabled={saving} />
                  {form.jd_url && <a className="cv-table-link" href={form.jd_url} target="_blank" rel="noreferrer"><FileText size={13} /> Current JD</a>}
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
