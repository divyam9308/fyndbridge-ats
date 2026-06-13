import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useParams, Link } from 'react-router-dom'
import { ChevronDown, ChevronLeft, AlertCircle, Loader2, Briefcase, FileText, Pencil, X } from 'lucide-react'
import '../styles/Shared.css'
import './ClientDetailPage.css'
import { apiCandidateToUi } from '../utils/candidateUtils'
import { CANDIDATE_TABLE_COLUMNS, DEFAULT_CANDIDATE_COLUMN_KEYS, mergeCandidateColumnPreference } from '../utils/candidateTableColumns'
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_BADGE_MAP, CANDIDATE_STATUS_OPTIONS } from '../utils/candidateStatuses'
import { MANDATE_STATUS_BADGE_MAP, normalizeMandateStatus } from '../utils/mandateStatuses'
import { supabase } from '../services/supabaseClient'

const STATUS_BADGE_MAP = CANDIDATE_STATUS_BADGE_MAP
const STATUS_COLUMNS = CANDIDATE_STATUSES.map(status => [status, status])

const SORT_OPTIONS = [
  { field: 'candidate_id', label: 'Candidate ID', toggle: true },
  { field: 'candidate_name', label: 'Alphabetic Order', toggle: true },
  { field: 'consultant', label: 'Consultant', toggle: false },
]
const RELOCATE_OPTIONS = ['', 'Yes', 'No']

const pageSize = 50
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const getJobText = (candidate) => candidate.job || candidate.job_title || candidate.jobTitle || candidate.role || candidate.position || 'Unassigned Mandate'
const displayIdNumber = (value, prefix) => Number(String(value || '').replace(new RegExp(`^${prefix}`, 'i'), '')) || Number.MAX_SAFE_INTEGER
const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
const fmt = (n) => n ? `Rs. ${Number(n).toLocaleString('en-IN')}` : '-'
const initials = (name) => String(name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}
const formatMonth = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-US', { month: 'short' })
}
const getCurrentUser = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
  } catch {
    return {}
  }
}
const candidateToEditForm = (candidate) => ({
  association_id: candidate.associationId,
  full_name: candidate.name || '',
  email: candidate.email || '',
  mobile_number: candidate.mobile || '',
  city: candidate.city || '',
  state: candidate.state || '',
  location: candidate.location || '',
  current_designation: candidate.designation || '',
  current_company: candidate.currentCompany || '',
  current_organisation: candidate.currentOrganisation || '',
  experience_years: candidate.exp ?? '',
  notice_period: candidate.noticePeriod ?? '',
  open_to_relocate: candidate.openToRelocate || '',
  education: candidate.education || '',
  skills: Array.isArray(candidate.skills) ? candidate.skills.join(', ') : '',
  cv_link: candidate.cvLink || '',
  linkedin_url: candidate.linkedinUrl || '',
  client_id: candidate.clientId || '',
  client_name: candidate.client || '',
  job_title: candidate.job || '',
  consultant_name: candidate.consultantName || candidate.consultant || '',
  status: candidate.status || '',
  current_salary: candidate.salary ?? '',
  expected_salary: candidate.expectedSalary ?? '',
  offered_ctc: candidate.offeredCtc ?? '',
  date_of_joining: candidate.dateOfJoining || '',
  notes: candidate.notes || '',
})

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const location = useLocation()
  const [client, setClient] = useState(null)
  const [clientJobs, setClientJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [page, setPage] = useState(1)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [editCandidate, setEditCandidate] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState('')
  const [savingCandidate, setSavingCandidate] = useState(false)
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)
  const editModalRef = useRef(null)

  const focusPopup = useCallback((ref) => {
    window.requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const target = node.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || node).focus({ preventScroll: true })
    })
  }, [])

  useEffect(() => {
    if (!editCandidate) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [editCandidate])

  const fetchAllCandidates = useCallback(async (clientData) => {
    const candidateMap = new Map()
    let nextPage = 1
    const clientName = clientData.name || clientData.client_name || ''

    while (true) {
      const results = await Promise.allSettled([
        fetch(`/api/candidates?client_id=${clientId}&page=${nextPage}&limit=100`),
        fetch(`/api/candidates?client_name=${encodeURIComponent(clientName)}&page=${nextPage}&limit=100`),
      ])

      const responses = results
        .filter(result => result.status === 'fulfilled' && result.value.ok)
        .map(result => result.value)
      if (!responses.length) throw new Error('Failed to fetch candidate associations.')

      const payloads = await Promise.all(responses.map(response => response.json()))
      payloads.flatMap(payload => payload.data || []).forEach((row) => {
        const clientTextMatches = normalizeText(row.client_name) === normalizeText(clientName)
        if (row.client_id === clientId || clientTextMatches) candidateMap.set(row.association_id || row.id, row)
      })
      if (payloads.every(payload => (payload.data || []).length < 100)) break
      nextPage += 1
    }

    return [...candidateMap.values()].map(apiCandidateToUi)
  }, [clientId])

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      try {
        setLoading(true)
        const clientRes = await fetch(`/api/clients/${clientId}`)
        if (clientRes.status === 404) {
          setClient(null)
          return
        }
        if (!clientRes.ok) throw new Error('Failed to fetch client details.')
        const clientData = await clientRes.json()
        const [jobsRes, candidateRows] = await Promise.all([
          fetch(`/api/jobs?client_id=${clientId}`),
          fetchAllCandidates(clientData),
        ])
        if (!jobsRes.ok) throw new Error('Failed to fetch client jobs.')
        const jobsPayload = await jobsRes.json()
        if (!active) return
        setClient(clientData)
        setClientJobs(jobsPayload.data || [])
        setCandidates(candidateRows)
        setError(null)
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchData()
    return () => { active = false }
  }, [clientId, fetchAllCandidates])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null
        const currentUser = getCurrentUser()
        const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/candidate_columns?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = mergeCandidateColumnPreference(payload.data?.value)
        if (value?.length) {
          setVisibleColumns(value)
          setPendingColumns(value)
          setSavedColumns(value)
        }
      } catch {
        setVisibleColumns(DEFAULT_CANDIDATE_COLUMN_KEYS)
        setPendingColumns(DEFAULT_CANDIDATE_COLUMN_KEYS)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!columnsOpen) return
    const handleClickOutside = (event) => {
      if (!columnsDropdownRef.current?.contains(event.target)) {
        setPendingColumns(visibleColumns)
        setColumnsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [columnsOpen, visibleColumns])

  useEffect(() => {
    if (!sortOpen) return
    const handleClickOutside = (event) => {
      if (!sortDropdownRef.current?.contains(event.target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sortOpen])

  const jobGroups = useMemo(() => {
    const groups = new Map()
    clientJobs.forEach((job) => {
      const title = job.title || job.role || 'Unassigned Mandate'
      const key = normalizeText(title) || job.id
      groups.set(key, { title, candidates: [], relatedJob: job })
    })
    candidates.forEach((candidate) => {
      const matchedJob = clientJobs.find(job => job.id === candidate.jobId) || clientJobs.find(job => normalizeText(job.title || job.role) === normalizeText(getJobText(candidate)))
      const title = matchedJob ? matchedJob.title || matchedJob.role : getJobText(candidate) || 'Unassigned Mandate'
      const key = matchedJob ? normalizeText(matchedJob.title || matchedJob.role) || matchedJob.id : normalizeText(title) || 'unassigned mandate'
      if (!groups.has(key)) groups.set(key, { title, candidates: [], relatedJob: matchedJob })
      groups.get(key).candidates.push(candidate)
    })

    return [...groups.values()].map((group) => {
      const relatedJob = group.relatedJob || clientJobs.find(job => normalizeText(job.title || job.role) === normalizeText(group.title))
      const stats = CANDIDATE_STATUSES.reduce((acc, status) => {
        acc[status] = group.candidates.filter(c => c.status === status).length
        return acc
      }, { total: group.candidates.length })
      const savedStatus = normalizeMandateStatus(relatedJob?.mandate_status || relatedJob?.status)
      const derivedStatus = savedStatus === 'Scrapped'
        ? 'Scrapped'
        : stats.Hired > 0
          ? 'Completed'
          : savedStatus === '-' ? 'Ongoing' : savedStatus
      return { ...group, relatedJob, status: derivedStatus, stats }
    }).sort((a, b) => compareText(a.title, b.title))
  }, [candidates, clientJobs])

  const jobCounts = useMemo(() => ({
    ongoing: jobGroups.filter(job => job.status === 'Ongoing').length,
    scrapped: jobGroups.filter(job => job.status === 'Scrapped').length,
    completed: jobGroups.filter(job => job.status === 'Completed').length,
  }), [jobGroups])

  useEffect(() => {
    const selectedJobId = location.state?.selectedJobId
    const selectedJobTitle = location.state?.selectedJobTitle
    if (!jobGroups.length || selectedGroup || (!selectedJobId && !selectedJobTitle)) return
    const group = jobGroups.find(item => item.relatedJob?.id === selectedJobId) || jobGroups.find(item => normalizeText(item.title) === normalizeText(selectedJobTitle))
    if (!group) return
    const timer = window.setTimeout(() => {
      setSelectedGroup({ jobTitle: group.title, status: '' })
      setPage(1)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [jobGroups, location.state, selectedGroup])

  const calculatedClientStatus = useMemo(() => {
    if (jobGroups.length && jobGroups.every(job => job.status === 'Scrapped')) return 'Inactive'
    if (jobGroups.some(job => job.status === 'Completed')) return 'Active'
    return client?.status || '-'
  }, [client?.status, jobGroups])

  const selectedCandidates = useMemo(() => {
    if (!selectedGroup) return []
    const group = jobGroups.find(item => normalizeText(item.title) === normalizeText(selectedGroup.jobTitle))
    const rows = group?.candidates || []
    return selectedGroup.status ? rows.filter(candidate => candidate.status === selectedGroup.status) : rows
  }, [jobGroups, selectedGroup])

  const sortedCandidates = useMemo(() => {
    const rows = [...selectedCandidates]
    const direction = sortDirection === 'desc' ? -1 : 1
    if (sortField === 'candidate_id') rows.sort((a, b) => (displayIdNumber(a.candidateDisplayId, 'CA') - displayIdNumber(b.candidateDisplayId, 'CA')) * direction)
    if (sortField === 'candidate_name') rows.sort((a, b) => compareText(a.name, b.name) * direction)
    if (sortField === 'consultant') rows.sort((a, b) => compareText(a.consultant, b.consultant))
    return rows
  }, [selectedCandidates, sortDirection, sortField])

  const pagedCandidates = sortedCandidates.slice((page - 1) * pageSize, page * pageSize)
  const activeColumns = CANDIDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key) || column.key === 'jobId')

  const openGroup = (jobTitle, status = '') => {
    setSelectedGroup({ jobTitle, status })
    setPage(1)
  }
  const togglePendingColumn = (key) => setPendingColumns(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  const proceedColumns = () => {
    setVisibleColumns(pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)
    setColumnsOpen(false)
  }
  const saveColumnPreference = async () => {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    const currentUser = getCurrentUser()
    const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
    const value = pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS
    await fetch('/api/user-preferences/candidate_columns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, value }),
    })
    setSavedColumns(value)
  }
  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    return option ? `${option.label} ${sortDirection === 'asc' ? '↓' : '↑'}` : 'Sort By'
  }
  const selectSort = (field) => {
    if (sortField === field) setSortDirection(current => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortField(field)
      setSortDirection('asc')
    }
    setSortOpen(false)
  }
  const openEditCandidate = (candidate) => {
    setEditCandidate(candidate)
    setEditForm(candidateToEditForm(candidate))
    setEditError('')
  }
  useEffect(() => {
    if (editCandidate) focusPopup(editModalRef)
  }, [editCandidate, focusPopup])
  const updateEditField = (field, value) => {
    setEditForm(form => ({ ...form, [field]: value }))
  }
  const saveEditCandidate = async () => {
    if (!editCandidate || !editForm) return
    setSavingCandidate(true)
    setEditError('')
    try {
      const payload = {
        ...editForm,
        skills: editForm.skills.split(',').map(skill => skill.trim()).filter(Boolean),
        experience_years: editForm.experience_years === '' ? null : Number(editForm.experience_years),
        notice_period: editForm.notice_period === '' ? null : Number(editForm.notice_period),
        open_to_relocate: editForm.open_to_relocate === '' ? null : editForm.open_to_relocate === 'Yes',
        current_salary: editForm.current_salary === '' ? null : Number(editForm.current_salary),
        expected_salary: editForm.expected_salary === '' ? null : Number(editForm.expected_salary),
        offered_ctc: editForm.status === 'Hired' && editForm.offered_ctc !== '' ? Number(editForm.offered_ctc) : null,
        date_of_joining: editForm.status === 'Hired' ? editForm.date_of_joining || null : null,
      }
      const response = await fetch(`/api/candidates/${editCandidate.associationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || Object.values(data.errors || {})[0] || 'Unable to update candidate.')
      const updated = apiCandidateToUi(data)
      const newJobTitle = getJobText(updated)
      const nextCandidates = candidates.map(candidate => candidate.associationId === updated.associationId ? updated : candidate)
      setCandidates(nextCandidates)
      if (updated.status === 'Hired') {
        const job = clientJobs.find(item => normalizeText(item.title || item.role) === normalizeText(newJobTitle))
        if (job && normalizeMandateStatus(job.mandate_status || job.status) !== 'Scrapped') {
          setClientJobs(rows => rows.map(row => row.id === job.id ? { ...row, mandate_status: 'Completed', status: 'Completed' } : row))
        }
      }
      setEditCandidate(null)
      setEditForm(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setSavingCandidate(false)
    }
  }

  const renderSkillsCell = (candidate) => {
    const skills = Array.isArray(candidate.skills) ? candidate.skills.filter(Boolean) : []
    if (!skills.length) return '-'
    return (
      <div className="table-chip-list">
        {skills.map(skill => <span className="table-skill-chip" key={skill}>{skill}</span>)}
      </div>
    )
  }

  const renderCandidateCell = ({ key }, c) => {
    switch (key) {
      case 'candidateDisplayId': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.candidateDisplayId || '-'}</td>
      case 'date': return <td key={key}>{formatDate(c.createdAt)}</td>
      case 'consultant': return <td key={key}>{c.consultant || '-'}</td>
      case 'client': return <td key={key}>{c.client || '-'}</td>
      case 'clientId': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{client?.client_display_id || '-'}</td>
      case 'jobId': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.jobDisplayId || '-'}</td>
      case 'job': return <td key={key} className="cell-ellipsis">{getJobText(c)}</td>
      case 'name':
        return <td key={key}><div className="name-cell"><div className="name-avatar">{initials(c.name)}</div><div><div className="name-text">{c.name}</div><div className="sub-text">{c.location || [c.city, c.state].filter(Boolean).join(', ')}</div></div></div></td>
      case 'organisation': return <td key={key}>{c.currentOrganisation || c.currentCompany || '-'}</td>
      case 'designation': return <td key={key}>{c.designation || '-'}</td>
      case 'mobile': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.mobile || '-'}</td>
      case 'email': return <td key={key}>{c.email || '-'}</td>
      case 'experience': return <td key={key}>{c.exp ? `${c.exp} yrs` : '-'}</td>
      case 'skills': return <td key={key}>{renderSkillsCell(c)}</td>
      case 'salary': return <td key={key}>{fmt(c.salary)}</td>
      case 'location': return <td key={key}>{c.location || c.city || '-'}</td>
      case 'notice': return <td key={key}>{c.noticePeriod !== '' && c.noticePeriod !== null ? c.noticePeriod : '-'}</td>
      case 'expectedSalary': return <td key={key}>{fmt(c.expectedSalary)}</td>
      case 'relocate': return <td key={key}>{c.openToRelocate || '-'}</td>
      case 'comments': return <td key={key} className="cell-ellipsis">{c.notes || '-'}</td>
      case 'linkedin': return <td key={key}>{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="table-link">LinkedIn</a> : '-'}</td>
      case 'status': return <td key={key}><span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status || '-'}</span></td>
      case 'offeredCtc': return <td key={key}>{c.status === 'Hired' ? fmt(c.offeredCtc) : '-'}</td>
      case 'dateOfJoining': return <td key={key}>{c.status === 'Hired' ? formatDate(c.dateOfJoining) : '-'}</td>
      case 'cv': return <td key={key}>{c.cvLink ? <a href={c.cvLink} target="_blank" rel="noopener noreferrer" className="cv-table-link" title="Open CV"><FileText size={15} /></a> : '-'}</td>
      case 'month': return <td key={key}>{formatMonth(c.createdAt)}</td>
      case 'action': return <td key={key}><button className="row-action-btn" type="button" title="Edit Candidate" onClick={() => openEditCandidate(c)}><Pencil size={13} /></button></td>
      default: return null
    }
  }

  if (loading) return <div className="loading-state"><Loader2 size={32} className="spin" color="var(--gold)" /><p>Loading client metrics...</p></div>

  if (error || !client) {
    return (
      <div className="client-detail-container">
        <div className="page-header"><Link to="/dashboard/clients" className="btn-secondary"><ChevronLeft size={15} /> Back to Clients</Link></div>
        <div className="table-card"><div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">{error ? 'Error loading client' : 'Client not found'}</div><div className="empty-state-desc">{error || 'The requested client ID does not exist.'}</div></div></div>
      </div>
    )
  }

  return (
    <div className="client-detail-container">
      <div className="page-header" style={{ justifyContent: 'flex-start' }}>
        <Link to="/dashboard/clients" className="btn-secondary"><ChevronLeft size={15} /> Back to Clients</Link>
      </div>

      <div className="client-header-card">
        <div className="client-avatar-large">{initials(client.name)}</div>
        <div className="client-header-info">
          <h2 className="client-title-text">{client.name}</h2>
          <div className="client-metrics-grid">
            <div><span>Client Status</span><strong>{calculatedClientStatus}</strong></div>
            <div><span>Ongoing Mandates</span><strong>{jobCounts.ongoing}</strong></div>
            <div><span>Scrapped Mandates</span><strong>{jobCounts.scrapped}</strong></div>
            <div><span>Completed Mandates</span><strong>{jobCounts.completed}</strong></div>
          </div>
        </div>
      </div>

      <div className="section-title"><Briefcase size={18} /><h3>Mandate Groups ({jobGroups.length})</h3></div>
      <div className="table-card">
        {jobGroups.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No candidate job groups</div><div className="empty-state-desc">No candidates are linked to this client yet.</div></div>
        ) : (
          <table className="data-table" aria-label="Client Mandate Groups">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Mandate / Role</th>
                <th>Status</th>
                <th className="align-center">Candidates Assigned</th>
                {STATUS_COLUMNS.map(([, label]) => <th className="align-center" key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {jobGroups.map(group => (
                <tr key={group.title}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{group.relatedJob?.job_display_id || '-'}</td>
                  <td><button className="table-link-button" type="button" onClick={() => openGroup(group.title)}>{group.title}</button></td>
                  <td><span className={`badge ${MANDATE_STATUS_BADGE_MAP[group.status] || ''}`}>{group.status}</span></td>
                  <td className="align-center"><button className="count-badge-link" type="button" onClick={() => openGroup(group.title)}>{group.stats.total}</button></td>
                  {STATUS_COLUMNS.map(([key, label]) => (
                    <td className="align-center" key={key}>
                      {group.stats[key] ? <button className="count-badge-link" type="button" onClick={() => openGroup(group.title, label)}>{group.stats[key]}</button> : <span className="count-zero">0</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedGroup && (
        <>
          <div className="section-title"><Briefcase size={18} /><h3>{selectedGroup.jobTitle} Candidates{selectedGroup.status ? ` - ${selectedGroup.status}` : ''}</h3></div>
          <div className="candidate-columns-toolbar">
            <div className="candidate-columns-control" ref={columnsDropdownRef}>
              <button className="filter-select candidate-columns-btn" type="button" onClick={() => { setPendingColumns(visibleColumns); setColumnsOpen(open => !open) }}><span>Columns</span><ChevronDown size={13} /></button>
              <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
              {columnsOpen && (
                <div className="filter-dropdown candidate-columns-dropdown">
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(DEFAULT_CANDIDATE_COLUMN_KEYS)}>Select All</button>
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
                  <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(savedColumns?.length ? savedColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)}>Reset to Saved Preference</button>
                  <div className="candidate-columns-divider" />
                  {CANDIDATE_TABLE_COLUMNS.map(column => <label className="candidate-column-option" key={column.key}><input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />{column.label}</label>)}
                </div>
              )}
            </div>
          </div>
          <div className="filter-bar candidates-filter-bar">
            <span className="filter-label">Sort By</span>
            <div className="candidate-sort-control" ref={sortDropdownRef}>
              <button className="filter-select candidate-sort-btn" type="button" onClick={() => setSortOpen(open => !open)}><span>{sortLabel()}</span><ChevronDown size={13} /></button>
              {sortOpen && <div className="filter-dropdown candidate-sort-dropdown">{SORT_OPTIONS.map(option => <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>{option.toggle ? `${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}` : option.label}</button>)}</div>}
            </div>
            <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc'); setPage(1) }}>Clear</button>
          </div>
          <div className="table-card">
            <div className="table-wrapper">
              <table className="data-table candidates-master-table" aria-label="Client Mandate Candidates">
                <thead><tr>{activeColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
                <tbody>{pagedCandidates.map((candidate, index) => <tr key={candidate.associationId || candidate.id}>{activeColumns.map(column => renderCandidateCell(column, candidate, index))}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="pagination-bar">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(sortedCandidates.length / pageSize))}</span>
            <span>{sortedCandidates.length.toLocaleString('en-IN')} total</span>
            <button className="btn-secondary" disabled={page >= Math.max(1, Math.ceil(sortedCandidates.length / pageSize))} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </>
      )}
      {editCandidate && editForm && createPortal((
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !savingCandidate && setEditCandidate(null)}>
          <div className="modal-card modal-card-lg" ref={editModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit Candidate">
            <div className="modal-header">
              <span className="modal-title">Edit Candidate</span>
              <button className="modal-close" type="button" onClick={() => setEditCandidate(null)} disabled={savingCandidate} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              {editError && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{editError}</div>}
              <div className="form-grid-2">
                {[
                  ['full_name', 'Full Name', 'text'],
                  ['email', 'Email', 'email'],
                  ['mobile_number', 'Mobile Number', 'text'],
                  ['consultant_name', 'Consultant', 'text'],
                  ['current_designation', 'Current Designation', 'text'],
                  ['current_organisation', 'Current Organisation', 'text'],
                  ['location', 'Current Location', 'text'],
                  ['experience_years', 'Experience Years', 'number'],
                  ['notice_period', 'Notice Period', 'number'],
                  ['current_salary', 'Current Salary', 'number'],
                  ['expected_salary', 'Expected Salary', 'number'],
                  ['job_title', 'Mandate / Role', 'text'],
                  ['linkedin_url', 'LinkedIn URL', 'text'],
                  ['cv_link', 'CV', 'text'],
                ].map(([field, label, type]) => (
                  <div className="form-group" key={field}>
                    <label className="form-label">{label}</label>
                    <input className="form-control" type={type} value={editForm[field] ?? ''} onChange={(event) => updateEditField(field, event.target.value)} disabled={savingCandidate} />
                  </div>
                ))}
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-control" value={editForm.status} onChange={(event) => updateEditField('status', event.target.value)} disabled={savingCandidate}>
                    {CANDIDATE_STATUS_OPTIONS.map(status => <option key={status || '-'} value={status}>{status || '-'}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Open to Relocate</label>
                  <select className="form-control" value={editForm.open_to_relocate} onChange={(event) => updateEditField('open_to_relocate', event.target.value)} disabled={savingCandidate}>
                    {RELOCATE_OPTIONS.map(value => <option key={value || '-'} value={value}>{value || '-'}</option>)}
                  </select>
                </div>
                {editForm.status === 'Hired' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Offered CTC</label>
                      <input className="form-control" type="number" value={editForm.offered_ctc ?? ''} onChange={(event) => updateEditField('offered_ctc', event.target.value)} disabled={savingCandidate} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date of Joining</label>
                      <input className="form-control" type="date" value={editForm.date_of_joining || ''} onChange={(event) => updateEditField('date_of_joining', event.target.value)} disabled={savingCandidate} />
                    </div>
                  </>
                )}
                <div className="form-group full">
                  <label className="form-label">Skills</label>
                  <input className="form-control" value={editForm.skills} onChange={(event) => updateEditField('skills', event.target.value)} disabled={savingCandidate} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Education</label>
                  <textarea className="form-control" rows={3} value={editForm.education} onChange={(event) => updateEditField('education', event.target.value)} disabled={savingCandidate} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Comments</label>
                  <textarea className="form-control" rows={3} value={editForm.notes} onChange={(event) => updateEditField('notes', event.target.value)} disabled={savingCandidate} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setEditCandidate(null)} disabled={savingCandidate}>Cancel</button>
              <button className="btn-primary" type="button" onClick={saveEditCandidate} disabled={savingCandidate}>{savingCandidate ? 'Saving...' : 'Save Candidate'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
