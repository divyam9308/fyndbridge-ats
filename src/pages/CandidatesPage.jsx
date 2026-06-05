import { useEffect, useRef, useState } from 'react'
import { Plus, Upload, X, Users, ChevronDown, AlertCircle, FileText, Search, Loader2 } from 'lucide-react'
import '../styles/Shared.css'

/* ====== Static reference data ====== */
const CLIENTS = ['Acme Corp', 'Nexus Tech', 'Bright Minds Ltd', 'Zeta FinTech', 'CloudBridge Labs', 'Lumino Health']

const JOBS = [
  { id: 1, title: 'Senior Backend Engineer', client: 'Zeta FinTech',     status: 'Open' },
  { id: 2, title: 'Product Manager',         client: 'Nexus Tech',       status: 'Open' },
  { id: 3, title: 'UX Designer',             client: 'Bright Minds Ltd', status: 'On Hold' },
  { id: 4, title: 'Sales Executive',         client: 'Acme Corp',        status: 'Filled' },
  { id: 5, title: 'Data Analyst',            client: 'CloudBridge Labs', status: 'Open' },
  { id: 6, title: 'DevOps Engineer',         client: 'Zeta FinTech',     status: 'Closed' },
  { id: 7, title: 'Frontend Engineer',       client: 'Nexus Tech',       status: 'Open' },
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

const fmt = (n) => n ? `Rs. ${Number(n).toLocaleString('en-IN')}` : '-'
const initials = (name) => name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()
const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}
const formatMonth = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-US', { month: 'short' })
}
const getCurrentUser = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
  } catch {
    return {}
  }
}

const getConsultantNameFromUser = (user) => {
  const email = String(user?.email || user?.id || '').trim()
  const prefix = email.includes('@') ? email.split('@')[0] : ''

  if (/@fyndbridge\.in$/i.test(email) && prefix) {
    return prefix
  }

  return prefix || user?.name || 'hr'
}

const AI_FILTER_FIELDS = [
  'name',
  'city',
  'state',
  'currentDesignation',
  'email',
  'mobile',
  'experience',
  'salary',
  'client',
  'job',
  'clientMobile',
  'status',
  'skills',
  'education'
]

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()

const ROLE_KEYWORD_GROUPS = {
  software: [
    'software engineer',
    'software developer',
    'backend engineer',
    'backend developer',
    'frontend engineer',
    'frontend developer',
    'full stack',
    'devops',
    'database',
    'data engineer',
    'programmer',
    'react',
    'node',
    'java',
    'sql'
  ],
  backend: ['backend', 'back end', 'server', 'api', 'node', 'node.js', 'express', 'django'],
  frontend: ['frontend', 'front end', 'react', 'angular', 'vue', 'ui developer', 'web developer', 'javascript'],
  database: ['database', 'sql', 'postgres', 'mysql', 'mongodb', 'dba', 'data engineer'],
  data: ['data analyst', 'data engineer', 'analytics', 'python', 'sql', 'statistics'],
  devops: ['devops', 'cloud', 'aws', 'azure', 'kubernetes', 'docker', 'ci/cd'],
  product: ['product manager', 'product owner', 'pm']
}

const GENERIC_ROLE_WORDS = new Set(['engineer', 'developer', 'manager', 'lead', 'senior', 'junior', 'software'])

const normalizeSearchText = (value) => normalizeText(value)
  .replace(/[^a-z0-9+#./\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const searchTermsForQuery = (query) => {
  const normalized = normalizeSearchText(query)
  if (!normalized) return []

  const terms = new Set([normalized])
  Object.entries(ROLE_KEYWORD_GROUPS).forEach(([key, values]) => {
    const groupHit = key === 'software'
      ? /\b(software|sftware|softwar|programmer|developers?)\b/.test(normalized)
      : normalized.includes(key) || values.some(value => normalized.includes(normalizeSearchText(value)))
    if (groupHit) values.forEach(value => terms.add(normalizeSearchText(value)))
  })

  normalized
    .split(/\s+/)
    .filter(word => word.length >= 4 && !GENERIC_ROLE_WORDS.has(word))
    .forEach(word => terms.add(word))

  return [...terms].filter(Boolean)
}

const roleTermMatches = (haystack, term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryPattern = escaped.replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${boundaryPattern}([^a-z0-9]|$)`, 'i').test(haystack)
}

const matchesRoleText = (candidate, query) => {
  const haystack = normalizeSearchText([
    candidate.designation,
    candidate.job,
    Array.isArray(candidate.skills) ? candidate.skills.join(' ') : ''
  ].filter(Boolean).join(' '))
  const terms = searchTermsForQuery(query)

  if (!terms.length) return true
  return terms.some(term => roleTermMatches(haystack, term))
}

const matchesAiFilters = (candidate, filters) => {
  if (!filters) return true

  const includes = (source, needle) => {
    const haystack = normalizeText(source)
    const query = normalizeText(needle)
    if (!query) return true
    return haystack.includes(query)
  }

  if (filters.name && !includes(candidate.name, filters.name)) return false
  if (filters.city && !includes(candidate.city, filters.city)) return false
  if (filters.state && !includes(candidate.state, filters.state)) return false
  if (filters.currentDesignation && !matchesRoleText(candidate, filters.currentDesignation)) return false
  if (filters.email && !includes(candidate.email, filters.email)) return false
  if (filters.mobile && !includes(candidate.mobile, filters.mobile)) return false
  if (filters.client && !includes(candidate.client, filters.client)) return false
  if (filters.job && !matchesRoleText(candidate, filters.job)) return false
  if (filters.clientMobile && !includes(candidate.clientPhone, filters.clientMobile)) return false
  if (filters.status && !includes(candidate.status, filters.status)) return false
  if (filters.education && !includes(candidate.education, filters.education)) return false

  if (Array.isArray(filters.skills) && filters.skills.length > 0) {
    const skillHaystack = Array.isArray(candidate.skills) ? candidate.skills.map(normalizeText) : []
    const skillMatches = filters.skills.every(skill => skillHaystack.some(item => item.includes(normalizeText(skill))))
    if (!skillMatches) return false
  }

  if (filters.experience) {
    const exp = candidate.exp === '' || candidate.exp === null || candidate.exp === undefined ? null : Number(candidate.exp)
    if (filters.experience.min !== null && (exp === null || exp < Number(filters.experience.min))) return false
    if (filters.experience.max !== null && (exp === null || exp > Number(filters.experience.max))) return false
  }

  if (filters.salary) {
    const salary = candidate.salary === '' || candidate.salary === null || candidate.salary === undefined ? null : Number(candidate.salary)
    if (filters.salary.min !== null && (salary === null || salary < Number(filters.salary.min))) return false
    if (filters.salary.max !== null && (salary === null || salary > Number(filters.salary.max))) return false
  }

  return true
}

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
  location:'', currentCompany:'', currentOrganisation:'', exp:'', salary:'', expectedSalary:'', skills:[], education:'',
  noticePeriod:'', openToRelocate:false,
  client:'', job:'', clientPhone:'', status:'Interested',
  cvLink:'', linkedinUrl:'', notes:'', consultantName:'', candidateId:'', associationId:'',
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

const apiCandidateToUi = (row) => ({
  id: row.association_id || row.id,
  associationId: row.association_id || row.id,
  candidateId: row.candidate_id,
  name: row.full_name || '',
  email: row.email || '',
  mobile: row.mobile_number || '',
  city: row.city || '',
  state: row.state || '',
  location: row.location || '',
  designation: row.current_designation || '',
  currentCompany: row.current_company || '',
  currentOrganisation: row.current_organisation || row.current_company || '',
  exp: row.experience_years ?? '',
  noticePeriod: row.notice_period ?? '',
  openToRelocate: Boolean(row.open_to_relocate),
  salary: row.current_salary ?? '',
  expectedSalary: row.expected_salary ?? '',
  skills: row.skills || [],
  education: row.education || '',
  client: row.client_name || '',
  clientPhone: row.client_phone_number || CLIENT_PHONES[row.client_name] || '',
  job: row.job_title || '',
  status: row.status || 'Interested',
  cvLink: row.cv_link || row.resume_url || '',
  linkedinUrl: row.linkedin_url || '',
  notes: row.notes || '',
  consultant: row.consultant_name || '',
  consultantName: row.consultant_name || '',
  createdAt: row.created_at || '',
})

const uiCandidateToApi = (f, consultantName = '') => ({
  association_id: f.associationId || undefined,
  full_name: f.name,
  email: f.email,
  mobile_number: f.mobile,
  city: f.city,
  state: f.state,
  location: f.location,
  current_designation: f.designation,
  current_company: f.currentOrganisation,
  current_organisation: f.currentOrganisation,
  experience_years: f.exp,
  notice_period: f.noticePeriod,
  open_to_relocate: Boolean(f.openToRelocate),
  skills: f.skills,
  education: f.education,
  client_name: f.client,
  job_title: f.job,
  status: f.status,
  current_salary: f.salary,
  expected_salary: f.expectedSalary,
  cv_link: f.cvLink,
  linkedin_url: f.linkedinUrl,
  notes: f.notes,
  consultant_name: f.consultantName || consultantName || '',
  source: f.source,
})

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES)
  const fileInputRef = useRef(null)
  const candidateModalBodyRef = useRef(null)
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)
  const activeConsultantName = getConsultantNameFromUser(getCurrentUser())

  // Filters
  const [filterJob, setFilterJob]       = useState('All')
  const [filterMinSal, setFilterMinSal] = useState('')
  const [filterMaxSal, setFilterMaxSal] = useState('')
  const [filterStatus, setFilterStatus] = useState([])
  const [aiFilterText, setAiFilterText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiFilterLoading, setAiFilterLoading] = useState(false)
  const [aiFilterError, setAiFilterError] = useState('')
  const [aiFilterCount, setAiFilterCount] = useState(null)

  // Add Candidate Modal
  const [addOpen, setAddOpen]   = useState(false)
  const [form, setForm]         = useState(EMPTY_CAND)
  const [errors, setErrors]     = useState({})
  const [skillInput, setSkillInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [collapsed, setCollapsed] = useState({})

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

  const loadCandidates = async () => {
    try {
      const response = await fetch('/api/candidates')
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load candidates.')
      }

      if (Array.isArray(payload.data)) {
        setCandidates(payload.data.map(apiCandidateToUi))
      }
      setApiError('')
    } catch (err) {
      setApiError(err.message)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCandidates()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (addOpen) {
      const timer = window.setTimeout(() => {
        if (candidateModalBodyRef.current) {
          candidateModalBodyRef.current.scrollTop = 0
        }
      }, 0)

      return () => window.clearTimeout(timer)
    }
  }, [addOpen, editing])

  const saveCandidateToApi = async (candidate, { update = false } = {}) => {
    const response = await fetch(update ? `/api/candidates/${candidate.associationId}` : '/api/candidates', {
      method: update ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uiCandidateToApi(candidate, activeConsultantName))
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = payload.errors ? Object.values(payload.errors)[0] : payload.error
      throw new Error(message || 'Unable to save candidate.')
    }

    await loadCandidates()
    return apiCandidateToUi(payload)
  }

  // ---- Filtering ----
  const filtered = candidates.filter(c => {
    if (filterJob !== 'All' && c.job !== filterJob) return false
    if (filterMinSal && c.salary < Number(filterMinSal)) return false
    if (filterMaxSal && c.salary > Number(filterMaxSal)) return false
    if (filterStatus.length > 0 && !filterStatus.includes(c.status)) return false
    if (aiFilters && !matchesAiFilters(c, aiFilters)) return false
    return true
  })

  const mobileGroups = {}
  filtered.forEach(c => {
    const key = c.mobile || c.mobile_number || c.id
    if (!mobileGroups[key]) mobileGroups[key] = []
    mobileGroups[key].push(c)
  })

  const visibleCandidates = []
  Object.entries(mobileGroups).forEach(([mobile, rows]) => {
    const isGroup = rows.length >= 2
    const visibleRows = isGroup && collapsed[mobile] ? rows.slice(0, 1) : rows
    visibleRows.forEach((candidate, index) => {
      visibleCandidates.push({
        candidate,
        mobile,
        isGroup,
        groupSize: rows.length,
        groupIndex: index,
        isLastInGroup: index === visibleRows.length - 1,
      })
    })
  })

  const toggleCollapsed = (mobile) => {
    setCollapsed(prev => ({ ...prev, [mobile]: !prev[mobile] }))
  }

  const clearFilters = () => {
    setFilterJob('All'); setFilterMinSal(''); setFilterMaxSal(''); setFilterStatus([])
    setAiFilterText('')
    setAiFilters(null)
    setAiFilterError('')
    setAiFilterCount(null)
  }

  const clearAiFilter = () => {
    setAiFilterText('')
    setAiFilters(null)
    setAiFilterError('')
    setAiFilterCount(null)
  }

  // ---- Status multi-select toggle ----
  const toggleStatus = (s) => {
    setFilterStatus(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  // ---- Add Candidate form ----
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    const nextValue = type === 'checkbox' ? checked : value
    if (name === 'client') {
      setForm(f => ({ ...f, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
    } else {
      setForm(f => ({ ...f, [name]: nextValue }))
    }
    if (errors[name]) setErrors(err => ({ ...err, [name]: '' }))
  }

  const cleanSkill = (value) => value.replace(/,$/, '').replace(/\s+/g, ' ').trim()

  const appendSkills = (skills, values) => {
    const next = [...skills]
    values
      .map(cleanSkill)
      .filter(Boolean)
      .forEach((skill) => {
        if (!next.some((existing) => existing.toLowerCase() === skill.toLowerCase())) next.push(skill)
      })
    return next
  }

  const addManualSkill = (value = skillInput) => {
    const s = cleanSkill(value)
    if (s) setForm(f => ({ ...f, skills: appendSkills(f.skills, [s]) }))
    setSkillInput('')
  }

  const handleSkillInputChange = (value) => {
    setSkillInput(value)
  }

  const handleSkillKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && skillInput.trim()) {
      e.preventDefault()
      addManualSkill()
    }
  }
  const removeSkill = (s) => setForm(f => ({ ...f, skills: f.skills.filter(x => x !== s) }))

  const validate = (f) => {
    const e = {}
    if (!f.name.trim()) e.name = 'Full Name is required'
    if (!f.mobile.trim()) e.mobile = 'Mobile is required'
    return e
  }

  const openAddModal = () => { setForm({ ...EMPTY_CAND, skills: [], consultantName: activeConsultantName }); setEditing(false); setErrors({}); setSkillInput(''); setAddOpen(true) }

  const applyAiFilter = async (event) => {
    event?.preventDefault?.()
    const prompt = aiFilterText.trim()
    if (!prompt) {
      clearAiFilter()
      return
    }

    setAiFilterLoading(true)
    setAiFilterError('')
    try {
      const response = await fetch('/api/candidates/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          allowedFields: AI_FILTER_FIELDS
        })
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'AI filter failed.')
      }

      setAiFilters(payload.filters || null)
      setAiFilterCount(Number.isFinite(payload.matchedCount) ? payload.matchedCount : null)
    } catch (err) {
      setAiFilterError(err.message)
      setAiFilters(null)
      setAiFilterCount(null)
    } finally {
      setAiFilterLoading(false)
    }
  }

  const handleSave = async () => {
    const e = validate(form)
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    try {
      await saveCandidateToApi(form, { update: editing })
      setAddOpen(false)
      setEditing(false)
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setSaving(false)
    }
  }

  // ---- Parsed skill input ----
  const addParsedManualSkill = (value = parsedSkillInput) => {
    const s = cleanSkill(value)
    if (s) setParsedForm(f => ({ ...f, skills: appendSkills(f.skills, [s]) }))
    setParsedSkillInput('')
  }

  const handleParsedSkillInputChange = (value) => {
    setParsedSkillInput(value)
  }

  const handleParsedSkillKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && parsedSkillInput.trim()) {
      e.preventDefault()
      addParsedManualSkill()
    }
  }
  const removeParsedSkill = (s) => setParsedForm(f => ({ ...f, skills: f.skills.filter(x => x !== s) }))

  const fieldValue = (extracted, key, fallback = '') => extracted?.[key]?.value ?? fallback

  const mapParsedResponseToForm = (payload) => {
    const extracted = payload.extracted || {}
    const ai = payload.ai_extracted || null
    const lowConf = Object.entries(extracted)
      .filter(([, data]) => data?.confidence === 'low' && data.value)
      .map(([key]) => ({
        full_name: 'name',
        mobile_number: 'mobile',
        current_designation: 'designation',
        current_organisation: 'currentOrganisation',
        experience_years: 'exp',
        cover_letter: 'notes'
      }[key] || key))

    return {
      ...EMPTY_CAND,
      consultantName: activeConsultantName,
      name: ai?.name || fieldValue(extracted, 'full_name'),
      email: ai?.email || fieldValue(extracted, 'email'),
      mobile: ai?.mobile || fieldValue(extracted, 'mobile_number'),
      designation: ai?.currentDesignation || fieldValue(extracted, 'current_designation'),
      currentCompany: ai?.currentOrganisation || fieldValue(extracted, 'current_organisation') || fieldValue(extracted, 'current_company'),
      currentOrganisation: ai?.currentOrganisation || fieldValue(extracted, 'current_organisation') || fieldValue(extracted, 'current_company'),
      exp: ai?.experience ?? fieldValue(extracted, 'experience_years'),
      city: ai?.city || fieldValue(extracted, 'city'),
      state: ai?.state || fieldValue(extracted, 'state'),
      location: ai?.location || [ai?.city || fieldValue(extracted, 'city'), ai?.state || fieldValue(extracted, 'state')].filter(Boolean).join(', ') || fieldValue(extracted, 'location'),
      skills: ai?.skills?.length ? ai.skills : (fieldValue(extracted, 'skills', []) || []),
      education: ai?.education || fieldValue(extracted, 'education'),
      salary: ai?.salary ?? fieldValue(extracted, 'salary'),
      linkedinUrl: ai?.linkedin || '',
      notes: ai?.summary || fieldValue(extracted, 'cover_letter'),
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

  const handleSaveParsed = async () => {
    const e = validate(parsedForm)
    if (Object.keys(e).length) { setImportError(Object.values(e)[0]); return }
    setSaving(true)
    try {
      await saveCandidateToApi({ ...parsedForm, source: 'resume' })
      closeImport()
    } catch (err) {
      setImportError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const closeImport = () => {
    setImportOpen(false); setImportTab('upload'); setResumeUrl(''); setResumeFile(null); setImportError('')
    setParsing(false); setParsed(false); setParsedForm(null); setParsedSkillInput('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Parsed form change ----
  const handleParsedChange = (e) => {
    const { name, value, type, checked } = e.target
    const nextValue = type === 'checkbox' ? checked : value
    if (name === 'client') {
      setParsedForm(f => ({ ...f, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
    } else {
      setParsedForm(f => ({ ...f, [name]: nextValue }))
    }
  }

  // ---- Candidate Form body (shared between Add + Review) ----
  const CandidateFormBody = ({ f, setF, errs, sInput, onSkillInputChange, onSkillKey, onAddSkill, rmSkill, lowConf = [], onChange }) => {
    const low = (field) => lowConf.includes(field) ? ' low-confidence' : ''
    const handleLocalChange = onChange || ((e) => {
      const { name, value, type, checked } = e.target
      const nextValue = type === 'checkbox' ? checked : value
      if (name === 'client') setF(prev => ({ ...prev, client: value, clientPhone: CLIENT_PHONES[value] || '', job: '' }))
      else setF(prev => ({ ...prev, [name]: nextValue }))
    })
    return (
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Full Name <span className="req">*</span></label>
          <input name="name" value={f.name} onChange={handleLocalChange}
            className={`form-control${errs?.name ? ' is-error' : ''}${low('name')}`}
            />
          {errs?.name && <span className="form-error">{errs.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Email <span className="req">*</span></label>
          <input name="email" type="email" value={f.email} onChange={handleLocalChange}
            className={`form-control${errs?.email ? ' is-error' : ''}${low('email')}`}
            />
          {errs?.email && <span className="form-error">{errs.email}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Mobile Number <span className="req">*</span></label>
          <input name="mobile" value={f.mobile} onChange={handleLocalChange}
            className={`form-control${errs?.mobile ? ' is-error' : ''}${low('mobile')}`}
            />
          {errs?.mobile && <span className="form-error">{errs.mobile}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Consultant</label>
          <input name="consultantName" value={f.consultantName || ''} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <div className="form-group">
          <label className="form-label">Current Designation</label>
          <input name="designation" value={f.designation} onChange={handleLocalChange}
            className={`form-control${low('designation')}`}
            />
        </div>

        <div className="form-group">
          <label className="form-label">Current Organisation</label>
          <input name="currentOrganisation" value={f.currentOrganisation || ''} onChange={handleLocalChange}
            className={`form-control${low('currentOrganisation')}`} />
        </div>

        <div className="form-group">
          <label className="form-label">Current Location</label>
          <input name="location" value={f.location || ''} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <div className="form-group">
          <label className="form-label">Experience (years)</label>
          <input name="exp" type="number" min="0" value={f.exp} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <div className="form-group">
          <label className="form-label">Notice Period (days)</label>
          <input name="noticePeriod" type="number" min="0" value={f.noticePeriod || ''} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <div className="form-group">
          <label className="form-label">Status</label>
          <select name="status" value={f.status} onChange={handleLocalChange} className="form-control">
            {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Current Salary (Rs.)</label>
          <input name="salary" type="number" value={f.salary} onChange={handleLocalChange}
            className={`form-control${low('salary')}`}
            />
        </div>

        <div className="form-group">
          <label className="form-label">Expected Salary (Rs.)</label>
          <input name="expectedSalary" type="number" value={f.expectedSalary} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <label className="filter-toggle" style={{ alignSelf:'end', height:38 }}>
          <input name="openToRelocate" type="checkbox" checked={Boolean(f.openToRelocate)} onChange={handleLocalChange} />
          Open to Relocate
        </label>

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
              onChange={e => onSkillInputChange(e.target.value)} onKeyDown={onSkillKey}
              aria-label="Add skill" />
            <button className="tag-add-btn" type="button" onClick={() => onAddSkill()} disabled={!sInput.trim()}>
              <Plus size={12} strokeWidth={2.4} /> Add
            </button>
          </div>
        </div>

        <div className="form-group full">
          <label className="form-label">Education</label>
          <textarea name="education" value={f.education} onChange={handleLocalChange}
            className="form-control" rows={4} style={{ minHeight: 96, lineHeight: 1.5 }}
            />
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
          <select name="job" value={f.job} onChange={handleLocalChange} className="form-control">
            <option value="">Select job...</option>
            {JOBS.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Client Phone</label>
          <input name="clientPhone" value={f.clientPhone} onChange={handleLocalChange}
            className="form-control" />
        </div>

        <div className="form-group">
          <label className="form-label">LinkedIn URL</label>
          <input name="linkedinUrl" value={f.linkedinUrl || ''} onChange={handleLocalChange}
            className="form-control"
            />
        </div>

        <div className="form-group">
          <label className="form-label">CV Link
            {f.cvLink && <span style={{ marginLeft:6, fontSize:10, color:'var(--success)', fontWeight:600, background:'rgba(40,167,69,0.1)', padding:'1px 6px', borderRadius:4 }}>Auto-filled</span>}
          </label>
          <input name="cvLink" value={f.cvLink || ''} onChange={handleLocalChange}
            className={`form-control${low('cvLink')}`}
            />
        </div>

        <div className="form-group full">
          <label className="form-label">Comments</label>
          <textarea name="notes" value={f.notes} onChange={handleLocalChange}
            className="form-control" rows={3} style={{ minHeight: 84, lineHeight: 1.5 }} />
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
      {apiError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {apiError}
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar">
        <span className="filter-label">Job</span>
        <select className="filter-select" value={filterJob}
          onChange={e => setFilterJob(e.target.value)} id="filter-candidate-job">
          <option value="All">All Jobs</option>
          {JOBS.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
        </select>

        <div className="filter-divider" />

        <span className="filter-label">Salary Rs.</span>
        <input className="filter-input" type="number" value={filterMinSal}
          onChange={e => setFilterMinSal(e.target.value)} id="filter-sal-min" />
        <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>-</span>
        <input className="filter-input" type="number" value={filterMaxSal}
          onChange={e => setFilterMaxSal(e.target.value)} id="filter-sal-max" />

        <div className="filter-divider" />

        <div style={{ position: 'relative' }}>
          <StatusMultiSelect
            selected={filterStatus}
            onToggle={toggleStatus}
            options={ALL_STATUSES}
          />
        </div>

        <form onSubmit={applyAiFilter} style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:340 }}>
          <span className="filter-label">AI Filter</span>
          <input
            className="filter-input"
            style={{ width:'100%', minWidth:240, flex:1 }}
            value={aiFilterText}
            onChange={e => { setAiFilterText(e.target.value); setAiFilterError('') }}
            id="filter-ai-candidates"
          />
          <button className="btn-secondary" type="submit" disabled={aiFilterLoading} style={{ height:34, padding:'0 12px' }}>
            {aiFilterLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            Apply
          </button>
        </form>

        <button className="filter-clear" onClick={clearFilters}>Clear Filters</button>
      </div>

      {aiFilterError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {aiFilterError}
        </div>
      )}

      {aiFilters && (
        <div style={{ marginBottom:12, fontSize:12.5, color:'var(--gray-500)' }}>
          AI filter active{aiFilterCount !== null ? ` · ${aiFilterCount} match${aiFilterCount === 1 ? '' : 'es'}` : ''}
        </div>
      )}

      {/* Table */}
      <div className="table-card">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No candidates match your filters</div>
            <div className="empty-state-desc">Try adjusting your filters or add a new candidate.</div>
          </div>
        ) : (
          <div className="table-wrapper">
          <table className="data-table candidates-master-table" aria-label="Candidates">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Date</th>
                <th>Consultant</th>
                <th>Client Name</th>
                <th>Role (Job)</th>
                <th>Candidate Name</th>
                <th>Organisation</th>
                <th>Designation</th>
                <th>Mobile</th>
                <th>Email ID</th>
                <th>Experience</th>
                <th>Current CTC</th>
                <th>Current Location</th>
                <th>Notice Period</th>
                <th>Expected CTC</th>
                <th>Open to Relocate</th>
                <th>Comments</th>
                <th>LinkedIn</th>
                <th>Status</th>
                <th>CV Link</th>
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map(({ candidate: c, mobile, isGroup, groupSize, groupIndex, isLastInGroup }, index) => {
                const rowClass = isGroup
                  ? `candidate-mobile-group-row${groupIndex === 0 ? ' group-first' : ' group-child'}${isLastInGroup ? ' group-last' : ''}`
                  : ''
                return (
                <tr key={c.associationId || c.id} className={rowClass}>
                  <td>{index + 1}</td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>{c.consultant || '-'}</td>
                  <td>{c.client || '-'}</td>
                  <td className="cell-ellipsis">{c.job || '-'}</td>
                  <td>
                    <div className="name-cell">
                      <div className="name-avatar">{initials(c.name)}</div>
                      <div>
                        <div className="name-text candidate-group-name">
                          <span>{c.name}</span>
                          {isGroup && groupIndex === 0 && (
                            <>
                              <span className="candidate-submission-chip">{groupSize} submissions</span>
                              <button
                                className={`candidate-group-toggle${collapsed[mobile] ? ' collapsed' : ''}`}
                                type="button"
                                aria-label={collapsed[mobile] ? 'Expand candidate submissions' : 'Collapse candidate submissions'}
                                onClick={() => toggleCollapsed(mobile)}
                              >
                                <ChevronDown size={12} strokeWidth={2.4} />
                              </button>
                            </>
                          )}
                        </div>
                        <div className="sub-text">{c.location || [c.city, c.state].filter(Boolean).join(', ')}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontWeight:500, color:'var(--navy-darkest)' }}>
                      {c.currentOrganisation || c.currentCompany || '—'}
                    </span>
                  </td>
                  <td>{c.designation || '—'}</td>
                  <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.mobile || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.exp ? `${c.exp} yrs` : '—'}</td>
                  <td style={{ fontWeight:600 }}>{fmt(c.salary)}</td>
                  <td>{c.location || c.city || '—'}</td>
                  <td>{c.noticePeriod !== '' && c.noticePeriod !== null ? c.noticePeriod : '—'}</td>
                  <td style={{ fontWeight:600 }}>{fmt(c.expectedSalary)}</td>
                  <td>{c.openToRelocate ? 'Yes' : 'No'}</td>
                  <td className="cell-ellipsis">{c.notes || '—'}</td>
                  <td>
                    {c.linkedinUrl ? (
                      <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="table-link">LinkedIn</a>
                    ) : (
                       <span style={{ color:'var(--gray-400)', fontSize:12 }}>-</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status}</span>
                  </td>
                  <td>
                    {c.cvLink ? (
                      <a href={c.cvLink} target="_blank" rel="noopener noreferrer" className="cv-table-link" title="Open CV">
                        <FileText size={12} strokeWidth={2} /> CV
                      </a>
                    ) : (
                       <span style={{ color:'var(--gray-400)', fontSize:12 }}>-</span>
                    )}
                  </td>
                  <td>{formatMonth(c.createdAt)}</td>
                </tr>
              )})}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ===== Add Candidate Modal ===== */}
      {addOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Add Candidate">
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Candidate' : 'Add New Candidate'}</span>
              <button className="modal-close" onClick={() => setAddOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body" ref={candidateModalBodyRef}>
              {errors.form && <div className="form-error" style={{ display:'block', marginBottom:12 }}>{errors.form}</div>}
              {CandidateFormBody({
                f: form,
                setF: setForm,
                errs: errors,
                sInput: skillInput,
                onSkillInputChange: handleSkillInputChange,
                onSkillKey: handleSkillKey,
                onAddSkill: addManualSkill,
                rmSkill: removeSkill,
                onChange: handleChange
              })}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-candidate-btn" disabled={saving}>
                {saving ? 'Saving...' : 'Save Candidate'}
              </button>
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
                      <div className="drop-zone-subtitle">Max file size: 10 MB - PDF only</div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      <label className="form-label">Resume URL</label>
                      <input className="form-control" value={resumeUrl}
                        onChange={e => { setResumeUrl(e.target.value); setImportError('') }}
                        id="resume-url-input" />
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
                  {CandidateFormBody({
                    f: parsedForm,
                    setF: setParsedForm,
                    errs: {},
                    sInput: parsedSkillInput,
                    onSkillInputChange: handleParsedSkillInputChange,
                    onSkillKey: handleParsedSkillKey,
                    onAddSkill: addParsedManualSkill,
                    rmSkill: removeParsedSkill,
                    lowConf: parsedForm._lowConf || [],
                    onChange: handleParsedChange
                  })}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeImport}>Cancel</button>
              {parsed && (
                <button className="btn-primary" onClick={handleSaveParsed} id="save-parsed-candidate-btn" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Candidate'}
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

