import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, X, Users, ChevronDown, AlertCircle, FileText, Search, Loader2 } from 'lucide-react'
import NewActionDropdown from '../components/NewActionDropdown'
import '../styles/Shared.css'
import { supabase } from '../services/supabaseClient'

/* ====== Static reference data ====== */
const ALL_STATUSES = [
  'Interested', 'Not Interested', 'Interview', 'Client Submission',
  'Offered', 'Hired', 'Rejected by Recruiter', 'Rejected by Client',
]
const STATUS_OPTIONS = ['', ...ALL_STATUSES]
const RELOCATE_OPTIONS = ['', 'Yes', 'No']
const MAX_RESUME_FILES = 10
const MAX_RESUME_SIZE = 10 * 1024 * 1024
const ACCEPTED_RESUME_EXTENSIONS = ['pdf', 'doc', 'docx']

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
const normalizeCandidateGroupName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const normalizeCandidateGroupEmail = (value) => String(value || '').trim().toLowerCase()
const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

const notifyAiQuota = (message) => {
  if (message === 'AI quota reached') {
    window.dispatchEvent(new CustomEvent('ai-quota-reached', { detail: 'AI quota reached' }))
  }
}
const formatMonth = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-US', { month: 'short' })
}

const formatFilterChip = (condition) => {
  const value = Array.isArray(condition.value) ? condition.value.join(' - ') : condition.value
  return `${condition.field} ${condition.operator}${value !== undefined && value !== null ? ` ${value}` : ''}`
}

const getReadableClientId = (candidate, dbClients) => {
  if (!candidate.client || candidate.client.trim() === '') {
    return 'Unassigned'
  }
  // Try matching by UUID first
  if (candidate.clientId) {
    const matchedByUuid = dbClients.find(client => client.id === candidate.clientId)
    if (matchedByUuid?.client_display_id) {
      return matchedByUuid.client_display_id
    }
  }
  // Fallback to name matching
  const normalizedCandidateClientName = String(candidate.client).replace(/\s+/g, ' ').trim().toLowerCase()
  const matchedByName = dbClients.find(client => {
    const name = client.name || client.client_name || ''
    return name.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedCandidateClientName
  })
  if (matchedByName?.client_display_id) {
    return matchedByName.client_display_id
  }
  return 'Client not found'
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
  'candidate_id',
  'name',
  'city',
  'state',
  'currentDesignation',
  'email',
  'mobile',
  'experience',
  'salary',
  'consultant',
  'client',
  'job',
  'clientMobile',
  'status',
  'skills',
  'education'
]

const CANDIDATE_TABLE_COLUMNS = [
  { key: 'candidateDisplayId', label: 'Candidate ID' },
  { key: 'date', label: 'Date' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'client', label: 'Client Name' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'job', label: 'Role' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'designation', label: 'Designation' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email ID' },
  { key: 'experience', label: 'Experience' },
  { key: 'skills', label: 'Skills' },
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
  { key: 'action', label: 'Action' },
]

const DEFAULT_CANDIDATE_COLUMN_KEYS = CANDIDATE_TABLE_COLUMNS.map(column => column.key)

const SORT_OPTIONS = [
  { field: 'candidate_id', label: 'Candidate ID', toggle: true },
  { field: 'candidate_name', label: 'Alphabetic Order', toggle: true },
  { field: 'consultant', label: 'Consultant', toggle: false }
]

/* ====== Empty forms ====== */
const EMPTY_CAND = {
  name:'', email:'', mobile:'', designation:'', city:'', state:'',
  location:'', currentCompany:'', currentOrganisation:'', exp:'', salary:'', expectedSalary:'', skills:[], education:'',
  noticePeriod:'', openToRelocate:'',
  client:'', clientId:'', newClientName:'', job:'', clientPhone:'', status:'',
  cvLink:'', linkedinUrl:'', notes:'', consultantName:'', candidateId:'', candidateDisplayId:'', associationId:'',
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
  candidateDisplayId: row.candidate_display_id || '',
  clientId: row.client_id || '',
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
  openToRelocate: row.open_to_relocate === null || row.open_to_relocate === undefined ? '' : (row.open_to_relocate ? 'Yes' : 'No'),
  salary: row.current_salary ?? '',
  expectedSalary: row.expected_salary ?? '',
  skills: row.skills || [],
  education: row.education || '',
  client: row.client_name || '',
  clientPhone: row.client_phone_number || CLIENT_PHONES[row.client_name] || '',
  job: row.job_title || '',
  status: row.status || '',
  cvLink: row.cv_link || row.resume_url || '',
  linkedinUrl: row.linkedin_url || '',
  notes: row.notes || '',
  consultant: row.consultant_name || '',
  consultantName: row.consultant_name || '',
  createdAt: row.created_at || '',
})

const cleanNumberForApi = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return ''
  return value
}

const getCanonicalClients = (clients) => {
  const map = new Map()
  clients.forEach(client => {
    const name = client?.name || client?.client_name || ''
    const key = (client?.client_display_id || name).toString().trim().toLowerCase()
    if (!key || map.has(key)) return
    map.set(key, client)
  })
  return [...map.values()]
}

const uiCandidateToApi = (f, consultantName = '', dbClients = [], dbJobs = []) => {
  const matchingClient = dbClients.find(c => c.id === f.clientId) || dbClients.find(c => c.name === f.client)
  const matchingJob = dbJobs.find(j => j.title === f.job && (matchingClient ? j.client_id === matchingClient.id : true))
  return {
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
    experience_years: cleanNumberForApi(f.exp),
    notice_period: cleanNumberForApi(f.noticePeriod),
    open_to_relocate: f.openToRelocate === '' ? null : f.openToRelocate === 'Yes',
    skills: f.skills,
    education: f.education,
    client_name: f.client,
    job_title: f.job,
    client_id: f.clientId || (matchingClient ? matchingClient.id : undefined),
    job_id: matchingJob ? matchingJob.id : undefined,
    status: f.status,
    current_salary: cleanNumberForApi(f.salary),
    expected_salary: cleanNumberForApi(f.expectedSalary),
    cv_link: f.cvLink,
    linkedin_url: f.linkedinUrl,
    notes: f.notes,
    consultant_name: f.consultantName || consultantName || '',
    source: f.source,
  }
}

export default function CandidatesPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState([])
  const fileInputRef = useRef(null)
  const candidateModalRef = useRef(null)
  const candidateModalBodyRef = useRef(null)
  const candidateDetailRef = useRef(null)
  const importModalRef = useRef(null)
  const duplicateModalRef = useRef(null)
  const [apiError, setApiError] = useState('')
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [candidateDuplicate, setCandidateDuplicate] = useState(null)
  const [page, setPage] = useState(1)
  const [totalCandidates, setTotalCandidates] = useState(0)
  const pageSize = 50
  const activeConsultantName = getConsultantNameFromUser(getCurrentUser())

  // Filters
  const [filterJob, setFilterJob]       = useState('All')
  const [aiFilterText, setAiFilterText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiAppliedPrompt, setAiAppliedPrompt] = useState('')
  const [aiFilterLoading, setAiFilterLoading] = useState(false)
  const [aiFilterError, setAiFilterError] = useState('')
  const [aiFilterCount, setAiFilterCount] = useState(null)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)

  const [dbClients, setDbClients] = useState([])
  const [dbJobs, setDbJobs] = useState([])

  useEffect(() => {
    fetch('/api/clients').then(res => res.json()).then(data => setDbClients(data.data || []))
    fetch('/api/jobs').then(res => res.json()).then(data => setDbJobs(data.data || []))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null
        const userId = session?.user?.id || getCurrentUser()?.id || getCurrentUser()?.email || 'anonymous'
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
      if (!sortDropdownRef.current?.contains(event.target)) {
        setSortOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sortOpen])

  // Add Candidate Modal
  const [addOpen, setAddOpen]   = useState(false)
  const [form, setForm]         = useState(EMPTY_CAND)
  const [errors, setErrors]     = useState({})
  const [skillInput, setSkillInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [detailPosition, setDetailPosition] = useState(null)
  const [candidateAssociations, setCandidateAssociations] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [expandedCells, setExpandedCells] = useState({})

  // Bulk resume review modal
  const [importOpen, setImportOpen]   = useState(false)
  const [resumeFiles, setResumeFiles] = useState([])
  const [importQueue, setImportQueue] = useState([])
  const [currentImportIndex, setCurrentImportIndex] = useState(0)
  const [importError, setImportError] = useState('')
  const [parsing, setParsing]         = useState(false)
  const [parsed, setParsed]           = useState(false)    // after parse success
  const [parsedForm, setParsedForm]   = useState(null)
  const [parsedSkillInput, setParsedSkillInput] = useState('')
  const [reviewNotice, setReviewNotice] = useState('')

  const focusPopup = useCallback((ref) => {
    window.requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const target = node.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || node).focus({ preventScroll: true })
    })
  }, [])

  useEffect(() => {
    if (!addOpen && !importOpen && !candidateDuplicate && !selectedCandidate) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [addOpen, importOpen, candidateDuplicate, selectedCandidate])

  useEffect(() => {
    if (addOpen) focusPopup(candidateModalRef)
  }, [addOpen, focusPopup])

  useEffect(() => {
    if (importOpen) focusPopup(importModalRef)
  }, [importOpen, parsed, focusPopup])

  useEffect(() => {
    if (candidateDuplicate) focusPopup(duplicateModalRef)
  }, [candidateDuplicate, focusPopup])

  useEffect(() => {
    if (selectedCandidate) focusPopup(candidateDetailRef)
  }, [selectedCandidate, focusPopup])

  const loadCandidates = useCallback(async (nextPage = page, { showLoading = true } = {}) => {
    if (showLoading) setLoadingCandidates(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(pageSize)
      })

      if (filterJob !== 'All') params.set('job_title', filterJob)
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      if (aiFilters) {
        params.set('ai_filters', JSON.stringify(aiFilters))
        if (aiAppliedPrompt) params.set('ai_prompt', aiAppliedPrompt)
      }

      const response = await fetch(`/api/candidates?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load candidates.')
      }

      setCandidates(Array.isArray(payload.data) ? payload.data.map(apiCandidateToUi) : [])
      setTotalCandidates(Number(payload.total) || 0)
      setPage(Number(payload.page) || nextPage)
      setApiError('')
    } catch (err) {
      setApiError(err.message)
      setCandidates([])
      setTotalCandidates(0)
    } finally {
      if (showLoading) setLoadingCandidates(false)
    }
  }, [aiAppliedPrompt, aiFilters, filterJob, page, pageSize, sortDirection, sortField])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCandidates(page)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadCandidates, page])

  const saveCandidateToApi = async (candidate, { update = false, duplicateAction = '' } = {}) => {
    const prepared = await ensureCandidateClient(candidate)
    const body = uiCandidateToApi(prepared, activeConsultantName, dbClients, dbJobs)
    if (duplicateAction) body.duplicate_action = duplicateAction

    const response = await fetch(update ? `/api/candidates/${candidate.associationId}` : '/api/candidates', {
      method: update ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const payload = await response.json().catch(() => ({}))

    if (response.status === 409 && payload.duplicate) {
      const error = new Error(payload.error || 'Duplicate candidate found.')
      error.duplicate = payload
      throw error
    }

    if (!response.ok) {
      const message = payload.errors ? Object.values(payload.errors)[0] : payload.error
      throw new Error(message || 'Unable to save candidate.')
    }

    return apiCandidateToUi(payload)
  }

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const clientName = (client) => client?.name || client?.client_name || ''
  const canonicalClients = getCanonicalClients(dbClients)
  const findClientByName = (name) => canonicalClients.find(c => normalizeText(clientName(c)) === normalizeText(name))
  const findClientByInput = (value) => canonicalClients.find(c => c.id === value) || findClientByName(value)
  const clientDisplayIdForForm = (candidate) => {
    const client = canonicalClients.find(c => c.id === candidate.clientId) || findClientByName(candidate.client)
    return client?.client_display_id || ''
  }

  const ensureCandidateClient = async (candidate) => {
    if (candidate.clientId) return candidate
    const client = findClientByName(candidate.client)
    return client ? { ...candidate, clientId: client.id, client: client.name || client.client_name } : candidate
  }

  const filtered = candidates

  const mobileGroups = {}
  filtered.forEach(c => {
    const name = normalizeCandidateGroupName(c.name)
    const email = normalizeCandidateGroupEmail(c.email)
    const key = sortField
      ? c.associationId || c.id
      : (name && email ? `${name}|${email}` : c.associationId || c.id)
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
    setFilterJob('All')
    setAiFilterText('')
    setAiFilters(null)
    setAiAppliedPrompt('')
    setAiFilterError('')
    setAiFilterCount(null)
    setPage(1)
  }

  const clearAiFilter = () => {
    setAiFilterText('')
    setAiFilters(null)
    setAiAppliedPrompt('')
    setAiFilterError('')
    setAiFilterCount(null)
    setPage(1)
  }

  const togglePendingColumn = (key) => {
    setPendingColumns(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    )
  }

  const proceedColumns = () => {
    setVisibleColumns(pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const currentUser = getCurrentUser()
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const value = pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS
      const response = await fetch('/api/user-preferences/candidate_columns', {
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
      setApiError(err.message)
    }
  }

  const resetColumnsToSaved = () => {
    setPendingColumns(savedColumns?.length ? savedColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)
  }

  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    if (!option) return 'Sort By'
    return option.toggle ? `${option.label} ${sortDirection === 'asc' ? '↓' : '↑'}` : option.label
  }

  const selectSort = (field) => {
    const option = SORT_OPTIONS.find(item => item.field === field)
    if (!option) return

    if (!option.toggle) {
      setSortField(field)
      setSortDirection('asc')
    } else if (sortField === field) {
      setSortDirection(current => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }

    setPage(1)
    setSortOpen(false)
  }

  // ---- Add Candidate form ----
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    const nextValue = type === 'checkbox' ? checked : value
    if (name === 'client') {
      const matchingClient = findClientByInput(value)
      setForm(f => ({
        ...f,
        client: matchingClient ? clientName(matchingClient) : value,
        clientId: matchingClient?.id || '',
        clientPhone: matchingClient?.phone || CLIENT_PHONES[clientName(matchingClient)] || '',
        job: ''
      }))
    } else {
      setForm(f => ({ ...f, [name]: nextValue }))
    }
  }

  const handleSkillKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && skillInput.trim()) {
      e.preventDefault()
      addManualSkill()
    }
  }
  const removeSkill = (s) => setForm(f => ({ ...f, skills: f.skills.filter(x => x !== s) }))

  const cleanSkill = (s) => String(s).replace(/[,;]+$/, '').trim()
  const appendSkills = (existing, newSkills) => {
    const set = new Set((existing || []).map(x => x.toLowerCase()))
    return [...(existing || []), ...newSkills.filter(s => s && !set.has(s.toLowerCase()))]
  }
  const handleSkillInputChange = (value) => setSkillInput(value)
  const addManualSkill = (value = skillInput) => {
    const s = cleanSkill(value)
    if (s) setForm(f => ({ ...f, skills: appendSkills(f.skills, [s]) }))
    setSkillInput('')
  }

  const validate = (f) => {
    const e = {}
    if (!f.name.trim()) e.name = 'Full Name is required'
    if (!f.mobile.trim()) e.mobile = 'Mobile is required'
    return e
  }

  const fetchNextCandidateDisplayId = useCallback(async () => {
    const response = await fetch('/api/candidates/next-display-id')
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to load candidate ID')
    return payload.candidate_display_id || ''
  }, [])

  const openAddModal = async () => {
    setForm({ ...EMPTY_CAND, skills: [], consultantName: activeConsultantName, candidateDisplayId: 'Loading...' })
    setEditing(false)
    setErrors({})
    setSkillInput('')
    setAddOpen(true)
    try {
      const candidateDisplayId = await fetchNextCandidateDisplayId()
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId } : current)
    } catch {
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId: '' } : current)
    }
  }

  useEffect(() => {
    const action = location.state?.action
    if (!action) return
    const timer = window.setTimeout(() => {
      navigate(location.pathname, { replace: true, state: {} })
      if (action === 'upload-resumes') fileInputRef.current?.click()
      if (action === 'add-candidate') {
        setForm({ ...EMPTY_CAND, skills: [], consultantName: activeConsultantName, candidateDisplayId: 'Loading...' })
        setEditing(false)
        setErrors({})
        setSkillInput('')
        setAddOpen(true)
        fetchNextCandidateDisplayId()
          .then(candidateDisplayId => setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId } : current))
          .catch(() => setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId: '' } : current))
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeConsultantName, fetchNextCandidateDisplayId, location.pathname, location.state, navigate])

  const candidateToForm = (candidate) => {
    const matchedClient = dbClients.find(c => c.id === candidate.clientId) || findClientByName(candidate.client)
    return {
      ...EMPTY_CAND,
      ...candidate,
      consultantName: candidate.consultantName || candidate.consultant || activeConsultantName,
      associationId: candidate.associationId,
      candidateId: candidate.candidateId,
      clientId: candidate.clientId || matchedClient?.id || '',
      client: clientName(matchedClient) || candidate.client || '',
      currentOrganisation: candidate.currentOrganisation || candidate.currentCompany || '',
      skills: Array.isArray(candidate.skills) ? candidate.skills : []
    }
  }

  const openEditCandidate = (candidate) => {
    setForm(candidateToForm(candidate))
    setEditing(true)
    setErrors({})
    setSkillInput('')
    setSelectedCandidate(null)
    setAddOpen(true)
  }

  const openCandidateDetail = async (candidate, event) => {
    const rect = event?.currentTarget?.getBoundingClientRect()
    const viewportHeight = window.innerHeight || 0
    const top = rect ? Math.min(Math.max(rect.top - 16, 16), Math.max(16, viewportHeight - 620)) : 96
    setDetailPosition({ top })
    setSelectedCandidate(candidate)
    setCandidateAssociations([])
    setDetailError('')

    if (!candidate.candidateId) {
      return
    }

    setDetailLoading(true)
    try {
      const response = await fetch(`/api/candidates/by-candidate/${candidate.candidateId}/associations`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load candidate details.')
      }

      setCandidateAssociations(Array.isArray(payload.data) ? payload.data.map(apiCandidateToUi) : [])
    } catch (err) {
      setDetailError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

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
      setAiAppliedPrompt(prompt)
      setAiFilterCount(Number.isFinite(payload.matchedCount) ? payload.matchedCount : null)
      setPage(1)
    } catch (err) {
      notifyAiQuota(err.message)
      setAiFilterError(err.message)
      setAiFilters(null)
      setAiAppliedPrompt('')
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
      await loadCandidates(page, { showLoading: false })
    } catch (err) {
      if (err.duplicate) {
        setCandidateDuplicate({ source: 'manual', candidate: form, existing: err.duplicate.existing })
        return
      }
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

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    handleBulkResumeFiles(files)
  }

  const validateResumeFiles = (files) => {
    if (!files.length) return 'Select at least one resume.'
    if (files.length > MAX_RESUME_FILES) return 'Upload up to 10 resumes at once.'
    const invalid = files.find(file => !ACCEPTED_RESUME_EXTENSIONS.includes(String(file.name.split('.').pop() || '').toLowerCase()))
    if (invalid) return 'Only PDF, DOC, and DOCX files are accepted.'
    const oversized = files.find(file => file.size > MAX_RESUME_SIZE)
    if (oversized) return 'Each resume must be 10 MB or smaller.'
    return ''
  }

  const mapBulkResumeRowToForm = (row) => {
    const parsedClient = row.client_name || ''
    const matchedClient = findClientByName(parsedClient)
    return {
      ...EMPTY_CAND,
      consultantName: activeConsultantName,
      name: row.candidate_name || '',
      email: row.email || '',
      mobile: row.phone_number || '',
      designation: row.current_designation || '',
      currentCompany: row.current_organization || '',
      currentOrganisation: row.current_organization || '',
      exp: row.experience_years ?? '',
      city: row.city || '',
      state: row.state || '',
      location: row.location || [row.city, row.state].filter(Boolean).join(', '),
      skills: Array.isArray(row.skills) ? row.skills : [],
      education: row.education || '',
      salary: row.salary ?? '',
      client: matchedClient ? clientName(matchedClient) : '',
      clientId: matchedClient?.id || '',
      newClientName: '',
      clientPhone: matchedClient?.phone || '',
      linkedinUrl: row.linkedin_url || '',
      cvLink: row.resume_url || '',
      notes: row.summary || row.error || '',
      source: 'resume'
    }
  }

  const startResumeReview = async (rows) => {
    const candidateDisplayId = await fetchNextCandidateDisplayId().catch(() => '')
    setImportQueue(rows)
    setCurrentImportIndex(0)
    setParsedForm({ ...mapBulkResumeRowToForm(rows[0]), candidateDisplayId })
    setParsed(true)
    setReviewNotice(rows[0]?.error ? `Parsing warning: ${rows[0].error}` : '')
  }

  const handleBulkResumeFiles = async (files) => {
    const validationError = validateResumeFiles(files)
    setImportError(validationError)
    if (validationError) return
    setResumeFiles(files)
    setImportOpen(true)
    setParsed(false)
    setParsedForm(null)
    setReviewNotice('')
    const body = new FormData()
    files.forEach(file => body.append('resumes', file))
    setParsing(true)
    try {
      const response = await fetch('/api/resumes/bulk-parse', {
        method: 'POST',
        body
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to parse resumes.')
      const rows = payload.rows || []
      if (!rows.length) throw new Error('No resumes were parsed.')
      await startResumeReview(rows)
    } catch (err) {
      notifyAiQuota(err.message)
      setImportError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const fillEmptyCandidateFields = (candidate) => {
    // mobile is included so a missing phone number from a CV defaults to '-' rather than ''
    // which avoids 'Mobile is required' blocking the save silently
    const textFields = ['name', 'email', 'mobile', 'designation', 'city', 'state', 'location', 'currentCompany', 'currentOrganisation', 'education', 'client', 'job', 'clientPhone', 'cvLink', 'linkedinUrl', 'notes', 'consultantName']
    const next = { ...candidate }
    textFields.forEach(field => {
      if (String(next[field] ?? '').trim() === '') next[field] = '-'
    })
    return next
  }

  const advanceResumeReview = async (notice = '') => {
    const nextIndex = currentImportIndex + 1
    if (nextIndex >= importQueue.length) {
      closeImport()
      await loadCandidates(page, { showLoading: false })
      return
    }
    const candidateDisplayId = await fetchNextCandidateDisplayId().catch(() => '')
    setCurrentImportIndex(nextIndex)
    setParsedForm({ ...mapBulkResumeRowToForm(importQueue[nextIndex]), candidateDisplayId })
    setParsedSkillInput('')
    setReviewNotice(importQueue[nextIndex]?.error ? `Parsing warning: ${importQueue[nextIndex].error}` : notice)
  }

  const handleSaveParsed = async () => {
    const candidateToSave = fillEmptyCandidateFields({ ...parsedForm, source: 'resume' })
    const e = validate(candidateToSave)
    if (Object.keys(e).length) { setImportError(Object.values(e)[0]); return }
    setSaving(true)
    try {
      await saveCandidateToApi(candidateToSave)
      await loadCandidates(page, { showLoading: false })
      await advanceResumeReview('Candidate saved.')
    } catch (err) {
      if (err.duplicate) {
        setCandidateDuplicate({ source: 'resume', candidate: candidateToSave, existing: err.duplicate.existing })
        return
      }
      setImportError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const skipCurrentResume = () => {
    advanceResumeReview('Resume skipped.')
  }

  const cancelRemainingResumes = () => {
    if (window.confirm('Cancel remaining resume reviews?')) closeImport()
  }

  const resolveCandidateDuplicate = async (duplicateAction) => {
    if (!candidateDuplicate) return

    setSaving(true)
    try {
      await saveCandidateToApi(candidateDuplicate.candidate, { duplicateAction })
      setCandidateDuplicate(null)
      await loadCandidates(page, { showLoading: false })
      if (candidateDuplicate.source === 'resume') {
        await advanceResumeReview('Duplicate resolved.')
        return
      }
      setAddOpen(false)
      setEditing(false)
    } catch (err) {
      const message = err.message || 'Unable to resolve duplicate candidate.'
      if (candidateDuplicate.source === 'resume') setImportError(message)
      else setErrors({ form: message })
    } finally {
      setSaving(false)
    }
  }

  const closeImport = () => {
    setImportOpen(false); setResumeFiles([]); setImportQueue([]); setCurrentImportIndex(0); setImportError(''); setReviewNotice('')
    setParsing(false); setParsed(false); setParsedForm(null); setParsedSkillInput('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Parsed form change ----
  const handleParsedChange = (e) => {
    const { name, value, type, checked } = e.target
    const nextValue = type === 'checkbox' ? checked : value
    if (name === 'client') {
      const matchingClient = findClientByInput(value)
      setParsedForm(f => ({
        ...f,
        client: matchingClient ? clientName(matchingClient) : value,
        clientId: matchingClient?.id || '',
        clientPhone: matchingClient?.phone || CLIENT_PHONES[clientName(matchingClient)] || '',
        job: ''
      }))
    } else {
      setParsedForm(f => ({ ...f, [name]: nextValue }))
    }
  }

  // ---- Candidate Form body (shared between Add + Review) ----
  const CandidateFormBody = ({ f, setF, errs, sInput, onSkillInputChange, onSkillKey, onAddSkill, rmSkill, lowConf = [], onChange }) => {
    const low = (field) => lowConf.includes(field) ? ' low-confidence' : ''
    const visibleClientValue = f.client || ''
    const matchingClients = canonicalClients
      .filter(client => normalizeText(clientName(client)).includes(normalizeText(visibleClientValue)))
      .slice(0, 8)
    const setClientValue = (value) => {
      const matchedClient = findClientByInput(value)
      setF(prev => ({
        ...prev,
        client: matchedClient ? clientName(matchedClient) : value,
        clientId: matchedClient?.id || '',
        clientPhone: matchedClient?.phone || CLIENT_PHONES[clientName(matchedClient)] || '',
        job: ''
      }))
    }
    const handleLocalChange = onChange || ((e) => {
      const { name, value, type, checked } = e.target
      const nextValue = type === 'checkbox' ? checked : value
      if (name === 'client') {
        const matchedClient = findClientByInput(value)
        setF(prev => ({
          ...prev,
          client: matchedClient ? clientName(matchedClient) : value,
          clientId: matchedClient?.id || '',
          clientPhone: matchedClient?.phone || CLIENT_PHONES[clientName(matchedClient)] || '',
          job: ''
        }))
      } else {
        setF(prev => ({ ...prev, [name]: nextValue }))
      }
    })
    return (
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Candidate ID</label>
          <input value={f.candidateDisplayId || 'Auto-generated'} className="form-control" disabled readOnly />
        </div>
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
            {STATUS_OPTIONS.map(s => <option key={s || '-'} value={s}>{s || '-'}</option>)}
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

        <div className="form-group">
          <label className="form-label">Open to Relocate</label>
          <select name="openToRelocate" value={f.openToRelocate} onChange={handleLocalChange} className="form-control">
            {RELOCATE_OPTIONS.map(value => <option key={value || '-'} value={value}>{value || '-'}</option>)}
          </select>
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

        <div className="form-section-title">Mandate Assignment</div>

        <div className="form-group">
          <label className="form-label">Client</label>
          <div className="client-search-wrap">
            <input
              name="client"
              value={visibleClientValue}
              onChange={(event) => setClientValue(event.target.value)}
              className={`form-control${errs?.client ? ' is-error' : ''}`}
              placeholder={dbClients.length ? 'Search client...' : 'Loading clients...'}
              autoComplete="off"
            />
            <div className="client-suggestions">
              {matchingClients.map(client => (
                <button type="button" key={client.id} onMouseDown={(event) => { event.preventDefault(); setClientValue(client.id) }}>
                  <span>{clientName(client)}</span>
                  <small>{client.client_display_id || ''}</small>
                </button>
              ))}
            </div>
          </div>
          {errs?.client && <span className="form-error">{errs.client}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Client ID</label>
          <input value={clientDisplayIdForForm(f)} placeholder="Auto-filled after selecting client" className="form-control" readOnly />
        </div>

        <div className="form-group">
          <label className="form-label">Mandate / Role</label>
          <select name="job" value={f.job} onChange={handleLocalChange} className="form-control">
            <option value="">Select job...</option>
            {dbJobs
              .filter(j => !f.clientId || f.clientId === j.client_id)
              .map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
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

  const activeColumns = CANDIDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))
  const toggleExpandedCell = (id, key, event) => {
    event.stopPropagation()
    const cellKey = `${id}-${key}`
    setExpandedCells(current => ({ ...current, [cellKey]: !current[cellKey] }))
  }
  const renderSkillsCell = (candidate) => {
    const skills = Array.isArray(candidate.skills) ? candidate.skills.filter(Boolean) : []
    if (!skills.length) return '-'
    const cellKey = `${candidate.associationId || candidate.id}-skills`
    const expanded = Boolean(expandedCells[cellKey])
    const visibleSkills = expanded ? skills : skills.slice(0, 3)
    return (
      <div className="table-chip-cell">
        <div className="table-chip-list">
          {visibleSkills.map(skill => <span className="table-skill-chip" key={skill}>{skill}</span>)}
        </div>
        {skills.length > 3 && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(candidate.associationId || candidate.id, 'skills', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'Show less' : `+ ${skills.length - 3} more skills`}
          </button>
        )}
      </div>
    )
  }
  const renderCommentsCell = (candidate) => {
    const text = String(candidate.notes || '').trim()
    if (!text) return '-'
    const cellKey = `${candidate.associationId || candidate.id}-comments`
    const expanded = Boolean(expandedCells[cellKey])
    const isLong = text.length > 24
    return (
      <div className="table-comment-cell">
        <div className={`table-comment-text${expanded ? ' is-expanded' : ''}`}>{text}</div>
        {isLong && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(candidate.associationId || candidate.id, 'comments', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'Show less' : 'View full comment'}
          </button>
        )}
      </div>
    )
  }
  const renderCandidateCell = ({ key }, c, groupMeta) => {
    const { mobile, isGroup, groupSize, groupIndex } = groupMeta

    switch (key) {
      case 'candidateDisplayId':
        return <td key={key} style={{ fontFamily:'monospace', fontSize:12 }}>{c.candidateDisplayId || '-'}</td>
      case 'date':
        return <td key={key}>{formatDate(c.createdAt)}</td>
      case 'consultant':
        return <td key={key}>{c.consultant || '-'}</td>
      case 'client':
        return <td key={key}>{c.client || '-'}</td>
      case 'clientId':
        return <td key={key} style={{ fontFamily:'monospace', fontSize:12 }}>{getReadableClientId(c, dbClients)}</td>
      case 'job':
        return <td key={key} className="cell-ellipsis">{c.job || '-'}</td>
      case 'name':
        return (
          <td key={key}>
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
                        onClick={(event) => { event.stopPropagation(); toggleCollapsed(mobile) }}
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
        )
      case 'organisation':
        return <td key={key}><span style={{ fontWeight:500, color:'var(--navy-darkest)' }}>{c.currentOrganisation || c.currentCompany || '-'}</span></td>
      case 'designation':
        return <td key={key}>{c.designation || '-'}</td>
      case 'mobile':
        return <td key={key} style={{ fontFamily:'monospace', fontSize:12 }}>{c.mobile || '-'}</td>
      case 'email':
        return <td key={key}>{c.email || '-'}</td>
      case 'experience':
        return <td key={key}>{c.exp ? `${c.exp} yrs` : '-'}</td>
      case 'skills': {
        return <td key={key}>{renderSkillsCell(c)}</td>
      }
      case 'salary':
        return <td key={key} style={{ fontWeight:600 }}>{fmt(c.salary)}</td>
      case 'location':
        return <td key={key}>{c.location || c.city || '-'}</td>
      case 'notice':
        return <td key={key}>{c.noticePeriod !== '' && c.noticePeriod !== null ? c.noticePeriod : '-'}</td>
      case 'expectedSalary':
        return <td key={key} style={{ fontWeight:600 }}>{fmt(c.expectedSalary)}</td>
      case 'relocate':
        return <td key={key}>{c.openToRelocate || '-'}</td>
      case 'comments':
        return <td key={key}>{renderCommentsCell(c)}</td>
      case 'linkedin':
        return (
          <td key={key}>
            {c.linkedinUrl ? (
              <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="table-link" onClick={event => event.stopPropagation()}>LinkedIn</a>
            ) : (
              <span style={{ color:'var(--gray-400)', fontSize:12 }}>-</span>
            )}
          </td>
        )
      case 'status':
        return <td key={key}><span className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`}>{c.status}</span></td>
      case 'cv':
        return (
          <td key={key}>
            {c.cvLink ? (
              <a href={c.cvLink} target="_blank" rel="noopener noreferrer" className="cv-table-link" title="Open CV" onClick={event => event.stopPropagation()}>
                <FileText size={12} strokeWidth={2} /> CV
              </a>
            ) : (
              <span style={{ color:'var(--gray-400)', fontSize:12 }}>-</span>
            )}
          </td>
        )
      case 'month':
        return <td key={key}>{formatMonth(c.createdAt)}</td>
      case 'action':
        return (
          <td key={key}>
            <div className="row-actions">
              <button className="btn-secondary" style={{ height:30, padding:'0 10px' }} onClick={(event) => { event.stopPropagation(); openCandidateDetail(c, event) }}>
                View
              </button>
              <button className="btn-secondary" style={{ height:30, padding:'0 10px' }} onClick={(event) => { event.stopPropagation(); openEditCandidate(c) }}>
                Edit
              </button>
            </div>
          </td>
        )
      default:
        return null
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      {apiError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {apiError}
        </div>
      )}

      <div className="candidate-columns-toolbar">
        <NewActionDropdown
          onUploadResumes={() => fileInputRef.current?.click()}
          onAddCandidate={openAddModal}
          onAddClient={() => navigate('/dashboard/clients', { state: { action: 'add-client' } })}
          onAddJob={() => navigate('/dashboard/jobs', { state: { action: 'add-job' } })}
        />
        <div className="candidate-columns-control" ref={columnsDropdownRef}>
          <button
            className="filter-select candidate-columns-btn"
            type="button"
            onClick={() => { setPendingColumns(visibleColumns); setColumnsOpen(open => !open) }}
          >
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>
            Proceed
          </button>
          {columnsOpen && (
            <div className="filter-dropdown candidate-columns-dropdown">
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(DEFAULT_CANDIDATE_COLUMN_KEYS)}>
                Select All
              </button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>
                Clear All
              </button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>
                Save Preference
              </button>
              <button className="candidate-columns-action" type="button" onClick={resetColumnsToSaved}>
                Reset to Saved Preference
              </button>
              <div className="candidate-columns-divider" />
              {CANDIDATE_TABLE_COLUMNS.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input
                    type="checkbox"
                    checked={pendingColumns.includes(column.key)}
                    onChange={() => togglePendingColumn(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar candidates-filter-bar">
        <span className="filter-label">Mandate</span>
        <select className="filter-select" value={filterJob}
          onChange={e => { setFilterJob(e.target.value); setPage(1) }} id="filter-candidate-job">
          <option value="All">All Mandates</option>
          {dbJobs.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
        </select>

        <div className="filter-divider" />

        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input
            className="filter-input candidate-ai-filter-input"
            value={aiFilterText}
            onChange={e => { setAiFilterText(e.target.value); setAiFilterError('') }}
            id="filter-ai-candidates"
          />
          <button className="btn-secondary" type="submit" disabled={aiFilterLoading} style={{ height:34, padding:'0 12px' }}>
            {aiFilterLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            Apply
          </button>
          <button className="filter-clear" type="button" onClick={clearFilters}>Clear Filters</button>
        </form>

        <div className="filter-divider" />

        <span className="filter-label">Sort By</span>
        <div className="candidate-sort-control" ref={sortDropdownRef}>
          <button className="filter-select candidate-sort-btn" type="button" onClick={() => setSortOpen(open => !open)}>
            <span>{sortLabel()}</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {sortOpen && (
            <div className="filter-dropdown candidate-sort-dropdown">
              {SORT_OPTIONS.map(option => (
                <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>
                  {option.toggle ? `${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}` : option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc'); setPage(1) }}>Clear</button>
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

      {aiFilters && (
        <div className="ai-filter-chips">
          {(aiFilters.conditions || []).map((condition, index) => (
            <span className="tag-chip" key={`${condition.field}-${index}`}>{formatFilterChip(condition)}</span>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="table-card">
        {loadingCandidates ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Loader2 size={28} color="var(--gold)" className="spin" /></div>
            <div className="empty-state-title">Loading candidates</div>
          </div>
        ) : filtered.length === 0 ? (
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
                  {activeColumns.map(column => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map(({ candidate: c, mobile, isGroup, groupSize, groupIndex, isLastInGroup }) => {
                  const rowClass = isGroup
                    ? `candidate-mobile-group-row${groupIndex === 0 ? ' group-first' : ' group-child'}${isLastInGroup ? ' group-last' : ''}`
                    : ''
                  return (
                    <tr key={c.associationId || c.id} className={rowClass}>
                      {activeColumns.map(column => renderCandidateCell(column, c, { mobile, isGroup, groupSize, groupIndex }))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pagination-bar">
        <button className="btn-secondary" disabled={page <= 1 || loadingCandidates} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
        <span>Page {page} of {Math.max(1, Math.ceil(totalCandidates / pageSize))}</span>
        <span>{totalCandidates.toLocaleString('en-IN')} total</span>
        <button className="btn-secondary" disabled={page >= Math.max(1, Math.ceil(totalCandidates / pageSize)) || loadingCandidates} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>

      {selectedCandidate && createPortal((
        <div className="candidate-drawer-overlay" onClick={e => e.target === e.currentTarget && setSelectedCandidate(null)}>
          <aside className="candidate-drawer" ref={candidateDetailRef} tabIndex={-1} style={detailPosition ? { top: detailPosition.top } : undefined} aria-label="Candidate details">
            <div className="candidate-drawer-header">
              <div>
                <div className="candidate-drawer-title">{selectedCandidate.name}</div>
                <div className="sub-text">{selectedCandidate.designation || 'Candidate'} ? {selectedCandidate.location || selectedCandidate.city || '-'}</div>
              </div>
              <button className="modal-close" onClick={() => setSelectedCandidate(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="candidate-drawer-actions">
              <button className="btn-primary" onClick={() => openEditCandidate(selectedCandidate)}>Edit</button>
              {selectedCandidate.cvLink && (
                <a className="btn-secondary" href={selectedCandidate.cvLink} target="_blank" rel="noopener noreferrer"><FileText size={14} /> CV</a>
              )}
              {selectedCandidate.linkedinUrl && (
                <a className="btn-secondary" href={selectedCandidate.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>
              )}
            </div>

            {detailError && <div className="form-error" style={{ display:'block', marginBottom:12 }}>{detailError}</div>}
            {detailLoading && <div className="sub-text" style={{ marginBottom:12 }}>Loading associations...</div>}

            <div className="candidate-detail-grid">
              {[
                ['Date', formatDate(selectedCandidate.createdAt)],
                ['Candidate ID', selectedCandidate.candidateDisplayId || '-'],
                ['Consultant', selectedCandidate.consultant || '-'],
                ['Client', selectedCandidate.client || '-'],
                ['Role', selectedCandidate.job || '-'],
                ['Organisation', selectedCandidate.currentOrganisation || selectedCandidate.currentCompany || '-'],
                ['Designation', selectedCandidate.designation || '-'],
                ['Mobile', selectedCandidate.mobile || '-'],
                ['Email', selectedCandidate.email || '-'],
                ['Experience', selectedCandidate.exp ? `${selectedCandidate.exp} yrs` : '-'],
                ['Current CTC', fmt(selectedCandidate.salary)],
                ['Expected CTC', fmt(selectedCandidate.expectedSalary)],
                ['Current Location', selectedCandidate.location || selectedCandidate.city || '-'],
                ['Notice Period', selectedCandidate.noticePeriod !== '' && selectedCandidate.noticePeriod !== null ? selectedCandidate.noticePeriod : '-'],
                ['Open to Relocate', selectedCandidate.openToRelocate || '-'],
                ['Status', selectedCandidate.status || '-'],
                ['Month', formatMonth(selectedCandidate.createdAt)],
                ['Education', selectedCandidate.education || '-'],
                ['Skills', Array.isArray(selectedCandidate.skills) && selectedCandidate.skills.length ? selectedCandidate.skills.join(', ') : '-'],
              ].map(([label, value]) => (
                <div className="candidate-detail-item" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <div className="candidate-detail-section">
              <div className="candidate-detail-section-title">Comments / Notes</div>
              <p>{selectedCandidate.notes || '-'}</p>
            </div>

            <div className="candidate-detail-section">
              <div className="candidate-detail-section-title">Client / Mandate Associations</div>
              {(candidateAssociations.length ? candidateAssociations : [selectedCandidate]).map(item => (
                <div className="candidate-association-card" key={item.associationId || item.id}>
                  <div><strong>{item.client || '-'}</strong></div>
                  <div>{item.job || '-'}</div>
                  <div><span className={`badge ${STATUS_BADGE_MAP[item.status] || ''}`}>{item.status}</span></div>
                  <div className="sub-text">Consultant: {item.consultant || '-'} ? Expected: {fmt(item.expectedSalary)}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ), document.body)}

      {/* ===== Add Candidate Modal ===== */}
      {addOpen && createPortal((
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setAddOpen(false)}>
          <div className="modal-card modal-card-lg" ref={candidateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add Candidate">
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Candidate' : 'Add New Candidate'}</span>
              <button className="modal-close" onClick={() => setAddOpen(false)} aria-label="Close" disabled={saving}><X size={16} /></button>
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
              <button className="btn-secondary" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-candidate-btn" disabled={saving}>
                {saving ? 'Saving...' : 'Save Candidate'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ===== Bulk Resume Review Modal ===== */}
      {importOpen && createPortal((
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeImport()}>
          <div className="modal-card modal-card-lg" ref={importModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Parse and add candidates">
            <div className="modal-header">
              <span className="modal-title">{parsed ? 'Parse & Add Candidates' : 'Upload Resumes'}</span>
              <button className="modal-close" onClick={closeImport} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="modal-body">
              {!parsed ? (
                <>
                  <div className="review-banner">
                    <Loader2 size={16} className={parsing ? 'spin' : ''} color="#9a6a00" />
                    <span>
                      <strong>{parsing ? 'Parsing resumes...' : 'No resumes selected.'}</strong>
                      {resumeFiles.length ? ` ${resumeFiles.length} file${resumeFiles.length === 1 ? '' : 's'} selected.` : ' Choose PDF, DOC, or DOCX files from Upload Resumes.'}
                    </span>
                  </div>
                  {importError && (
                    <div className="form-error" style={{ display:'block', marginTop:12 }} role="alert">
                      {importError}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="review-banner">
                    <AlertCircle size={16} color="#9a6a00" />
                    <span>
                      <strong>Resume {currentImportIndex + 1} of {importQueue.length}</strong>
                      {importQueue[currentImportIndex]?.file_name ? ` - ${importQueue[currentImportIndex].file_name}` : ''}
                      {reviewNotice ? ` - ${reviewNotice}` : ''}
                    </span>
                  </div>
                  {importError && (
                    <div className="form-error" style={{ display:'block', marginBottom:12 }} role="alert">
                      {importError}
                    </div>
                  )}
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
              {/* Show error in footer so it is always visible without scrolling */}
              {importError && parsed && (
                <div className="form-error" style={{ display: 'block', flex: '1 1 100%', marginBottom: 0 }} role="alert">
                  {importError}
                </div>
              )}
              <button className="btn-secondary" onClick={cancelRemainingResumes}>Cancel Remaining</button>
              {parsed && (
                <>
                <button className="btn-secondary" onClick={skipCurrentResume} disabled={saving}>Skip this resume</button>
                <button className="btn-primary" onClick={handleSaveParsed} id="save-parsed-candidate-btn" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Candidate'}
                </button>
                </>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {candidateDuplicate && createPortal((
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCandidateDuplicate(null)}>
          <div className="modal-card" ref={duplicateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Duplicate Candidate">
            <div className="modal-header">
              <span className="modal-title">Duplicate Candidate</span>
              <button className="modal-close" onClick={() => setCandidateDuplicate(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="review-banner">
                <AlertCircle size={16} />
                A candidate with the same name and email already exists.
              </div>
              <div className="duplicate-compare-grid">
                <div className="duplicate-compare-card">
                  <div className="form-section-title">Existing Candidate</div>
                  <div className="name-text">{candidateDuplicate.existing?.full_name || '-'}</div>
                  <div className="sub-text">{candidateDuplicate.existing?.email || '-'}</div>
                  <div className="sub-text">{candidateDuplicate.existing?.mobile_number || '-'}</div>
                </div>
                <div className="duplicate-compare-card">
                  <div className="form-section-title">New Candidate</div>
                  <div className="name-text">{candidateDuplicate.candidate?.name || '-'}</div>
                  <div className="sub-text">{candidateDuplicate.candidate?.email || '-'}</div>
                  <div className="sub-text">{candidateDuplicate.candidate?.mobile || '-'}</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => resolveCandidateDuplicate('add_duplicate')} disabled={saving}>Add Duplicate Entry</button>
              <button className="btn-primary" onClick={() => resolveCandidateDuplicate('update_current')} disabled={saving}>Update Current Entry</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
