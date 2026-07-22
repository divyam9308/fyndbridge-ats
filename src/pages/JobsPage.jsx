import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, Copy, ExternalLink, FileText, Globe2, Loader2, Pencil, Plus, Search, X, Lock } from 'lucide-react'
import NewActionDropdown from '../components/NewActionDropdown'
import { useAuth } from '../context/useAuth'
import { useAdminAccess, isColumnHidden, isColumnDisabled } from '../hooks/useAdminAccess'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import { useStaffDirectory } from '../hooks/useStaffDirectory'
import RecordLockButton from '../components/admin/RecordLockButton'
import PaginationBar from '../components/PaginationBar'
import TablePopover from '../components/TablePopover'
import FloatingDropdown from '../components/FloatingDropdown'
import CompactPagination from '../components/CompactPagination'
import FormattedDateInput from '../components/FormattedDateInput'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { AttachmentList, DocumentIconGroup } from '../components/DocumentAttachments'
import { apiFetch, normalizeExternalUrl, openExternalUrl, openProtectedDocumentPath } from '../services/apiClient'
import '../styles/Shared.css'
import { MANDATE_STATUSES, MANDATE_STATUS_BADGE_MAP, mandateStatusLabel, normalizeMandateStatus } from '../utils/mandateStatuses'
import { SECTOR_OPTIONS } from '../utils/sectorOptions'
import { highlightText } from '../utils/aiFilterUi'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { parseDashboardFiltersFromUrl } from '../utils/dashboardDrilldown'
import { ConsultantPill, ConsultantPillGroup } from '../components/ConsultantPill'
import { normalizeAttachments, validateDocumentSelection } from '../utils/documentAttachments'

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const MAX_JD_FILES_PER_SAVE = 20
const MAX_JD_LINKS_PER_SAVE = 20
const SORT_OPTIONS = [
  { field: 'job_id', label: 'Job ID' },
  { field: 'role', label: 'Alphabetic order' }
]
const MANDATE_PERMISSION_BY_COLUMN = {
  jobId: 'job_display_id',
  consultant: 'consultants',
  teamLead: 'team_lead',
  clientId: 'client_id',
  clientName: 'client_name',
  role: 'title',
  budget: 'budget',
  mandateStatus: 'mandate_status',
  sector: 'vertical',
  allocationDate: 'allocation_date',
  jd: 'jd_storage_path',
  publicState: 'public_careers_listing'
}
const MANDATE_TABLE_COLUMNS = [
  { key: 'jobId', label: 'Job ID', width: 130 },
  { key: 'consultant', label: 'Consultant', width: 220 },
  { key: 'teamLead', label: 'Team Lead', width: 180 },
  { key: 'clientId', label: 'Client ID', width: 130 },
  { key: 'clientName', label: 'Client Name', width: 240 },
  { key: 'role', label: 'Role', width: 240 },
  { key: 'budget', label: 'Budget', width: 150 },
  { key: 'mandateStatus', label: 'Mandate Status', width: 190 },
  { key: 'sector', label: 'Sector', width: 180 },
  { key: 'allocationDate', label: 'Date of Allocation', width: 180 },
  { key: 'jd', label: 'JD', width: 110 },
  { key: 'publicState', label: 'Public', width: 140, required: true },
  { key: 'action', label: 'Action', width: 250 }
]
const DEFAULT_MANDATE_COLUMN_KEYS = MANDATE_TABLE_COLUMNS.map(column => column.key)
const REMOVED_MANDATE_COLUMN_KEYS = new Set(['location'])
const MANDATES_TABLE_COLUMNS_PREFERENCE_KEY = 'mandates_columns_preference'
const readStoredMandateColumns = () => {
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(window.localStorage.getItem(MANDATES_TABLE_COLUMNS_PREFERENCE_KEY) || 'null')
    const value = Array.isArray(saved) ? saved.filter(key => !REMOVED_MANDATE_COLUMN_KEYS.has(key) && DEFAULT_MANDATE_COLUMN_KEYS.includes(key)) : []
    return value.length ? value : null
  } catch {
    return null
  }
}
const storeMandateColumns = (value) => {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(MANDATES_TABLE_COLUMNS_PREFERENCE_KEY, JSON.stringify(value)) } catch {}
}
const EMPTY_FORM = {
  id: '',
  job_display_id: '',
  consultants: ['-'],
  consultant_user_ids: [],
  team_lead: '-',
  team_lead_user_id: '',
  client_id: '',
  role: '',
  location: '',
  budget: '',
  mandate_status: 'Ongoing (P1)',
  vertical: '',
  allocation_date: '',
  jd_url: '',
  jd_storage_path: '',
  is_public: false,
  public_slug: '',
  public_name: '',
  public_location: '',
  public_experience: '',
  public_skills: [],
  application_deadline: '',
  public_jd: ''
}

const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const normalizePublicSkills = (value) => {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))]
}
const publicListingComplete = (job) => Boolean(
  String(job?.public_slug || '').trim() &&
  String(job?.public_name || '').trim() &&
  String(job?.public_location || '').trim() &&
  String(job?.public_experience || '').trim() &&
  String(job?.application_deadline || '').trim() &&
  String(job?.public_jd || '').trim()
)
const publicListingState = (job) => {
  if (!job?.is_public) return 'Not Public'
  if (!publicListingComplete(job)) return 'Incomplete'
  if (normalizeMandateStatus(job.mandate_status || job.status || job.priority) !== 'Ongoing (P1)') return 'Closed'
  if (String(job.application_deadline || '') < indiaToday()) return 'Expired'
  return 'Published'
}
const publicListingFormChanged = (form, job) => {
  if (!job) return true
  return Boolean(form.is_public) !== Boolean(job.is_public) ||
    String(form.public_name || '').trim() !== String(job.public_name || '').trim() ||
    String(form.public_location || '').trim() !== String(job.public_location || '').trim() ||
    String(form.public_experience || '').trim() !== String(job.public_experience || '').trim() ||
    JSON.stringify(normalizePublicSkills(form.public_skills)) !== JSON.stringify(normalizePublicSkills(job.public_skills)) ||
    String(form.application_deadline || '') !== String(job.application_deadline || '') ||
    String(form.public_jd || '').trim() !== String(job.public_jd || '').trim()
}
const dash = (value) => value || '-'
const mutedDash = <span className="table-muted-dash">-</span>
const clientName = (client) => client?.name || client?.client_name || ''
const canonicalClients = (clients) => {
  const map = new Map()
  clients.forEach(client => {
    const key = String(client?.client_display_id || clientName(client)).trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, client)
  })
  return [...map.values()].sort((a, b) => clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' }))
}
const formatLocationText = (location) => String(location || '').trim()
const displayUserLabel = (value) => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.name || value.full_name || value.display_name || value.email || '').trim()
}
const isDashOption = (value) => displayUserLabel(value) === '-'
const normalizeSelectedUsers = (values) => {
  const labels = (Array.isArray(values) ? values : [values]).map(displayUserLabel).filter(Boolean)
  if (!labels.length || labels.includes('-')) return ['-']
  return [...new Set(labels)]
}
const normalizeConsultantFields = (values) => {
  const labels = (Array.isArray(values) ? values : [values]).map(displayUserLabel).filter(Boolean)
  const real = []
  const seen = new Set()
  labels.forEach((label) => {
    if (label === '-') return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    real.push(label)
  })
  return real.length ? real : ['-']
}

const jobJdAttachments = (job) => normalizeAttachments(job?.jd_attachments, {
  path: job?.jd_storage_path || job?.jd_url,
  name: job?.jd_file_name || job?.jd_original_name
})
const jdLinkAttachment = (path) => {
  const hostname = new URL(path).hostname.replace(/^www\./i, '')
  return {
    path,
    name: `Mandate Sheet link (${hostname})`,
    mime_type: 'text/uri-list',
    size: null,
    uploaded_at: ''
  }
}

const notifyAiQuota = (message) => {
  if (message === 'AI quota reached') {
    window.dispatchEvent(new CustomEvent('ai-quota-reached', { detail: 'AI quota reached' }))
  }
}

const isSupportedIntentFilter = (filters) => {
  const mode = String(filters?.mode || '').trim().toLowerCase()
  if (['ast', 'structured', 'hybrid'].includes(mode)) return Boolean(filters?.root) || (mode === 'structured' && Array.isArray(filters?.sort) && filters.sort.length > 0)
  return mode === 'keyword' && typeof filters?.search_text === 'string' && Boolean(filters.search_text.trim())
}

export default function JobsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isDashboardEmbed = useMemo(() => new URLSearchParams(location.search).get('embed') === 'dashboard', [location.search])
  const dashboardFilters = useMemo(() => parseDashboardFiltersFromUrl(location.search), [location.search])
  const { loadProfile, session } = useAuth()
  const { isAdmin, permissions } = useAdminAccess()
  const [jobs, setJobs] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [dbClients, setDbClients] = useState([])
  const { staff: allUserOptions, selectableStaff: userOptions } = useStaffDirectory()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [listError, setListError] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [mandateDuplicate, setMandateDuplicate] = useState(null)
  const [duplicateBypass, setDuplicateBypass] = useState(false)
  const [duplicateMoreOpen, setDuplicateMoreOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiError, setAiError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [sortAnchor, setSortAnchor] = useState(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnsAnchor, setColumnsAnchor] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalJobs, setTotalJobs] = useState(0)
  const [openingDocument, setOpeningDocument] = useState('')
  const initialMandateColumns = useMemo(() => readStoredMandateColumns() || DEFAULT_MANDATE_COLUMN_KEYS, [])
  const [visibleColumns, setVisibleColumns] = useState(initialMandateColumns)
  const [pendingColumns, setPendingColumns] = useState(initialMandateColumns)
  const [savedColumns, setSavedColumns] = useState(initialMandateColumns)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const [clientSearch, setClientSearch] = useState('')
  const [savedJdAttachments, setSavedJdAttachments] = useState([])
  const [pendingJdFiles, setPendingJdFiles] = useState([])
  const [pendingJdLinks, setPendingJdLinks] = useState([])
  const [jdLinkInput, setJdLinkInput] = useState('')
  const [removedJdPaths, setRemovedJdPaths] = useState([])
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const [roleSuggestionsOpen, setRoleSuggestionsOpen] = useState(false)
  const [addingNewRole, setAddingNewRole] = useState(false)
  const [roleSelectionConfirmed, setRoleSelectionConfirmed] = useState(false)
  const [sectorSearch, setSectorSearch] = useState('')
  const [sectorOpen, setSectorOpen] = useState(false)
  const [teamLeadSearch, setTeamLeadSearch] = useState('')
  const [teamLeadOpen, setTeamLeadOpen] = useState(false)
  const [consultantSearch, setConsultantSearch] = useState({})
  const [consultantPickerOpen, setConsultantPickerOpen] = useState({})
  const [publicSkillInput, setPublicSkillInput] = useState('')
  const [publicFieldsTouched, setPublicFieldsTouched] = useState({})
  const [publicActionSaving, setPublicActionSaving] = useState({})
  const [publicActionNotice, setPublicActionNotice] = useState(null)
  const publicNoticeSequenceRef = useRef(0)
  const modalRef = useRef(null)
  const duplicateModalRef = useRef(null)
  const roleInputRef = useRef(null)
  const sortRef = useRef(null)
  const columnsDropdownRef = useRef(null)
  const pendingRealtimeRefreshRef = useRef(false)
  const handledRouteActionRef = useRef('')
  const aiFilterRequestRef = useRef(0)
  const aiFilterAbortRef = useRef(null)
  const mandateListRequestRef = useRef(0)
  const mandateListAbortRef = useRef(null)

  const fetchData = useCallback(async ({ showLoading = true } = {}) => {
    const requestId = ++mandateListRequestRef.current
    mandateListAbortRef.current?.abort()
    const controller = new AbortController()
    mandateListAbortRef.current = controller
    try {
      if (showLoading) setLoading(true)
      setListError('')
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pageSize))
      if (aiFilters) params.set('ai_filters', JSON.stringify(aiFilters))
      if (dashboardFilters?.consultant) params.set('consultant', dashboardFilters.consultant)
      if (dashboardFilters?.teamLead) params.set('teamLead', dashboardFilters.teamLead)
      if (dashboardFilters?.status) params.set('status', dashboardFilters.status)
      if (dashboardFilters?.clientName) params.set('clientName', dashboardFilters.clientName)
      if (dashboardFilters?.role) params.set('role', dashboardFilters.role)
      if (dashboardFilters?.period) params.set('period', dashboardFilters.period)
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      const jobsRes = await fetch(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      const jobsData = await jobsRes.json().catch(() => ({}))
      if (requestId !== mandateListRequestRef.current || controller.signal.aborted) return
      if (!jobsRes.ok) throw new Error(jobsData.error || 'Failed to fetch mandates.')
      const nextTotal = Number(jobsData.total) || 0
      const validPage = Math.min(Number(jobsData.page) || page, Math.max(1, Math.ceil(nextTotal / pageSize)))
      setJobs(jobsData.data || [])
      setTotalJobs(nextTotal)
      setPage(validPage)
      if (import.meta.env.DEV && aiFilters) console.debug('Mandates AI filter', { filters: aiFilters, matched: Number(jobsData.total) || 0 })
      setError(null)
      setListError('')
    } catch (err) {
      if (requestId !== mandateListRequestRef.current || controller.signal.aborted || err?.name === 'AbortError') return
      setListError(err.message || 'Failed to fetch mandates.')
    } finally {
      if (mandateListAbortRef.current === controller) mandateListAbortRef.current = null
      if (requestId === mandateListRequestRef.current) setLoading(false)
    }
  }, [aiFilters, dashboardFilters, page, pageSize, sortDirection, sortField])

  useEffect(() => () => {
    mandateListRequestRef.current += 1
    mandateListAbortRef.current?.abort()
    mandateListAbortRef.current = null
    aiFilterRequestRef.current += 1
    aiFilterAbortRef.current?.abort()
    aiFilterAbortRef.current = null
  }, [])

  const openDocument = useCallback(async (key, path, recordId) => {
    setOpeningDocument(key)
    try {
      if (/^https?:\/\//i.test(String(path || '').trim())) {
        openExternalUrl(path)
        return
      }
      await openProtectedDocumentPath('jd', path, {
        recordId,
        missingMessage: 'JD is missing or needs to be reuploaded',
        notFoundMessage: 'JD not found.'
      })
    } finally {
      setOpeningDocument('')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  const refreshClientOptions = useCallback(async () => {
    const [clientsRes, jobsRes] = await Promise.all([
      fetch('/api/clients?options=true'),
      fetch('/api/jobs?options=true')
    ])
    const clientsData = await clientsRes.json().catch(() => ({}))
    const jobsData = await jobsRes.json().catch(() => ({}))
    if (clientsRes.ok) setDbClients(clientsData.data || [])
    if (jobsRes.ok) setAllJobs(jobsData.data || [])
  }, [])

  const refreshJobsRealtime = useCallback(() => {
    if (isOpen || editingJob) {
      pendingRealtimeRefreshRef.current = true
      return
    }
    fetchData({ showLoading: false })
  }, [editingJob, fetchData, isOpen])

  useEffect(() => {
    if ((isOpen || editingJob) || !pendingRealtimeRefreshRef.current) return
    pendingRealtimeRefreshRef.current = false
    fetchData({ showLoading: false })
  }, [editingJob, fetchData, isOpen])

  useRealtimeRefresh({
    channelName: 'realtime:jobs-page',
    tables: ['jobs'],
    onChange: refreshJobsRealtime
  })

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
        const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/mandates_columns_preference?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = Array.isArray(payload.data?.value)
          ? payload.data.value.filter(key => !REMOVED_MANDATE_COLUMN_KEYS.has(key) && DEFAULT_MANDATE_COLUMN_KEYS.includes(key))
          : null
        if (value?.length) {
          setVisibleColumns(value)
          setPendingColumns(value)
          setSavedColumns(value)
          storeMandateColumns(value)
        }
      } catch {
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [session?.user?.id])

  useEffect(() => {
    const timer = window.setTimeout(refreshClientOptions, 0)
    return () => window.clearTimeout(timer)
  }, [refreshClientOptions])

  useEffect(() => {
    const refreshClients = () => refreshClientOptions()
    const refreshJobs = () => fetchData({ showLoading: false })
    window.addEventListener('ats:clients-updated', refreshClients)
    window.addEventListener('ats:jobs-updated', refreshJobs)
    return () => {
      window.removeEventListener('ats:clients-updated', refreshClients)
      window.removeEventListener('ats:jobs-updated', refreshJobs)
    }
  }, [fetchData, refreshClientOptions])

  useEffect(() => {
    if (!publicActionNotice) return undefined
    const fadeTimer = window.setTimeout(() => {
      setPublicActionNotice(current => current ? { ...current, visible: false } : current)
    }, 4600)
    const removeTimer = window.setTimeout(() => setPublicActionNotice(null), 5000)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(removeTimer)
    }
  }, [publicActionNotice?.id])

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => {
      const target = modalRef.current?.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || modalRef.current)?.focus({ preventScroll: true })
    })
    return () => { document.body.style.overflow = previous }
  }, [isOpen])

  useEffect(() => {
    if (!mandateDuplicate) return
    window.requestAnimationFrame(() => {
      const target = duplicateModalRef.current?.querySelector('button:not([disabled])')
      ;(target || duplicateModalRef.current)?.focus({ preventScroll: true })
    })
  }, [mandateDuplicate])

  const getFreshActiveConsultantName = useCallback(async () => {
    const profile = await loadProfile().catch(() => null)
    const nextName = String(profile?.name || '').trim()
    const activeEmployee = userOptions.find(user => user.id === profile?.user_id) || userOptions.find(user => user.name === nextName)
    return { name: activeEmployee?.name || '', userId: activeEmployee?.id || '' }
  }, [loadProfile, userOptions])

  const fetchNextId = async () => {
    const res = await fetch('/api/jobs/next-display-id')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Unable to load mandate ID')
    return data.job_display_id || ''
  }

  const openModal = useCallback(async () => {
    setEditingJob(null)
    setErrors({})
    setMandateDuplicate(null)
    setDuplicateBypass(false)
    setDuplicateMoreOpen(false)
    setForm({ ...EMPTY_FORM, consultants: ['-'], team_lead: '-', team_lead_user_id: '', job_display_id: 'Loading...', allocation_date: todayLocal() })
    setClientSearch('')
    setRoleSearch('')
    setRoleSelectionConfirmed(false)
    setSectorSearch('')
    setTeamLeadSearch('')
    setTeamLeadOpen(false)
    setConsultantSearch({})
    setConsultantPickerOpen({})
    setPublicSkillInput('')
    setPublicFieldsTouched({})
    setAddingNewRole(false)
    setSavedJdAttachments([])
    setPendingJdFiles([])
    setPendingJdLinks([])
    setJdLinkInput('')
    setRemovedJdPaths([])
    setClientSuggestionsOpen(false)
    setRoleSuggestionsOpen(false)
    setIsOpen(true)
    try {
      const [nextId, profile] = await Promise.all([
        fetchNextId().catch(() => ''),
        getFreshActiveConsultantName().catch(() => ({ name: '' }))
      ])
      const cName = profile?.name ? String(profile.name).trim() : ''
      setForm(current => ({
        ...current,
        job_display_id: current.job_display_id === 'Loading...' ? nextId : current.job_display_id,
        consultants: cName ? [cName] : ['-']
      }))
      if (cName) setConsultantSearch({ 0: cName })
    } catch {
      setForm(current => ({ ...current, job_display_id: '' }))
    }
  }, [getFreshActiveConsultantName])

  useEffect(() => {
    const query = new URLSearchParams(location.search)
    const action = query.get('new') === 'mandate' ? 'add-job' : location.state?.action
    if (action !== 'add-job') return

    const actionKey = `${location.key}:${action}`
    if (handledRouteActionRef.current === actionKey) return
    handledRouteActionRef.current = actionKey
    openModal()

    query.delete('new')
    const search = query.toString()
    navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true, state: null })
  }, [location.key, location.pathname, location.search, location.state?.action, navigate, openModal])

  const editJob = (job) => {
    const consultantFields = normalizeConsultantFields(Array.isArray(job.consultants) ? job.consultants : [])
    const teamLeadValue = displayUserLabel(job.team_lead) || '-'
    setEditingJob(job)
    setErrors({})
    setMandateDuplicate(null)
    setDuplicateBypass(false)
    setDuplicateMoreOpen(false)
    const hasSavedPublicConfiguration = Boolean(
      job.is_public || job.public_slug || job.public_name || job.public_location || job.public_experience ||
      normalizePublicSkills(job.public_skills).length || job.application_deadline || job.public_jd
    )
    const experienceMinimum = job.experience_min ?? job.ai_experience_min_years
    const defaultExperience = job.experience_label || (experienceMinimum !== undefined && experienceMinimum !== null ? `${experienceMinimum}+ years` : '')
    setForm({
      id: job.id,
      job_display_id: job.job_display_id || '',
      consultants: consultantFields,
      consultant_user_ids: [],
      team_lead: teamLeadValue,
      team_lead_user_id: '',
      client_id: job.client_id || '',
      role: job.role || job.title || '',
      location: job.location || job.city || '',
      budget: job.budget || '',
      mandate_status: normalizeMandateStatus(job.mandate_status || job.status || job.priority) === '-' ? 'Ongoing (P1)' : normalizeMandateStatus(job.mandate_status || job.status || job.priority),
      vertical: job.vertical || '',
      allocation_date: job.allocation_date || todayLocal(),
      jd_url: job.jd_storage_path || job.jd_url || '',
      jd_storage_path: job.jd_storage_path || '',
      is_public: Boolean(job.is_public),
      public_slug: job.public_slug || '',
      public_name: job.public_name || (!hasSavedPublicConfiguration ? job.role || job.title || '' : ''),
      public_location: job.public_location || (!hasSavedPublicConfiguration ? job.location || job.city || '' : ''),
      public_experience: job.public_experience || (!hasSavedPublicConfiguration ? defaultExperience : ''),
      public_skills: normalizePublicSkills(job.public_skills).length ? normalizePublicSkills(job.public_skills) : (!hasSavedPublicConfiguration ? normalizePublicSkills(job.skills) : []),
      application_deadline: job.application_deadline || '',
      public_jd: job.public_jd || ''
    })
    setPublicSkillInput('')
    setPublicFieldsTouched(hasSavedPublicConfiguration ? {
      public_name: true,
      public_location: true,
      public_experience: true,
      public_skills: true,
      application_deadline: true,
      public_jd: true
    } : {})
    setSavedJdAttachments(jobJdAttachments(job))
    setPendingJdFiles([])
    setPendingJdLinks([])
    setJdLinkInput('')
    setRemovedJdPaths([])
    setClientSearch(job.client_name || '')
    setRoleSearch(job.role || job.title || '')
    setRoleSelectionConfirmed(true)
    setSectorSearch(job.vertical || '')
    setConsultantSearch({})
    setConsultantPickerOpen({})
    setTeamLeadSearch(teamLeadValue)
    setAddingNewRole(false)
    setClientSuggestionsOpen(false)
    setRoleSuggestionsOpen(false)
    refreshClientOptions()
    setIsOpen(true)
  }

  const userList = useMemo(() => userOptions
    .map(user => {
      if (typeof user === 'string') return null
      if (!user || typeof user !== 'object') return null
      const name = String(user.name || user.display_name || '').trim()
      return name ? { ...user, name } : null
    })
    .filter(Boolean), [userOptions])
  const allUserList = useMemo(() => allUserOptions
    .map(user => {
      if (!user || typeof user !== 'object') return null
      const name = String(user.name || user.display_name || '').trim()
      return name ? { ...user, name } : null
    })
    .filter(Boolean), [allUserOptions])
  const sortedUsers = useMemo(() => ['-', ...userList.map(user => user.name)], [userList])
  const userByName = useMemo(() => new Map(allUserList.map(user => [user.name, user])), [allUserList])
  const userByNormalizedName = useMemo(() => new Map(allUserList.map(user => [user.name.toLowerCase(), user])), [allUserList])
  const clientOptions = useMemo(() => canonicalClients(dbClients), [dbClients])
  const matchingClients = useMemo(() => clientOptions
    .filter(client => `${clientName(client)} ${client.client_display_id || ''}`.toLowerCase().includes(clientSearch.trim().toLowerCase())), [clientOptions, clientSearch])
  const roleOptions = useMemo(() => {
    const map = new Map()
    allJobs.forEach(job => {
      const role = (job.role || job.title || '').trim()
      if (!role) return
      const key = role.toLowerCase()
      if (!map.has(key)) map.set(key, { role, job_display_id: job.job_display_id || job.job_id || '' })
    })
    return [...map.values()].sort((a, b) => a.role.localeCompare(b.role, undefined, { sensitivity: 'base' }))
  }, [allJobs])
  const matchingRoles = useMemo(() => roleOptions
    .filter(job => `${job.role} ${job.job_display_id || ''}`.toLowerCase().includes(roleSearch.trim().toLowerCase())), [roleOptions, roleSearch])
  const matchingSectors = useMemo(() => SECTOR_OPTIONS.filter(value => value.toLowerCase().includes(sectorSearch.trim().toLowerCase())), [sectorSearch])
  const matchingTeamLeads = useMemo(() => {
    const query = teamLeadSearch.trim().toLowerCase()
    return sortedUsers.filter(user => user === '-' || user.toLowerCase().includes(query))
  }, [sortedUsers, teamLeadSearch])
  const consultantFields = Array.isArray(form.consultants) && form.consultants.length
    ? form.consultants.map(item => displayUserLabel(item) || '-')
    : ['-']
  const selectedConsultants = normalizeConsultantFields(consultantFields)
  const resolveConsultantName = (index, fallbackName) => {
    const text = String(consultantSearch[index] ?? fallbackName ?? '').replace(/\s+/g, ' ').trim()
    if (!text || text === '-') return '-'
    return userByNormalizedName.get(text.toLowerCase())?.name || text
  }
  const resolvedSelectedConsultants = normalizeConsultantFields(
    consultantFields.map((name, index) => resolveConsultantName(index, name))
  )
  const resolveTeamLeadUser = () => {
    const text = String(teamLeadSearch || form.team_lead || '').replace(/\s+/g, ' ').trim()
    if (!text || text === '-') return null
    return userByNormalizedName.get(text.toLowerCase()) || null
  }
  const availableColumns = MANDATE_TABLE_COLUMNS.filter(column => !isColumnHidden(permissions, 'jobs', MANDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const customizableColumns = availableColumns.filter(column => !column.required)
  const activeColumns = isDashboardEmbed
    ? availableColumns
    : availableColumns.filter(column => column.required || visibleColumns.includes(column.key))
  const mandateTableMinWidth = activeColumns.reduce((sum, column) => sum + (column.width || 140), 0)
  const hasActiveMandateFilters = Boolean(aiFilters) || Boolean(
    dashboardFilters && Object.values(dashboardFilters).some(value => String(value || '').trim())
  )
  const jobFieldPermission = {
    job_display_id: 'job_display_id',
    allocation_date: 'allocation_date',
    consultants: 'consultants',
    team_lead: 'team_lead',
    client_name: 'client_name',
    client_id: 'client_id',
    title: 'title',
    location: 'city',
    budget: 'budget',
    mandate_status: 'mandate_status',
    vertical: 'vertical',
    jd_file: 'jd_storage_path',
    comments: 'comments',
    public_careers_listing: 'public_careers_listing'
  }
  const isJobFieldHidden = (name) => isColumnHidden(permissions, 'jobs', jobFieldPermission[name] || name, isAdmin)
  const isJobFieldDisabled = (name) => isColumnDisabled(permissions, 'jobs', jobFieldPermission[name] || name, isAdmin)

  const updateJobLockState = async (record) => {
    setJobs(current => current.map(job => job.id === record.id ? { ...job, ...record } : job))
    setAllJobs(current => current.map(job => job.id === record.id ? { ...job, ...record } : job))
    await fetchData()
    await refreshClientOptions()
  }

  const togglePendingColumn = (key) => {
    setPendingColumns(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const proceedColumns = () => {
    const allowed = customizableColumns.map(column => column.key)
    const next = pendingColumns.filter(key => allowed.includes(key))
    setVisibleColumns(next)
    storeMandateColumns(next)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const allowed = customizableColumns.map(column => column.key)
      const value = pendingColumns.filter(key => allowed.includes(key))
      const response = await fetch('/api/user-preferences/mandates_columns_preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, value })
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail || payload.error || 'Unable to save column preference.')
      }
      setSavedColumns(value)
      storeMandateColumns(value)
    } catch (err) {
      setError(err.message)
    }
  }

  const resetColumnsToSaved = () => {
    const allowedKeys = new Set(customizableColumns.map(column => column.key))
    const value = (savedColumns?.length ? savedColumns : DEFAULT_MANDATE_COLUMN_KEYS).filter(key => allowedKeys.has(key))
    setPendingColumns(value)
    setVisibleColumns(value)
    storeMandateColumns(value)
    setColumnsOpen(false)
  }

  const validate = () => {
    const next = {}
    if (!form.job_display_id) next.job_display_id = 'Job ID is required'
    if (!form.client_id) next.client_id = clientSearch.trim() ? 'Please select a valid client from the dropdown.' : 'Client Name is required'
    if (!form.role.trim()) next.role = 'Role is required'
    if (!editingJob && form.role.trim() && !roleSelectionConfirmed) next.role = 'Select a role from the dropdown or choose Add New Role first.'
    const realConsultants = resolvedSelectedConsultants.filter(name => name !== '-')
    if (new Set(realConsultants).size !== realConsultants.length) next.consultants = 'Consultants cannot be duplicated'
    const invalidConsultant = Object.entries(consultantSearch).some(([index, value]) => {
      const text = String(value || '').trim()
      const selected = selectedConsultants[Number(index)]
      return text && text !== '-' && selected && text !== selected && !userByNormalizedName.has(text.toLowerCase())
    })
    if (invalidConsultant) next.consultants = 'Please select a valid consultant from the dropdown.'
    if (teamLeadSearch.trim() && teamLeadSearch !== '-' && !resolveTeamLeadUser()) next.team_lead = 'Please select a valid team lead from the dropdown.'
    if (form.is_public && publicListingFormChanged(form, editingJob) && !isJobFieldHidden('public_careers_listing') && !isJobFieldDisabled('public_careers_listing')) {
      if (!String(form.public_name || '').trim()) next.public_name = 'Public Role Name is required.'
      if (!String(form.public_location || '').trim()) next.public_location = 'Public Location is required.'
      if (!String(form.public_experience || '').trim()) next.public_experience = 'Public Experience is required.'
      if (!form.application_deadline) next.application_deadline = 'Application Deadline is required.'
      else if (form.application_deadline < indiaToday()) next.application_deadline = 'Application Deadline cannot be in the past in Asia/Kolkata.'
      if (!String(form.public_jd || '').trim()) next.public_jd = 'Public JD is required.'
      if (normalizeMandateStatus(form.mandate_status) !== 'Ongoing (P1)') next.is_public = 'Only an Ongoing (P1) mandate can be published.'
    }
    return next
  }

  const closeMandateModal = () => {
    setIsOpen(false)
    setMandateDuplicate(null)
    setDuplicateBypass(false)
    setDuplicateMoreOpen(false)
    setSavedJdAttachments([])
    setPendingJdFiles([])
    setPendingJdLinks([])
    setJdLinkInput('')
    setRemovedJdPaths([])
  }

  const selectJdFiles = (event) => {
    const { accepted, errors: fileErrors } = validateDocumentSelection(event.target.files, { label: 'JD file' })
    const availableSlots = Math.max(0, MAX_JD_FILES_PER_SAVE - pendingJdFiles.length)
    const filesToAdd = accepted.slice(0, availableSlots)
    const selectionErrors = [
      ...fileErrors,
      ...accepted.slice(availableSlots).map(file => `${file.name}: no more than ${MAX_JD_FILES_PER_SAVE} new JD files can be uploaded at once.`)
    ]
    if (filesToAdd.length) setPendingJdFiles(current => [...current, ...filesToAdd])
    setErrors(current => {
      const next = { ...current }
      if (selectionErrors.length) next.jd_files = selectionErrors.join(' ')
      else delete next.jd_files
      return next
    })
    event.target.value = ''
  }

  const removeSavedJd = (attachment) => {
    if (!attachment?.path) return
    setRemovedJdPaths(current => current.includes(attachment.path) ? current : [...current, attachment.path])
  }

  const removePendingJd = (index) => {
    setPendingJdFiles(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const addJdLink = () => {
    const path = normalizeExternalUrl(jdLinkInput)
    if (!path) {
      setErrors(current => ({ ...current, jd_link: 'Please enter a valid HTTP or HTTPS link.' }))
      return
    }
    const savedMatch = savedJdAttachments.find(attachment => attachment.path === path)
    if (savedMatch) {
      if (removedJdPaths.includes(path)) {
        setRemovedJdPaths(current => current.filter(item => item !== path))
        setJdLinkInput('')
        setErrors(current => {
          const next = { ...current }
          delete next.jd_link
          return next
        })
        return
      }
      setErrors(current => ({ ...current, jd_link: 'This Mandate Sheet link has already been added.' }))
      return
    }
    if (pendingJdLinks.some(attachment => attachment.path === path)) {
      setErrors(current => ({ ...current, jd_link: 'This Mandate Sheet link has already been added.' }))
      return
    }
    if (pendingJdLinks.length >= MAX_JD_LINKS_PER_SAVE) {
      setErrors(current => ({ ...current, jd_link: `No more than ${MAX_JD_LINKS_PER_SAVE} new Mandate Sheet links can be added at once.` }))
      return
    }
    setPendingJdLinks(current => [...current, jdLinkAttachment(path)])
    setJdLinkInput('')
    setErrors(current => {
      const next = { ...current }
      delete next.jd_link
      return next
    })
  }

  const removePendingJdLink = (index) => {
    setPendingJdLinks(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const resolveMandateDuplicate = (duplicateAction) => {
    if (!mandateDuplicate) return
    if (duplicateAction === 'add_duplicate') {
      setDuplicateBypass(true)
      setMandateDuplicate(null)
      setDuplicateMoreOpen(false)
      return
    }
    const existing = mandateDuplicate.existing
    setMandateDuplicate(null)
    setDuplicateMoreOpen(false)
    if (existing) editJob(existing)
  }

  const duplicateMandateValue = (row, key) => {
    switch (key) {
      case 'jobId': return row.job_display_id || '-'
      case 'consultant': return Array.isArray(row.consultants) && row.consultants.length ? row.consultants.join(', ') : '-'
      case 'teamLead': return row.team_lead || '-'
      case 'clientId': return row.client_display_id || '-'
      case 'clientName': return row.client_name || row.client || '-'
      case 'role': return row.role || row.title || '-'
      case 'budget': return row.budget || '-'
      case 'mandateStatus': return row.mandate_status || row.status || '-'
      case 'sector': return row.vertical || '-'
      case 'allocationDate': return formatDateDDMMYYYY(row.allocation_date)
      case 'jd': return jobJdAttachments(row).length || row.jd_file || row.jd_files ? 'JD' : '-'
      default: return '-'
    }
  }

  const duplicateMandateValuesDiffer = (existing, incoming, key) => (
    String(duplicateMandateValue(existing, key) ?? '').replace(/\s+/g, ' ').trim() !==
    String(duplicateMandateValue(incoming, key) ?? '').replace(/\s+/g, ' ').trim()
  )

  const saveJob = async () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      const normalizedConsultants = normalizeConsultantFields(resolvedSelectedConsultants).filter(name => name !== '-')
      const normalizedConsultantIds = [...new Set(normalizedConsultants.map(name => userByNormalizedName.get(name.toLowerCase())?.id || '').filter(Boolean))]
      const teamLeadUser = resolveTeamLeadUser()
      const teamLeadName = teamLeadUser?.name || (form.team_lead && form.team_lead !== '-' ? form.team_lead : '')
      const payload = {
        consultants: normalizedConsultants,
        consultant_user_ids: normalizedConsultantIds,
        team_lead: teamLeadName || null,
        team_lead_user_id: teamLeadUser?.id || '',
        client_id: form.client_id,
        role: form.role,
        location: form.location,
        budget: form.budget,
        mandate_status: form.mandate_status || null,
        vertical: form.vertical,
        allocation_date: form.allocation_date
      }
      if (!isJobFieldHidden('public_careers_listing') && !isJobFieldDisabled('public_careers_listing')) {
        Object.assign(payload, {
          is_public: Boolean(form.is_public),
          public_name: String(form.public_name || '').trim(),
          public_location: String(form.public_location || '').trim(),
          public_experience: String(form.public_experience || '').trim(),
          public_skills: normalizePublicSkills(form.public_skills),
          application_deadline: form.application_deadline || '',
          public_jd: String(form.public_jd || '').trim()
        })
      }
      const body = new FormData()
      Object.entries(payload).forEach(([key, value]) => body.append(key, key === 'public_skills' ? JSON.stringify(value) : Array.isArray(value) ? value.join(',') : value ?? ''))
      if (!editingJob && duplicateBypass) body.append('duplicate_action', 'add_duplicate')
      pendingJdFiles.forEach(file => body.append('jd_files', file))
      if (pendingJdLinks.length) body.append('jd_links', JSON.stringify(pendingJdLinks))
      if (editingJob && removedJdPaths.length) body.append('removed_jd_paths', JSON.stringify(removedJdPaths))
      const res = await apiFetch(editingJob ? `/api/jobs/${editingJob.id}` : '/api/jobs', {
        method: editingJob ? 'PATCH' : 'POST',
        body
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.duplicate) {
        const selectedClient = clientOptions.find(client => client.id === form.client_id)
        setMandateDuplicate({
          existing: data.existing,
          allowAddDuplicate: data.allowAddDuplicate !== false,
          message: data.error,
          mandate: {
            ...payload,
            job_display_id: form.job_display_id,
            client_name: clientSearch,
            client_display_id: selectedClient?.client_display_id || '',
            jd_file: [...pendingJdFiles.map(file => file.name), ...pendingJdLinks.map(link => link.name)].join(', ')
          }
        })
        setDuplicateBypass(false)
        return
      }
      if (!res.ok) throw new Error(data.error || 'Failed to save mandate.')
      closeMandateModal()
      setEditingJob(null)
      await fetchData()
      await refreshClientOptions()
      window.dispatchEvent(new Event('ats:jobs-updated'))
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setSaving(false)
    }
  }

  const applyAiFilter = async (event) => {
    event.preventDefault()
    const prompt = aiText.trim()
    if (!prompt) {
      clearFilters()
      return
    }
    const requestId = ++aiFilterRequestRef.current
    aiFilterAbortRef.current?.abort()
    const controller = new AbortController()
    aiFilterAbortRef.current = controller
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/jobs/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      })
      const data = await res.json().catch(() => ({}))
      if (requestId !== aiFilterRequestRef.current || controller.signal.aborted) return
      if (!res.ok) throw new Error(data.error || 'Could not parse Mandates filter.')
      if (!isSupportedIntentFilter(data.filters)) {
        throw new Error("I couldn't confidently understand this filter. Try specifying a mandate field, condition, and value.")
      }
      setAiFilters(data.filters)
      setPage(1)
    } catch (err) {
      if (requestId !== aiFilterRequestRef.current || controller.signal.aborted || err?.name === 'AbortError') return
      notifyAiQuota(err.message)
      setAiError(err.message || "I couldn't confidently understand this filter. Try specifying a mandate field, condition, and value.")
    } finally {
      if (aiFilterAbortRef.current === controller) aiFilterAbortRef.current = null
      if (requestId === aiFilterRequestRef.current) setAiLoading(false)
    }
  }

  const clearFilters = () => {
    aiFilterRequestRef.current += 1
    aiFilterAbortRef.current?.abort()
    aiFilterAbortRef.current = null
    setAiText('')
    setAiFilters(null)
    setAiError('')
    setListError('')
    setAiLoading(false)
    setPage(1)
  }

  const selectSort = (field) => {
    setSortDirection(current => sortField === field && current === 'asc' ? 'desc' : 'asc')
    setSortField(field)
    setPage(1)
    setSortOpen(false)
  }

  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    return option ? `${option.label} ${sortDirection === 'desc' ? '↑' : '↓'}` : 'Sort By'
  }

  const addConsultant = () => {
    setForm(current => {
      const nextConsultants = normalizeConsultantFields(current.consultants)
      return { ...current, consultants: [...nextConsultants, '-'] }
    })
  }

  const updateConsultant = (index, value) => {
    const label = displayUserLabel(value) || '-'
    setConsultantSearch(current => {
      const nextSearch = {}
      Object.entries(current).forEach(([key, item]) => {
        const numericKey = Number(key)
        if (label === '-') {
          if (numericKey < index) nextSearch[numericKey] = item
          else if (numericKey > index) nextSearch[numericKey - 1] = item
        } else if (numericKey === index) {
          nextSearch[numericKey] = label
        } else {
          nextSearch[numericKey] = item
        }
      })
      return nextSearch
    })
    setConsultantPickerOpen(current => {
      const nextOpen = {}
      Object.entries(current).forEach(([key, item]) => {
        const numericKey = Number(key)
        if (label === '-') {
          if (numericKey < index) nextOpen[numericKey] = item
          else if (numericKey > index) nextOpen[numericKey - 1] = item
        } else if (numericKey !== index) {
          nextOpen[numericKey] = item
        }
      })
      return nextOpen
    })
    setForm(current => {
      const currentFields = Array.isArray(current.consultants) && current.consultants.length
        ? current.consultants.map(item => displayUserLabel(item) || '-')
        : ['-']
      const next = [...currentFields]
      if (label === '-') {
        if (next.length > 1) next.splice(index, 1)
        else next[0] = '-'
      } else {
        const duplicateIndex = next.findIndex((item, itemIndex) => item === label && itemIndex !== index)
        if (duplicateIndex !== -1) {
          setErrors(currentErrors => ({ ...currentErrors, consultants: 'This consultant is already selected.' }))
          return current
        }
        setErrors(currentErrors => {
          if (!currentErrors.consultants) return currentErrors
          const nextErrors = { ...currentErrors }
          delete nextErrors.consultants
          return nextErrors
        })
        next[index] = label
      }
      const normalized = next.filter(Boolean)
      const real = normalized.filter(name => name !== '-')
      return {
        ...current,
        consultants: normalized.length ? normalized : ['-'],
        consultant_user_ids: [...new Set(real.map(name => userByNormalizedName.get(name.toLowerCase())?.id || '').filter(Boolean))]
      }
    })
  }
  const matchingConsultants = (index) => {
    const query = String(consultantSearch[index] || '').trim().toLowerCase()
    const currentFields = Array.isArray(form.consultants) && form.consultants.length ? form.consultants.map(item => displayUserLabel(item) || '-') : ['-']
    return sortedUsers.filter(user => user === '-' || (!currentFields.some((selected, selectedIndex) => selectedIndex !== index && selected === user) && user.toLowerCase().includes(query)))
  }

  const openMandateCandidates = (job) => {
    if (!job?.client_id || !job?.id) return
    navigate(`/dashboard/clients/${job.client_id}`, {
      state: {
        selectedJobId: job.id,
        selectedJobTitle: job.role || job.title || ''
      }
    })
  }

  const updateMandateStatus = async (job, status) => {
    setStatusSaving(current => ({ ...current, [job.id]: true }))
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mandate_status: status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update mandate status.')
      setJobs(rows => rows.map(row => row.id === job.id ? { ...row, mandate_status: status, status } : row))
      setTablePopover(null)
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setStatusSaving(current => ({ ...current, [job.id]: false }))
    }
  }

  const setPublicFormField = (field, value) => {
    setPublicFieldsTouched(current => ({ ...current, [field]: true }))
    setForm(current => ({ ...current, [field]: value }))
    setErrors(current => {
      if (!current[field] && !(field === 'is_public' && current.is_public)) return current
      const next = { ...current }
      delete next[field]
      if (field === 'is_public') delete next.is_public
      return next
    })
  }

  const showPublicActionNotice = (message, type = 'success') => {
    publicNoticeSequenceRef.current += 1
    setPublicActionNotice({ id: publicNoticeSequenceRef.current, message, type, visible: true })
  }

  const addPublicSkill = () => {
    const skill = String(publicSkillInput || '').trim().replace(/[,;]+$/, '')
    if (!skill) return
    setPublicFieldsTouched(current => ({ ...current, public_skills: true }))
    setForm(current => ({ ...current, public_skills: normalizePublicSkills([...(current.public_skills || []), skill]) }))
    setPublicSkillInput('')
    setErrors(current => ({ ...current, public_skills: '' }))
  }

  const removePublicSkill = (skill) => {
    setPublicFieldsTouched(current => ({ ...current, public_skills: true }))
    setForm(current => ({ ...current, public_skills: normalizePublicSkills(current.public_skills).filter(item => item !== skill) }))
  }

  const updatePublicVisibility = async (job, isPublic) => {
    if (!job?.id || isPublic || publicActionSaving[job.id] || (job.is_locked && !isAdmin) || isJobFieldHidden('public_careers_listing') || isJobFieldDisabled('public_careers_listing')) return
    setPublicActionSaving(current => ({ ...current, [job.id]: true }))
    try {
      const response = await apiFetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: isPublic }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Unable to ${isPublic ? 'publish' : 'unpublish'} this role.`)
      setJobs(current => current.map(row => row.id === job.id ? { ...row, ...payload } : row))
      setAllJobs(current => current.map(row => row.id === job.id ? { ...row, ...payload } : row))
      window.dispatchEvent(new Event('ats:public-roles-updated'))
    } catch (actionError) {
      showPublicActionNotice(actionError.message || 'Unable to unpublish this mandate.', 'error')
    } finally {
      setPublicActionSaving(current => ({ ...current, [job.id]: false }))
    }
  }

  const publicRoleUrl = job => `${window.location.origin}/open-roles/${encodeURIComponent(job.public_slug)}`
  const previewPublicListing = job => {
    const opened = window.open(publicRoleUrl(job), '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
  }
  const copyPublicLink = async job => {
    try {
      await navigator.clipboard.writeText(publicRoleUrl(job))
    } catch {
      showPublicActionNotice('Could not copy the public link. Please use Preview Public Listing and copy it from the browser.', 'error')
    }
  }

  const toggleTablePopover = (type, id, element) => {
    if (!element) return
    const anchorRect = element.getBoundingClientRect()
    setTablePopover(current => current?.type === type && current.id === id ? null : { type, id, anchorRect })
  }

  const renderMandateCell = (column, job) => {
    switch (column.key) {
      case 'jobId':
        return <td key={column.key}>{job.job_display_id ? <span className="table-id-chip table-job-id-chip">{job.job_display_id}</span> : mutedDash}</td>
      case 'consultant':
        return <td key={column.key}><ConsultantPillGroup consultants={job.consultants} onClick={(event) => toggleTablePopover('consultants', job.id, event.currentTarget)} /></td>
      case 'teamLead':
        return <td key={column.key}>{highlightText(dash(job.team_lead), aiFilters)}</td>
      case 'clientId':
        return <td key={column.key}>{job.client_display_id ? <span className="table-id-chip table-client-id-chip">{job.client_display_id}</span> : mutedDash}</td>
      case 'clientName':
        return <td key={column.key}>{highlightText(dash(job.client_name), aiFilters)}</td>
      case 'role':
        return (
          <td key={column.key}>
            <div>
              <button className="table-link-button name-text" type="button" onClick={() => openMandateCandidates(job)}>{job.is_locked && <Lock size={12} className="fb-lock-icon" />} {highlightText(dash(job.role), aiFilters)}</button>
              <div className="sub-text candidate-location-text">{highlightText(formatLocationText(job.location) || '-', aiFilters)}</div>
            </div>
          </td>
        )
      case 'budget':
        return <td key={column.key}>{highlightText(dash(job.budget), aiFilters)}</td>
      case 'mandateStatus':
        {
          const status = normalizeMandateStatus(job.mandate_status || job.status || job.priority)
          return (
            <td key={column.key}>
              <div className="candidate-columns-control mandate-status-control">
                <button className={`badge ${MANDATE_STATUS_BADGE_MAP[status] || ''}`} type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('status', job.id, event.currentTarget)} disabled={statusSaving[job.id]}>
                  {highlightText(mandateStatusLabel(status), aiFilters)}
                </button>
              </div>
            </td>
          )
        }
      case 'sector':
        return <td key={column.key}>{highlightText(dash(job.vertical), aiFilters)}</td>
      case 'allocationDate':
        return <td key={column.key}>{formatDateDDMMYYYY(job.allocation_date)}</td>
      case 'jd':
        {
          const attachments = jobJdAttachments(job)
          return (
            <td key={column.key}>
              <DocumentIconGroup
                attachments={attachments}
                keyPrefix={`jd-${job.id}`}
                openingKey={openingDocument}
                onOpen={(key, attachment) => openDocument(key, attachment.path, job.id)}
                showExternalLinkIcon
              />
            </td>
          )
        }
      case 'publicState':
        {
          const state = job.public_state || publicListingState(job)
          return <td key={column.key}><span className={`mandate-public-state mandate-public-state-${state.toLowerCase().replace(/\s+/g, '-')}`}>{state}</span></td>
        }
      case 'action':
        {
          const state = job.public_state || publicListingState(job)
          const showPublicActions = !isJobFieldHidden('public_careers_listing')
          const publicActionDisabled = publicActionSaving[job.id] || (job.is_locked && !isAdmin) || isJobFieldDisabled('public_careers_listing')
          return <td key={column.key}><div className="row-actions mandate-row-actions">
            <button className="row-action-btn" type="button" title="Edit Mandate" onClick={() => editJob(job)} disabled={job.is_locked && !isAdmin}><Pencil size={13} /></button>
            {showPublicActions && state === 'Published' && <button className="row-action-btn" type="button" title="Preview Public Listing" onClick={() => previewPublicListing(job)}><ExternalLink size={13} /></button>}
            {showPublicActions && state === 'Published' && <button className="row-action-btn" type="button" title="Copy Public Link" onClick={() => copyPublicLink(job)}><Copy size={13} /></button>}
            {showPublicActions && (job.is_public
              ? <button className="row-action-btn mandate-public-toggle-action" type="button" title="Unpublish mandate" onClick={() => updatePublicVisibility(job, false)} disabled={publicActionDisabled}>{publicActionSaving[job.id] ? <Loader2 size={13} className="spin" aria-label="Unpublishing mandate" /> : <Globe2 size={13} />}</button>
              : <span className="mandate-public-disabled-wrap" title="Configure and publish this mandate from Edit Mandate"><button className="row-action-btn mandate-public-toggle-action is-disabled" type="button" aria-label="Configure and publish this mandate from Edit Mandate" disabled><Globe2 size={13} /></button></span>)}
            {isAdmin && <RecordLockButton tableName="jobs" recordId={job.id} locked={job.is_locked} onChanged={updateJobLockState} />}
          </div></td>
        }
      default:
        return null
    }
  }

  return (
    <div className="candidates-page">
      <div className="candidate-columns-toolbar candidates-toolbar">
        <NewActionDropdown
          onUploadResumes={() => navigate('/dashboard/candidates', { state: { action: 'upload-resumes' } })}
          onAddCandidate={() => navigate('/dashboard/candidates', { state: { action: 'add-candidate' } })}
          onAddClient={() => navigate('/dashboard/clients', { state: { action: 'add-client' } })}
          onAddJob={openModal}
        />
        <div className="candidate-columns-control" ref={columnsDropdownRef}>
          <button className="filter-select candidate-columns-btn" type="button" onClick={(event) => { setPendingColumns(visibleColumns); setColumnsAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setColumnsOpen(open => !open) }}>
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
          {columnsOpen && (
            <FloatingDropdown anchorRect={columnsAnchor?.rect} ignoreElement={columnsDropdownRef.current || columnsAnchor?.element} className="candidate-columns-dropdown" width={176} onClose={() => { setPendingColumns(visibleColumns); setColumnsOpen(false) }}>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(customizableColumns.map(column => column.key))}>Select All</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
              <button className="candidate-columns-action" type="button" onClick={resetColumnsToSaved}>Reset to Saved Preference</button>
              <div className="candidate-columns-divider" />
              {customizableColumns.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />
                  {column.label}
                </label>
              ))}
            </FloatingDropdown>
          )}
        </div>
      </div>

      {publicActionNotice && <div className={`mandate-public-toast mandate-public-toast-${publicActionNotice.type}${publicActionNotice.visible ? ' is-visible' : ' is-hidden'}`} role={publicActionNotice.type === 'error' ? 'alert' : 'status'} aria-live="polite">{publicActionNotice.type === 'error' ? <AlertCircle size={16} /> : <Globe2 size={16} />}<span>{publicActionNotice.message}</span><button type="button" onClick={() => setPublicActionNotice(null)} aria-label="Dismiss public listing notice"><X size={13} /></button></div>}

      <div className="filter-bar candidates-filter-bar candidates-toolbar">
        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input
            className="filter-input candidate-ai-filter-input"
            value={aiText}
            onChange={e => {
              aiFilterRequestRef.current += 1
              aiFilterAbortRef.current?.abort()
              aiFilterAbortRef.current = null
              setAiLoading(false)
              setAiText(e.target.value)
              setAiError('')
            }}
          />
          <button className="btn-secondary" type="submit" disabled={aiLoading} style={{ height: 34, padding: '0 12px' }}>
            {aiLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            Apply
          </button>
          <button className="filter-clear" type="button" onClick={clearFilters}>Clear Filters</button>
        </form>
        <div className="filter-divider" />
        <span className="filter-label">Sort By</span>
        <div className="candidate-sort-control" ref={sortRef}>
          <button className="filter-select candidate-sort-btn" type="button" onClick={(event) => { setSortAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setSortOpen(open => !open) }}>
            <span>{sortLabel()}</span><ChevronDown size={13} />
          </button>
          {sortOpen && (
            <FloatingDropdown anchorRect={sortAnchor?.rect} ignoreElement={sortAnchor?.element} className="candidate-sort-dropdown" minWidth={180} onClose={() => setSortOpen(false)}>
              {SORT_OPTIONS.map(option => (
                <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>
                  {`${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}`}
                </button>
              ))}
            </FloatingDropdown>
          )}
        </div>
        <div className="filter-bar-spacer" />
        <CompactPagination page={page} totalPages={Math.max(1, Math.ceil(totalJobs / pageSize))} onPageChange={setPage} loading={loading} />
      </div>
      {aiError && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{aiError}</div>}
      {listError && jobs.length > 0 && (
        <div className="form-error" style={{ display: 'block', marginBottom: 12 }} role="alert">
          {listError} Previous mandate results are still shown.
        </div>
      )}
      {!loading && !error && !listError && !aiError && hasActiveMandateFilters && jobs.length === 0 && (
        <div className="form-error" style={{ display: 'block', marginBottom: 12 }} role="alert">
          No mandates match your filters. Try changing or clearing the filters.
        </div>
      )}

      <div className="table-card table-card-popovers candidates-table-card" style={{ minWidth: `max(100%, ${mandateTableMinWidth}px)` }}>
        {loading ? (
          <div className="table-wrapper candidates-table-scroll">
            <table className="data-table fb-theme-table candidates-master-table candidates-table table-loading-table" aria-label="Loading mandates" style={{ minWidth: mandateTableMinWidth }}>
              <colgroup>{activeColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
              <thead><tr>{activeColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
              <tbody>
                <tr className="table-loading-row">
                  <td className="table-loading-cell" colSpan={Math.max(activeColumns.length, 1)}>
                    <FyndbridgeLoader size={88} label="Loading mandates..." className="table-inline-loader" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : error ? (
          <div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">Error loading data</div><div className="empty-state-desc">{error}</div></div>
        ) : listError && jobs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">Error loading data</div><div className="empty-state-desc">{listError}</div></div>
        ) : jobs.length === 0 ? (
          <div className="table-wrapper candidates-table-scroll">
            <table className="data-table fb-theme-table candidates-master-table candidates-table table-empty-table" aria-label="Mandates" style={{ minWidth: mandateTableMinWidth }}>
              <colgroup>{activeColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
              <thead><tr>{activeColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
              <tbody>
                <tr className="table-empty-row">
                  <td className="table-empty-cell" colSpan={Math.max(activeColumns.length, 1)}>
                    <div className="empty-state" role="status">
                      <div className="empty-state-icon"><FileText size={28} color="var(--gold)" strokeWidth={1.5} /></div>
                      <div className="empty-state-title">{hasActiveMandateFilters ? 'No mandates match your filters' : 'No mandates found'}</div>
                      <div className="empty-state-desc">{hasActiveMandateFilters ? 'Try changing or clearing the filters to see more mandates.' : 'Create a mandate to get started.'}</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrapper candidates-table-scroll">
            <table className="data-table fb-theme-table candidates-master-table candidates-table" aria-label="Mandates" style={{ minWidth: mandateTableMinWidth }}>
              <colgroup>
                {activeColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {activeColumns.map(column => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    {activeColumns.map(column => renderMandateCell(column, job))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PaginationBar
        page={page}
        totalPages={Math.max(1, Math.ceil(totalJobs / pageSize))}
        total={totalJobs}
        pageSize={pageSize}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
      />

      {tablePopover && (() => {
        const job = jobs.find(item => item.id === tablePopover.id)
        if (!job) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={tablePopover.type === 'status' ? 150 : 180} onClose={() => setTablePopover(null)}>
            {tablePopover.type === 'consultants' ? (
              job.consultants.map(name => <div className="candidate-column-option" key={name}><ConsultantPill name={name} /></div>)
            ) : (
              MANDATE_STATUSES.map(status => (
                <button className="candidate-columns-action" type="button" key={status} onClick={() => updateMandateStatus(job, status)}>
                  {mandateStatusLabel(status)}
                </button>
              ))
            )}
          </TablePopover>
        )
      })()}

      {isOpen && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editingJob ? 'Edit Mandate' : 'Add Mandate'}>
            <div className="modal-header">
              <span className="modal-title">{editingJob ? 'Edit Mandate' : 'Add Mandate'}</span>
              <button className="modal-close" onClick={closeMandateModal} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              {errors.form && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{errors.form}</div>}
              <div className="form-grid-2">
                {!isJobFieldHidden('job_display_id') && <div className="form-group">
                  <label className="form-label">Job ID <span className="req">*</span></label>
                  <input className={`form-control${errors.job_display_id ? ' is-error' : ''}`} value={form.job_display_id || 'Auto-generated'} disabled readOnly />
                  {errors.job_display_id && <span className="form-error">{errors.job_display_id}</span>}
                </div>}
                {!isJobFieldHidden('allocation_date') && <div className="form-group">
                  <label className="form-label">Date of Allocation</label>
                  <FormattedDateInput value={form.allocation_date} onChange={(value) => setForm(current => ({ ...current, allocation_date: value }))} className="form-control" disabled={saving || isJobFieldDisabled('allocation_date')} />
                </div>}
                {!isJobFieldHidden('consultants') && <div className="form-group full">
                  <label className="form-label">Consultant</label>
                  <div className="consultant-picker-list">
                    {consultantFields.map((name, index) => (
                      <div className="client-search-wrap" key={`${name}-${index}`}>
                        <input
                          className="form-control"
                          value={consultantSearch[index] ?? name}
                          onChange={e => {
                            setConsultantSearch(current => ({ ...current, [index]: e.target.value }))
                            setConsultantPickerOpen(current => ({ ...current, [index]: true }))
                          }}
                          onFocus={() => {
                            setConsultantSearch(current => ({ ...current, [index]: current[index] ?? name }))
                            setConsultantPickerOpen(current => ({ ...current, [index]: true }))
                          }}
                          onBlur={() => window.setTimeout(() => setConsultantPickerOpen(current => ({ ...current, [index]: false })), 120)}
                          disabled={saving || isJobFieldDisabled('consultants')}
                          autoComplete="off"
                        />
                        {consultantPickerOpen[index] && (
                          <div className="client-suggestions manual-suggestions is-open">
                            {matchingConsultants(index).length ? matchingConsultants(index).map(user => (
                              <button type="button" key={user} onMouseDown={event => {
                                event.preventDefault()
                                updateConsultant(index, user)
                                setConsultantSearch(current => ({ ...current, [index]: user }))
                                setConsultantPickerOpen(current => ({ ...current, [index]: false }))
                              }}><span>{user}</span></button>
                            )) : <div className="candidate-column-option">No results found</div>}
                          </div>
                        )}
                      </div>
                    ))}
                    <button className="row-action-btn" type="button" title="Add Consultant" onClick={addConsultant} disabled={saving || isJobFieldDisabled('consultants')}><Plus size={13} /></button>
                  </div>
                  {errors.consultants && <span className="form-error">{errors.consultants}</span>}
                </div>}
                {!isJobFieldHidden('team_lead') && <div className="form-group">
                  <label className="form-label">Team Lead</label>
                  <div className="client-search-wrap">
                    <input className="form-control" value={teamLeadSearch || form.team_lead} onChange={e => {
                      setTeamLeadSearch(e.target.value)
                      setForm(current => ({ ...current, team_lead: '', team_lead_user_id: '' }))
                      setTeamLeadOpen(true)
                    }} onFocus={() => setTeamLeadOpen(true)} onBlur={() => window.setTimeout(() => setTeamLeadOpen(false), 120)} disabled={saving || isJobFieldDisabled('team_lead')} autoComplete="off" />
                    {teamLeadOpen && (
                      <div className="client-suggestions manual-suggestions is-open">
                        {matchingTeamLeads.length ? matchingTeamLeads.map(user => (
                          <button type="button" key={user} onMouseDown={event => {
                            event.preventDefault()
                            setTeamLeadSearch(user)
                            setForm(current => ({ ...current, team_lead: user, team_lead_user_id: userByName.get(user)?.id || '' }))
                            setTeamLeadOpen(false)
                          }}><span>{user}</span></button>
                        )) : <div className="candidate-column-option">No results found</div>}
                      </div>
                    )}
                  </div>
                  {errors.team_lead && <span className="form-error">{errors.team_lead}</span>}
                </div>}
                {!isJobFieldHidden('client_name') && <div className="form-group">
                  <label className="form-label">Client Name <span className="req">*</span></label>
                  <div className="client-search-wrap">
                    <input
                      className={`form-control${errors.client_id ? ' is-error' : ''}`}
                      value={clientSearch}
                      onChange={e => {
                        setClientSearch(e.target.value)
                        setForm(current => ({ ...current, client_id: '' }))
                        setClientSuggestionsOpen(true)
                      }}
                      onFocus={() => {
                        setClientSuggestionsOpen(true)
                        refreshClientOptions()
                      }}
                      onBlur={() => window.setTimeout(() => setClientSuggestionsOpen(false), 120)}
                      placeholder={dbClients.length ? 'Search client...' : 'Loading clients...'}
                      disabled={saving || isJobFieldDisabled('client_name')}
                      autoComplete="off"
                    />
                    {clientSuggestionsOpen && (
                    <div className="client-suggestions manual-suggestions is-open">
                      {matchingClients.map(client => (
                        <button type="button" key={client.id} onMouseDown={(event) => {
                          event.preventDefault()
                          setClientSearch(clientName(client))
                          setForm(current => ({ ...current, client_id: client.id }))
                          setClientSuggestionsOpen(false)
                        }}>
                          <span>{clientName(client)}</span>
                          <small>{client.client_display_id || ''}</small>
                        </button>
                      ))}
                    </div>
                    )}
                  </div>
                  {errors.client_id && <span className="form-error">{errors.client_id}</span>}
                </div>}
                {!isJobFieldHidden('client_id') && <div className="form-group">
                  <label className="form-label">Client ID</label>
                  <input className="form-control" value={clientOptions.find(client => client.id === form.client_id)?.client_display_id || ''} placeholder="Auto-filled after selecting client" disabled readOnly />
                </div>}
                {!isJobFieldHidden('title') && <div className="form-group">
                  <label className="form-label">Role <span className="req">*</span></label>
                  <div className="client-search-wrap">
                    {addingNewRole && (
                      <div className="sub-text" style={{ marginBottom: 6 }}>
                        Adding new role
                        <button type="button" className="filter-clear" style={{ marginLeft: 8 }} onMouseDown={(event) => {
                          event.preventDefault()
                          setAddingNewRole(false)
                          setRoleSelectionConfirmed(false)
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '', ...(!publicFieldsTouched.public_name ? { public_name: '' } : {}) }))
                          setRoleSuggestionsOpen(true)
                        }}>Switch</button>
                      </div>
                    )}
                    <input
                      ref={roleInputRef}
                      className={`form-control${errors.role ? ' is-error' : ''}`}
                      value={roleSearch}
                      onChange={e => {
                        setRoleSearch(e.target.value)
                        setForm(current => ({ ...current, role: e.target.value, ...(!publicFieldsTouched.public_name ? { public_name: e.target.value } : {}) }))
                        if (!addingNewRole) setRoleSelectionConfirmed(false)
                        if (!addingNewRole) setRoleSuggestionsOpen(true)
                      }}
                      onFocus={() => !addingNewRole && setRoleSuggestionsOpen(true)}
                      onBlur={() => window.setTimeout(() => setRoleSuggestionsOpen(false), 120)}
                      disabled={saving || isJobFieldDisabled('title')}
                      autoComplete="off"
                    />
                    {roleSuggestionsOpen && !addingNewRole && (
                      <div className="client-suggestions manual-suggestions is-open">
                        <button type="button" onMouseDown={(event) => {
                          event.preventDefault()
                          setAddingNewRole(true)
                          setRoleSelectionConfirmed(true)
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '', ...(!publicFieldsTouched.public_name ? { public_name: '' } : {}) }))
                          setRoleSuggestionsOpen(false)
                          window.setTimeout(() => roleInputRef.current?.focus(), 0)
                        }}>
                          <span>Add New Role</span>
                        </button>
                        {matchingRoles.map(job => (
                          <button type="button" key={`${job.role}-${job.job_display_id}`} onMouseDown={(event) => {
                            event.preventDefault()
                            setRoleSearch(job.role)
                            setForm(current => ({ ...current, role: job.role, ...(!publicFieldsTouched.public_name ? { public_name: job.role } : {}) }))
                            setAddingNewRole(false)
                            setRoleSelectionConfirmed(true)
                            setRoleSuggestionsOpen(false)
                          }}>
                            <span>{job.role}</span>
                            <small>{job.job_display_id || ''}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.role && <span className="form-error">{errors.role}</span>}
                </div>}
                {!isJobFieldHidden('location') && <div className="form-group">
                  <label className="form-label">Location</label>
                  <input className="form-control" value={form.location} onChange={e => setForm(current => ({ ...current, location: e.target.value, ...(!publicFieldsTouched.public_location ? { public_location: e.target.value } : {}) }))} disabled={saving || isJobFieldDisabled('location')} />
                </div>}
                {!isJobFieldHidden('budget') && <div className="form-group">
                  <label className="form-label">Budget</label>
                  <select className="form-control" value={form.budget} onChange={e => setForm(current => ({ ...current, budget: e.target.value }))} disabled={saving || isJobFieldDisabled('budget')}>
                    <option value="">-</option>
                    {BUDGETS.map(value => <option key={value}>{value}</option>)}
                  </select>
                </div>}
                {!isJobFieldHidden('mandate_status') && <div className="form-group">
                  <label className="form-label">Mandate Status</label>
                  <select className="form-control" value={form.mandate_status} onChange={e => setForm(current => ({ ...current, mandate_status: e.target.value }))} disabled={saving || isJobFieldDisabled('mandate_status')}>
                    {MANDATE_STATUSES.map(value => <option key={value} value={value}>{mandateStatusLabel(value)}</option>)}
                  </select>
                </div>}
                {!isJobFieldHidden('vertical') && <div className="form-group">
                  <label className="form-label">Sector</label>
                  <div className="client-search-wrap">
                    <input className="form-control" value={sectorSearch || form.vertical} onChange={e => {
                      setSectorSearch(e.target.value)
                      setForm(current => ({ ...current, vertical: '' }))
                      setSectorOpen(true)
                    }} onFocus={() => setSectorOpen(true)} onBlur={() => window.setTimeout(() => setSectorOpen(false), 120)} disabled={saving || isJobFieldDisabled('vertical')} autoComplete="off" />
                    {sectorOpen && (
                      <div className="client-suggestions manual-suggestions is-open">
                        {matchingSectors.length ? matchingSectors.map(value => (
                          <button type="button" key={value} onMouseDown={event => {
                            event.preventDefault()
                            setSectorSearch(value)
                            setForm(current => ({ ...current, vertical: value }))
                            setSectorOpen(false)
                          }}><span>{value}</span></button>
                        )) : <div className="candidate-column-option">No results found</div>}
                      </div>
                    )}
                  </div>
                </div>}
                {!isJobFieldHidden('jd_file') && <div className="form-group">
                  <label className="form-label">JD Files or Links</label>
                  <input type="file" multiple accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className={`form-control${errors.jd_files ? ' is-error' : ''}`} onChange={selectJdFiles} disabled={saving || isJobFieldDisabled('jd_file')} />
                  {errors.jd_files && <span className="form-error">{errors.jd_files}</span>}
                  <div className="document-link-input">
                    <input
                      type="url"
                      className={`form-control${errors.jd_link ? ' is-error' : ''}`}
                      value={jdLinkInput}
                      onChange={event => {
                        setJdLinkInput(event.target.value)
                        if (errors.jd_link) setErrors(current => ({ ...current, jd_link: '' }))
                      }}
                      onKeyDown={event => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        addJdLink()
                      }}
                      placeholder="Paste a Mandate Sheet link"
                      aria-label="Mandate Sheet link"
                      disabled={saving || isJobFieldDisabled('jd_file')}
                    />
                    <button className="btn-secondary" type="button" onClick={addJdLink} disabled={saving || isJobFieldDisabled('jd_file') || !jdLinkInput.trim()}>Add Link</button>
                  </div>
                  {errors.jd_link && <span className="form-error">{errors.jd_link}</span>}
                  <AttachmentList
                    saved={savedJdAttachments}
                    pending={pendingJdFiles}
                    pendingAttachments={pendingJdLinks}
                    removedPaths={removedJdPaths}
                    keyPrefix={`jd-form-${editingJob?.id || 'new'}`}
                    openingKey={openingDocument}
                    onOpen={editingJob ? (key, attachment) => openDocument(key, attachment.path, editingJob.id) : undefined}
                    onRemoveSaved={isJobFieldDisabled('jd_file') ? undefined : removeSavedJd}
                    onRemovePending={isJobFieldDisabled('jd_file') ? undefined : removePendingJd}
                    onRemovePendingAttachment={isJobFieldDisabled('jd_file') ? undefined : removePendingJdLink}
                    disabled={saving}
                    showExternalLinkIcon
                  />
                </div>}
                {!isJobFieldHidden('public_careers_listing') && <>
                  <div className="form-section-title mandate-public-section-title"><Globe2 size={14} />Public Careers Listing</div>
                  <div className="form-group full mandate-public-switch-row">
                    <label className="mandate-public-switch">
                      <input type="checkbox" checked={Boolean(form.is_public)} onChange={event => setPublicFormField('is_public', event.target.checked)} disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                      <span><strong>Publish this role</strong><small>Existing and new mandates remain private unless this is enabled and all public details are complete.</small></span>
                    </label>
                    {errors.is_public && <span className="form-error">{errors.is_public}</span>}
                  </div>
                  {Boolean(form.is_public) && <>
                  <div className="form-group">
                    <label className="form-label">Public Role Name <span className="req">*</span></label>
                    <input className={`form-control${errors.public_name ? ' is-error' : ''}`} value={form.public_name} onChange={event => setPublicFormField('public_name', event.target.value)} disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                    {errors.public_name && <span className="form-error">{errors.public_name}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Public Location <span className="req">*</span></label>
                    <input className={`form-control${errors.public_location ? ' is-error' : ''}`} value={form.public_location} onChange={event => setPublicFormField('public_location', event.target.value)} disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                    {errors.public_location && <span className="form-error">{errors.public_location}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Public Experience <span className="req">*</span></label>
                    <input className={`form-control${errors.public_experience ? ' is-error' : ''}`} value={form.public_experience} onChange={event => setPublicFormField('public_experience', event.target.value)} placeholder="For example, 5-8 years" disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                    {errors.public_experience && <span className="form-error">{errors.public_experience}</span>}
                  </div>
                  <div className="form-group full">
                    <label className="form-label">Public Skills <span className="sub-text">(Optional)</span></label>
                    <div className={`tag-input-wrap mandate-public-skills${errors.public_skills ? ' is-error' : ''}`}>
                      {normalizePublicSkills(form.public_skills).map(skill => <span className="tag-chip" key={skill}>{skill}<button className="tag-chip-remove" type="button" onClick={() => removePublicSkill(skill)} disabled={saving || isJobFieldDisabled('public_careers_listing')} aria-label={`Remove ${skill}`}><X size={11} /></button></span>)}
                      <input className="tag-input-field" value={publicSkillInput} onChange={event => setPublicSkillInput(event.target.value)} onKeyDown={event => {
                        if (event.key !== 'Enter' && event.key !== ',') return
                        event.preventDefault()
                        addPublicSkill()
                      }} placeholder="Type a public skill" disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                      <button className="tag-add-btn" type="button" onClick={addPublicSkill} disabled={saving || isJobFieldDisabled('public_careers_listing') || !publicSkillInput.trim()}>Add</button>
                    </div>
                    {errors.public_skills && <span className="form-error">{errors.public_skills}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Application Deadline <span className="req">*</span></label>
                    <input type="date" min={indiaToday()} className={`form-control${errors.application_deadline ? ' is-error' : ''}`} value={form.application_deadline} onChange={event => setPublicFormField('application_deadline', event.target.value)} disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                    {errors.application_deadline && <span className="form-error">{errors.application_deadline}</span>}
                  </div>
                  <div className="form-group full">
                    <label className="form-label">Public JD <span className="req">*</span></label>
                    <textarea rows="8" className={`form-control${errors.public_jd ? ' is-error' : ''}`} value={form.public_jd} onChange={event => setPublicFormField('public_jd', event.target.value)} disabled={saving || isJobFieldDisabled('public_careers_listing')} />
                    <span className="sub-text">Only this text is public. Internal JD files, Mandate Sheet links, client details and internal notes remain private.</span>
                    {errors.public_jd && <span className="form-error">{errors.public_jd}</span>}
                  </div>
                  </>}
                </>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeMandateModal} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveJob} disabled={saving}>{saving ? 'Saving...' : 'Save Mandate'}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {mandateDuplicate && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" ref={duplicateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Duplicate Mandate">
            <div className="modal-header">
              <span className="modal-title">Duplicate Mandate</span>
              <button className="modal-close" onClick={() => setMandateDuplicate(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="review-banner">
                <AlertCircle size={16} />
                {mandateDuplicate.message || 'A mandate with the same role already exists for this client.'}
              </div>
              <div className="duplicate-compare-grid">
                <div className="duplicate-compare-card">
                  <div className="form-section-title">Existing Mandate</div>
                  <div className="name-text">{mandateDuplicate.existing?.role || mandateDuplicate.existing?.title || '-'}</div>
                  <div className="sub-text">{mandateDuplicate.existing?.client_name || mandateDuplicate.existing?.client || '-'}</div>
                  <div className="sub-text">{mandateDuplicate.existing?.job_display_id || '-'}</div>
                </div>
                <div className="duplicate-compare-card">
                  <div className="form-section-title">New Mandate</div>
                  <div className="name-text">{mandateDuplicate.mandate?.role || '-'}</div>
                  <div className="sub-text">{mandateDuplicate.mandate?.client_name || '-'}</div>
                  <div className="sub-text">{mandateDuplicate.mandate?.job_display_id || '-'}</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDuplicateMoreOpen(true)} disabled={saving}>View More</button>
              <button className="btn-secondary" onClick={() => { setMandateDuplicate(null); setDuplicateMoreOpen(false) }} disabled={saving}>Cancel</button>
              {mandateDuplicate.allowAddDuplicate !== false && (
                <button className="btn-secondary" onClick={() => resolveMandateDuplicate('add_duplicate')} disabled={saving}>Add Duplicate</button>
              )}
              <button className="btn-primary" onClick={() => resolveMandateDuplicate('update_current')} disabled={saving}>Update Existing</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {mandateDuplicate && duplicateMoreOpen && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-xl" role="dialog" aria-modal="true" aria-label="Duplicate Mandate Details">
            <div className="modal-header">
              <span className="modal-title">Duplicate Mandate Details</span>
              <button className="modal-close" onClick={() => setDuplicateMoreOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="duplicate-details-scroll">
                <table className="data-table duplicate-details-table">
                  <thead>
                    <tr>
                      <th>Field Name</th>
                      <th>Existing Mandate</th>
                      <th>New Mandate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MANDATE_TABLE_COLUMNS.filter(column => column.key !== 'action').map(column => {
                      const changed = duplicateMandateValuesDiffer(mandateDuplicate.existing || {}, mandateDuplicate.mandate || {}, column.key)
                      return (
                        <tr key={column.key} className={changed ? 'is-different' : ''}>
                          <td className="field-name">{column.label}</td>
                          <td className={changed ? 'diff-cell' : ''}>{duplicateMandateValue(mandateDuplicate.existing || {}, column.key)}</td>
                          <td className={changed ? 'diff-cell' : ''}>{duplicateMandateValue(mandateDuplicate.mandate || {}, column.key)}</td>
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
      ), document.body)}
    </div>
  )
}
