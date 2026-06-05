import { useState } from 'react'
import { Plus, Pencil, Eye, X, Briefcase } from 'lucide-react'
import '../styles/Shared.css'
import { DEMO_CLIENTS, DEMO_JOBS } from '../data/demoDirectoryData'

const CLIENTS = DEMO_CLIENTS.map((client) => client.name)
const INITIAL_JOBS = DEMO_JOBS

const STATUS_BADGE = {
  Open: 'badge-open',
  Active: 'badge-open',
  'On Hold': 'badge-on-hold',
  Closed: 'badge-closed',
  Filled: 'badge-filled',
}

const PROGRESS_COLOR = (pct) => pct === 100 ? 'var(--success)' : pct >= 60 ? 'var(--gold)' : 'var(--info)'

const EMPTY_FORM = {
  title: '', client: '', city: '', state: '',
  salaryMin: '', salaryMax: '', experience: '',
  jd: '', skills: [], status: 'Open', completion: 0, notes: '',
}

export default function JobsPage() {
  const [jobs, setJobs] = useState(INITIAL_JOBS)
  const [filterStatus, setFilterStatus] = useState('All')
  const [showRejected, setShowRejected] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [skillInput, setSkillInput] = useState('')

  const filtered = jobs.filter((job) => {
    if (filterStatus !== 'All' && job.status !== filterStatus) return false
    if (showRejected && job.rejectedByClient === 0) return false
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
    if (!form.client) next.client = 'Client is required'
    return next
  }

  const openModal = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setSkillInput('')
    setIsOpen(true)
  }

  const handleSave = () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    setJobs((current) => [{
      id: Date.now(),
      title: form.title,
      client: form.client,
      city: form.city,
      state: form.state,
      status: form.status,
      rejectedByClient: 0,
      successCount: 0,
      completion: Number(form.completion) || 0,
      experience: form.experience,
      skills: form.skills,
      salaryMin: form.salaryMin,
      salaryMax: form.salaryMax,
      openPositions: 1,
      jd: form.jd,
      notes: form.notes,
    }, ...current])
    setIsOpen(false)
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
        {filtered.length === 0 ? (
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
                    {job.experience && <div className="sub-text">{job.experience}</div>}
                  </td>
                  <td>{job.client}</td>
                  <td>{job.city || '-'}</td>
                  <td><span className={`badge ${STATUS_BADGE[job.status] || ''}`}>{job.status}</span></td>
                  <td>
                    <span style={{ fontWeight: 700, color: job.rejectedByClient > 0 ? 'var(--danger)' : 'var(--gray-400)' }}>
                      {job.rejectedByClient}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: job.successCount > 0 ? 'var(--success)' : 'var(--gray-400)' }}>
                      {job.successCount}
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

      {isOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setIsOpen(false)}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Add Job">
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
                    placeholder="e.g. Senior Backend Engineer" />
                  {errors.title && <span className="form-error">{errors.title}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Client <span className="req">*</span></label>
                  <select name="client" value={form.client} onChange={handleChange}
                    className={`form-control${errors.client ? ' is-error' : ''}`}>
                    <option value="">Select client...</option>
                    {CLIENTS.map((client) => <option key={client}>{client}</option>)}
                  </select>
                  {errors.client && <span className="form-error">{errors.client}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Experience Required</label>
                  <input name="experience" value={form.experience} onChange={handleChange}
                    className="form-control" placeholder="e.g. 3-5 years" />
                </div>

                <div className="form-group">
                  <label className="form-label">City</label>
                  <input name="city" value={form.city} onChange={handleChange}
                    className="form-control" placeholder="e.g. Bangalore" />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <input name="state" value={form.state} onChange={handleChange}
                    className="form-control" placeholder="e.g. Karnataka" />
                </div>

                <div className="form-group">
                  <label className="form-label">Min Salary (Rs.)</label>
                  <input name="salaryMin" type="number" value={form.salaryMin} onChange={handleChange}
                    className="form-control" placeholder="1200000" />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Salary (Rs.)</label>
                  <input name="salaryMax" type="number" value={form.salaryMax} onChange={handleChange}
                    className="form-control" placeholder="2000000" />
                </div>

                <div className="form-group">
                  <label className="form-label">Job Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className="form-control">
                    {['Open', 'Active', 'On Hold', 'Closed', 'Filled'].map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Completion %</label>
                  <input name="completion" type="number" min="0" max="100" value={form.completion}
                    onChange={handleChange} className="form-control" placeholder="0-100" />
                </div>

                <div className="form-group full">
                  <label className="form-label">Required Skills</label>
                  <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input').focus()}>
                    {form.skills.map((skill) => (
                      <span className="tag-chip" key={skill}>
                        {skill}
                        <button className="tag-chip-remove" onClick={() => removeSkill(skill)} type="button"><X size={10} /></button>
                      </span>
                    ))}
                    <input className="tag-input-field" value={skillInput}
                      onChange={e => setSkillInput(e.target.value)} onKeyDown={handleSkillKey}
                      placeholder={form.skills.length === 0 ? 'Type a skill and press Enter...' : ''} />
                  </div>
                </div>

                <div className="form-group full">
                  <label className="form-label">Job Description</label>
                  <textarea name="jd" value={form.jd} onChange={handleChange}
                    className="form-control" rows={4}
                    placeholder="Describe the role, key responsibilities, and qualifications..." />
                </div>

                <div className="form-group full">
                  <label className="form-label">Notes</label>
                  <textarea name="notes" value={form.notes} onChange={handleChange}
                    className="form-control" rows={2} placeholder="Internal notes for this job..." />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-job-btn">Save Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

