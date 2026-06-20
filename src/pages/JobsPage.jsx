import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, FileText, Loader2, Pencil, Plus, Search, X, Lock } from 'lucide-react'
import NewActionDropdown from '../components/NewActionDropdown'
import { useAdminAccess, isColumnHidden, isColumnDisabled } from '../hooks/useAdminAccess'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import RecordLockButton from '../components/admin/RecordLockButton'
import PaginationBar from '../components/PaginationBar'
import TablePopover from '../components/TablePopover'
import FloatingDropdown from '../components/FloatingDropdown'
import CompactPagination from '../components/CompactPagination'
import FormattedDateInput from '../components/FormattedDateInput'
import { supabase } from '../services/supabaseClient'
import { openProtectedUrl } from '../services/apiClient'
import '../styles/Shared.css'
import { MANDATE_STATUSES, MANDATE_STATUS_BADGE_MAP, normalizeMandateStatus } from '../utils/mandateStatuses'
import { SECTOR_OPTIONS } from '../utils/sectorOptions'
import { highlightText, keywordFilters } from '../utils/aiFilterUi'
import { formatDateDDMMYYYY } from '../utils/dateFormat'

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const SORT_OPTIONS = [
  { field: 'job_id', label: 'Job ID' },
  { field: 'role', label: 'Alphabetic order' }
]
const MANDATE_AI_SEARCH_FIELDS = ['job_id', 'consultant', 'team_lead', 'client_id', 'client_name', 'role', 'location', 'budget', 'experience', 'vertical', 'date_of_allocation', 'mandate_status', 'comments', 'jd']
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
  jd: 'jd_storage_path'
}
const MANDATE_PERMISSION_BY_AI_FIELD = {
  job_id: 'job_display_id',
  consultant: 'consultants',
  team_lead: 'team_lead',
  client_id: 'client_id',
  client_name: 'client_name',
  role: 'title',
  location: 'city',
  budget: 'budget',
  experience: 'experience',
  vertical: 'vertical',
  date_of_allocation: 'allocation_date',
  mandate_status: 'mandate_status',
  comments: 'comments',
  jd: 'jd_storage_path'
}
const MANDATE_TABLE_COLUMNS = [
  { key: 'jobId', label: 'Job ID' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'teamLead', label: 'Team Lead' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'role', label: 'Role' },
  { key: 'budget', label: 'Budget' },
  { key: 'mandateStatus', label: 'Mandate Status' },
  { key: 'sector', label: 'Sector' },
  { key: 'allocationDate', label: 'Date of Allocation' },
  { key: 'jd', label: 'JD' },
  { key: 'action', label: 'Action' }
]
const DEFAULT_MANDATE_COLUMN_KEYS = MANDATE_TABLE_COLUMNS.map(column => column.key)
const REMOVED_MANDATE_COLUMN_KEYS = new Set(['location'])
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
  mandate_status: '',
  vertical: '',
  allocation_date: '',
  jd_url: '',
  jd_storage_path: ''
}

const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
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

export default function JobsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAdmin, permissions } = useAdminAccess()
  const [jobs, setJobs] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [dbClients, setDbClients] = useState([])
  const [userOptions, setUserOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
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
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_MANDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_MANDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const [clientSearch, setClientSearch] = useState('')
  const [jdFile, setJdFile] = useState(null)
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const [roleSuggestionsOpen, setRoleSuggestionsOpen] = useState(false)
  const [addingNewRole, setAddingNewRole] = useState(false)
  const [sectorSearch, setSectorSearch] = useState('')
  const [sectorOpen, setSectorOpen] = useState(false)
  const [teamLeadSearch, setTeamLeadSearch] = useState('')
  const [teamLeadOpen, setTeamLeadOpen] = useState(false)
  const [consultantSearch, setConsultantSearch] = useState({})
  const [consultantPickerOpen, setConsultantPickerOpen] = useState({})
  const modalRef = useRef(null)
  const roleInputRef = useRef(null)
  const sortRef = useRef(null)
  const columnsDropdownRef = useRef(null)
  const pendingRealtimeRefreshRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pageSize))
      if (aiFilters) params.set('ai_filters', JSON.stringify(aiFilters))
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      const [jobsRes, clientsRes, usersRes] = await Promise.all([
        fetch(`/api/jobs?${params.toString()}`),
        fetch('/api/clients?all=true'),
        fetch('/api/jobs/users/options')
      ])
      if (!jobsRes.ok) throw new Error('Failed to fetch mandates.')
      if (!clientsRes.ok) throw new Error('Failed to fetch clients.')
      const jobsData = await jobsRes.json()
      const clientsData = await clientsRes.json()
      const usersData = usersRes.ok ? await usersRes.json() : { data: [] }
      setJobs(jobsData.data || [])
      setTotalJobs(Number(jobsData.total) || 0)
      setPage(Number(jobsData.page) || 1)
      if (import.meta.env.DEV && aiFilters) console.debug('Mandates AI filter', { filters: aiFilters, matched: Number(jobsData.total) || 0 })
      setDbClients(clientsData.data || [])
      setUserOptions(usersData.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [aiFilters, page, pageSize, sortDirection, sortField])

  const openDocument = useCallback(async (key, url) => {
    setOpeningDocument(key)
    try {
      await openProtectedUrl(url)
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
      fetch('/api/clients?all=true'),
      fetch('/api/jobs?all=true')
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
    fetchData()
    refreshClientOptions()
  }, [editingJob, fetchData, isOpen, refreshClientOptions])

  useEffect(() => {
    if ((isOpen || editingJob) || !pendingRealtimeRefreshRef.current) return
    pendingRealtimeRefreshRef.current = false
    fetchData()
    refreshClientOptions()
  }, [editingJob, fetchData, isOpen, refreshClientOptions])

  useRealtimeRefresh({
    channelName: 'realtime:jobs-page',
    tables: ['jobs', 'clients'],
    onChange: refreshJobsRealtime
  })

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
        const userId = currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/mandates_columns_preference?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = Array.isArray(payload.data?.value)
          ? payload.data.value.filter(key => !REMOVED_MANDATE_COLUMN_KEYS.has(key) && DEFAULT_MANDATE_COLUMN_KEYS.includes(key))
          : null
        if (value?.length) {
          setVisibleColumns(value)
          setPendingColumns(value)
          setSavedColumns(value)
        }
      } catch {
        setVisibleColumns(DEFAULT_MANDATE_COLUMN_KEYS)
        setPendingColumns(DEFAULT_MANDATE_COLUMN_KEYS)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(refreshClientOptions, 0)
    return () => window.clearTimeout(timer)
  }, [refreshClientOptions])

  useEffect(() => {
    const refreshClients = () => refreshClientOptions()
    const refreshJobs = () => fetchData()
    window.addEventListener('ats:clients-updated', refreshClients)
    window.addEventListener('ats:jobs-updated', refreshJobs)
    return () => {
      window.removeEventListener('ats:clients-updated', refreshClients)
      window.removeEventListener('ats:jobs-updated', refreshJobs)
    }
  }, [fetchData, refreshClientOptions])

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

  const getFreshActiveConsultantName = useCallback(async () => {
    try {
      const fbUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
      if (fbUser.role === 'Consultant' && fbUser.full_name) {
        return { name: fbUser.full_name, userId: fbUser.id }
      }
      const token = (await supabase?.auth?.getSession())?.data?.session?.access_token
      if (!token) return { name: '', userId: '' }
      const res = await fetch('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } })
      const payload = await res.json()
      const nextName = payload?.data?.full_name || ''
      return { name: nextName, userId: payload?.data?.id || '' }
    } catch {
      return { name: '', userId: '' }
    }
  }, [])

  const fetchNextId = async () => {
    const res = await fetch('/api/jobs/next-display-id')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Unable to load mandate ID')
    return data.job_display_id || ''
  }

  const openModal = useCallback(async () => {
    setEditingJob(null)
    setErrors({})
    setForm({ ...EMPTY_FORM, consultants: ['-'], team_lead: '-', team_lead_user_id: '', job_display_id: 'Loading...', allocation_date: todayLocal() })
    setClientSearch('')
    setRoleSearch('')
    setSectorSearch('')
    setTeamLeadSearch('')
    setTeamLeadOpen(false)
    setConsultantSearch({})
    setConsultantPickerOpen({})
    setAddingNewRole(false)
    setJdFile(null)
    setClientSuggestionsOpen(false)
    setRoleSuggestionsOpen(false)
    setIsOpen(true)
    try {
      const [nextId, profile] = await Promise.all([
        fetchNextId().catch(() => ''),
        getFreshActiveConsultantName().catch(() => ({ name: '' }))
      ])
      await refreshClientOptions()
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
  }, [refreshClientOptions, getFreshActiveConsultantName])

  useEffect(() => {
    const action = location.state?.action
    if (!action) return
    navigate(location.pathname, { replace: true, state: null })
    if (action === 'add-job') openModal()
  }, [location.pathname, location.state?.action, navigate, openModal])

  const editJob = (job) => {
    const consultantFields = normalizeConsultantFields(Array.isArray(job.consultants) ? job.consultants : [])
    const teamLeadValue = displayUserLabel(job.team_lead) || '-'
    setEditingJob(job)
    setErrors({})
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
      mandate_status: normalizeMandateStatus(job.mandate_status || job.status || job.priority) === '-' ? '' : normalizeMandateStatus(job.mandate_status || job.status || job.priority),
      vertical: job.vertical || '',
      allocation_date: job.allocation_date || todayLocal(),
      jd_url: job.jd_url || '',
      jd_storage_path: job.jd_storage_path || ''
    })
    setJdFile(null)
    setClientSearch(job.client_name || '')
    setRoleSearch(job.role || job.title || '')
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
  const sortedUsers = useMemo(() => ['-', ...userList.map(user => user.name)], [userList])
  const userByName = useMemo(() => new Map(userList.map(user => [user.name, user])), [userList])
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
  const activeColumns = MANDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key) && !isColumnHidden(permissions, 'jobs', MANDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const availableColumns = MANDATE_TABLE_COLUMNS.filter(column => !isColumnHidden(permissions, 'jobs', MANDATE_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const visibleAiFields = MANDATE_AI_SEARCH_FIELDS.filter(field => !isColumnHidden(permissions, 'jobs', MANDATE_PERMISSION_BY_AI_FIELD[field], isAdmin))
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
    comments: 'comments'
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
    const allowed = availableColumns.map(column => column.key)
    const next = (pendingColumns.length ? pendingColumns : allowed).filter(key => allowed.includes(key))
    setVisibleColumns(next.length ? next : allowed)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const currentUser = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
      const userId = currentUser?.id || currentUser?.email || 'anonymous'
      const allowed = availableColumns.map(column => column.key)
      const value = (pendingColumns.length ? pendingColumns : allowed).filter(key => allowed.includes(key))
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
    } catch (err) {
      setError(err.message)
    }
  }

  const validate = () => {
    const next = {}
    if (!form.job_display_id) next.job_display_id = 'Job ID is required'
    if (!form.client_id) next.client_id = 'Client Name is required'
    if (!form.role.trim()) next.role = 'Role is required'
    const realConsultants = selectedConsultants.filter(name => name !== '-')
    if (new Set(realConsultants).size !== realConsultants.length) next.consultants = 'Consultants cannot be duplicated'
    return next
  }

  const saveJob = async () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      const normalizedConsultants = normalizeConsultantFields(selectedConsultants).filter(name => name !== '-')
      const normalizedConsultantIds = [...new Set(normalizedConsultants.map(name => userByName.get(name)?.id || '').filter(Boolean))]
      const payload = {
        consultants: normalizedConsultants,
        consultant_user_ids: normalizedConsultantIds,
        team_lead: form.team_lead && form.team_lead !== '-' ? form.team_lead : null,
        team_lead_user_id: form.team_lead && form.team_lead !== '-' ? userByName.get(form.team_lead)?.id || '' : '',
        client_id: form.client_id,
        role: form.role,
        location: form.location,
        budget: form.budget,
        mandate_status: form.mandate_status || null,
        vertical: form.vertical,
        allocation_date: form.allocation_date,
        jd_url: form.jd_url || '',
        jd_storage_path: form.jd_storage_path || ''
      }
      const body = new FormData()
      Object.entries(payload).forEach(([key, value]) => body.append(key, Array.isArray(value) ? value.join(',') : value ?? ''))
      if (jdFile) body.append('jd_file', jdFile)
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const res = await fetch(editingJob ? `/api/jobs/${editingJob.id}` : '/api/jobs', {
        method: editingJob ? 'PATCH' : 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save mandate.')
      setIsOpen(false)
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
    setAiError('')
    if (!aiText.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/jobs/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiText })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAiFilters(keywordFilters('mandates', aiText, visibleAiFields))
        setPage(1)
        return
      }
      setAiFilters(data.filters)
      setPage(1)
    } catch {
      setAiFilters(keywordFilters('mandates', aiText, visibleAiFields))
      setPage(1)
    } finally {
      setAiLoading(false)
    }
  }

  const clearFilters = () => {
    setAiText('')
    setAiFilters(null)
    setAiError('')
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
    setForm(current => {
      const label = displayUserLabel(value) || '-'
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
        consultant_user_ids: [...new Set(real.map(name => userByName.get(name)?.id || '').filter(Boolean))]
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
        return <td key={column.key}>{(job.consultants || []).length <= 1 ? highlightText(dash(job.consultants?.[0]), aiFilters) : <div className="candidate-columns-control mandate-consultants-control"><button className="filter-select compact-select" type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('consultants', job.id, event.currentTarget)}>{highlightText(job.consultants[0], aiFilters)} +{job.consultants.length - 1}</button></div>}</td>
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
        return <td key={column.key}><span className={`badge ${MANDATE_STATUS_BADGE_MAP[normalizeMandateStatus(job.mandate_status || job.status || job.priority)] || ''}`}>{highlightText(dash(normalizeMandateStatus(job.mandate_status || job.status || job.priority)), aiFilters)}</span></td>
      case 'sector':
        return <td key={column.key}>{highlightText(dash(job.vertical), aiFilters)}</td>
      case 'allocationDate':
        return <td key={column.key}>{formatDateDDMMYYYY(job.allocation_date)}</td>
      case 'jd':
        {
          const docKey = `jd-${job.id}`
          return <td key={column.key}>{job.jd_url ? <a href="#" target="_blank" rel="noreferrer" className="cv-table-link" title="Open JD" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openDocument(docKey, job.jd_url) }}>{openingDocument === docKey ? <Loader2 size={15} className="spin" /> : <FileText size={15} />}</a> : '-'}</td>
        }
      case 'action':
        return <td key={column.key}><div className="row-actions"><button className="row-action-btn" type="button" title="Edit Mandate" onClick={() => editJob(job)} disabled={job.is_locked && !isAdmin}><Pencil size={13} /></button>{isAdmin && <RecordLockButton tableName="jobs" recordId={job.id} locked={job.is_locked} onChanged={updateJobLockState} />}</div></td>
      default:
        return null
    }
  }

  return (
    <div>
      <div className="candidate-columns-toolbar">
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
            <FloatingDropdown anchorRect={columnsAnchor?.rect} ignoreElement={columnsAnchor?.element} className="candidate-columns-dropdown" width={176} onClose={() => { setPendingColumns(visibleColumns); setColumnsOpen(false) }}>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(availableColumns.map(column => column.key))}>Select All</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns((savedColumns?.length ? savedColumns : DEFAULT_MANDATE_COLUMN_KEYS).filter(key => availableColumns.some(column => column.key === key)))}>Reset to Saved Preference</button>
              <div className="candidate-columns-divider" />
              {availableColumns.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />
                  {column.label}
                </label>
              ))}
            </FloatingDropdown>
          )}
        </div>
      </div>

      <div className="filter-bar candidates-filter-bar">
        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input className="filter-input candidate-ai-filter-input" value={aiText} onChange={e => { setAiText(e.target.value); setAiError('') }} />
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

      <div className="table-card table-card-popovers">
        {loading ? (
          <div className="loading-state"><Loader2 size={32} className="spin" color="var(--gold)" /><p>Loading mandates...</p></div>
        ) : error ? (
          <div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">Error loading data</div><div className="empty-state-desc">{error}</div></div>
        ) : jobs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No mandates found</div><div className="empty-state-desc">Create a mandate to get started.</div></div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table fb-theme-table candidates-master-table" aria-label="Mandates">
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
              job.consultants.map(name => <div className="candidate-column-option" key={name}>{name}</div>)
            ) : (
              MANDATE_STATUSES.map(status => (
                <button className="candidate-columns-action" type="button" key={status} onClick={() => updateMandateStatus(job, status)}>
                  {status}
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
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
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
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '' }))
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
                        setForm(current => ({ ...current, role: e.target.value }))
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
                          setRoleSearch('')
                          setForm(current => ({ ...current, role: '' }))
                          setRoleSuggestionsOpen(false)
                          window.setTimeout(() => roleInputRef.current?.focus(), 0)
                        }}>
                          <span>Add New Role</span>
                        </button>
                        {matchingRoles.map(job => (
                          <button type="button" key={`${job.role}-${job.job_display_id}`} onMouseDown={(event) => {
                            event.preventDefault()
                            setRoleSearch(job.role)
                            setForm(current => ({ ...current, role: job.role }))
                            setAddingNewRole(false)
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
                  <input className="form-control" value={form.location} onChange={e => setForm(current => ({ ...current, location: e.target.value }))} disabled={saving || isJobFieldDisabled('location')} />
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
                    <option value="">-</option>
                    {MANDATE_STATUSES.map(value => <option key={value}>{value}</option>)}
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
                  <label className="form-label">JD File</label>
                  <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="form-control" onChange={e => setJdFile(e.target.files?.[0] || null)} disabled={saving || isJobFieldDisabled('jd_file')} />
                  {form.jd_url && <a className="cv-table-link" href="#" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openDocument('jd-form', form.jd_url) }}>{openingDocument === 'jd-form' ? <Loader2 size={13} className="spin" /> : <FileText size={13} />} Current JD</a>}
                </div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveJob} disabled={saving}>{saving ? 'Saving...' : 'Save Mandate'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
