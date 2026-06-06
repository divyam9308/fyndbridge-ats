import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Users, AlertCircle, Loader2, FileText } from 'lucide-react'
import '../styles/Shared.css'
import './ClientJobCandidatesPage.css'
import { apiCandidateToUi } from '../utils/candidateUtils'

const STATUS_BADGE_MAP = {
  'Interested':           'badge-interested',
  'Not Interested':       'badge-not-interested',
  'Interview':            'badge-interview',
  'Client Submission':    'badge-client-submission',
  'Offered':              'badge-offered',
  'Hired':                'badge-hired',
  'Rejected by Recruiter':'badge-rejected-recruiter',
  'Rejected by Client':   'badge-rejected-client',
}

const ALL_FILTER_STATUSES = [
  'All',
  'Interested',
  'Interview',
  'Offered',
  'Hired',
  'Rejected'
]

const fmt = (n) => n ? `Rs. ${Number(n).toLocaleString('en-IN')}` : '-'
const initials = (name) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

export default function ClientJobCandidatesPage() {
  const { clientId, jobId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  
  const [client, setClient] = useState(null)
  const [job, setJob] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Read status query param if present
  const initialStatusFilter = searchParams.get('status') || 'All'
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter)

  useEffect(() => {
    // Keep local filter in sync with query param
    const currentParam = searchParams.get('status') || 'All'
    setStatusFilter(currentParam)
  }, [searchParams])

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      try {
        setLoading(true)

        // 1. Fetch Client and Job Info
        const [clientRes, jobRes] = await Promise.all([
          fetch(`/api/clients/${clientId}`),
          fetch(`/api/jobs/${jobId}`)
        ])

        if (!clientRes.ok) {
          if (clientRes.status === 404) throw new Error('Client not found.')
          throw new Error('Failed to fetch client.')
        }
        if (!jobRes.ok) {
          if (jobRes.status === 404) throw new Error('Job not found.')
          throw new Error('Failed to fetch job.')
        }

        const clientData = await clientRes.json()
        const jobData = await jobRes.json()

        if (!active) return
        setClient(clientData)
        setJob(jobData)

        // 2. Fetch candidates matching this client name
        const candidatesRes = await fetch(`/api/candidates?client_name=${encodeURIComponent(clientData.name)}&limit=100`)
        if (!candidatesRes.ok) throw new Error('Failed to fetch candidates.')
        
        const candidatesData = await candidatesRes.json()

        if (active) {
          setCandidates((candidatesData.data || []).map(apiCandidateToUi))
          setError(null)
        }
      } catch (err) {
        if (active) {
          setError(err.message)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => { active = false }
  }, [clientId, jobId])

  if (loading) {
    return (
      <div className="client-candidates-container" style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
        <div className="loading-state">
          <Loader2 size={32} className="spin" color="var(--gold)" />
          <p>Loading candidate pipeline...</p>
        </div>
      </div>
    )
  }

  if (error || !client || !job) {
    return (
      <div className="client-candidates-container">
        <div className="page-header" style={{ justifyContent: 'flex-start' }}>
          <Link to="/dashboard/clients" className="btn-secondary">
            <ChevronLeft size={15} /> Back to Clients
          </Link>
        </div>
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div>
            <div className="empty-state-title">Client or job mandate not found</div>
            <div className="empty-state-desc">{error || 'The requested client or job ID does not exist.'}</div>
          </div>
        </div>
      </div>
    )
  }

  // Filter candidates assigned to this job title
  const jobCandidates = candidates.filter(c => c.job === job.title)

  // Apply status filter logic
  const filteredCandidates = jobCandidates.filter(c => {
    if (statusFilter === 'All') return true
    if (statusFilter === 'Rejected') {
      return c.status === 'Rejected by Recruiter' || c.status === 'Rejected by Client'
    }
    return c.status === statusFilter
  })

  const handleStatusFilterChange = (status) => {
    setStatusFilter(status)
    if (status === 'All') {
      searchParams.delete('status')
    } else {
      searchParams.set('status', status)
    }
    setSearchParams(searchParams)
  }

  return (
    <div className="client-candidates-container">
      {/* Navigation breadcrumbs */}
      <div className="page-header client-candidates-header">
        <div className="header-nav-buttons">
          <Link to={`/dashboard/clients/${client.id}`} className="btn-secondary" id="btn-back-to-client">
            <ChevronLeft size={15} /> Back to {client.name}
          </Link>
          <Link to="/dashboard/clients" className="btn-secondary" id="btn-back-to-clients-candidates">
            Back to Clients List
          </Link>
        </div>
      </div>

      {/* Mandate Card Details */}
      <div className="mandate-info-card">
        <div className="mandate-info-details">
          <div className="mandate-sub-label">Client Name</div>
          <h2 className="mandate-client-title">{client.name}</h2>
          <div className="mandate-job-block">
            <div className="mandate-sub-label">Job Mandate / Position</div>
            <h3 className="mandate-job-title">{job.title}</h3>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <span className="filter-label">Pipeline Status</span>
        <select 
          className="filter-select" 
          value={statusFilter}
          onChange={e => handleStatusFilterChange(e.target.value)} 
          id="filter-candidate-pipeline-status"
        >
          {ALL_FILTER_STATUSES.map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        
        {statusFilter !== 'All' && (
          <button 
            className="filter-clear" 
            onClick={() => handleStatusFilterChange('All')}
          >
            Clear Filter
          </button>
        )}
      </div>

      {/* Candidate List Table */}
      <div className="table-card">
        {filteredCandidates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No candidates found</div>
            <div className="empty-state-desc">
              {statusFilter === 'All' 
                ? 'No candidates have been assigned to this job mandate yet.'
                : `No candidates match the status filter "${statusFilter}".`}
            </div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table" aria-label="Assigned Candidates">
              <thead>
                <tr>
                  <th>Candidate Name</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>Designation</th>
                  <th>Experience</th>
                  <th>Current CTC</th>
                  <th>Expected CTC</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Consultant</th>
                  <th>CV</th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.map((c) => (
                  <tr key={c.associationId || c.id}>
                    <td>
                      <div className="name-cell">
                        <div className="name-avatar">{initials(c.name)}</div>
                        <div>
                          <div className="name-text">{c.name}</div>
                          <div className="sub-text">{c.currentCompany || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{c.mobile || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>{c.designation || '—'}</td>
                    <td>{c.exp ? `${c.exp} yrs` : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(c.salary)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(c.expectedSalary)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status}</span>
                    </td>
                    <td>{c.location || c.city || '—'}</td>
                    <td>{c.consultant || '—'}</td>
                    <td>
                      {c.cvLink ? (
                        <a href={c.cvLink} target="_blank" rel="noopener noreferrer" className="cv-table-link" title="Open CV">
                          <FileText size={12} strokeWidth={2} /> CV
                        </a>
                      ) : (
                        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
