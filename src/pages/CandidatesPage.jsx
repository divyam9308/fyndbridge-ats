import { useRef, useState } from 'react'
import { Plus, Upload, Pencil, X, Users, ChevronDown, AlertCircle, ExternalLink, FileText } from 'lucide-react'
import '../styles/Shared.css'

/* ====== Static reference data ====== */
const CLIENTS = ['Acme Corp', 'Nexus Tech', 'Bright Minds Ltd', 'Zeta FinTech', 'CloudBridge Labs', 'Lumino Health']

const JOBS = [
  { id: 1, title: 'Senior Backend Engineer', client: 'Zeta FinTech' },
  { id: 2, title: 'Product Manager',         client: 'Nexus Tech' },
  { id: 3, title: 'UX Designer',             client: 'Bright Minds Ltd' },
  { id: 4, title: 'Sales Executive',         client: 'Acme Corp' },
  { id: 5, title: 'Data Analyst',            client: 'CloudBridge Labs' },
  { id: 6, title: 'DevOps Engineer',         client: 'Zeta FinTech' },
  { id: 7, title: 'Frontend Engineer',       client: 'Nexus Tech' },
]

const ALL_STATUSES = [
  'Interested', 'Not Interested', 'Interview', 'Client Submission',
  'Offered', 'Hired', 'Rejected by Recruiter', 'Rejected by Client',
]

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

const fmt = (n) => n ? `₹${Number(n).toLocaleString('en-IN')}` : '—'
const initials = (name) => name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()

/* ====== Placeholder candidates ====== */
const INITIAL_CANDIDATES = [
  { id:1, name:'Arjun Rao',        city:'Bengaluru', currentCompany:'Infosys',           designation:'Backend Developer',    email:'arjun.rao@email.com',    mobile:'+91 98765 11111', exp:4,  salary:900000,  expectedSalary:1400000, client:'Zeta FinTech',     job:'Senior Backend Engineer', status:'Interview',         skills:['Node.js','AWS'],          education:'B.Tech, NIT Trichy',    cvLink:'https://drive.google.com/file/d/arjun-cv',     linkedinUrl:'https://linkedin.com/in/arjunrao',       notes:'' },
  { id:2, name:'Priya Kapoor',     city:'Mumbai',    currentCompany:'Razorpay',          designation:'Product Designer',     email:'priya.k@email.com',      mobile:'+91 99012 22222', exp:3,  salary:750000,  expectedSalary:1100000, client:'Bright Minds Ltd', job:'UX Designer',             status:'Offered',           skills:['Figma','UX Research'],    education:'B.Des, IDC IIT Bombay', cvLink:'https://drive.google.com/file/d/priya-cv',     linkedinUrl:'https://linkedin.com/in/priyadesigns',   notes:'' },
  { id:3, name:'Mohammed Salim',   city:'Hyderabad', currentCompany:'Mu Sigma',          designation:'Data Analyst',         email:'m.salim@email.com',      mobile:'+91 91234 33333', exp:2,  salary:600000,  expectedSalary:900000,  client:'CloudBridge Labs', job:'Data Analyst',            status:'Client Submission', skills:['Python','SQL'],           education:'M.Sc Statistics, OU',  cvLink:'https://drive.google.com/file/d/salim-cv',     linkedinUrl:'',                                       notes:'' },
  { id:4, name:'Tanvi Shah',       city:'Pune',      currentCompany:'Persistent Systems', designation:'DevOps Lead',         email:'tanvi.s@email.com',      mobile:'+91 97654 44444', exp:5,  salary:1200000, expectedSalary:1800000, client:'Zeta FinTech',     job:'DevOps Engineer',         status:'Hired',             skills:['Kubernetes','Docker'],    education:'B.Tech, COEP',         cvLink:'https://drive.google.com/file/d/tanvi-cv',     linkedinUrl:'https://linkedin.com/in/tanvishah',      notes:'' },
  { id:5, name:'Ritika Nair',      city:'Chennai',   currentCompany:'Zoho',              designation:'QA Engineer',          email:'ritika.n@email.com',     mobile:'+91 94567 55555', exp:3,  salary:700000,  expectedSalary:1000000, client:'Nexus Tech',       job:'Frontend Engineer',       status:'Interview',         skills:['Selenium','JIRA'],        education:'B.E CSE, Anna Univ',   cvLink:'',                                             linkedinUrl:'https://linkedin.com/in/ritikanair',     notes:'' },
  { id:6, name:'Karan Mehra',      city:'Delhi',     currentCompany:'HDFC Bank',         designation:'Sales Manager',        email:'karan.m@email.com',      mobile:'+91 98001 66666', exp:6,  salary:1000000, expectedSalary:1500000, client:'Acme Corp',        job:'Sales Executive',         status:'Interested',        skills:['B2B','CRM','Salesforce'], education:'MBA, FMS Delhi',       cvLink:'https://drive.google.com/file/d/karan-cv',     linkedinUrl:'https://linkedin.com/in/karanmehra',     notes:'' },
  { id:7, name:'Deepa Krishnan',   city:'Bengaluru', currentCompany:'Flipkart',          designation:'Product Manager',      email:'deepa.k@email.com',      mobile:'+91 99888 77777', exp:7,  salary:1400000, expectedSalary:2200000, client:'Nexus Tech',       job:'Product Manager',         status:'Rejected by Client', skills:['Agile','Jira'],          education:'MBA, IIM Kozhikode',   cvLink:'https://drive.google.com/file/d/deepa-cv',     linkedinUrl:'https://linkedin.com/in/deepakrishnan', notes:'' },
  { id:8, name:'Suresh Pillai',    city:'Kochi',     currentCompany:'UST Global',        designation:'React Developer',      email:'suresh.p@email.com',     mobile:'+91 95555 88888', exp:2,  salary:550000,  expectedSalary:850000,  client:'Nexus Tech',       job:'Frontend Engineer',       status:'Not Interested',    skills:['React','CSS'],           education:'B.Tech, CUSAT',        cvLink:'',                                             linkedinUrl:'',                                       notes:'' },
]

/* ====== Empty forms ====== */
const EMPTY_CAND = {
  name:'', email:'', mobile:'', designation:'', city:'', state:'',
  currentCompany:'', exp:'', salary:'', expectedSalary:'', skills:[], education:'',
  client:'', job:'', clientPhone:'', status:'Interested',
  cvLink:'', linkedinUrl:'', notes:'',
}

/* ====== Client phone lookup ====== */
const CLIENT_PHONES = {
  'Zeta FinTech':     '+91 98765 43210',
  'Nexus Tech':       '+91 98234 56789',
  'Bright Minds Ltd': '+91 99012 34567',
  'Acme Corp':        '+91 97654 32109',
  'CloudBridge Labs':  '+91 91234 56780',
  'Lumino Health':    '+91 94567 89012',
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES)
  const fileInputRef = useRef(null)

  // Filters
  const [filterJob, setFilterJob]       = useState('All')
  const [filterMinSal, setFilterMinSal] = useState('')
  const [filterMaxSal, setFilterMaxSal] = useState('')
  const [filterStatus, setFilterStatus] = useState([])

  // Add Candidate Modal
  const [addOpen, setAddOpen]   = useState(false)
  const [form, setForm]         = useState(EMPTY_CAND)
  const [errors, setErrors]     = useState({})
  const [skillInput, setSkillInput] = useState('')

  // Import Resume Modal
  const [importOpen, setImportOpen]   = useState(false)
  const [importTab, setImportTab]     = useState('upload')  // 'upload' | 'url'
  const [resumeUrl, setResumeUrl]     = useState('')
  const [resumeFile, setResumeFile]   = useState(null)
  const [importError, setImportError] = useState('')
  const [parsing, setParsing]         = useState(false)
  const [parsed, setParsed]           = useState(false)    // after parse success
  const [parsedForm, setParsedForm]   = useState(null)
  const [parsedSkillInput, setParsedSkillInput] = useState('')

  // ---- Filtering ----
  const filtered = candidates.filter(c => {
    if (filterJob !== 'All' && c.job !== filterJob) return false
    if (filterMinSal && c.salary < Number(filterMinSal)) return false
    if (filterMaxSal && c.salary > Number(filterMaxSal)) return false
    if (filterStatus.length > 0 && !filterStatus.includes(c.status)) return false
    return true
  })

  const clearFilters = () => {
    setFilterJob('All'); setFilterMinSal(''); setFilterMaxSal(''); setFilterStatus([])
  }

  // ---- Status multi-select toggle ----
  const toggleStatus = (s) => {
    setFilterStatus(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  // ---- Add Candidate form ----
  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'client') {
      setForm(f => ({ ...f, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
    } else {
      setForm(f => ({ ...f, [name]: value }))
    }
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

  const validate = (f) => {
    const e = {}
    if (!f.name.trim()) e.name = 'Full Name is required'
    if (!f.email.trim()) e.email = 'Email is required'
    if (!f.mobile.trim()) e.mobile = 'Mobile is required'
    return e
  }

  const openAddModal = () => { setForm(EMPTY_CAND); setErrors({}); setSkillInput(''); setAddOpen(true) }

  const handleSave = () => {
    const e = validate(form)
    if (Object.keys(e).length) { setErrors(e); return }
    setCandidates(c => [{
      id: Date.now(), ...form, exp: Number(form.exp) || 0,
      salary: Number(form.salary) || 0, expectedSalary: Number(form.expectedSalary) || 0,
    }, ...c])
    setAddOpen(false)
  }

  // ---- Parsed skill input ----
  const handleParsedSkillKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && parsedSkillInput.trim()) {
      e.preventDefault()
      const s = parsedSkillInput.trim().replace(/,$/, '')
      if (s && !parsedForm.skills.includes(s))
        setParsedForm(f => ({ ...f, skills: [...f.skills, s] }))
      setParsedSkillInput('')
    }
  }
  const removeParsedSkill = (s) => setParsedForm(f => ({ ...f, skills: f.skills.filter(x => x !== s) }))

  const fieldValue = (extracted, key, fallback = '') => extracted?.[key]?.value ?? fallback

  const mapParsedResponseToForm = (payload) => {
    const extracted = payload.extracted || {}
    const lowConf = Object.entries(extracted)
      .filter(([, data]) => data?.confidence === 'low' && data.value)
      .map(([key]) => ({
        full_name: 'name',
        mobile_number: 'mobile',
        current_designation: 'designation',
        experience_years: 'exp',
        current_salary: 'salary'
      }[key] || key))

    return {
      ...EMPTY_CAND,
      name: fieldValue(extracted, 'full_name'),
      email: fieldValue(extracted, 'email'),
      mobile: fieldValue(extracted, 'mobile_number'),
      designation: fieldValue(extracted, 'current_designation'),
      city: fieldValue(extracted, 'city'),
      state: fieldValue(extracted, 'state'),
      exp: fieldValue(extracted, 'experience_years'),
      salary: fieldValue(extracted, 'current_salary'),
      skills: fieldValue(extracted, 'skills', []) || [],
      education: fieldValue(extracted, 'education'),
      notes: 'Parsed from imported resume.',
      _lowConf: lowConf
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    handleResumeFile(file)
  }

  const handleResumeFile = (file) => {
    setImportError('')

    if (!file) {
      setResumeFile(null)
      return
    }

    if (file.type !== 'application/pdf') {
      setResumeFile(null)
      setImportError('Only PDF files are accepted.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setResumeFile(null)
      setImportError('PDF file must be 10 MB or smaller.')
      return
    }

    setResumeFile(file)
  }

  // ---- Resume parsing ----
  const handleParse = async () => {
    setImportError('')

    if (importTab === 'upload' && !resumeFile) {
      setImportError('Choose a PDF resume first.')
      return
    }

    if (importTab === 'url' && !resumeUrl.trim()) {
      setImportError('Paste a resume PDF URL first.')
      return
    }

    setParsing(true)
    try {
      let body
      let headers

      if (importTab === 'upload') {
        body = new FormData()
        body.append('resume', resumeFile)
      } else {
        headers = { 'Content-Type': 'application/json' }
        body = JSON.stringify({ resume_url: resumeUrl.trim() })
      }

      const response = await fetch('/api/candidates/parse-resume', {
        method: 'POST',
        headers,
        body
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Resume parsing failed.')
      }

      setParsedForm(mapParsedResponseToForm(payload))
      setParsed(true)
    } catch (err) {
      setImportError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleSaveParsed = () => {
    const e = validate(parsedForm)
    if (Object.keys(e).length) return
    setCandidates(c => [{
      id: Date.now(), ...parsedForm, exp: Number(parsedForm.exp) || 0,
      salary: Number(parsedForm.salary) || 0, expectedSalary: Number(parsedForm.expectedSalary) || 0,
    }, ...c])
    closeImport()
  }

  const closeImport = () => {
    setImportOpen(false); setImportTab('upload'); setResumeUrl(''); setResumeFile(null); setImportError('')
    setParsing(false); setParsed(false); setParsedForm(null); setParsedSkillInput('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Parsed form change ----
  const handleParsedChange = (e) => {
    const { name, value } = e.target
    if (name === 'client') {
      setParsedForm(f => ({ ...f, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
    } else {
      setParsedForm(f => ({ ...f, [name]: value }))
    }
  }

  const clientJobs = (clientName) => JOBS.filter(j => j.client === clientName)

  // ---- Candidate Form body (shared between Add + Review) ----
  const CandidateFormBody = ({ f, setF, errs, sInput, setSInput, onSkillKey, rmSkill, lowConf = [], onChange }) => {
    const low = (field) => lowConf.includes(field) ? ' low-confidence' : ''
    const handleLocalChange = onChange || ((e) => {
      const { name, value } = e.target
      if (name === 'client') setF(prev => ({ ...prev, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
      else setF(prev => ({ ...prev, [name]: value }))
    })
    return (
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Full Name <span className="req">*</span></label>
          <input name="name" value={f.name} onChange={handleLocalChange}
            className={`form-control${errs?.name ? ' is-error' : ''}${low('name')}`}
            placeholder="e.g. Arjun Rao" />
          {errs?.name && <span className="form-error">{errs.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Email <span className="req">*</span></label>
          <input name="email" type="email" value={f.email} onChange={handleLocalChange}
            className={`form-control${errs?.email ? ' is-error' : ''}${low('email')}`}
            placeholder="candidate@email.com" />
          {errs?.email && <span className="form-error">{errs.email}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Mobile Number <span className="req">*</span></label>
          <input name="mobile" value={f.mobile} onChange={handleLocalChange}
            className={`form-control${errs?.mobile ? ' is-error' : ''}${low('mobile')}`}
            placeholder="+91 98765 43210" />
          {errs?.mobile && <span className="form-error">{errs.mobile}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Current Designation</label>
          <input name="designation" value={f.designation} onChange={handleLocalChange}
            className={`form-control${low('designation')}`}
            placeholder="e.g. Backend Developer" />
        </div>

        <div className="form-group">
          <label className="form-label">Current Company</label>
          <input name="currentCompany" value={f.currentCompany || ''} onChange={handleLocalChange}
            className={`form-control${low('currentCompany')}`}
            placeholder="e.g. Infosys" />
        </div>

        <div className="form-group">
          <label className="form-label">City</label>
          <input name="city" value={f.city} onChange={handleLocalChange}
            className="form-control" placeholder="e.g. Bengaluru" />
        </div>

        <div className="form-group">
          <label className="form-label">State</label>
          <input name="state" value={f.state} onChange={handleLocalChange}
            className="form-control" placeholder="e.g. Karnataka" />
        </div>

        <div className="form-group">
          <label className="form-label">Experience (years)</label>
          <input name="exp" type="number" min="0" value={f.exp} onChange={handleLocalChange}
            className="form-control" placeholder="e.g. 4" />
        </div>

        <div className="form-group">
          <label className="form-label">Status</label>
          <select name="status" value={f.status} onChange={handleLocalChange} className="form-control">
            {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Current Salary (₹)</label>
          <input name="salary" type="number" value={f.salary} onChange={handleLocalChange}
            className={`form-control${low('salary')}`}
            placeholder="e.g. 900000" />
        </div>

        <div className="form-group">
          <label className="form-label">Expected Salary (₹)</label>
          <input name="expectedSalary" type="number" value={f.expectedSalary} onChange={handleLocalChange}
            className="form-control" placeholder="e.g. 1400000" />
        </div>

        <div className="form-group full">
          <label className="form-label">Skills</label>
          <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input').focus()}>
            {f.skills.map(s => (
              <span className="tag-chip" key={s}>
                {s}
                <button className="tag-chip-remove" type="button" onClick={() => rmSkill(s)}><X size={10} /></button>
              </span>
            ))}
            <input className="tag-input-field" value={sInput}
              onChange={e => setSInput(e.target.value)} onKeyDown={onSkillKey}
              placeholder={f.skills.length === 0 ? 'Type a skill + Enter...' : ''} />
          </div>
        </div>

        <div className="form-group full">
          <label className="form-label">Education</label>
          <textarea name="education" value={f.education} onChange={handleLocalChange}
            className="form-control" rows={2} placeholder="e.g. B.Tech CSE, IIT Madras" />
        </div>

        <div className="form-section-title">Job Assignment</div>

        <div className="form-group">
          <label className="form-label">Client</label>
          <select name="client" value={f.client} onChange={handleLocalChange} className="form-control">
            <option value="">Select client...</option>
            {CLIENTS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Job</label>
          <select name="job" value={f.job} onChange={handleLocalChange} className="form-control" disabled={!f.client}>
            <option value="">Select job...</option>
            {clientJobs(f.client).map(j => <option key={j.id}>{j.title}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Client Phone</label>
          <input name="clientPhone" value={f.clientPhone} onChange={handleLocalChange}
            className="form-control" placeholder="Auto-filled on client select" />
        </div>

        <div className="form-group">
          <label className="form-label">LinkedIn URL</label>
          <input name="linkedinUrl" value={f.linkedinUrl || ''} onChange={handleLocalChange}
            className="form-control"
            placeholder="https://linkedin.com/in/username" />
        </div>

        <div className="form-group">
          <label className="form-label">CV Link
            {f.cvLink && <span style={{ marginLeft:6, fontSize:10, color:'var(--success)', fontWeight:600, background:'rgba(40,167,69,0.1)', padding:'1px 6px', borderRadius:4 }}>Auto-filled</span>}
          </label>
          <input name="cvLink" value={f.cvLink || ''} onChange={handleLocalChange}
            className={`form-control${low('cvLink')}`}
            placeholder="https://drive.google.com/..." />
        </div>

        <div className="form-group full">
          <label className="form-label">Notes</label>
          <textarea name="notes" value={f.notes} onChange={handleLocalChange}
            className="form-control" rows={2} placeholder="Recruiter notes..." />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <button className="btn-secondary" onClick={() => { setImportOpen(true) }} id="btn-import-resume">
          <Upload size={14} strokeWidth={2} /> Import Resume
        </button>
        <button className="btn-primary" onClick={openAddModal} id="btn-add-candidate">
          <Plus size={15} strokeWidth={2.5} /> Add Candidate
        </button>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <span className="filter-label">Job</span>
        <select className="filter-select" value={filterJob}
          onChange={e => setFilterJob(e.target.value)} id="filter-candidate-job">
          <option value="All">All Jobs</option>
          {JOBS.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
        </select>

        <div className="filter-divider" />

        <span className="filter-label">Salary ₹</span>
        <input className="filter-input" type="number" value={filterMinSal}
          onChange={e => setFilterMinSal(e.target.value)} placeholder="Min" id="filter-sal-min" />
        <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>–</span>
        <input className="filter-input" type="number" value={filterMaxSal}
          onChange={e => setFilterMaxSal(e.target.value)} placeholder="Max" id="filter-sal-max" />

        <div className="filter-divider" />

        <div style={{ position: 'relative' }}>
          <StatusMultiSelect
            selected={filterStatus}
            onToggle={toggleStatus}
            options={ALL_STATUSES}
          />
        </div>

        <button className="filter-clear" onClick={clearFilters}>Clear Filters</button>
      </div>

      {/* Table */}
      <div className="table-card">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No candidates match your filters</div>
            <div className="empty-state-desc">Try adjusting your filters or add a new candidate.</div>
          </div>
        ) : (
          <table className="data-table" aria-label="Candidates">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Current Company</th>
                <th>Designation</th>
                <th>Mobile</th>
                <th>Exp</th>
                <th>Current Salary</th>
                <th>Client</th>
                <th>Job</th>
                <th>Status</th>
                <th>CV</th>
                <th>LinkedIn</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <div className="name-cell">
                      <div className="name-avatar">{initials(c.name)}</div>
                      <div>
                        <div className="name-text">{c.name}</div>
                        <div className="sub-text">{c.city}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontWeight:500, color:'var(--navy-darkest)' }}>
                      {c.currentCompany || '—'}
                    </span>
                  </td>
                  <td>{c.designation || '—'}</td>
                  <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.mobile}</td>
                  <td>{c.exp ? `${c.exp} yr${c.exp !== 1 ? 's' : ''}` : '—'}</td>
                  <td style={{ fontWeight:600 }}>{fmt(c.salary)}</td>
                  <td>{c.client || '—'}</td>
                  <td style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {c.job || '—'}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status}</span>
                  </td>
                  <td>
                    {c.cvLink ? (
                      <a href={c.cvLink} target="_blank" rel="noopener noreferrer"
                        style={{ display:'inline-flex', alignItems:'center', gap:4,
                          color:'var(--info)', fontSize:12, fontWeight:600,
                          textDecoration:'none', padding:'3px 8px',
                          background:'rgba(23,162,184,0.08)', borderRadius:6,
                          transition:'background 0.15s',
                        }}
                        title="Open CV">
                        <FileText size={12} strokeWidth={2} /> CV
                      </a>
                    ) : (
                      <span style={{ color:'var(--gray-400)', fontSize:12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {c.linkedinUrl ? (
                      <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display:'inline-flex', alignItems:'center', gap:4,
                          color:'#0A66C2', fontSize:12, fontWeight:600,
                          textDecoration:'none', padding:'3px 8px',
                          background:'rgba(10,102,194,0.08)', borderRadius:6,
                          transition:'background 0.15s',
                        }}
                        title="Open LinkedIn">
                        <ExternalLink size={12} strokeWidth={2} /> in
                      </a>
                    ) : (
                      <span style={{ color:'var(--gray-400)', fontSize:12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="Edit" id={`edit-cand-${c.id}`}>
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                      <button className="row-action-btn" title="Change Status" id={`status-cand-${c.id}`}>
                        <ChevronDown size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== Add Candidate Modal ===== */}
      {addOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Add Candidate">
            <div className="modal-header">
              <span className="modal-title">Add New Candidate</span>
              <button className="modal-close" onClick={() => setAddOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <CandidateFormBody
                f={form} setF={setForm} errs={errors}
                sInput={skillInput} setSInput={setSkillInput}
                onSkillKey={handleSkillKey} rmSkill={removeSkill}
                onChange={handleChange}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-candidate-btn">Save Candidate</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Import Resume Modal ===== */}
      {importOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeImport()}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Import Resume">
            <div className="modal-header">
              <span className="modal-title">{parsed ? 'Review Extracted Data' : 'Import Resume'}</span>
              <button className="modal-close" onClick={closeImport} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="modal-body">
              {!parsed ? (
                <>
                  {/* Tabs */}
                  <div className="import-tabs">
                    <button
                      className={`import-tab${importTab === 'upload' ? ' active' : ''}`}
                      onClick={() => { setImportTab('upload'); setImportError('') }}>Upload PDF</button>
                    <button
                      className={`import-tab${importTab === 'url' ? ' active' : ''}`}
                      onClick={() => { setImportTab('url'); setImportError('') }}>Paste URL</button>
                  </div>

                  {importTab === 'upload' ? (
                    <div className="drop-zone" role="button" tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        handleResumeFile(e.dataTransfer.files?.[0])
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
                      }}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileSelect}
                        style={{ display:'none' }}
                      />
                      <div className="drop-zone-icon">
                        <Upload size={24} color="var(--gold)" strokeWidth={1.8} />
                      </div>
                      <div className="drop-zone-title">
                        {resumeFile ? resumeFile.name : 'Drop your PDF here or click to browse'}
                      </div>
                      <div className="drop-zone-subtitle">Max file size: 10 MB · PDF only</div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      <label className="form-label">Resume URL</label>
                      <input className="form-control" value={resumeUrl}
                        onChange={e => { setResumeUrl(e.target.value); setImportError('') }}
                        placeholder="https://drive.google.com/..." id="resume-url-input" />
                    </div>
                  )}

                  {importError && (
                    <div className="form-error" style={{ display:'block', marginTop:12 }} role="alert">
                      {importError}
                    </div>
                  )}

                  <div style={{ marginTop: 20 }}>
                    <button className="btn-primary" id="btn-parse-resume"
                      onClick={handleParse} disabled={parsing}
                      style={{ width:'100%', justifyContent:'center', height:44, fontSize:14 }}>
                      {parsing ? (
                        <><span className="parse-btn-spinner" /> Parsing Resume...</>
                      ) : (
                        <><Upload size={15} strokeWidth={2} /> Parse Resume</>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Review Banner */}
                  <div className="review-banner">
                    <AlertCircle size={16} color="#9a6a00" />
                    <span>
                      <strong>Review extracted data before saving.</strong> Fields highlighted in amber were low-confidence and may need correction.
                    </span>
                  </div>
                  <CandidateFormBody
                    f={parsedForm} setF={setParsedForm} errs={{}}
                    sInput={parsedSkillInput} setSInput={setParsedSkillInput}
                    onSkillKey={handleParsedSkillKey} rmSkill={removeParsedSkill}
                    lowConf={parsedForm._lowConf || []}
                    onChange={handleParsedChange}
                  />
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeImport}>Cancel</button>
              {parsed && (
                <button className="btn-primary" onClick={handleSaveParsed} id="save-parsed-candidate-btn">
                  Save Candidate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ===== Status Multi-Select dropdown ===== */
function StatusMultiSelect({ selected, onToggle, options }) {
  const [open, setOpen] = useState(false)
  const label = selected.length === 0 ? 'All Statuses' : `${selected.length} selected`
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="filter-select"
        style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', minWidth:140 }}
        onClick={() => setOpen(o => !o)}
        id="filter-status-dd"
        type="button"
      >
        <span style={{ flex:1, textAlign:'left' }}>{label}</span>
        <ChevronDown size={13} strokeWidth={2}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', left:0, minWidth:200, zIndex:200,
          background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:9,
          boxShadow:'0 6px 20px rgba(0,0,0,0.1)', padding:'6px 0',
        }}>
          {options.map(s => (
            <label key={s} style={{
              display:'flex', alignItems:'center', gap:10, padding:'7px 14px',
              cursor:'pointer', fontSize:13, color:'var(--gray-700)',
              background: selected.includes(s) ? 'rgba(245,166,35,0.07)' : 'transparent',
              transition:'background 0.1s',
            }}>
              <input type="checkbox" checked={selected.includes(s)} onChange={() => onToggle(s)}
                style={{ accentColor:'var(--gold)', width:14, height:14 }} />
              {s}
            </label>
          ))}
          <div style={{ height:1, background:'var(--gray-100)', margin:'6px 0' }} />
          <button onClick={() => { options.forEach(s => { if (selected.includes(s)) onToggle(s) }) }}
            style={{ display:'block', width:'100%', textAlign:'left', padding:'7px 14px', border:'none',
            background:'none', fontSize:12.5, color:'var(--gold)', fontWeight:600, cursor:'pointer',
            fontFamily:'var(--font-body)' }}>
            Clear Selection
          </button>
        </div>
      )}
    </div>
  )
}
