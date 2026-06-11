import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronDown, ChevronLeft, AlertCircle, Loader2, Briefcase, FileText } from 'lucide-react'
import '../styles/Shared.css'
import './ClientDetailPage.css'
import { apiCandidateToUi } from '../utils/candidateUtils'
import { supabase } from '../services/supabaseClient'

const STATUS_BADGE = {
  Open: 'badge-open',
  Active: 'badge-open',
  'On Hold': 'badge-on-hold',
  Closed: 'badge-closed',
  Filled: 'badge-filled',
}

const STATUS_BADGE_MAP = {
  Interested: 'badge-interested',
  'Not Interested': 'badge-not-interested',
  Interview: 'badge-interview',
  'Client Submission': 'badge-client-submission',
  Offered: 'badge-offered',
  Hired: 'badge-hired',
  'Rejected by Recruiter': 'badge-rejected-recruiter',
  'Rejected by Client': 'badge-rejected-client',
}

const STATUS_COLUMNS = [
  ['interested', 'Interested'],
  ['notInterested', 'Not Interested'],
  ['interview', 'Interview'],
  ['clientSubmission', 'Client Submission'],
  ['offered', 'Offered'],
  ['hired', 'Hired'],
  ['rejectedByClient', 'Rejected by Client'],
  ['rejectedByRecruiter', 'Rejected by Recruiter'],
]

const CANDIDATE_TABLE_COLUMNS = [
  { key: 'sno', label: 'S.No' },
  { key: 'candidateDisplayId', label: 'Candidate ID' },
  { key: 'date', label: 'Date' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'client', label: 'Client Name' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'job', label: 'Role (Job)' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'designation', label: 'Designation' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email ID' },
  { key: 'experience', label: 'Experience' },
  { key: 'salary', label: 'Current CTC' },
  { key: 'location', label: 'Current Location' },
  { key: 'notice', label: 'Notice Period' },
  { key: 'expectedSalary', label: 'Expected CTC' },
  { key: 'relocate', label: 'Open to Relocate' },
  { key: 'comments', label: 'Comments' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'status', label: 'Status' },
  { key: 'cv', label: 'CV Link' },
  { key: 'month', label: 'Month' },
]

const DEFAULT_CANDIDATE_COLUMN_KEYS = CANDIDATE_TABLE_COLUMNS.map(column => column.key)
const SORT_OPTIONS = [
  { field: 'candidate_id', label: 'Candidate ID', toggle: true },
  { field: 'candidate_name', label: 'Alphabetic Order', toggle: true },
  { field: 'consultant', label: 'Consultant', toggle: false },
]

const pageSize = 50
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const getJobText = (candidate) => candidate.job || candidate.job_title || candidate.jobTitle || candidate.role || candidate.position || 'Unassigned Job'
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

export default function ClientDetailPage() {
  const { clientId } = useParams()
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
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)

  const fetchAllCandidates = useCallback(async (clientData) => {
    const candidateMap = new Map()
    let nextPage = 1

    while (true) {
      const [linkedRes, namedRes] = await Promise.all([
        fetch(`/api/candidates?client_id=${clientId}&page=${nextPage}&limit=100`),
        fetch(`/api/candidates?client_name=${encodeURIComponent(clientData.name)}&page=${nextPage}&limit=100`),
      ])
      if (!linkedRes.ok || !namedRes.ok) throw new Error('Failed to fetch candidate associations.')
      const linked = await linkedRes.json()
      const named = await namedRes.json()
      ;[...(linked.data || []), ...(named.data || [])].forEach((row) => {
        const clientTextMatches = normalizeText(row.client_name) === normalizeText(clientData.name)
        if (row.client_id === clientId || clientTextMatches) candidateMap.set(row.association_id || row.id, row)
      })
      if ((linked.data || []).length < 100 && (named.data || []).length < 100) break
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
        const value = Array.isArray(payload.data?.value) ? payload.data.value.filter(key => DEFAULT_CANDIDATE_COLUMN_KEYS.includes(key)) : null
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
    candidates.forEach((candidate) => {
      const title = getJobText(candidate) || 'Unassigned Job'
      const key = normalizeText(title) || 'unassigned job'
      if (!groups.has(key)) groups.set(key, { title, candidates: [] })
      groups.get(key).candidates.push(candidate)
    })

    return [...groups.values()].map((group) => {
      const relatedJob = clientJobs.find(job => normalizeText(job.title) === normalizeText(group.title))
      const stats = {
        total: group.candidates.length,
        interested: group.candidates.filter(c => c.status === 'Interested').length,
        notInterested: group.candidates.filter(c => c.status === 'Not Interested').length,
        interview: group.candidates.filter(c => c.status === 'Interview').length,
        clientSubmission: group.candidates.filter(c => c.status === 'Client Submission').length,
        offered: group.candidates.filter(c => c.status === 'Offered').length,
        hired: group.candidates.filter(c => c.status === 'Hired').length,
        rejectedByClient: group.candidates.filter(c => c.status === 'Rejected by Client').length,
        rejectedByRecruiter: group.candidates.filter(c => c.status === 'Rejected by Recruiter').length,
      }
      return { ...group, status: relatedJob?.status || '-', stats }
    }).sort((a, b) => compareText(a.title, b.title))
  }, [candidates, clientJobs])

  const jobCounts = useMemo(() => ({
    active: clientJobs.filter(job => ['Open', 'Active'].includes(job.status)).length,
    open: clientJobs.filter(job => job.status === 'Open').length,
    onHold: clientJobs.filter(job => job.status === 'On Hold').length,
    closed: clientJobs.filter(job => ['Closed', 'Filled'].includes(job.status)).length,
  }), [clientJobs])

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
  const activeColumns = CANDIDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))

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

  const renderCandidateCell = ({ key }, c, index) => {
    switch (key) {
      case 'sno': return <td key={key}>{(page - 1) * pageSize + index + 1}</td>
      case 'candidateDisplayId': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.candidateDisplayId || '-'}</td>
      case 'date': return <td key={key}>{formatDate(c.createdAt)}</td>
      case 'consultant': return <td key={key}>{c.consultant || '-'}</td>
      case 'client': return <td key={key}>{c.client || '-'}</td>
      case 'clientId': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{client?.client_display_id || '-'}</td>
      case 'job': return <td key={key} className="cell-ellipsis">{getJobText(c)}</td>
      case 'name':
        return <td key={key}><div className="name-cell"><div className="name-avatar">{initials(c.name)}</div><div><div className="name-text">{c.name}</div><div className="sub-text">{c.location || [c.city, c.state].filter(Boolean).join(', ')}</div></div></div></td>
      case 'organisation': return <td key={key}>{c.currentOrganisation || c.currentCompany || '-'}</td>
      case 'designation': return <td key={key}>{c.designation || '-'}</td>
      case 'mobile': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.mobile || '-'}</td>
      case 'email': return <td key={key}>{c.email || '-'}</td>
      case 'experience': return <td key={key}>{c.exp ? `${c.exp} yrs` : '-'}</td>
      case 'salary': return <td key={key}>{fmt(c.salary)}</td>
      case 'location': return <td key={key}>{c.location || c.city || '-'}</td>
      case 'notice': return <td key={key}>{c.noticePeriod !== '' && c.noticePeriod !== null ? c.noticePeriod : '-'}</td>
      case 'expectedSalary': return <td key={key}>{fmt(c.expectedSalary)}</td>
      case 'relocate': return <td key={key}>{c.openToRelocate ? 'Yes' : 'No'}</td>
      case 'comments': return <td key={key} className="cell-ellipsis">{c.notes || '-'}</td>
      case 'linkedin': return <td key={key}>{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="table-link">LinkedIn</a> : '-'}</td>
      case 'status': return <td key={key}><span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status}</span></td>
      case 'cv': return <td key={key}>{c.cvLink ? <a href={c.cvLink} target="_blank" rel="noopener noreferrer" className="cv-table-link"><FileText size={12} /> CV</a> : '-'}</td>
      case 'month': return <td key={key}>{formatMonth(c.createdAt)}</td>
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
            <div><span>Status</span><strong>{client.status || '-'}</strong></div>
            <div><span>Active Jobs</span><strong>{jobCounts.active}</strong></div>
            <div><span>Open Jobs</span><strong>{jobCounts.open}</strong></div>
            <div><span>On Hold Jobs</span><strong>{jobCounts.onHold}</strong></div>
            <div><span>Closed Jobs</span><strong>{jobCounts.closed}</strong></div>
          </div>
        </div>
      </div>

      <div className="section-title"><Briefcase size={18} /><h3>Job Groups ({jobGroups.length})</h3></div>
      <div className="table-card">
        {jobGroups.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No candidate job groups</div><div className="empty-state-desc">No candidates are linked to this client yet.</div></div>
        ) : (
          <table className="data-table" aria-label="Client Job Groups">
            <thead>
              <tr>
                <th>Job Title</th>
                <th>Status</th>
                <th className="align-center">Total Assigned</th>
                {STATUS_COLUMNS.map(([, label]) => <th className="align-center" key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {jobGroups.map(group => (
                <tr key={group.title}>
                  <td><button className="table-link-button" type="button" onClick={() => openGroup(group.title)}>{group.title}</button></td>
                  <td><span className={`badge ${STATUS_BADGE[group.status] || ''}`}>{group.status}</span></td>
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
              <table className="data-table candidates-master-table" aria-label="Client Job Candidates">
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
    </div>
  )
}
