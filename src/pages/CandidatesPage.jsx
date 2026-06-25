import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, X, Users, ChevronDown, AlertCircle, FileText, Search, Loader2, Eye, Pencil, Lock } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess, isColumnHidden, isColumnDisabled } from '../hooks/useAdminAccess'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import RecordLockButton from '../components/admin/RecordLockButton'
import NewActionDropdown from '../components/NewActionDropdown'
import PaginationBar from '../components/PaginationBar'
import FloatingDropdown from '../components/FloatingDropdown'
import TablePopover from '../components/TablePopover'
import CompactPagination from '../components/CompactPagination'
import FormattedDateInput from '../components/FormattedDateInput'
import '../styles/Shared.css'
import { supabase } from '../services/supabaseClient'
import { logCandidateCvOpen, normalizeExternalUrl, openExternalUrl, openProtectedDocumentPath, resolveCandidateCvHref } from '../utils/candidateUtils'
import { CANDIDATE_TABLE_COLUMNS, DEFAULT_CANDIDATE_COLUMN_KEYS, mergeCandidateColumnPreference } from '../utils/candidateTableColumns'
import { CANDIDATE_STATUS_BADGE_MAP, CANDIDATE_STATUS_OPTIONS } from '../utils/candidateStatuses'
import { normalizeMandateStatus } from '../utils/mandateStatuses'
import { highlightText, keywordFilters } from '../utils/aiFilterUi'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { parseDashboardFiltersFromUrl } from '../utils/dashboardDrilldown'

/* ====== Static reference data ====== */
const STATUS_OPTIONS = CANDIDATE_STATUS_OPTIONS
const RELOCATE_OPTIONS = ['', 'Yes', 'No']
const MAX_RESUME_FILES = 10
const MAX_RESUME_SIZE = 10 * 1024 * 1024
const ACCEPTED_RESUME_EXTENSIONS = ['pdf', 'doc', 'docx']
const consumedRouteActions = new Set()

const STATUS_BADGE_MAP = CANDIDATE_STATUS_BADGE_MAP
const CANDIDATES_TABLE_COLUMNS_PREFERENCE_KEY = 'candidatesTableColumns'

const fmt = (n) => n ? `Rs. ${Number(n).toLocaleString('en-IN')}` : '-'
const initials = (name) => name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()
const avatarPalette = [
  ['#7c3aed', '#a855f7'],
  ['#2563eb', '#3b82f6'],
  ['#059669', '#10b981'],
  ['#ea580c', '#f97316'],
  ['#db2777', '#ec4899'],
  ['#4f46e5', '#6366f1'],
  ['#65a30d', '#84cc16'],
  ['#0891b2', '#06b6d4'],
]
const normalizeCandidateGroupName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const normalizeCandidateGroupEmail = (value) => String(value || '').trim().toLowerCase()
const normalizeCandidateGroupMobile = (value) => String(value || '').replace(/\D/g, '').trim()
const isMeaningfulDuplicateValue = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  return Boolean(text && text !== '-' && text !== 'na' && text !== 'n/a' && text !== 'none')
}
const duplicateIdentityTokens = (candidate) => {
  const tokens = []
  const mobile = normalizeCandidateGroupMobile(candidate.mobile)
  const email = normalizeCandidateGroupEmail(candidate.email)
  if (isMeaningfulDuplicateValue(mobile)) tokens.push(`m:${mobile}`)
  if (isMeaningfulDuplicateValue(email)) tokens.push(`e:${email}`)
  return tokens
}
const formatDate = formatDateDDMMYYYY

const notifyAiQuota = (message) => {
  if (message === 'AI quota reached') {
    window.dispatchEvent(new CustomEvent('ai-quota-reached', { detail: 'AI quota reached' }))
  }
}
const formatMonth = formatDateDDMMYYYY
const avatarColorsFor = (value) => {
  const text = String(value || '').trim()
  const hash = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [start, end] = avatarPalette[hash % avatarPalette.length]
  return { background: `linear-gradient(135deg, ${start}, ${end})`, color: '#fff' }
}
const formatCandidateCtc = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return '-'
  const hasRupee = text.includes('₹')
  const hasLpa = /lpa/i.test(text)
  const base = hasRupee ? text : `₹${text}`
  return hasLpa ? base : `${base} LPA`
}
const getNoticeMeta = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return null
  const numeric = Number(text.replace(/[^\d.]/g, ''))
  const label = /days/i.test(text) ? text : `${text} Days`
  if (!Number.isFinite(numeric)) return { label, tone: 'mid' }
  if (numeric <= 30) return { label, tone: 'low' }
  if (numeric < 60) return { label, tone: 'mid' }
  return { label, tone: 'high' }
}
const formatLocationRegion = (location, region) => {
  const parts = [location, region].map(value => String(value || '').trim()).filter(Boolean)
  return parts.join(', ')
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

const SORT_OPTIONS = [
  { field: 'candidate_id', label: 'Candidate ID', toggle: true },
  { field: 'candidate_name', label: 'Alphabetic Order', toggle: true },
  { field: 'consultant', label: 'Consultant', toggle: false }
]
const CANDIDATE_AI_SEARCH_FIELDS = ['candidate_id', 'candidate_name', 'consultant', 'email', 'mobile', 'designation', 'organisation', 'experience', 'skills', 'client_id', 'client_name', 'role', 'date', 'current_ctc', 'expected_ctc', 'current_location', 'notice_period', 'open_to_relocate', 'comments', 'status', 'month', 'linkedin']
const CANDIDATE_PERMISSION_BY_COLUMN = {
  candidateDisplayId: 'candidate_display_id',
  date: 'created_at',
  consultant: 'consultant_name',
  client: 'client_name',
  clientId: 'client_id',
  jobId: 'job_id',
  job: 'job_title',
  name: 'full_name',
  organisation: 'current_organisation',
  designation: 'current_designation',
  mobile: 'mobile_number',
  email: 'email',
  experience: 'experience_years',
  skills: 'skills',
  salary: 'current_salary',
  notice: 'notice_period',
  expectedSalary: 'expected_salary',
  relocate: 'open_to_relocate',
  comments: 'notes',
  linkedin: 'linkedin_url',
  status: 'status',
  offeredCtc: 'current_salary',
  dateOfJoining: 'created_at',
  cv: 'cv_link',
  month: 'created_at_month'
}
const CANDIDATE_PERMISSION_BY_AI_FIELD = {
  candidate_id: 'candidate_display_id',
  candidate_name: 'full_name',
  consultant: 'consultant_name',
  email: 'email',
  mobile: 'mobile_number',
  designation: 'current_designation',
  organisation: 'current_organisation',
  experience: 'experience_years',
  skills: 'skills',
  client_id: 'client_id',
  client_name: 'client_name',
  role: 'job_title',
  date: 'created_at',
  current_ctc: 'current_salary',
  expected_ctc: 'expected_salary',
  current_location: 'location',
  notice_period: 'notice_period',
  open_to_relocate: 'open_to_relocate',
  comments: 'notes',
  status: 'status',
  month: 'created_at_month',
  linkedin: 'linkedin_url'
}

/* ====== Empty forms ====== */
const EMPTY_CAND = {
  name:'', email:'', mobile:'', designation:'', city:'', state:'',
  location:'', currentCompany:'', currentOrganisation:'', exp:'', salary:'', expectedSalary:'', skills:[], education:'',
  noticePeriod:'', openToRelocate:'',
  offeredCtc:'', dateOfJoining:'',
  client:'', clientId:'', newClientName:'', job:'', jobId:'', jobDisplayId:'', status:'',
  cvLink:'', cvFile:null, cvFileHash:'', cvStoragePath:'', cvOriginalName:'', cvMimetype:'', linkedinUrl:'', notes:'', consultantName:'', consultantUserId:'', candidateId:'', candidateDisplayId:'', associationId:'',
  sourceFile:null, duplicateCvAlreadyChecked:false, duplicateCvResult:null,
}

const apiCandidateToUi = (row) => ({
  id: row.association_id || row.id,
  associationId: row.association_id || row.id,
  candidateId: row.candidate_id,
  candidateDisplayId: row.candidate_display_id || '',
  clientId: row.client_id || '',
  clientDisplayId: row.client_display_id || '',
  jobId: row.job_id || '',
  jobDisplayId: row.job_display_id || '',
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
  offeredCtc: row.offered_ctc ?? '',
  dateOfJoining: row.date_of_joining || '',
  skills: row.skills || [],
  education: row.education || '',
  client: row.client_name || '',
  job: row.job_title || '',
  status: row.status || '',
  cvLink: row.cv_link || row.resume_url || '',
  cvFileHash: row.cv_file_hash || '',
  cvStoragePath: row.cv_storage_path || row.resume_path || '',
  cvOriginalName: row.cv_original_name || row.file_name || '',
  cvMimetype: row.cv_mimetype || '',
  linkedinUrl: row.linkedin_url || '',
  notes: row.notes || '',
  consultant: row.consultant_name || '',
  consultantName: row.consultant_name || '',
  consultantUserId: row.consultant_user_id || '',
  isLocked: Boolean(row.is_locked),
  createdAt: row.created_at || '',
})

const cleanNumberForApi = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return ''
  return text.replace(/^rs\.?\s*/i, '').replace(/^₹\s*/i, '').replace(/\s*lpa$/i, '').trim()
}
const normalizeCtcInputValue = (value) => cleanNumberForApi(value)

const getCanonicalClients = (clients) => {
  const map = new Map()
  clients.forEach(client => {
    const name = client?.name || client?.client_name || ''
    const key = (client?.client_display_id || name).toString().trim().toLowerCase()
    if (!key || map.has(key)) return
    map.set(key, client)
  })
  return [...map.values()].sort((a, b) => (a?.name || a?.client_name || '').localeCompare(b?.name || b?.client_name || '', undefined, { sensitivity: 'base' }))
}

const getUniqueSortedJobs = (jobs, clientId = '', search = '') => {
  const query = String(search || '').trim().toLowerCase()
  return jobs
    .filter(job => !clientId || job.client_id === clientId)
    .filter(job => normalizeMandateStatus(job.mandate_status || job.status || job.priority) !== 'Completed')
    .filter(job => {
      const name = (job?.title || job?.role || '').trim()
      if (!name) return false
      const text = `${name} ${job.job_display_id || ''}`.toLowerCase()
      return !query || text.includes(query)
    })
    .sort((a, b) => {
      const byName = (a?.title || a?.role || '').localeCompare(b?.title || b?.role || '', undefined, { sensitivity: 'base' })
      if (byName !== 0) return byName
      return String(a?.job_display_id || '').localeCompare(String(b?.job_display_id || ''), undefined, { sensitivity: 'base' })
    })
}

const uiCandidateToApi = (f, consultantName = '', dbClients = [], dbJobs = []) => {
  const matchingClient = dbClients.find(c => c.id === f.clientId) || dbClients.find(c => c.name === f.client)
  const matchingJob = dbJobs.find(j => j.id === f.jobId) || dbJobs.find(j => (j.title || j.role) === f.job && (matchingClient ? j.client_id === matchingClient.id : true))
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
    job_id: f.jobId || (matchingJob ? matchingJob.id : undefined),
    status: f.status,
    current_salary: cleanNumberForApi(f.salary),
    expected_salary: cleanNumberForApi(f.expectedSalary),
    offered_ctc: f.status === 'Hired' ? cleanNumberForApi(f.offeredCtc) : '',
    date_of_joining: f.status === 'Hired' ? f.dateOfJoining || '' : '',
    cv_link: f.cvLink,
    cv_file_hash: f.cvFileHash || undefined,
    cv_storage_path: f.cvStoragePath || undefined,
    cv_original_name: f.cvOriginalName || undefined,
    cv_mimetype: f.cvMimetype || undefined,
    linkedin_url: f.linkedinUrl,
    notes: f.notes,
    consultant_name: f.consultantName || consultantName || '',
    consultant_user_id: f.consultantUserId || '',
    source: f.source,
  }
}

export default function CandidatesPage() {
  const { loadProfile } = useAuth()
  const { isAdmin, permissions } = useAdminAccess()
  const location = useLocation()
  const navigate = useNavigate()
  const dashboardFilters = useMemo(() => parseDashboardFiltersFromUrl(location.search), [location.search])
  const [candidates, setCandidates] = useState([])
  const fileInputRef = useRef(null)
  const candidateModalRef = useRef(null)
  const candidateModalBodyRef = useRef(null)
  const candidateDetailRef = useRef(null)
  const importModalRef = useRef(null)
  const duplicateModalRef = useRef(null)
  const cvLinkCheckTimerRef = useRef(null)
  const importCancelledRef = useRef(false)
  const pendingRealtimeRefreshRef = useRef(false)
  const assignmentSourceRef = useRef(null)
  const [apiError, setApiError] = useState('')
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [candidateDuplicate, setCandidateDuplicate] = useState(null)
  const [duplicateBypass, setDuplicateBypass] = useState(null)
  const [duplicateMoreOpen, setDuplicateMoreOpen] = useState(false)
  const [cvDuplicateNotice, setCvDuplicateNotice] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCandidates, setTotalCandidates] = useState(0)
  const [openingDocument, setOpeningDocument] = useState('')
  const [activeConsultantName, setActiveConsultantName] = useState('-')

  // Filters
  const [filterJob, setFilterJob]       = useState('All')
  const [aiFilterText, setAiFilterText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiAppliedPrompt, setAiAppliedPrompt] = useState('')
  const [aiFilterLoading, setAiFilterLoading] = useState(false)
  const [aiFilterError, setAiFilterError] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnsAnchor, setColumnsAnchor] = useState(null)
  const [sortAnchor, setSortAnchor] = useState(null)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)

  const [dbClients, setDbClients] = useState([])
  const [dbJobs, setDbJobs] = useState([])
  const [consultantOptions, setConsultantOptions] = useState([])
  const [consultantSearch, setConsultantSearch] = useState('')
  const [consultantOpen, setConsultantOpen] = useState(false)

  const refreshOptionData = useCallback(async () => {
    const [clientsRes, jobsRes, usersRes] = await Promise.all([
      fetch('/api/clients?all=true'),
      fetch('/api/jobs?all=true'),
      fetch('/api/user-profiles/options')
    ])
    const clientsData = await clientsRes.json().catch(() => ({}))
    const jobsData = await jobsRes.json().catch(() => ({}))
    const usersData = await usersRes.json().catch(() => ({}))
    if (clientsRes.ok) setDbClients(clientsData.data || [])
    if (jobsRes.ok) setDbJobs((jobsData.data || []).sort((a, b) => (a?.title || a?.role || '').localeCompare(b?.title || b?.role || '', undefined, { sensitivity: 'base' })))
    if (usersRes.ok) setConsultantOptions((Array.isArray(usersData.data) ? usersData.data : [])
      .map(user => ({ id: user.id || user.user_id || '', name: String(user.name || user.display_name || '').trim(), email: user.email || '' }))
      .filter(user => user.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(refreshOptionData, 0)
    return () => window.clearTimeout(timer)
  }, [refreshOptionData])

  const consultantByName = useMemo(() => new Map(consultantOptions.map(user => [user.name, user])), [consultantOptions])
  const matchingConsultants = useMemo(() => {
    const query = consultantSearch.trim().toLowerCase()
    return consultantOptions.filter(user => !query || user.name.toLowerCase().includes(query))
  }, [consultantOptions, consultantSearch])

  const fetchConsultantOptions = useCallback(async () => {
    const res = await fetch('/api/user-profiles/options')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return []
    const users = (Array.isArray(data.data) ? data.data : [])
      .map(user => ({ id: user.id || user.user_id || '', name: String(user.name || user.display_name || '').trim(), email: user.email || '' }))
      .filter(user => user.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    setConsultantOptions(users)
    return users
  }, [])

  const getFreshActiveConsultantName = useCallback(async () => {
    const profile = await loadProfile({ force: true }).catch(() => null)
    const nextName = String(profile?.name || profile?.display_name || '').trim()
    setActiveConsultantName(nextName || '-')
    return { name: nextName, userId: profile?.user_id || '' }
  }, [loadProfile])

  useEffect(() => {
    let cancelled = false
    const syncConsultant = async () => {
      const profile = await getFreshActiveConsultantName()
      if (cancelled) return
      setActiveConsultantName(profile.name || '-')
    }
    syncConsultant()
    return () => { cancelled = true }
  }, [getFreshActiveConsultantName])

  useEffect(() => {
    window.addEventListener('ats:clients-updated', refreshOptionData)
    window.addEventListener('ats:jobs-updated', refreshOptionData)
    return () => {
      window.removeEventListener('ats:clients-updated', refreshOptionData)
      window.removeEventListener('ats:jobs-updated', refreshOptionData)
    }
  }, [refreshOptionData])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null
        const userId = session?.user?.id || getCurrentUser()?.id || getCurrentUser()?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/${CANDIDATES_TABLE_COLUMNS_PREFERENCE_KEY}?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = mergeCandidateColumnPreference(payload.data?.value)

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

  // Add Candidate Modal
  const [addOpen, setAddOpen]   = useState(false)
  const [form, setForm]         = useState(EMPTY_CAND)
  const [errors, setErrors]     = useState({})
  const [skillInput, setSkillInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [assigningAnother, setAssigningAnother] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [detailPosition, setDetailPosition] = useState(null)
  const [candidateAssociations, setCandidateAssociations] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [expandedCells, setExpandedCells] = useState({})
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [jobSuggestionsOpen, setJobSuggestionsOpen] = useState(false)

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
      if (dashboardFilters?.role) params.set('job_title', dashboardFilters.role)
      if (dashboardFilters?.clientName) params.set('client_name', dashboardFilters.clientName)
      if (dashboardFilters?.consultant) params.set('consultant', dashboardFilters.consultant)
      if (dashboardFilters?.status) params.set('status', dashboardFilters.status)
      if (dashboardFilters?.period) params.set('period', dashboardFilters.period)
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
      if (import.meta.env.DEV && aiFilters) console.debug('Candidates AI filter', { filters: aiFilters, matched: Number(payload.total) || 0 })
      setApiError('')
    } catch (err) {
      setApiError(err.message)
      setCandidates([])
      setTotalCandidates(0)
    } finally {
      if (showLoading) setLoadingCandidates(false)
    }
  }, [aiAppliedPrompt, aiFilters, dashboardFilters, filterJob, page, pageSize, sortDirection, sortField])

  const openDocument = useCallback(async (key, path) => {
    setOpeningDocument(key)
    try {
      await openProtectedDocumentPath('cv', path, {
        missingMessage: 'CV is missing or needs to be reuploaded',
        notFoundMessage: 'Document file not found. Please re-upload the CV.'
      })
    } finally {
      setOpeningDocument('')
    }
  }, [])

  const scrollImportToTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      importModalRef.current?.querySelector('.modal-body')?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCandidates(page)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadCandidates, page])

  useEffect(() => {
    const refreshCandidates = () => { loadCandidates(page, { showLoading: false }) }
    window.addEventListener('ats:candidates-updated', refreshCandidates)
    return () => window.removeEventListener('ats:candidates-updated', refreshCandidates)
  }, [loadCandidates, page])

  const refreshCandidatesRealtime = useCallback(() => {
    if (addOpen || importOpen || candidateDuplicate || editing) {
      pendingRealtimeRefreshRef.current = true
      return
    }
    loadCandidates(page, { showLoading: false })
  }, [addOpen, candidateDuplicate, editing, importOpen, loadCandidates, page])

  useEffect(() => {
    if ((addOpen || importOpen || candidateDuplicate || editing) || !pendingRealtimeRefreshRef.current) return
    pendingRealtimeRefreshRef.current = false
    loadCandidates(page, { showLoading: false })
  }, [addOpen, candidateDuplicate, editing, importOpen, loadCandidates, page])

  useRealtimeRefresh({
    channelName: 'realtime:candidates-page',
    tables: ['candidates', 'candidate_associations', 'clients', 'jobs'],
    onChange: () => {
      refreshOptionData()
      refreshCandidatesRealtime()
    }
  })

  const saveCandidateToApi = async (candidate, { update = false, duplicateAction = '' } = {}) => {
    const prepared = await ensureCandidateClient(candidate)
    const body = uiCandidateToApi(prepared, activeConsultantName, dbClients, dbJobs)
    if (duplicateAction) body.duplicate_action = duplicateAction
    const formBody = new FormData()
    Object.entries(body).forEach(([key, value]) => {
      if (value === undefined) return
      if (value === '') return
      formBody.append(key, Array.isArray(value) ? JSON.stringify(value) : value ?? '')
    })
    const cvFile = candidate.cvFile || (candidate.source === 'resume' ? candidate.sourceFile : null)
    if (cvFile) formBody.append('cv_file', cvFile)

    const response = await fetch(update ? `/api/candidates/${candidate.associationId}` : '/api/candidates', {
      method: update ? 'PATCH' : 'POST',
      body: formBody
    })
    const payload = await response.json().catch(() => ({}))

    if (response.status === 409 && payload.duplicate) {
      const error = new Error(payload.error || 'Duplicate candidate found.')
      error.duplicate = payload
      error.exactAssociation = Boolean(payload.exactAssociation)
      throw error
    }

    if (!response.ok) {
      const message = payload.errors ? Object.values(payload.errors)[0] : payload.error
      throw new Error(message || 'Unable to save candidate.')
    }

    return apiCandidateToUi(payload)
  }

  const toggleTablePopover = (type, id, element) => {
    if (!element || !id) return
    const anchorRect = element.getBoundingClientRect()
    setTablePopover(current => current?.type === type && current.id === id ? null : { type, id, anchorRect })
  }

  const updateCandidateStatus = async (candidate, status) => {
    const associationId = candidate.associationId || candidate.id
    if (!associationId) return
    const previous = candidates
    const nextStatus = status || '-'
    setApiError('')
    setCandidates(current => current.map(row => (row.associationId || row.id) === associationId ? { ...row, status: nextStatus } : row))
    setStatusSaving(current => ({ ...current, [associationId]: true }))
    setTablePopover(null)
    try {
      const response = await fetch(`/api/candidates/${associationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ association_id: associationId, status: nextStatus })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || Object.values(payload.errors || {})[0] || 'Unable to update candidate status.')
      const updated = apiCandidateToUi(payload)
      setCandidates(current => current.map(row => (row.associationId || row.id) === associationId ? updated : row))
    } catch (err) {
      setCandidates(previous)
      setApiError(err.message)
    } finally {
      setStatusSaving(current => ({ ...current, [associationId]: false }))
    }
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
  const jobName = (job) => job?.title || job?.role || ''
  const uniqueJobFilterOptions = useMemo(() => {
    const names = new Set()
    dbJobs.forEach(job => {
      const name = jobName(job).trim()
      if (name) names.add(name)
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [dbJobs])
  const jobDisplayIdForForm = (candidate) => {
    const job = dbJobs.find(j => j.id === candidate.jobId) || dbJobs.find(j => jobName(j) === candidate.job && (!candidate.clientId || j.client_id === candidate.clientId))
    return job?.job_display_id || candidate.jobDisplayId || ''
  }

  const ensureCandidateClient = async (candidate) => {
    if (candidate.clientId) return candidate
    const client = findClientByName(candidate.client)
    return client ? { ...candidate, clientId: client.id, client: client.name || client.client_name } : candidate
  }

  const filtered = candidates

  const mobileGroups = {}
  const parents = filtered.map((_, index) => index)
  const firstTokenIndex = new Map()
  const find = (index) => {
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const next = parents[index]
      parents[index] = root
      index = next
    }
    return root
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parents[rootB] = rootA
  }

  filtered.forEach((candidate, index) => {
    const tokens = duplicateIdentityTokens(candidate)
    tokens.forEach((token) => {
      if (firstTokenIndex.has(token)) union(index, firstTokenIndex.get(token))
      else firstTokenIndex.set(token, index)
    })
  })

  filtered.forEach((candidate, index) => {
    const tokens = duplicateIdentityTokens(candidate)
    const key = tokens.length ? `group-${find(index)}` : `single-${candidate.associationId || candidate.id || index}`
    if (!mobileGroups[key]) mobileGroups[key] = []
    mobileGroups[key].push(candidate)
  })

  const visibleCandidates = []
  Object.entries(mobileGroups).forEach(([mobile, rows]) => {
    const isGroup = rows.length >= 2
    const isExpanded = Boolean(collapsed[mobile])
    const visibleRows = isGroup && !isExpanded ? rows.slice(0, 1) : rows
    visibleRows.forEach((candidate, index) => {
      visibleCandidates.push({
        candidate,
        mobile,
        isGroup,
        isExpanded,
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
    setPage(1)
  }

  const clearAiFilter = () => {
    setAiFilterText('')
    setAiFilters(null)
    setAiAppliedPrompt('')
    setAiFilterError('')
    setPage(1)
  }

  const togglePendingColumn = (key) => {
    setPendingColumns(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    )
  }

  const allowedCandidateColumnKeys = () => CANDIDATE_TABLE_COLUMNS
    .filter(column => !isColumnHidden(permissions, 'candidates', CANDIDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))
    .map(column => column.key)
  const candidateFieldPermission = {
    name: 'full_name',
    email: 'email',
    mobile: 'mobile_number',
    designation: 'current_designation',
    currentOrganisation: 'current_organisation',
    location: 'location',
    exp: 'experience_years',
    noticePeriod: 'notice_period',
    status: 'status',
    salary: 'current_salary',
    expectedSalary: 'expected_salary',
    openToRelocate: 'open_to_relocate',
    offeredCtc: 'current_salary',
    dateOfJoining: 'created_at',
    linkedinUrl: 'linkedin_url',
    cvLink: 'cv_link',
    cvFile: 'cv_link',
    notes: 'notes',
    consultantName: 'consultant_name',
    skills: 'skills',
    education: 'education',
    client: 'client_name',
    clientId: 'client_id',
    job: 'job_title',
    jobId: 'job_id'
  }
  const isCandidateFieldHidden = (name) => isColumnHidden(permissions, 'candidates', candidateFieldPermission[name] || name, isAdmin)
  const isCandidateFieldDisabled = (name) => isColumnDisabled(permissions, 'candidates', candidateFieldPermission[name] || name, isAdmin)

  const proceedColumns = () => {
    const allowed = allowedCandidateColumnKeys()
    const next = (pendingColumns.length ? pendingColumns : allowed).filter(key => allowed.includes(key))
    setVisibleColumns(next.length ? next : allowed)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const currentUser = getCurrentUser()
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const allowed = allowedCandidateColumnKeys()
      const value = (pendingColumns.length ? pendingColumns : allowed).filter(key => allowed.includes(key))
      const response = await fetch(`/api/user-preferences/${CANDIDATES_TABLE_COLUMNS_PREFERENCE_KEY}`, {
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
    if (assigningAnother) {
      if (!f.clientId) e.client = 'Client is required'
      if (!f.jobId) e.job = 'Mandate is required'
    }
    return e
  }

  const fetchNextCandidateDisplayId = useCallback(async () => {
    const response = await fetch('/api/candidates/next-display-id')
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to load candidate ID')
    return payload.candidate_display_id || ''
  }, [])

  const openAddModal = useCallback(async () => {
    setConsultantSearch('')
    setConsultantOpen(false)
    setForm({ ...EMPTY_CAND, skills: [], candidateDisplayId: 'Loading...' })
    setEditing(false)
    setAssigningAnother(false)
    setErrors({})
    setDuplicateBypass(null)
    setSkillInput('')
    setAddOpen(true)

    const [profile, users] = await Promise.all([
      getFreshActiveConsultantName(),
      fetchConsultantOptions().catch(() => [])
    ])
    const consultantUser = users.find(user => user.id && user.id === profile.userId) || users.find(user => user.name === profile.name)
    setConsultantSearch(profile.name)
    setConsultantOpen(false)
    setForm(current => ({
      ...current,
      consultantName: profile.name,
      consultantUserId: consultantUser?.id || ''
    }))
    try {
      const candidateDisplayId = await fetchNextCandidateDisplayId()
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId } : current)
    } catch {
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId: '' } : current)
    }
  }, [fetchConsultantOptions, fetchNextCandidateDisplayId, getFreshActiveConsultantName])

  useEffect(() => {
    const action = location.state?.action
    if (!action) return
    const actionKey = `${location.key}:${action}`
    navigate(location.pathname, { replace: true, state: null })
    if (consumedRouteActions.has(actionKey)) return
    consumedRouteActions.add(actionKey)
    if (action === 'upload-resumes') {
      window.requestAnimationFrame(() => fileInputRef.current?.click())
    }
    if (action === 'add-candidate') openAddModal()
  }, [location.pathname, location.state?.action, navigate, openAddModal])

  const candidateToForm = (candidate) => {
    const matchedClient = dbClients.find(c => c.id === candidate.clientId) || findClientByName(candidate.client)
    return {
      ...EMPTY_CAND,
      ...candidate,
      consultantName: candidate.consultantName || candidate.consultant || '',
      consultantUserId: candidate.consultantUserId || candidate.consultant_user_id || '',
      associationId: candidate.associationId,
      candidateId: candidate.candidateId,
      clientId: candidate.clientId || matchedClient?.id || '',
      client: clientName(matchedClient) || candidate.client || '',
      currentOrganisation: candidate.currentOrganisation || candidate.currentCompany || '',
      skills: Array.isArray(candidate.skills) ? candidate.skills : []
    }
  }

  const openEditCandidate = (candidate) => {
    const sourceForm = candidateToForm(candidate)
    assignmentSourceRef.current = sourceForm
    setForm(sourceForm)
    setConsultantSearch(candidate.consultantName || candidate.consultant || '')
    setConsultantOpen(false)
    fetchConsultantOptions().catch(() => {})
    setEditing(true)
    setAssigningAnother(false)
    setErrors({})
    setDuplicateBypass(null)
    setSkillInput('')
    setSelectedCandidate(null)
    setAddOpen(true)
  }

  const openAssignAnother = async () => {
    const source = assignmentSourceRef.current || form
    setForm({
      ...EMPTY_CAND,
      ...source,
      id: '',
      associationId: '',
      candidateId: '',
      candidateDisplayId: 'Loading...',
      client: '',
      clientId: '',
      clientDisplayId: '',
      job: '',
      jobId: '',
      jobDisplayId: '',
      notes: '',
      cvFile: null,
      skills: Array.isArray(source.skills) ? [...source.skills] : []
    })
    setEditing(false)
    setAssigningAnother(true)
    setErrors({})
    setDuplicateBypass(null)
    setClientSuggestionsOpen(false)
    setJobSuggestionsOpen(false)
    try {
      const candidateDisplayId = await fetchNextCandidateDisplayId()
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId } : current)
    } catch {
      setForm(current => current.candidateDisplayId === 'Loading...' ? { ...current, candidateDisplayId: '' } : current)
    }
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
      setPage(1)
    } catch (err) {
      notifyAiQuota(err.message)
      setAiFilters(keywordFilters('candidates', prompt, CANDIDATE_AI_SEARCH_FIELDS.filter(field => !isColumnHidden(permissions, 'candidates', CANDIDATE_PERMISSION_BY_AI_FIELD[field], isAdmin))))
      setAiAppliedPrompt(prompt)
      setAiFilterError('')
      setPage(1)
    } finally {
      setAiFilterLoading(false)
    }
  }

  const handleSave = async () => {
    const e = validate(form)
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    try {
      const candidateToSave = assigningAnother
        ? { ...form, id: '', associationId: '', candidateId: '', cvFile: null }
        : form
      await saveCandidateToApi(candidateToSave, { update: editing && !assigningAnother, duplicateAction: assigningAnother ? 'add_duplicate' : (duplicateBypass?.source === 'manual' ? 'add_duplicate' : '') })
      setDuplicateBypass(null)
      setAddOpen(false)
      setEditing(false)
      setAssigningAnother(false)
      await loadCandidates(1, { showLoading: false })
      setPage(1)
      setForm(current => ({ ...current, candidateDisplayId: 'Loading...' }))
      fetchNextCandidateDisplayId()
        .then(candidateDisplayId => setForm(current => ({ ...current, candidateDisplayId })))
        .catch(() => setForm(current => ({ ...current, candidateDisplayId: '' })))
    } catch (err) {
      if (err.duplicate) {
        setCandidateDuplicate({ source: 'manual', candidate: form, existing: err.duplicate.existing, exactAssociation: err.exactAssociation, allowAddDuplicate: err.duplicate.allowAddDuplicate !== false, message: err.message })
        return
      }
      setErrors({ form: err.message })
    } finally {
      setSaving(false)
    }
  }

  const checkCvDuplicate = async ({ file, link, setF }) => {
    try {
      const body = new FormData()
      if (file) body.append('cv_file', file)
      else body.append('cv_link', link || '')
      const response = await fetch('/api/candidates/check-cv-duplicate', { method: 'POST', body })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      if (payload.duplicate) {
        if (payload.cv_link || payload.resume_url) {
          setF(current => ({ ...current, cvLink: payload.cv_link || payload.resume_url }))
        }
        setCvDuplicateNotice('CV already exists in the database.')
      }
    } catch {
      // Non-blocking pre-check; save still performs authoritative dedupe.
    }
  }

  const handleCvFileChange = (setF, file) => {
    setF(current => ({ ...current, cvFile: file || null, cvLink: file ? '' : current.cvLink, cvOriginalName: file?.name || current.cvOriginalName }))
    if (file) checkCvDuplicate({ file, setF })
  }

  const handleCvLinkChange = (setF, value) => {
    setF(current => ({ ...current, cvLink: value, cvFile: null }))
    window.clearTimeout(cvLinkCheckTimerRef.current)
    const link = String(value || '').trim()
    if (link) {
      cvLinkCheckTimerRef.current = window.setTimeout(() => checkCvDuplicate({ link, setF }), 450)
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

  const mapBulkResumeRowToForm = (row, consultantName = activeConsultantName, consultantUserId = '') => {
    const parsedClient = row.client_name || ''
    const matchedClient = findClientByName(parsedClient)
    return {
      ...EMPTY_CAND,
      consultantName,
      consultantUserId,
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
      linkedinUrl: row.linkedin_url || '',
      cvLink: row.cv_link || row.resume_url || '',
      cvFileHash: row.cv_file_hash || '',
      cvStoragePath: row.cv_storage_path || row.resume_path || '',
      cvOriginalName: row.cv_original_name || row.file_name || '',
      cvMimetype: row.cv_mimetype || '',
      sourceFile: row.sourceFile || null,
      duplicateCvAlreadyChecked: Boolean(row.duplicateCvAlreadyChecked),
      duplicateCvResult: row.duplicateCvResult || null,
      notes: row.summary || row.error || '',
      source: 'resume'
    }
  }

  const startResumeReview = async (rows) => {
    const candidateDisplayId = await fetchNextCandidateDisplayId().catch(() => '')
    const [profile, users] = await Promise.all([
      getFreshActiveConsultantName(),
      fetchConsultantOptions().catch(() => [])
    ])
    const consultantUser = users.find(user => user.id && user.id === profile.userId) || users.find(user => user.name === profile.name)
    setConsultantSearch(profile.name)
    setImportQueue(rows)
    setCurrentImportIndex(0)
    setParsedForm({ ...mapBulkResumeRowToForm(rows[0], profile.name, consultantUser?.id || ''), candidateDisplayId })
    setParsed(true)
    setReviewNotice(rows[0]?.error ? `Parsing warning: ${rows[0].error}` : '')
    if (rows[0]?.cv_duplicate) setCvDuplicateNotice('CV already exists in the database.')
    scrollImportToTop()
  }

  const handleBulkResumeFiles = async (files) => {
    const validationError = validateResumeFiles(files)
    setImportError(validationError)
    if (validationError) return
    importCancelledRef.current = false
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
      if (importCancelledRef.current) {
        await discardResumeTemps(rows.map(row => row?.cv_storage_path || row?.resume_path))
        return
      }
      await startResumeReview(rows.map((row, index) => ({
        ...row,
        sourceFile: files[index] || null,
        originalFileName: files[index]?.name || row.file_name || '',
        duplicateCvAlreadyChecked: true,
        duplicateCvResult: row.cv_duplicate ? {
          duplicate: true,
          cv_link: row.cv_link || row.resume_url || '',
          resume_url: row.resume_url || row.cv_link || '',
          cv_file_hash: row.cv_file_hash || '',
          cv_storage_path: row.cv_storage_path || ''
        } : null
      })))
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
    const textFields = ['name', 'email', 'mobile', 'designation', 'city', 'state', 'location', 'currentCompany', 'currentOrganisation', 'education', 'client', 'job', 'cvLink', 'linkedinUrl', 'notes', 'consultantName']
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
      await loadCandidates(1, { showLoading: false })
      setPage(1)
      return
    }
    const candidateDisplayId = await fetchNextCandidateDisplayId().catch(() => '')
    const [profile, users] = await Promise.all([
      getFreshActiveConsultantName(),
      fetchConsultantOptions().catch(() => [])
    ])
    const consultantUser = users.find(user => user.id && user.id === profile.userId) || users.find(user => user.name === profile.name)
    setConsultantSearch(profile.name)
    setCurrentImportIndex(nextIndex)
    setParsedForm({ ...mapBulkResumeRowToForm(importQueue[nextIndex], profile.name, consultantUser?.id || ''), candidateDisplayId })
    setParsedSkillInput('')
    setReviewNotice(importQueue[nextIndex]?.error ? `Parsing warning: ${importQueue[nextIndex].error}` : notice)
    if (importQueue[nextIndex]?.cv_duplicate) setCvDuplicateNotice('CV already exists in the database.')
    scrollImportToTop()
  }

  const handleSaveParsed = async () => {
    const candidateToSave = fillEmptyCandidateFields({ ...parsedForm, source: 'resume' })
    const e = validate(candidateToSave)
    if (Object.keys(e).length) { setImportError(Object.values(e)[0]); return }
    if (!candidateToSave.cvFile && !candidateToSave.sourceFile && !candidateToSave.cvStoragePath && !candidateToSave.cvLink) {
      setImportError('Parsed resume file was lost. Please re-upload this resume.')
      return
    }
    setSaving(true)
    try {
      await saveCandidateToApi(candidateToSave, { duplicateAction: duplicateBypass?.source === 'resume' ? 'add_duplicate' : '' })
      await discardResumeTemps([candidateToSave.cvStoragePath || importQueue[currentImportIndex]?.cv_storage_path || importQueue[currentImportIndex]?.resume_path])
      setDuplicateBypass(null)
      await loadCandidates(1, { showLoading: false })
      setPage(1)
      await advanceResumeReview('Candidate saved.')
    } catch (err) {
      if (err.duplicate) {
        setCandidateDuplicate({ source: 'resume', candidate: candidateToSave, existing: err.duplicate.existing, exactAssociation: err.exactAssociation, allowAddDuplicate: err.duplicate.allowAddDuplicate !== false, message: err.message })
        return
      }
      setImportError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const skipCurrentResume = () => {
    discardResumeTemps([parsedForm?.cvStoragePath || importQueue[currentImportIndex]?.cv_storage_path || importQueue[currentImportIndex]?.resume_path])
      .finally(() => advanceResumeReview('Resume skipped.'))
  }

  const cancelRemainingResumes = () => {
    if (!window.confirm('Cancel remaining resume reviews?')) return
    importCancelledRef.current = true
    const remainingPaths = importQueue
      .slice(parsed ? currentImportIndex : 0)
      .map(row => row?.cv_storage_path || row?.resume_path)
    discardResumeTemps(remainingPaths).finally(() => closeImport())
  }

  const resolveCandidateDuplicate = async (duplicateAction) => {
    if (!candidateDuplicate) return

    if (duplicateAction === 'add_duplicate') {
      setDuplicateBypass({ source: candidateDuplicate.source })
      setCandidateDuplicate(null)
      setDuplicateMoreOpen(false)
      return
    }
    openDuplicateExistingForEdit()
  }

  const openDuplicateExistingForEdit = () => {
    if (!candidateDuplicate?.existing) return
    const existing = apiCandidateToUi(candidateDuplicate.existing)
    setCandidateDuplicate(null)
    setDuplicateMoreOpen(false)
    if (candidateDuplicate.source === 'resume') closeImport()
    openEditCandidate(existing)
  }

  const duplicateExistingToUi = (existing) => apiCandidateToUi({
    ...existing,
    association_id: existing.association_id || existing.id,
    candidate_id: existing.candidate_id || existing.id,
    full_name: existing.full_name,
    client_name: existing.client_name || '',
    job_title: existing.job_title || '',
  })

  const duplicateValue = (row, key) => {
    switch (key) {
      case 'candidateDisplayId': return row.candidateDisplayId || '-'
      case 'date': return formatDate(row.createdAt)
      case 'consultant': return row.consultant || row.consultantName || '-'
      case 'client': return row.client || '-'
      case 'clientId': return row.clientDisplayId || row.clientId || '-'
      case 'jobId': return row.jobDisplayId || row.jobId || '-'
      case 'job': return row.job || '-'
      case 'name': return row.name || '-'
      case 'organisation': return row.currentOrganisation || row.currentCompany || '-'
      case 'designation': return row.designation || '-'
      case 'mobile': return row.mobile || '-'
      case 'email': return row.email || '-'
      case 'experience': return row.exp ? `${row.exp} yrs` : '-'
      case 'skills': return Array.isArray(row.skills) && row.skills.length ? row.skills.join(', ') : '-'
      case 'salary': return fmt(row.salary)
      case 'location': return row.location || row.city || '-'
      case 'notice': return row.noticePeriod !== '' && row.noticePeriod !== null ? row.noticePeriod : '-'
      case 'expectedSalary': return fmt(row.expectedSalary)
      case 'relocate': return row.openToRelocate || '-'
      case 'comments': return row.notes || '-'
      case 'linkedin': return row.linkedinUrl || '-'
      case 'status': return row.status || '-'
      case 'offeredCtc': return row.status === 'Hired' ? fmt(row.offeredCtc) : '-'
      case 'dateOfJoining': return row.status === 'Hired' ? formatDate(row.dateOfJoining) : '-'
      case 'cv': return row.cvLink ? 'CV' : '-'
      case 'month': return formatMonth(row.createdAt)
      case 'action': return '-'
      default: return '-'
    }
  }
  const duplicateValuesDiffer = (existing, incoming, key) => (
    String(duplicateValue(existing, key) ?? '').replace(/\s+/g, ' ').trim() !==
    String(duplicateValue(incoming, key) ?? '').replace(/\s+/g, ' ').trim()
  )

  const closeImport = () => {
    setImportOpen(false); setResumeFiles([]); setImportQueue([]); setCurrentImportIndex(0); setImportError(''); setReviewNotice('')
    setParsing(false); setParsed(false); setParsedForm(null); setParsedSkillInput('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const discardResumeTemps = useCallback(async (paths = []) => {
    const uniquePaths = [...new Set(paths.map(value => String(value || '').trim()).filter(value => value.startsWith('/tmp/')))]
    if (!uniquePaths.length) return
    try {
      await fetch('/api/resumes/discard-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: uniquePaths })
      })
    } catch {
      // Cleanup is best-effort.
    }
  }, [])

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
        job: ''
      }))
    } else {
      setParsedForm(f => ({ ...f, [name]: nextValue }))
    }
  }

  // ---- Candidate Form body (shared between Add + Review) ----
  const CandidateFormBody = ({ f, setF, errs, sInput, onSkillInputChange, onSkillKey, onAddSkill, rmSkill, lowConf = [], onChange, lockCv = false }) => {
    const low = (field) => lowConf.includes(field) ? ' low-confidence' : ''
    const visibleClientValue = f.client || ''
    const matchingClients = canonicalClients
      .filter(client => normalizeText(clientName(client)).includes(normalizeText(visibleClientValue)))
    const matchingJobs = getUniqueSortedJobs(dbJobs, f.clientId, f.job)
    const setClientValue = (value) => {
      const matchedClient = findClientByInput(value)
      setF(prev => ({
        ...prev,
        client: matchedClient ? clientName(matchedClient) : value,
        clientId: matchedClient?.id || '',
        job: '',
        jobId: '',
        jobDisplayId: ''
      }))
      setClientSuggestionsOpen(!matchedClient)
    }
    const setJobValue = (value) => {
      const matchedJob = dbJobs.find(job => job.id === value) || dbJobs.find(job => jobName(job) === value && (!f.clientId || job.client_id === f.clientId))
      setF(prev => ({
        ...prev,
        job: matchedJob ? jobName(matchedJob) : value,
        jobId: matchedJob?.id || '',
        jobDisplayId: matchedJob?.job_display_id || ''
      }))
      setJobSuggestionsOpen(!matchedJob)
    }
    const handleLocalChange = onChange || ((e) => {
      const { name, value, type, checked } = e.target
      const rawValue = type === 'checkbox' ? checked : value
      const nextValue = ['salary', 'expectedSalary', 'offeredCtc'].includes(name) ? normalizeCtcInputValue(rawValue) : rawValue
      if (name === 'client') {
        const matchedClient = findClientByInput(value)
        setF(prev => ({
        ...prev,
        client: matchedClient ? clientName(matchedClient) : value,
        clientId: matchedClient?.id || '',
        job: '',
        jobId: '',
        jobDisplayId: ''
        }))
      } else {
        setF(prev => ({ ...prev, [name]: nextValue }))
      }
    })
    const cvHref = resolveCandidateCvHref(f)
    const parsedResumeAttached = f.source === 'resume' && (f.sourceFile || f.cvOriginalName || f.cvStoragePath)
    return (
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Candidate ID</label>
          <input value={f.candidateDisplayId || 'Auto-generated'} className="form-control" disabled readOnly />
        </div>
        {!isCandidateFieldHidden('name') && <div className="form-group">
          <label className="form-label">Full Name <span className="req">*</span></label>
          <input name="name" value={f.name} onChange={handleLocalChange}
            className={`form-control${errs?.name ? ' is-error' : ''}${low('name')}`}
            disabled={isCandidateFieldDisabled('name')}
            />
          {errs?.name && <span className="form-error">{errs.name}</span>}
        </div>}

        {!isCandidateFieldHidden('email') && <div className="form-group">
          <label className="form-label">Email</label>
          <input name="email" type="email" value={f.email} onChange={handleLocalChange}
            className={`form-control${errs?.email ? ' is-error' : ''}${low('email')}`}
            disabled={isCandidateFieldDisabled('email')}
            />
          {errs?.email && <span className="form-error">{errs.email}</span>}
        </div>}

        {!isCandidateFieldHidden('mobile') && <div className="form-group">
          <label className="form-label">Mobile Number <span className="req">*</span></label>
          <input name="mobile" value={f.mobile} onChange={handleLocalChange}
            className={`form-control${errs?.mobile ? ' is-error' : ''}${low('mobile')}`}
            disabled={isCandidateFieldDisabled('mobile')}
            />
          {errs?.mobile && <span className="form-error">{errs.mobile}</span>}
        </div>}

        {!isCandidateFieldHidden('consultantName') && <div className="form-group">
          <label className="form-label">Consultant</label>
          <div className="client-search-wrap">
            <input name="consultantName" value={consultantSearch || f.consultantName || ''} onChange={e => {
              setConsultantSearch(e.target.value)
              setF(prev => ({ ...prev, consultantName: e.target.value, consultantUserId: '' }))
              setConsultantOpen(true)
            }} onFocus={() => {
              setConsultantSearch(current => current || f.consultantName || '')
              setConsultantOpen(true)
            }} onBlur={() => window.setTimeout(() => setConsultantOpen(false), 120)}
              className="form-control" disabled={isCandidateFieldDisabled('consultantName')} autoComplete="off" />
            {consultantOpen && (
              <div className="client-suggestions manual-suggestions is-open">
                {matchingConsultants.length ? matchingConsultants.map(user => (
                  <button type="button" key={user.id || user.name} onMouseDown={event => {
                    event.preventDefault()
                    setConsultantSearch(user.name)
                    setF(prev => ({ ...prev, consultantName: user.name, consultantUserId: consultantByName.get(user.name)?.id || '' }))
                    setConsultantOpen(false)
                  }}><span>{user.name}</span></button>
                )) : <div className="candidate-column-option">No results found</div>}
              </div>
            )}
          </div>
        </div>}

        {!isCandidateFieldHidden('designation') && <div className="form-group">
          <label className="form-label">Current Designation</label>
          <input name="designation" value={f.designation} onChange={handleLocalChange}
            className={`form-control${low('designation')}`}
            disabled={isCandidateFieldDisabled('designation')}
            />
        </div>}

        {!isCandidateFieldHidden('currentOrganisation') && <div className="form-group">
          <label className="form-label">Current Organisation</label>
          <input name="currentOrganisation" value={f.currentOrganisation || ''} onChange={handleLocalChange}
            className={`form-control${low('currentOrganisation')}`} disabled={isCandidateFieldDisabled('currentOrganisation')} />
        </div>}

        {!isCandidateFieldHidden('location') && <div className="form-group">
          <label className="form-label">Current Location</label>
          <input name="location" value={f.location || ''} onChange={handleLocalChange}
            className="form-control" disabled={isCandidateFieldDisabled('location')} />
        </div>}

        {!isCandidateFieldHidden('exp') && <div className="form-group">
          <label className="form-label">Experience (years)</label>
          <input name="exp" type="number" min="0" value={f.exp} onChange={handleLocalChange}
            className="form-control" disabled={isCandidateFieldDisabled('exp')} />
        </div>}

        {!isCandidateFieldHidden('noticePeriod') && <div className="form-group">
          <label className="form-label">Notice Period (days)</label>
          <input name="noticePeriod" type="number" min="0" value={f.noticePeriod || ''} onChange={handleLocalChange}
            className="form-control" disabled={isCandidateFieldDisabled('noticePeriod')} />
        </div>}

        {!isCandidateFieldHidden('status') && <div className="form-group">
          <label className="form-label">Status</label>
          <select name="status" value={f.status} onChange={handleLocalChange} className="form-control" disabled={isCandidateFieldDisabled('status')}>
            {STATUS_OPTIONS.map(s => <option key={s || '-'} value={s}>{s || '-'}</option>)}
          </select>
        </div>}

        {!isCandidateFieldHidden('salary') && <div className="form-group">
          <label className="form-label">Current CTC</label>
          <div className="input-with-adornment">
            <span className="input-adornment">₹</span>
            <input name="salary" type="text" inputMode="decimal" value={normalizeCtcInputValue(f.salary)} onChange={handleLocalChange}
              className={`form-control${low('salary')}`}
              disabled={isCandidateFieldDisabled('salary')}
            />
            <span className="input-adornment input-adornment-end">LPA</span>
          </div>
        </div>}

        {!isCandidateFieldHidden('expectedSalary') && <div className="form-group">
          <label className="form-label">Expected CTC</label>
          <div className="input-with-adornment">
            <span className="input-adornment">₹</span>
            <input name="expectedSalary" type="text" inputMode="decimal" value={normalizeCtcInputValue(f.expectedSalary)} onChange={handleLocalChange}
              className="form-control" disabled={isCandidateFieldDisabled('expectedSalary')} />
            <span className="input-adornment input-adornment-end">LPA</span>
          </div>
        </div>}

        {!isCandidateFieldHidden('openToRelocate') && <div className="form-group">
          <label className="form-label">Open to Relocate</label>
          <select name="openToRelocate" value={f.openToRelocate} onChange={handleLocalChange} className="form-control" disabled={isCandidateFieldDisabled('openToRelocate')}>
            {RELOCATE_OPTIONS.map(value => <option key={value || '-'} value={value}>{value || '-'}</option>)}
          </select>
        </div>}

        {f.status === 'Hired' && (
          <>
            <div className="form-group">
              <label className="form-label">Offered CTC</label>
              <div className="input-with-adornment">
                <span className="input-adornment">₹</span>
                <input name="offeredCtc" type="text" inputMode="decimal" value={normalizeCtcInputValue(f.offeredCtc || '')} onChange={handleLocalChange} className="form-control" />
                <span className="input-adornment input-adornment-end">LPA</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Date of Joining</label>
              <FormattedDateInput name="dateOfJoining" value={f.dateOfJoining || ''} onChange={(value) => setF(prev => ({ ...prev, dateOfJoining: value }))} className="form-control" />
            </div>
          </>
        )}

        <div className="form-section-title">Mandate Assignment</div>

        {!isCandidateFieldHidden('client') && <div className="form-group">
          <label className="form-label">Client</label>
          <div className="client-search-wrap">
            <input
              name="client"
              value={visibleClientValue}
              onChange={(event) => setClientValue(event.target.value)}
              onFocus={() => {
                setClientSuggestionsOpen(true)
                refreshOptionData()
              }}
              onBlur={() => window.setTimeout(() => setClientSuggestionsOpen(false), 120)}
              className={`form-control${errs?.client ? ' is-error' : ''}`}
              placeholder={dbClients.length ? 'Search client...' : 'Loading clients...'}
              disabled={isCandidateFieldDisabled('client')}
              autoComplete="off"
            />
            {clientSuggestionsOpen && (
            <div className="client-suggestions manual-suggestions is-open">
              {matchingClients.map(client => (
                <button type="button" key={client.id} onMouseDown={(event) => { event.preventDefault(); setClientValue(client.id); setClientSuggestionsOpen(false) }}>
                  <span>{clientName(client)}</span>
                  <small>{client.client_display_id || ''}</small>
                </button>
              ))}
            </div>
            )}
          </div>
          {errs?.client && <span className="form-error">{errs.client}</span>}
        </div>}

        {!isCandidateFieldHidden('clientId') && <div className="form-group">
          <label className="form-label">Client ID</label>
          <input value={clientDisplayIdForForm(f)} placeholder="Auto-filled after selecting client" className="form-control" readOnly />
        </div>}

        {!isCandidateFieldHidden('job') && <div className="form-group">
          <label className="form-label">Role Name</label>
          <div className="client-search-wrap">
            <input
              name="job"
              value={f.job || ''}
              onChange={(event) => setJobValue(event.target.value)}
              onFocus={() => {
                setJobSuggestionsOpen(true)
                refreshOptionData()
              }}
              onBlur={() => window.setTimeout(() => setJobSuggestionsOpen(false), 120)}
              className={`form-control${errs?.job ? ' is-error' : ''}`}
              placeholder={dbJobs.length ? 'Search mandate...' : 'Loading mandates...'}
              disabled={isCandidateFieldDisabled('job')}
              autoComplete="off"
            />
            {jobSuggestionsOpen && (
            <div className="client-suggestions manual-suggestions is-open">
              {matchingJobs.map(job => (
                <button type="button" key={job.id} onMouseDown={(event) => { event.preventDefault(); setJobValue(job.id); setJobSuggestionsOpen(false) }}>
                  <span>{jobName(job)}</span>
                  <small>{job.job_display_id || ''}</small>
                </button>
              ))}
            </div>
            )}
          </div>
          {errs?.job && <span className="form-error">{errs.job}</span>}
        </div>}

        {!isCandidateFieldHidden('jobId') && <div className="form-group">
          <label className="form-label">Role ID</label>
          <input value={jobDisplayIdForForm(f)} placeholder="Auto-filled after selecting mandate" className="form-control" readOnly />
        </div>}

        {!isCandidateFieldHidden('linkedinUrl') && <div className="form-group">
          <label className="form-label">LinkedIn URL</label>
          <input name="linkedinUrl" value={f.linkedinUrl || ''} onChange={handleLocalChange}
            className="form-control"
            disabled={isCandidateFieldDisabled('linkedinUrl')}
            />
        </div>}

        {!isCandidateFieldHidden('cvLink') && <div className="form-group">
          <label className="form-label">CV
            {f.cvLink && <span style={{ marginLeft:6, fontSize:10, color:'var(--success)', fontWeight:600, background:'rgba(40,167,69,0.1)', padding:'1px 6px', borderRadius:4 }}>Auto-filled</span>}
          </label>
          <div style={{ display:'grid', gap:8 }}>
            {!lockCv && (
              <div>
                <span className="sub-text">{parsedResumeAttached ? `Parsed resume attached: ${f.cvOriginalName || f.sourceFile?.name || 'Resume'}` : (f.cvOriginalName ? `Resume: ${f.cvOriginalName}` : 'Choose File')}</span>
                {!parsedResumeAttached && (
                  <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => handleCvFileChange(setF, event.target.files?.[0] || null)} className="form-control" disabled={isCandidateFieldDisabled('cvFile')} />
                )}
              </div>
            )}
            {cvHref && (
              <button className="btn-secondary" type="button" onClick={(event) => { event.preventDefault(); openDocument(`cv-form-${f.associationId || f.candidateId || f.candidateDisplayId || 'new'}`, cvHref) }}>
                View Parsed Resume
              </button>
            )}
            {!lockCv && (
              <div>
                <span className="sub-text">Enter CV Link</span>
                <input name="cvLink" value={f.cvLink || ''} onChange={event => handleCvLinkChange(setF, event.target.value)}
                  className={`form-control${low('cvLink')}`}
                  disabled={isCandidateFieldDisabled('cvLink')}
                  />
              </div>
            )}
          </div>
        </div>}

        {!isCandidateFieldHidden('skills') && <div className="form-group full">
          <label className="form-label">Skills</label>
          <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input').focus()}>
            {f.skills.map(s => (
              <span className="tag-chip" key={s}>
                {s}
                <button className="tag-chip-remove" type="button" onClick={() => rmSkill(s)} disabled={isCandidateFieldDisabled('skills')}><X size={10} /></button>
              </span>
            ))}
            <input className="tag-input-field" value={sInput}
              onChange={e => onSkillInputChange(e.target.value)} onKeyDown={onSkillKey}
              aria-label="Add skill" disabled={isCandidateFieldDisabled('skills')} />
            <button className="tag-add-btn" type="button" onClick={() => onAddSkill()} disabled={!sInput.trim() || isCandidateFieldDisabled('skills')}>
              <Plus size={12} strokeWidth={2.4} /> Add
            </button>
          </div>
        </div>}

        {!isCandidateFieldHidden('notes') && <div className="form-group full">
          <label className="form-label">Comments</label>
          <textarea name="notes" value={f.notes} onChange={handleLocalChange}
            className="form-control" rows={3} style={{ minHeight: 84, lineHeight: 1.5 }} disabled={isCandidateFieldDisabled('notes')} />
        </div>}

        {!isCandidateFieldHidden('education') && <div className="form-group full">
          <label className="form-label">Education</label>
          <textarea name="education" value={f.education} onChange={handleLocalChange}
            className="form-control" rows={4} style={{ minHeight: 96, lineHeight: 1.5 }}
            disabled={isCandidateFieldDisabled('education')}
            />
        </div>}
      </div>
    )
  }
  const activeColumns = CANDIDATE_TABLE_COLUMNS.filter(column => (visibleColumns.includes(column.key) || column.key === 'jobId') && !isColumnHidden(permissions, 'candidates', CANDIDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const availableColumns = CANDIDATE_TABLE_COLUMNS.filter(column => !isColumnHidden(permissions, 'candidates', CANDIDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))

  const updateCandidateLockState = async (record) => {
    setCandidates(current => current.map(candidate => candidate.candidateId === record.id ? { ...candidate, isLocked: record.is_locked } : candidate))
    await loadCandidates(page, { showLoading: false })
  }
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
          {visibleSkills.map(skill => <span className="table-skill-chip" key={skill}>{highlightText(skill, aiFilters)}</span>)}
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
        <div className={`table-comment-text${expanded ? ' is-expanded' : ''}`}>{highlightText(text, aiFilters)}</div>
        {isLong && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(candidate.associationId || candidate.id, 'comments', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'Show less' : 'View full comment'}
          </button>
        )}
      </div>
    )
  }
  const renderCandidateCell = ({ key }, c, groupMeta) => {
    const { mobile, isGroup, isExpanded, groupSize, groupIndex } = groupMeta
    const candidateAvatarStyle = avatarColorsFor(c.name)
    const consultantInitials = initials(c.consultant || '').slice(0, 2) || '-'
    const consultantAvatarStyle = avatarColorsFor(c.consultant || c.name)
    const clientIdValue = c.clientDisplayId || getReadableClientId(c, dbClients)
    const jobIdValue = c.jobDisplayId || jobDisplayIdForForm(c) || '-'
    const noticeMeta = getNoticeMeta(c.noticePeriod)

    switch (key) {
      case 'candidateDisplayId':
        return <td key={key} style={{ fontFamily:'monospace', fontSize:12 }}>{c.candidateDisplayId || '-'}</td>
      case 'date':
        return <td key={key}>{formatDate(c.createdAt)}</td>
      case 'consultant':
        return (
          <td key={key}>
            {c.consultant ? (
              <span className="candidate-consultant-chip">
                <span className="candidate-consultant-avatar" style={consultantAvatarStyle}>{consultantInitials}</span>
                <span>{highlightText(c.consultant, aiFilters)}</span>
              </span>
            ) : (
              <span className="candidate-muted-dash">-</span>
            )}
          </td>
        )
      case 'client':
        return <td key={key}>{highlightText(c.client || '-', aiFilters)}</td>
      case 'clientId':
        return <td key={key}>{clientIdValue !== '-' ? <span className="candidate-id-chip candidate-client-id-chip">{clientIdValue}</span> : <span className="candidate-muted-dash">-</span>}</td>
      case 'jobId':
        return <td key={key}>{jobIdValue !== '-' ? <span className="candidate-id-chip candidate-job-id-chip">{jobIdValue}</span> : <span className="candidate-muted-dash">-</span>}</td>
      case 'job':
        return <td key={key} className="cell-ellipsis">{highlightText(c.job || '-', aiFilters)}</td>
      case 'name':
        return (
          <td key={key}>
            <div className="name-cell">
              <div className="name-avatar" style={candidateAvatarStyle}>{initials(c.name)}</div>
              <div className="candidate-name-content">
                <div className="name-text candidate-group-name">
                  <span className="candidate-name-text">{c.isLocked && <Lock size={12} className="fb-lock-icon" />} {highlightText(c.name, aiFilters)}</span>
                  {isGroup && groupIndex === 0 && (
                    <button
                      className="candidate-submission-chip"
                      type="button"
                      aria-label={isExpanded ? 'Collapse candidate submissions' : 'Expand candidate submissions'}
                      onClick={(event) => { event.stopPropagation(); toggleCollapsed(mobile) }}
                    >
                      <span>{groupSize} submissions</span>
                      <span className={`candidate-group-toggle${isExpanded ? '' : ' collapsed'}`}>
                        <ChevronDown size={12} strokeWidth={2.4} />
                      </span>
                    </button>
                  )}
                </div>
                <div className="sub-text candidate-location-text">{highlightText(String(c.location || '').trim() || '-', aiFilters)}</div>
              </div>
            </div>
          </td>
        )
      case 'organisation':
        return <td key={key}><span style={{ fontWeight:500, color:'var(--navy-darkest)' }}>{highlightText(c.currentOrganisation || c.currentCompany || '-', aiFilters)}</span></td>
      case 'designation':
        return <td key={key}>{highlightText(c.designation || '-', aiFilters)}</td>
      case 'mobile':
        return <td key={key} style={{ fontFamily:'monospace', fontSize:12 }}>{highlightText(c.mobile || '-', aiFilters)}</td>
      case 'email':
        return <td key={key}>{highlightText(c.email || '-', aiFilters)}</td>
      case 'experience':
        return <td key={key}>{c.exp ? `${c.exp} yrs` : '-'}</td>
      case 'skills': {
        return <td key={key}>{renderSkillsCell(c)}</td>
      }
      case 'salary':
        return <td key={key}>{c.salary ? <span className="candidate-money-value">{formatCandidateCtc(c.salary)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'notice':
        return <td key={key}>{noticeMeta ? <span className={`candidate-notice-pill candidate-notice-pill-${noticeMeta.tone}`}>{noticeMeta.label}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'expectedSalary':
        return <td key={key}>{c.expectedSalary ? <span className="candidate-money-value">{formatCandidateCtc(c.expectedSalary)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'relocate':
        return <td key={key}>{c.openToRelocate ? <span className={`candidate-relocate-pill${c.openToRelocate === 'Yes' ? ' is-yes' : ' is-no'}`}>{c.openToRelocate}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'comments':
        return <td key={key}>{renderCommentsCell(c)}</td>
      case 'linkedin':
        {
          const linkedinUrl = normalizeExternalUrl(c.linkedinUrl)
          return (
          <td key={key}>
            {linkedinUrl ? (
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="candidate-linkedin-link" onClick={event => event.stopPropagation()}>LinkedIn ↗</a>
            ) : (
              <span className="candidate-empty-value">-</span>
            )}
          </td>
          )
        }
      case 'status':
        return (
          <td key={key}>
            <div className="candidate-columns-control mandate-status-control">
              <button className={`badge ${STATUS_BADGE_MAP[c.status] || ''}`} type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('candidate-status', c.associationId || c.id, event.currentTarget)} disabled={statusSaving[c.associationId || c.id]}>
                {c.status || '-'}
              </button>
            </div>
          </td>
        )
      case 'offeredCtc':
        return <td key={key}>{c.status === 'Hired' && c.offeredCtc ? <span className="candidate-money-value">{formatCandidateCtc(c.offeredCtc)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'dateOfJoining':
        return <td key={key}>{c.status === 'Hired' ? formatDate(c.dateOfJoining) : '-'}</td>
      case 'cv': {
        const cvHref = resolveCandidateCvHref(c)
        const docKey = `cv-${c.associationId || c.id}`
        const isOpening = openingDocument === docKey
        return (
          <td key={key}>
            {cvHref ? (
              <a href="#" rel="noopener noreferrer" className="cv-table-link candidate-cv-link" title="Open CV" onClick={event => { event.preventDefault(); event.stopPropagation(); event.nativeEvent?.stopImmediatePropagation?.(); logCandidateCvOpen(c); openDocument(docKey, cvHref) }}>
                {isOpening ? <Loader2 size={15} className="spin" /> : <FileText size={15} strokeWidth={2} />}
              </a>
            ) : (
              <span className="candidate-empty-value">-</span>
            )}
          </td>
        )
      }
      case 'month':
        return <td key={key}>{formatMonth(c.createdAt)}</td>
      case 'action':
        return (
          <td key={key}>
            <div className="row-actions">
              <button className="row-action-btn" type="button" title="View" onClick={(event) => { event.stopPropagation(); openCandidateDetail(c, event) }}><Eye size={13} /></button>
              <button className="row-action-btn" type="button" title="Edit" onClick={(event) => { event.stopPropagation(); openEditCandidate(c) }} disabled={c.isLocked && !isAdmin}><Pencil size={13} /></button>
              {isAdmin && <RecordLockButton tableName="candidates" recordId={c.candidateId} locked={c.isLocked} onChanged={updateCandidateLockState} />}
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
            onClick={(event) => { setColumnsAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setColumnsOpen(open => !open) }}
          >
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>
            Proceed
          </button>
          {columnsOpen && (
            <FloatingDropdown anchorRect={columnsAnchor?.rect} ignoreElement={columnsAnchor?.element} className="candidate-columns-dropdown" width={176} onClose={() => setColumnsOpen(false)}>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(availableColumns.map(column => column.key))}>
                Select All
              </button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>
                Clear All
              </button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>
                Save Preference
              </button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns((savedColumns?.length ? savedColumns : DEFAULT_CANDIDATE_COLUMN_KEYS).filter(key => availableColumns.some(column => column.key === key)))}>
                Reset to Saved Preference
              </button>
              <div className="candidate-columns-divider" />
              {availableColumns.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input
                    type="checkbox"
                    checked={pendingColumns.includes(column.key)}
                    onChange={() => togglePendingColumn(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </FloatingDropdown>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar candidates-filter-bar">
        <span className="filter-label">Mandate</span>
        <select className="filter-select" value={filterJob}
          onChange={e => { setFilterJob(e.target.value); setPage(1) }} id="filter-candidate-job">
          <option value="All">All Mandates</option>
          {uniqueJobFilterOptions.map(name => <option key={name} value={name}>{name}</option>)}
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
          <button className="filter-select candidate-sort-btn" type="button" onClick={(event) => { setSortAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setSortOpen(open => !open) }}>
            <span>{sortLabel()}</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {sortOpen && (
            <FloatingDropdown anchorRect={sortAnchor?.rect} ignoreElement={sortAnchor?.element} className="candidate-sort-dropdown" minWidth={180} onClose={() => setSortOpen(false)}>
              {SORT_OPTIONS.map(option => (
                <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>
                  {option.toggle ? `${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}` : option.label}
                </button>
              ))}
            </FloatingDropdown>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc'); setPage(1) }}>Clear</button>
        <div className="filter-bar-spacer" />
        <CompactPagination page={page} totalPages={Math.max(1, Math.ceil(totalCandidates / pageSize))} onPageChange={setPage} loading={loadingCandidates} />
      </div>

      {aiFilterError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {aiFilterError}
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
                {visibleCandidates.map(({ candidate: c, mobile, isGroup, isExpanded, groupSize, groupIndex, isLastInGroup }) => {
                  const rowClass = isGroup
                    ? `candidate-mobile-group-row${groupIndex === 0 ? ' group-first' : ' group-child'}${isLastInGroup ? ' group-last' : ''}${isExpanded && groupIndex === 0 ? ' candidate-group-parent-expanded' : ''}${isExpanded && groupIndex > 0 ? ' candidate-group-child-expanded' : ''}`
                    : ''
                  return (
                    <tr key={c.associationId || c.id} className={rowClass}>
                      {activeColumns.map(column => renderCandidateCell(column, c, { mobile, isGroup, isExpanded, groupSize, groupIndex }))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={Math.max(1, Math.ceil(totalCandidates / pageSize))}
        total={totalCandidates}
        pageSize={pageSize}
        loading={loadingCandidates}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
      />

      {tablePopover?.type === 'candidate-status' && (() => {
        const candidate = candidates.find(item => (item.associationId || item.id) === tablePopover.id)
        if (!candidate) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={190} onClose={() => setTablePopover(null)}>
            {STATUS_OPTIONS.map(status => (
              <button className="candidate-columns-action" type="button" key={status || '-'} onClick={() => updateCandidateStatus(candidate, status)}>
                {status || '-'}
              </button>
            ))}
          </TablePopover>
        )
      })()}

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
              {!isCandidateFieldHidden('cvLink') && resolveCandidateCvHref(selectedCandidate) && (
                <a className="btn-secondary" href="#" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); event.nativeEvent?.stopImmediatePropagation?.(); logCandidateCvOpen(selectedCandidate); openDocument(`cv-detail-${selectedCandidate.associationId || selectedCandidate.id}`, resolveCandidateCvHref(selectedCandidate)) }}>{openingDocument === `cv-detail-${selectedCandidate.associationId || selectedCandidate.id}` ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} CV</a>
              )}
              {!isCandidateFieldHidden('linkedinUrl') && normalizeExternalUrl(selectedCandidate.linkedinUrl) && (
                <a className="btn-secondary" href={normalizeExternalUrl(selectedCandidate.linkedinUrl)} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl(selectedCandidate.linkedinUrl) }}>LinkedIn</a>
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
              ].filter(([label]) => {
                const map = { 'Current CTC': 'salary', 'Expected CTC': 'expectedSalary', Email: 'email', Mobile: 'mobile' }
                return !map[label] || !isCandidateFieldHidden(map[label])
              }).map(([label, value]) => (
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
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" ref={candidateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={assigningAnother ? 'Assign Another Mandate/Client' : 'Add Candidate'}>
            <div className="modal-header">
              <span className="modal-title">{assigningAnother ? 'Assign Another Mandate/Client' : (editing ? 'Edit Candidate' : 'Add New Candidate')}</span>
              <button className="modal-close" onClick={() => { setAddOpen(false); setAssigningAnother(false) }} aria-label="Close" disabled={saving}><X size={16} /></button>
            </div>
            <div className="modal-body" ref={candidateModalBodyRef}>
              {errors.form && <div className="form-error" style={{ display:'block', marginBottom:12 }}>{errors.form}</div>}
              {assigningAnother && <div className="review-banner" style={{ marginBottom:12 }}>Creates a new assignment. The current candidate row will not be changed.</div>}
              {CandidateFormBody({
                f: form,
                setF: setForm,
                errs: errors,
                sInput: skillInput,
                onSkillInputChange: handleSkillInputChange,
                onSkillKey: handleSkillKey,
                onAddSkill: addManualSkill,
                rmSkill: removeSkill,
                onChange: handleChange,
                lockCv: assigningAnother
              })}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setAddOpen(false); setAssigningAnother(false) }} disabled={saving}>Cancel</button>
              {editing && (
                <button className="btn-secondary" onClick={openAssignAnother} disabled={saving}>Assign Another Mandate/Client</button>
              )}
              <button className="btn-primary" onClick={handleSave} id="save-candidate-btn" disabled={saving}>
                {saving ? 'Saving...' : (assigningAnother ? 'Save New Assignment' : 'Save Candidate')}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ===== Bulk Resume Review Modal ===== */}
      {importOpen && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" ref={importModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Parse and add candidates">
            <div className="modal-header">
              <span className="modal-title">{parsed ? 'Parse & Add Candidates' : 'Upload Resumes'}</span>
              <button className="modal-close" onClick={cancelRemainingResumes} aria-label="Close"><X size={16} /></button>
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
        <div className="modal-overlay">
          <div className="modal-card" ref={duplicateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Duplicate Candidate">
            <div className="modal-header">
              <span className="modal-title">Duplicate Candidate</span>
              <button className="modal-close" onClick={() => setCandidateDuplicate(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="review-banner">
                <AlertCircle size={16} />
                {candidateDuplicate.message || 'A candidate with the same email or mobile already exists.'}
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
              <button className="btn-secondary" onClick={() => setDuplicateMoreOpen(true)} disabled={saving}>View More</button>
              <button className="btn-secondary" onClick={() => { setCandidateDuplicate(null); setDuplicateMoreOpen(false) }} disabled={saving}>Cancel</button>
              {!candidateDuplicate.exactAssociation && candidateDuplicate.allowAddDuplicate !== false && (
                <button className="btn-secondary" onClick={() => resolveCandidateDuplicate('add_duplicate')} disabled={saving}>Add Duplicate</button>
              )}
              <button className="btn-primary" onClick={candidateDuplicate.exactAssociation ? openDuplicateExistingForEdit : () => resolveCandidateDuplicate('update_current')} disabled={saving}>Update Existing</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {cvDuplicateNotice && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Duplicate CV">
            <div className="modal-header">
              <span className="modal-title">Duplicate CV</span>
            </div>
            <div className="modal-body">
              <div className="review-banner">
                <AlertCircle size={16} />
                {cvDuplicateNotice}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setCvDuplicateNotice(null)}>OK</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {candidateDuplicate && duplicateMoreOpen && createPortal((() => {
        const existing = duplicateExistingToUi(candidateDuplicate.existing || {})
        const incoming = candidateDuplicate.candidate || {}
        return (
          <div className="modal-overlay">
            <div className="modal-card modal-card-xl" role="dialog" aria-modal="true" aria-label="Duplicate Candidate Details">
              <div className="modal-header">
                <span className="modal-title">Duplicate Candidate Details</span>
                <button className="modal-close" onClick={() => setDuplicateMoreOpen(false)} aria-label="Close"><X size={16} /></button>
              </div>
              <div className="modal-body">
                <div className="duplicate-details-scroll">
                  <table className="data-table duplicate-details-table">
                    <thead>
                      <tr>
                        <th>Field Name</th>
                        <th>Existing Candidate</th>
                        <th>New Candidate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CANDIDATE_TABLE_COLUMNS.filter(column => column.key !== 'action').map(column => {
                        const changed = duplicateValuesDiffer(existing, incoming, column.key)
                        return (
                        <tr key={column.key} className={changed ? 'is-different' : ''}>
                          <td className="field-name">{column.label}</td>
                          <td className={changed ? 'diff-cell' : ''}>{duplicateValue(existing, column.key)}</td>
                          <td className={changed ? 'diff-cell' : ''}>{duplicateValue(incoming, column.key)}</td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setDuplicateMoreOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )
      })(), document.body)}
    </div>
  )
}

