import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Pencil, Eye, X, Briefcase, AlertCircle, Loader2 } from 'lucide-react'
import '../styles/Shared.css'

const STATUS_BADGE = {
  Open: 'badge-open',
  Active: 'badge-open',
  'On Hold': 'badge-on-hold',
  Closed: 'badge-closed',
  Filled: 'badge-filled',
}

const PROGRESS_COLOR = (pct) => pct === 100 ? 'var(--success)' : pct >= 60 ? 'var(--gold)' : 'var(--info)'

const EMPTY_FORM = {
  title: '', client_id: '', city: '', state: '',
  salaryMin: '', salaryMax: '', experience: '',
  jd: '', skills: [], status: 'Open', completion: 0, notes: '',
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([])
  const [dbClients, setDbClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterStatus, setFilterStatus] = useState('All')
  const [showRejected, setShowRejected] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [skillInput, setSkillInput] = useState('')
  const [saving, setSaving] = useState(false)
  const modalRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => {
      const target = modalRef.current?.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || modalRef.current)?.focus({ preventScroll: true })
    })
    return () => { document.body.style.overflow = previous }
  }, [isOpen])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [jobsRes, clientsRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/clients')
      ])

      if (!jobsRes.ok) throw new Error('Failed to fetch jobs.')
      if (!clientsRes.ok) throw new Error('Failed to fetch clients.')

      const jobsData = await jobsRes.json()
      const clientsData = await clientsRes.json()

      setJobs(jobsData.data || [])
      setDbClients(clientsData.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const filtered = jobs.filter((job) => {
    if (filterStatus !== 'All' && job.status !== filterStatus) return false
    if (showRejected && job.rejected_by_client === 0) return false
    return true
  })

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const handleSkillKey = (event) => {
    if ((event.key === 'Enter' || event.key === ',') && skillInput.trim()) {
      event.preventDefault()
      const value = skillInput.trim().replace(/,$/, '')
      if (value && !form.skills.includes(value)) {
        setForm((current) => ({ ...current, skills: [...current.skills, value] }))
      }
      setSkillInput('')
    }
  }

  const removeSkill = (skill) => setForm((current) => ({ ...current, skills: current.skills.filter((item) => item !== skill) }))

  const validate = () => {
    const next = {}
    if (!form.title.trim()) next.title = 'Job Title is required'
    if (!form.client_id) next.client_id = 'Client is required'
    return next
  }

  const openModal = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setSkillInput('')
    setIsOpen(true)
  }

  const handleSave = async () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    try {
      setSaving(true)
      const payload = {
        title: form.title,
        client_id: form.client_id,
        city: form.city,
        state: form.state,
        status: form.status,
        salary_min: form.salaryMin ? Number(form.salaryMin) : null,
        salary_max: form.salaryMax ? Number(form.salaryMax) : null,
        experience_label: form.experience,
        experience_min: form.experience ? parseInt(form.experience) || null : null,
        completion: Number(form.completion) || 0,
        skills: form.skills,
        notes: form.notes,
        jd: form.jd
      }

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to save job.')
      }

      await fetchData()
      setIsOpen(false)
    } catch (err) {
      setErrors({ title: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn-primary" onClick={openModal} id="btn-add-job">
          <Plus size={15} strokeWidth={2.5} /> Add Job
        </button>
      </div>

      <div className="filter-bar">
        <span className="filter-label">Status</span>
        <select className="filter-select" value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)} id="filter-job-status">
          {['All', 'Open', 'Active', 'On Hold', 'Closed', 'Filled'].map((status) => <option key={status}>{status}</option>)}
        </select>

        <div className="filter-divider" />

        <label className="filter-toggle">
          <input type="checkbox" id="filter-rejected-only"
            checked={showRejected} onChange={e => setShowRejected(e.target.checked)} />
          Show Rejected Only
        </label>

        <button className="filter-clear"
          onClick={() => { setFilterStatus('All'); setShowRejected(false) }}>
          Clear Filters
        </button>
      </div>

      <div className="table-card">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={32} className="spin" color="var(--gold)" />
            <p>Loading jobs database...</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div>
            <div className="empty-state-title">Error loading data</div>
            <div className="empty-state-desc">{error}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Briefcase size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No jobs match your filters</div>
            <div className="empty-state-desc">Try adjusting or clearing your filters to see results.</div>
          </div>
        ) : (
          <table className="data-table" aria-label="Jobs">
            <thead>
              <tr>
                <th>Job Title</th>
                <th>Client</th>
                <th>City</th>
                <th>Status</th>
                <th>Rej. by Client</th>
                <th>Hired</th>
                <th>Completion</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="name-text">{job.title}</div>
                    {job.experience_label && <div className="sub-text">{job.experience_label}</div>}
                  </td>
                  <td>{job.client}</td>
                  <td>{job.city || '-'}</td>
                  <td><span className={`badge ${STATUS_BADGE[job.status] || ''}`}>{job.status}</span></td>
                  <td>
                    <span style={{ fontWeight: 700, color: job.rejected_by_client > 0 ? 'var(--danger)' : 'var(--gray-400)' }}>
                      {job.rejected_by_client}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: job.success_count > 0 ? 'var(--success)' : 'var(--gray-400)' }}>
                      {job.success_count}
                    </span>
                  </td>
                  <td>
                    <div className="progress-inline">
                      <div className="progress-inline-bar">
                        <div className="progress-inline-fill"
                          style={{ width: `${job.completion}%`, background: PROGRESS_COLOR(job.completion) }} />
                      </div>
                      <span className="progress-inline-pct">{job.completion}%</span>
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="Edit" id={`edit-job-${job.id}`}><Pencil size={13} strokeWidth={2} /></button>
                      <button className="row-action-btn" title="View Candidates" id={`view-job-${job.id}`}><Eye size={13} strokeWidth={2} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isOpen && createPortal((
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setIsOpen(false)}>
          <div className="modal-card modal-card-lg" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add Job">
            <div className="modal-header">
              <span className="modal-title">Add New Job</span>
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group full">
                  <label className="form-label">Job Title / Position <span className="req">*</span></label>
                  <input name="title" value={form.title} onChange={handleChange}
                    className={`form-control${errors.title ? ' is-error' : ''}`}
                    placeholder="e.g. Senior Backend Engineer" disabled={saving} />
                  {errors.title && <span className="form-error">{errors.title}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Client <span className="req">*</span></label>
                  <select name="client_id" value={form.client_id} onChange={handleChange}
                    className={`form-control${errors.client_id ? ' is-error' : ''}`} disabled={saving}>
                    <option value="">Select client...</option>
                    {dbClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  {errors.client_id && <span className="form-error">{errors.client_id}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Experience Required</label>
                  <input name="experience" value={form.experience} onChange={handleChange}
                    className="form-control" placeholder="e.g. 3-5 years" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">City</label>
                  <input name="city" value={form.city} onChange={handleChange}
                    className="form-control" placeholder="e.g. Bangalore" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <input name="state" value={form.state} onChange={handleChange}
                    className="form-control" placeholder="e.g. Karnataka" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">Min Salary (Rs.)</label>
                  <input name="salaryMin" type="number" value={form.salaryMin} onChange={handleChange}
                    className="form-control" placeholder="1200000" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Salary (Rs.)</label>
                  <input name="salaryMax" type="number" value={form.salaryMax} onChange={handleChange}
                    className="form-control" placeholder="2000000" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">Job Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className="form-control" disabled={saving}>
                    {['Open', 'Active', 'On Hold', 'Closed', 'Filled'].map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Completion %</label>
                  <input name="completion" type="number" min="0" max="100" value={form.completion}
                    onChange={handleChange} className="form-control" placeholder="0-100" disabled={saving} />
                </div>

                <div className="form-group full">
                  <label className="form-label">Required Skills</label>
                  <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input').focus()}>
                    {form.skills.map((skill) => (
                      <span className="tag-chip" key={skill}>
                        {skill}
                        <button className="tag-chip-remove" onClick={() => removeSkill(skill)} type="button" disabled={saving}><X size={10} /></button>
                      </span>
                    ))}
                    <input className="tag-input-field" value={skillInput}
                      onChange={e => setSkillInput(e.target.value)} onKeyDown={handleSkillKey}
                      placeholder={form.skills.length === 0 ? 'Type a skill and press Enter...' : ''} disabled={saving} />
                  </div>
                </div>

                <div className="form-group full">
                  <label className="form-label">Job Description</label>
                  <textarea name="jd" value={form.jd} onChange={handleChange}
                    className="form-control" rows={4}
                    placeholder="Describe the role, key responsibilities, and qualifications..." disabled={saving} />
                </div>

                <div className="form-group full">
                  <label className="form-label">Notes</label>
                  <textarea name="notes" value={form.notes} onChange={handleChange}
                    className="form-control" rows={2} placeholder="Internal notes for this job..." disabled={saving} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-job-btn" disabled={saving}>
                {saving ? 'Saving...' : 'Save Job'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
