import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Upload, X, Users, ChevronDown, AlertCircle, FileText, Search, Loader2 } from 'lucide-react'
import '../styles/Shared.css'
import { supabase } from '../services/supabaseClient'

/* ====== Static reference data ====== */
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
  noticePeriod:'', openToRelocate:false,
  client:'', clientId:'', newClientName:'', job:'', clientPhone:'', status:'Interested',
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
    experience_years: f.exp,
    notice_period: f.noticePeriod,
    open_to_relocate: Boolean(f.openToRelocate),
    skills: f.skills,
    education: f.education,
    client_name: f.client,
    job_title: f.job,
    client_id: f.clientId || (matchingClient ? matchingClient.id : undefined),
    job_id: matchingJob ? matchingJob.id : undefined,
    status: f.status,
    current_salary: f.salary,
    expected_salary: f.expectedSalary,
    cv_link: f.cvLink,
    linkedin_url: f.linkedinUrl,
    notes: f.notes,
    consultant_name: f.consultantName || consultantName || '',
    source: f.source,
  }
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState([])
  const fileInputRef = useRef(null)
  const candidateModalBodyRef = useRef(null)
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
  const findClientByName = (name) => dbClients.find(c => normalizeText(clientName(c)) === normalizeText(name))
  const findClientByInput = (value) => dbClients.find(c => c.id === value) || findClientByName(value)
  const clientDisplayIdForForm = (candidate) => {
    const client = dbClients.find(c => c.id === candidate.clientId) || findClientByName(candidate.client)
    return client?.client_display_id || ''
  }

  const createClientFromCandidate = async (candidate) => {
    const name = String(candidate.newClientName || candidate.client || '').replace(/\s+/g, ' ').trim()
    if (!name) throw new Error('Client is required.')
    const existing = findClientByName(name)
    if (existing) return existing

    const response = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        client_name: name,
        mobile: candidate.clientPhone || 'N/A',
        phone: candidate.clientPhone || 'N/A',
        status: 'Not Converted',
        consultant_name: candidate.consultantName || activeConsultantName || ''
      })
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 409 && payload.existing) return payload.existing
    if (!response.ok) throw new Error(payload.error || 'Unable to create client.')
    setDbClients(clients => clients.some(c => c.id === payload.id) ? clients : [...clients, payload])
    return payload
  }

  const ensureCandidateClient = async (candidate) => {
    if (candidate.clientId) return candidate
    if (candidate.client === '__new_client__') {
      const client = await createClientFromCandidate(candidate)
      return { ...candidate, clientId: client.id, client: client.name || client.client_name || candidate.newClientName }
    }
    const client = findClientByName(candidate.client)
    return client ? { ...candidate, clientId: client.id, client: client.name || client.client_name } : candidate
  }

  const filtered = candidates

  const mobileGroups = {}
  filtered.forEach(c => {
    const name = normalizeCandidateGroupName(c.name)
    const email = normalizeCandidateGroupEmail(c.email)
    const key = name && email ? `${name}|${email}` : c.associationId || c.id
    if (!mobileGroups[key]) mobileGroups[key] = []
    mobileGroups[key].push(c)
  })

  const visibleCandidates = []
  let candidateGroupSerial = 0
  Object.entries(mobileGroups).forEach(([mobile, rows]) => {
    candidateGroupSerial += 1
    const isGroup = rows.length >= 2
    const visibleRows = isGroup && collapsed[mobile] ? rows.slice(0, 1) : rows
    visibleRows.forEach((candidate, index) => {
      visibleCandidates.push({
        candidate,
        mobile,
        groupSerial: candidateGroupSerial,
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
      const isNewClient = value === 'Other / Add New Client' || value === '__new_client__'
      const matchingClient = findClientByInput(value)
      setForm(f => ({
        ...f,
        client: isNewClient ? '__new_client__' : (matchingClient ? clientName(matchingClient) : value),
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
    if (f.client === '__new_client__' && !String(f.newClientName || '').trim()) e.client = 'Client is required'
    return e
  }

  const openAddModal = () => { setForm({ ...EMPTY_CAND, skills: [], consultantName: activeConsultantName }); setEditing(false); setErrors({}); setSkillInput(''); setAddOpen(true) }

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
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

  const fieldValue = (extracted, key, fallback = '') => extracted?.[key]?.value ?? fallback

  const mapParsedResponseToForm = (payload) => {
    const extracted = payload.extracted || {}
    const ai = payload.ai_extracted || null
    const parsedClient = ai?.client || ai?.clientName || fieldValue(extracted, 'client_name') || fieldValue(extracted, 'client') || ''
    const matchedClient = findClientByName(parsedClient)
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
      client: matchedClient ? clientName(matchedClient) : (parsedClient ? '__new_client__' : ''),
      clientId: matchedClient?.id || '',
      newClientName: matchedClient ? '' : parsedClient,
      clientPhone: matchedClient?.phone || '',
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
      notifyAiQuota(err.message)
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
      await loadCandidates(page, { showLoading: false })
    } catch (err) {
      if (err.duplicate) {
        setCandidateDuplicate({ source: 'resume', candidate: { ...parsedForm, source: 'resume' }, existing: err.duplicate.existing })
        return
      }
      setImportError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resolveCandidateDuplicate = async (duplicateAction) => {
    if (!candidateDuplicate) return

    setSaving(true)
    try {
      await saveCandidateToApi(candidateDuplicate.candidate, { duplicateAction })
      setCandidateDuplicate(null)
      setAddOpen(false)
      setEditing(false)
      closeImport()
      await loadCandidates(page, { showLoading: false })
    } catch (err) {
      const message = err.message || 'Unable to resolve duplicate candidate.'
      if (candidateDuplicate.source === 'resume') setImportError(message)
      else setErrors({ form: message })
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
      const isNewClient = value === 'Other / Add New Client' || value === '__new_client__'
      const matchingClient = findClientByInput(value)
      setParsedForm(f => ({
        ...f,
        client: isNewClient ? '__new_client__' : (matchingClient ? clientName(matchingClient) : value),
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
    const visibleClientValue = f.client === '__new_client__' ? '' : f.client
    const matchingClients = dbClients
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
    const selectNewClient = () => {
      setF(prev => ({
        ...prev,
        client: '__new_client__',
        clientId: '',
        clientPhone: '',
        job: ''
      }))
    }
    const handleLocalChange = onChange || ((e) => {
      const { name, value, type, checked } = e.target
      const nextValue = type === 'checkbox' ? checked : value
      if (name === 'client') {
        const isNewClient = value === 'Other / Add New Client' || value === '__new_client__'
        const matchedClient = findClientByInput(value)
        setF(prev => ({
          ...prev,
          client: isNewClient ? '__new_client__' : (matchedClient ? clientName(matchedClient) : value),
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
        {f.candidateDisplayId && (
          <div className="form-group">
            <label className="form-label">Candidate ID</label>
            <input value={f.candidateDisplayId} className="form-control" disabled readOnly />
          </div>
        )}
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
                <button type="button" key={client.id} onMouseDown={(event) => { event.preventDefault(); setClientValue(clientName(client)) }}>
                  <span>{clientName(client)}</span>
                  <small>{client.client_display_id || ''}</small>
                </button>
              ))}
              <button type="button" onMouseDown={(event) => { event.preventDefault(); selectNewClient() }}>
                <span>Other / Add New Client</span>
              </button>
            </div>
          </div>
          {errs?.client && <span className="form-error">{errs.client}</span>}
        </div>

        {f.client === '__new_client__' && (
          <div className="form-group">
            <label className="form-label">New Client Name</label>
            <input name="newClientName" value={f.newClientName || ''} onChange={handleLocalChange} className="form-control" />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Client ID</label>
          <input value={clientDisplayIdForForm(f)} placeholder="Auto-filled after selecting client" className="form-control" readOnly />
        </div>

        <div className="form-group">
          <label className="form-label">Job</label>
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
  const renderCandidateCell = ({ key }, c, groupMeta) => {
    const { mobile, groupSerial, isGroup, groupSize, groupIndex } = groupMeta

    switch (key) {
      case 'sno':
        return <td key={key}>{(page - 1) * pageSize + groupSerial}</td>
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
      case 'salary':
        return <td key={key} style={{ fontWeight:600 }}>{fmt(c.salary)}</td>
      case 'location':
        return <td key={key}>{c.location || c.city || '-'}</td>
      case 'notice':
        return <td key={key}>{c.noticePeriod !== '' && c.noticePeriod !== null ? c.noticePeriod : '-'}</td>
      case 'expectedSalary':
        return <td key={key} style={{ fontWeight:600 }}>{fmt(c.expectedSalary)}</td>
      case 'relocate':
        return <td key={key}>{c.openToRelocate ? 'Yes' : 'No'}</td>
      case 'comments':
        return <td key={key} className="cell-ellipsis">{c.notes || '-'}</td>
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

      <div className="candidate-columns-toolbar">
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
        <span className="filter-label">Job</span>
        <select className="filter-select" value={filterJob}
          onChange={e => { setFilterJob(e.target.value); setPage(1) }} id="filter-candidate-job">
          <option value="All">All Jobs</option>
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
                {visibleCandidates.map(({ candidate: c, mobile, groupSerial, isGroup, groupSize, groupIndex, isLastInGroup }) => {
                  const rowClass = isGroup
                    ? `candidate-mobile-group-row${groupIndex === 0 ? ' group-first' : ' group-child'}${isLastInGroup ? ' group-last' : ''}`
                    : ''
                  return (
                    <tr key={c.associationId || c.id} className={rowClass}>
                      {activeColumns.map(column => renderCandidateCell(column, c, { mobile, groupSerial, isGroup, groupSize, groupIndex }))}
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

      {selectedCandidate && (
        <div className="candidate-drawer-overlay" onClick={e => e.target === e.currentTarget && setSelectedCandidate(null)}>
          <aside className="candidate-drawer" style={detailPosition ? { top: detailPosition.top } : undefined} aria-label="Candidate details">
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
                ['Open to Relocate', selectedCandidate.openToRelocate ? 'Yes' : 'No'],
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
              <div className="candidate-detail-section-title">Client / Job Associations</div>
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
      )}

      {/* ===== Add Candidate Modal ===== */}
      {addOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setAddOpen(false)}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Add Candidate">
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

      {candidateDuplicate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCandidateDuplicate(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Duplicate Candidate">
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
      )}
    </div>
  )
}
