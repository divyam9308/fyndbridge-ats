import { useState } from 'react'
import { Plus, Pencil, Eye, X, Briefcase } from 'lucide-react'
import '../styles/Shared.css'

const CLIENTS = ['Acme Corp', 'Nexus Tech', 'Bright Minds Ltd', 'Zeta FinTech', 'CloudBridge Labs']

const INITIAL_JOBS = [
  { id: 1, title: 'Senior Backend Engineer', client: 'Zeta FinTech',     city: 'Bengaluru', status: 'Open',    rejectedByClient: 2, successCount: 1, completion: 68,  experience: '4–6 years', skills: ['Node.js','PostgreSQL','AWS'], salaryMin: 1200000, salaryMax: 2000000, jd: '', notes: '' },
  { id: 2, title: 'Product Manager',         client: 'Nexus Tech',       city: 'Mumbai',    status: 'Open',    rejectedByClient: 0, successCount: 0, completion: 30,  experience: '5–8 years', skills: ['Product Strategy','Roadmapping'], salaryMin: 1500000, salaryMax: 2500000, jd: '', notes: '' },
  { id: 3, title: 'UX Designer',             client: 'Bright Minds Ltd', city: 'Pune',      status: 'On Hold', rejectedByClient: 1, successCount: 0, completion: 45,  experience: '3–5 years', skills: ['Figma','User Research'], salaryMin: 800000, salaryMax: 1400000, jd: '', notes: '' },
  { id: 4, title: 'Sales Executive',         client: 'Acme Corp',        city: 'Delhi',     status: 'Filled',  rejectedByClient: 3, successCount: 2, completion: 100, experience: '2–4 years', skills: ['B2B Sales','CRM'], salaryMin: 600000, salaryMax: 1000000, jd: '', notes: '' },
  { id: 5, title: 'Data Analyst',            client: 'CloudBridge Labs', city: 'Hyderabad', status: 'Open',    rejectedByClient: 0, successCount: 0, completion: 20,  experience: '2–3 years', skills: ['Python','SQL','Tableau'], salaryMin: 700000, salaryMax: 1200000, jd: '', notes: '' },
  { id: 6, title: 'DevOps Engineer',         client: 'Zeta FinTech',     city: 'Bengaluru', status: 'Closed',  rejectedByClient: 1, successCount: 1, completion: 100, experience: '3–5 years', skills: ['Kubernetes','Docker','CI/CD'], salaryMin: 1000000, salaryMax: 1800000, jd: '', notes: '' },
  { id: 7, title: 'Frontend Engineer',       client: 'Nexus Tech',       city: 'Chennai',   status: 'Open',    rejectedByClient: 0, successCount: 0, completion: 55,  experience: '2–4 years', skills: ['React','TypeScript'], salaryMin: 900000, salaryMax: 1500000, jd: '', notes: '' },
]

const STATUS_BADGE = {
  Open:     'badge-open',
  'On Hold':'badge-on-hold',
  Closed:   'badge-closed',
  Filled:   'badge-filled',
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

  // ---- Filter ----
  const filtered = jobs.filter(j => {
    if (filterStatus !== 'All' && j.status !== filterStatus) return false
    if (showRejected && j.rejectedByClient === 0) return false
    return true
  })

  // ---- Form ----
  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (errors[name]) setErrors(err => ({ ...err, [name]: '' }))
  }

  const handleSkillKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && skillInput.trim()) {
      e.preventDefault()
      const s = skillInput.trim().replace(/,$/, '')
      if (s && !form.skills.includes(s)) setForm(f => ({ ...f, skills: [...f.skills, s] }))
      setSkillInput('')
    }
  }
  const removeSkill = (s) => setForm(f => ({ ...f, skills: f.skills.filter(x => x !== s) }))

  const validate = () => {
    const e = {}
    if (!form.title.trim()) e.title = 'Job Title is required'
    if (!form.client) e.client = 'Client is required'
    return e
  }

  const openModal = () => { setForm(EMPTY_FORM); setErrors({}); setSkillInput(''); setIsOpen(true) }

  const handleSave = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setJobs(j => [{
      id: Date.now(), title: form.title, client: form.client,
      city: form.city, status: form.status, rejectedByClient: 0, successCount: 0,
      completion: Number(form.completion) || 0, experience: form.experience,
      skills: form.skills, salaryMin: form.salaryMin, salaryMax: form.salaryMax,
      jd: form.jd, notes: form.notes,
    }, ...j])
    setIsOpen(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <button className="btn-primary" onClick={openModal} id="btn-add-job">
          <Plus size={15} strokeWidth={2.5} /> Add Job
        </button>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <span className="filter-label">Status</span>
        <select className="filter-select" value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)} id="filter-job-status">
          {['All','Open','On Hold','Closed','Filled'].map(s => <option key={s}>{s}</option>)}
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

      {/* Table */}
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
              {filtered.map(job => (
                <tr key={job.id}>
                  <td>
                    <div className="name-text">{job.title}</div>
                    {job.experience && <div className="sub-text">{job.experience}</div>}
                  </td>
                  <td>{job.client}</td>
                  <td>{job.city || '—'}</td>
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

      {/* ===== Add Job Modal ===== */}
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
                    {CLIENTS.map(c => <option key={c}>{c}</option>)}
                  </select>
                  {errors.client && <span className="form-error">{errors.client}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Experience Required</label>
                  <input name="experience" value={form.experience} onChange={handleChange}
                    className="form-control" placeholder="e.g. 3–5 years" />
                </div>

                <div className="form-group">
                  <label className="form-label">City</label>
                  <input name="city" value={form.city} onChange={handleChange}
                    className="form-control" placeholder="e.g. Bengaluru" />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <input name="state" value={form.state} onChange={handleChange}
                    className="form-control" placeholder="e.g. Karnataka" />
                </div>

                <div className="form-group">
                  <label className="form-label">Min Salary (₹)</label>
                  <input name="salaryMin" type="number" value={form.salaryMin} onChange={handleChange}
                    className="form-control" placeholder="1200000" />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Salary (₹)</label>
                  <input name="salaryMax" type="number" value={form.salaryMax} onChange={handleChange}
                    className="form-control" placeholder="2000000" />
                </div>

                <div className="form-group">
                  <label className="form-label">Job Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className="form-control">
                    {['Open','On Hold','Closed','Filled'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Completion %</label>
                  <input name="completion" type="number" min="0" max="100" value={form.completion}
                    onChange={handleChange} className="form-control" placeholder="0–100" />
                </div>

                <div className="form-group full">
                  <label className="form-label">Required Skills</label>
                  <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input').focus()}>
                    {form.skills.map(s => (
                      <span className="tag-chip" key={s}>
                        {s}
                        <button className="tag-chip-remove" onClick={() => removeSkill(s)} type="button"><X size={10} /></button>
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
