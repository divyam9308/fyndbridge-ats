import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronLeft, User, Phone, Mail, MapPin, Briefcase, AlertCircle, Loader2 } from 'lucide-react'
import '../styles/Shared.css'
import './ClientDetailPage.css'
import { apiCandidateToUi } from '../utils/candidateUtils'

const STATUS_BADGE = {
  Open: 'badge-open',
  Active: 'badge-open',
  'On Hold': 'badge-on-hold',
  Closed: 'badge-closed',
  Filled: 'badge-filled',
}

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const [client, setClient] = useState(null)
  const [clientJobs, setClientJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      try {
        setLoading(true)
        
        // 1. Fetch Client Details
        const clientRes = await fetch(`/api/clients/${clientId}`)
        if (!clientRes.ok) {
          if (clientRes.status === 404) {
            setClient(null)
            setLoading(false)
            return
          }
          throw new Error('Failed to fetch client details.')
        }
        const clientData = await clientRes.json()
        
        if (!active) return
        setClient(clientData)

        // 2. Fetch jobs and candidates
        const [jobsRes, candidatesRes] = await Promise.all([
          fetch(`/api/jobs?client_id=${clientId}`),
          fetch(`/api/candidates?client_name=${encodeURIComponent(clientData.name)}&limit=100`)
        ])

        if (!jobsRes.ok) throw new Error('Failed to fetch client jobs.')
        if (!candidatesRes.ok) throw new Error('Failed to fetch candidate associations.')

        const jobsPayload = await jobsRes.json()
        const candidatesPayload = await candidatesRes.json()

        if (active) {
          setClientJobs(jobsPayload.data || [])
          setCandidates((candidatesPayload.data || []).map(apiCandidateToUi))
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
  }, [clientId])

  if (loading) {
    return (
      <div className="client-detail-container" style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
        <div className="loading-state">
          <Loader2 size={32} className="spin" color="var(--gold)" />
          <p>Loading client metrics...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="client-detail-container">
        <div className="page-header">
          <Link to="/dashboard/clients" className="btn-secondary">
            <ChevronLeft size={15} /> Back to Clients
          </Link>
        </div>
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div>
            <div className="empty-state-title">Error loading client</div>
            <div className="empty-state-desc">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="client-detail-container">
        <div className="page-header">
          <Link to="/dashboard/clients" className="btn-secondary">
            <ChevronLeft size={15} /> Back to Clients
          </Link>
        </div>
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div>
            <div className="empty-state-title">Client not found</div>
            <div className="empty-state-desc">The requested client ID does not exist in our directory.</div>
          </div>
        </div>
      </div>
    )
  }

  // Helper function to calculate status counts for a job
  const getJobCandidateStats = (jobTitle) => {
    const jobCandidates = candidates.filter(c => c.job === jobTitle)
    const total = jobCandidates.length
    const interested = jobCandidates.filter(c => c.status === 'Interested').length
    const interview = jobCandidates.filter(c => c.status === 'Interview').length
    const offered = jobCandidates.filter(c => c.status === 'Offered').length
    const hired = jobCandidates.filter(c => c.status === 'Hired').length
    const rejected = jobCandidates.filter(c => c.status === 'Rejected by Recruiter' || c.status === 'Rejected by Client').length

    return { total, interested, interview, offered, hired, rejected }
  }

  return (
    <div className="client-detail-container">
      {/* Back Button */}
      <div className="page-header" style={{ justifyContent: 'flex-start' }}>
        <Link to="/dashboard/clients" className="btn-secondary" id="btn-back-to-clients">
          <ChevronLeft size={15} /> Back to Clients
        </Link>
      </div>

      {/* Client Summary Header Card */}
      <div className="client-header-card">
        <div className="client-avatar-large">
          {client.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="client-header-info">
          <h2 className="client-title-text">{client.name}</h2>
          <div className="client-meta-grid">
            <div className="meta-item">
              <User size={14} className="meta-icon" />
              <span>{client.contact || '—'}</span>
            </div>
            <div className="meta-item">
              <Phone size={14} className="meta-icon" />
              <span className="mono-text">{client.phone || '—'}</span>
            </div>
            <div className="meta-item">
              <Mail size={14} className="meta-icon" />
              <span className="email-text">{client.email || '—'}</span>
            </div>
            <div className="meta-item">
              <MapPin size={14} className="meta-icon" />
              <span>{[client.city, client.state].filter(Boolean).join(', ') || '—'}</span>
            </div>
          </div>
          {client.notes && (
            <div className="client-notes-box">
              <strong>Notes:</strong> {client.notes}
            </div>
          )}
        </div>
      </div>

      <div className="section-title">
        <Briefcase size={18} strokeWidth={2} />
        <h3>Active Mandates & Jobs ({clientJobs.length})</h3>
      </div>

      {/* Jobs Table */}
      <div className="table-card">
        {clientJobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Briefcase size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No jobs found</div>
            <div className="empty-state-desc">There are no jobs registered for this client.</div>
          </div>
        ) : (
          <table className="data-table" aria-label="Client Jobs">
            <thead>
              <tr>
                <th>Job Title</th>
                <th>City</th>
                <th>Status</th>
                <th className="align-center">Total Assigned</th>
                <th className="align-center text-interested">Interested</th>
                <th className="align-center text-interview">Interview</th>
                <th className="align-center text-offered">Offered</th>
                <th className="align-center text-hired">Hired</th>
                <th className="align-center text-rejected">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {clientJobs.map((job) => {
                const stats = getJobCandidateStats(job.title)
                return (
                  <tr key={job.id}>
                    <td>
                      <div className="name-text">{job.title}</div>
                      {job.experience_label && <div className="sub-text">{job.experience_label}</div>}
                    </td>
                    <td>{job.city || '—'}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[job.status] || ''}`}>{job.status}</span>
                    </td>
                    <td className="align-center">
                      {stats.total > 0 ? (
                        <Link 
                          className="count-badge-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates`}
                        >
                          {stats.total}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                    <td className="align-center">
                      {stats.interested > 0 ? (
                        <Link 
                          className="count-badge-link badge-interested-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates?status=Interested`}
                        >
                          {stats.interested}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                    <td className="align-center">
                      {stats.interview > 0 ? (
                        <Link 
                          className="count-badge-link badge-interview-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates?status=Interview`}
                        >
                          {stats.interview}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                    <td className="align-center">
                      {stats.offered > 0 ? (
                        <Link 
                          className="count-badge-link badge-offered-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates?status=Offered`}
                        >
                          {stats.offered}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                    <td className="align-center">
                      {stats.hired > 0 ? (
                        <Link 
                          className="count-badge-link badge-hired-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates?status=Hired`}
                        >
                          {stats.hired}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                    <td className="align-center">
                      {stats.rejected > 0 ? (
                        <Link 
                          className="count-badge-link badge-rejected-link" 
                          to={`/dashboard/clients/${client.id}/jobs/${job.id}/candidates?status=Rejected`}
                        >
                          {stats.rejected}
                        </Link>
                      ) : (
                        <span className="count-zero">0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
