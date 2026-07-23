import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useParams, Link } from 'react-router-dom'
import { ChevronDown, ChevronLeft, AlertCircle, Loader2, Briefcase, FileText, Pencil, X } from 'lucide-react'
import '../styles/Shared.css'
import './ClientDetailPage.css'
import { useAuth } from '../context/useAuth'
import { apiCandidateToUi, logCandidateCvOpen, normalizeExternalUrl, openExternalUrl, openProtectedDocumentPath, resolveCandidateCvHref } from '../utils/candidateUtils'
import { CANDIDATE_TABLE_COLUMNS, DEFAULT_CANDIDATE_COLUMN_KEYS, mergeCandidateColumnPreference } from '../utils/candidateTableColumns'
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_BADGE_MAP, CANDIDATE_STATUS_OPTIONS, REQUIRED_CANDIDATE_STATUS_ERROR, isCandidateStatusSelected } from '../utils/candidateStatuses'
import { MANDATE_STATUSES, MANDATE_STATUS_BADGE_MAP, mandateStatusLabel, normalizeMandateStatus } from '../utils/mandateStatuses'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import TablePopover from '../components/TablePopover'
import FloatingDropdown from '../components/FloatingDropdown'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { DocumentIconGroup } from '../components/DocumentAttachments'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { ConsultantPill } from '../components/ConsultantPill'
import { normalizeAttachments } from '../utils/documentAttachments'

const STATUS_BADGE_MAP = CANDIDATE_STATUS_BADGE_MAP
const candidateStatusLabel = (status) => status === 'Offer Declined' ? 'Offered Declined' : status
const MANDATE_SUMMARY_COLUMNS = CANDIDATE_STATUSES.map(status => [status, candidateStatusLabel(status)])
const CLIENT_DETAIL_STATUS_OPTIONS = CANDIDATE_STATUSES.map(value => ({ value, label: candidateStatusLabel(value) }))

const SORT_OPTIONS = [
  { field: 'candidate_id', label: 'Candidate ID', toggle: true },
  { field: 'candidate_name', label: 'Alphabetic Order', toggle: true },
  { field: 'consultant', label: 'Consultant', toggle: false },
]
const RELOCATE_OPTIONS = ['', 'Yes', 'No', 'NA']
const statusLabelForValue = (value) => CLIENT_DETAIL_STATUS_OPTIONS.find(option => option.value === value)?.label || value

const pageSize = 50
const CLIENT_DETAIL_COLUMNS_PREFERENCE_KEY = 'clientDetailMandateCandidatesColumns'
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const previewWords = (value, count = 3) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  return {
    words,
    isLong: words.length > count,
    preview: words.slice(0, count).join(' ')
  }
}
const getJobText = (candidate) => candidate.job || candidate.job_title || candidate.jobTitle || candidate.role || candidate.position || 'Unassigned Mandate'
const jobJdAttachments = (job) => normalizeAttachments(job?.jd_attachments, {
  path: job?.jd_storage_path || job?.jd_url,
  name: job?.jd_file_name || job?.jd_original_name
})
const displayIdNumber = (value, prefix) => Number(String(value || '').replace(new RegExp(`^${prefix}`, 'i'), '')) || Number.MAX_SAFE_INTEGER
const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
const initials = (name) => String(name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
const mutedDash = <span className="table-muted-dash">-</span>
const formatDate = formatDateDDMMYYYY
const formatMonth = formatDateDDMMYYYY
const getCurrentUser = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
  } catch {
    return {}
  }
}
const formatClientDetailCtc = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return '-'
  if (/\u20B9/.test(text) && /lpa/i.test(text)) return text
  const normalized = text.replace(/^rs\.?\s*/i, '').replace(/^\u20B9\s*/i, '').replace(/\s*lpa$/i, '').trim()
  return `\u20B9${normalized} LPA`
}
const formatCandidateCtc = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return '-'
  if (/lpa/i.test(text)) return text
  const normalized = text.replace(/^rs\.?\s*/i, '').replace(/^₹\s*/i, '').trim()
  return `${normalized} LPA`
}
const getNoticeMeta = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return null
  const numeric = Number(text.replace(/[^\d.]/g, ''))
  const label = /days?/i.test(text) ? text : `${text} days`
  if (!Number.isFinite(numeric)) return { label, tone: 'mid' }
  if (numeric <= 30) return { label, tone: 'low' }
  if (numeric < 60) return { label, tone: 'mid' }
  return { label, tone: 'high' }
}
const normalizeSkills = (skills) => {
  if (Array.isArray(skills)) return skills.map(skill => String(skill || '').trim()).filter(Boolean)
  return String(skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
}
const candidateToEditForm = (candidate) => ({
  association_id: candidate.associationId,
  full_name: candidate.name || '',
  email: candidate.email || '',
  mobile_number: candidate.mobile || '',
  city: candidate.city || '',
  state: candidate.state || '',
  location: candidate.location || '',
  current_designation: candidate.designation || '',
  current_company: candidate.currentCompany || '',
  current_organisation: candidate.currentOrganisation || '',
  experience_years: candidate.exp ?? '',
  notice_period: candidate.noticePeriod ?? '',
  open_to_relocate: candidate.openToRelocate || '',
  education: candidate.education || '',
  skills: Array.isArray(candidate.skills) ? candidate.skills.join(', ') : '',
  cv_link: candidate.cvLink || '',
  linkedin_url: candidate.linkedinUrl || '',
  client_id: candidate.clientId || '',
  client_name: candidate.client || '',
  job_title: candidate.job || '',
  consultant_name: candidate.consultantName || candidate.consultant || '',
  status: candidate.status || '',
  current_salary: candidate.salary ?? '',
  expected_salary: candidate.expectedSalary ?? '',
  offered_ctc: candidate.offeredCtc ?? '',
  date_of_joining: candidate.dateOfJoining || '',
  notes: candidate.notes || '',
})

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const location = useLocation()
  const { session } = useAuth()
  const [client, setClient] = useState(null)
  const [clientJobs, setClientJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [page, setPage] = useState(1)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CANDIDATE_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [columnsAnchor, setColumnsAnchor] = useState(null)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [editCandidate, setEditCandidate] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState('')
  const [editErrors, setEditErrors] = useState({})
  const [savingCandidate, setSavingCandidate] = useState(false)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const [expandedCells, setExpandedCells] = useState({})
  const [openingDocument, setOpeningDocument] = useState('')
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)
  const editModalRef = useRef(null)
  const pendingRealtimeRefreshRef = useRef(false)

  const focusPopup = useCallback((ref) => {
    window.requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const target = node.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || node).focus({ preventScroll: true })
    })
  }, [])

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

  const openJdDocument = useCallback(async (key, path, jobId) => {
    setOpeningDocument(key)
    try {
      if (/^https?:\/\//i.test(String(path || '').trim())) {
        openExternalUrl(path)
        return
      }
      await openProtectedDocumentPath('jd', path, {
        recordId: jobId,
        missingMessage: 'JD is missing or needs to be reuploaded',
        notFoundMessage: 'JD not found.'
      })
    } finally {
      setOpeningDocument('')
    }
  }, [])

  useEffect(() => {
    if (!editCandidate) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [editCandidate])

  const fetchAllCandidates = useCallback(async (clientData) => {
    const candidateMap = new Map()
    let nextPage = 1
    const clientName = clientData.name || clientData.client_name || ''
    const rootClientId = clientData.client_group_id || clientData.root_client_id || clientData.id || clientId

    while (true) {
      const results = await Promise.allSettled([
        fetch(`/api/candidates?client_id=${rootClientId}&page=${nextPage}&limit=100`),
        fetch(`/api/candidates?client_name=${encodeURIComponent(clientName)}&page=${nextPage}&limit=100`),
      ])

      const responses = results
        .filter(result => result.status === 'fulfilled' && result.value.ok)
        .map(result => result.value)
      if (!responses.length) throw new Error('Failed to fetch candidate associations.')

      const payloads = await Promise.all(responses.map(response => response.json()))
      payloads.flatMap(payload => payload.data || []).forEach((row) => {
        const clientTextMatches = normalizeText(row.client_name) === normalizeText(clientName)
        if (row.client_id === rootClientId || clientTextMatches) candidateMap.set(row.association_id || row.id, row)
      })
      if (payloads.every(payload => (payload.data || []).length < 100)) break
      nextPage += 1
    }

    return [...candidateMap.values()].map(apiCandidateToUi)
  }, [clientId])

  const refreshDetailData = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) setLoading(true)
      const clientRes = await fetch(`/api/clients/${clientId}`)
      if (clientRes.status === 404) {
        setClient(null)
        return
      }
      if (!clientRes.ok) throw new Error('Failed to fetch client details.')
      const clientData = await clientRes.json()
      const rootClientId = clientData.client_group_id || clientData.root_client_id || clientData.id || clientId
      const [jobsRes, candidateRows] = await Promise.all([
        fetch(`/api/jobs?client_id=${rootClientId}&all=true`),
        fetchAllCandidates(clientData),
      ])
      if (!jobsRes.ok) throw new Error('Failed to fetch client jobs.')
      const jobsPayload = await jobsRes.json()
      setClient(clientData)
      setClientJobs(jobsPayload.data || [])
      setCandidates(candidateRows)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [clientId, fetchAllCandidates])

  useEffect(() => {
    refreshDetailData()
  }, [refreshDetailData])

  const refreshDetailRealtime = useCallback(() => {
    if (editCandidate) {
      pendingRealtimeRefreshRef.current = true
      return
    }
    refreshDetailData({ showLoading: false })
  }, [editCandidate, refreshDetailData])

  useEffect(() => {
    if (editCandidate || !pendingRealtimeRefreshRef.current) return
    pendingRealtimeRefreshRef.current = false
    refreshDetailData({ showLoading: false })
  }, [editCandidate, refreshDetailData])

  useRealtimeRefresh({
    channelName: `realtime:client-detail:${clientId}`,
    tables: ['clients', 'client_follow_ups', 'jobs'],
    onChange: refreshDetailRealtime,
    enabled: Boolean(clientId)
  })

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const currentUser = getCurrentUser()
        const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/${CLIENT_DETAIL_COLUMNS_PREFERENCE_KEY}?user_id=${encodeURIComponent(userId)}`)
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
  }, [session?.user?.id])

  useEffect(() => {
    if (!sortOpen) return
    const handleClickOutside = (event) => {
      if (!sortDropdownRef.current?.contains(event.target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sortOpen])

  const jobGroups = useMemo(() => {
    const groups = new Map()
    clientJobs.forEach((job) => {
      const title = job.title || job.role || 'Unassigned Mandate'
      const key = job.id || normalizeText(`${title}-${job.job_display_id || ''}`)
      groups.set(key, { key, title, candidates: [], relatedJob: job })
    })
    candidates.forEach((candidate) => {
      const matchedJob = clientJobs.find(job => job.id === candidate.jobId) || clientJobs.find(job => (job.job_display_id || '') === (candidate.jobDisplayId || '') && normalizeText(job.title || job.role) === normalizeText(getJobText(candidate)))
      if (!matchedJob) return
      const title = matchedJob.title || matchedJob.role || 'Unassigned Mandate'
      const key = matchedJob.id
      groups.get(key).candidates.push(candidate)
    })

    return [...groups.values()].map((group) => {
      const relatedJob = group.relatedJob || clientJobs.find(job => normalizeText(job.title || job.role) === normalizeText(group.title))
      const stats = CANDIDATE_STATUSES.reduce((acc, status) => {
        acc[status] = group.candidates.filter(c => c.status === status).length
        return acc
      }, { total: group.candidates.length })
      const savedStatus = normalizeMandateStatus(relatedJob?.mandate_status || relatedJob?.status)
      const derivedStatus = savedStatus === 'Scrapped'
        ? 'Scrapped'
        : stats.Hired > 0
          ? 'Completed'
          : savedStatus === '-' ? 'Ongoing (P1)' : savedStatus
      return { ...group, relatedJob, status: derivedStatus, stats }
    }).sort((a, b) => compareText(`${a.title} ${a.relatedJob?.job_display_id || ''}`, `${b.title} ${b.relatedJob?.job_display_id || ''}`))
  }, [candidates, clientJobs])

  const jobCounts = useMemo(() => ({
    ongoing: jobGroups.filter(job => job.status === 'Ongoing (P1)').length,
    delivered: jobGroups.filter(job => job.status === 'Delivered (P2)').length,
    paused: jobGroups.filter(job => job.status === 'Paused (P3)').length,
    scrapped: jobGroups.filter(job => job.status === 'Scrapped').length,
    completed: jobGroups.filter(job => job.status === 'Completed').length,
  }), [jobGroups])

  useEffect(() => {
    const selectedJobId = location.state?.selectedJobId
    const selectedJobTitle = location.state?.selectedJobTitle
    if (!jobGroups.length || selectedGroup || (!selectedJobId && !selectedJobTitle)) return
    const group = jobGroups.find(item => item.relatedJob?.id === selectedJobId) || jobGroups.find(item => normalizeText(item.title) === normalizeText(selectedJobTitle))
    if (!group) return
    const timer = window.setTimeout(() => {
      setSelectedGroup({ groupKey: group.key, jobTitle: group.title, status: '' })
      setPage(1)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [jobGroups, location.state, selectedGroup])

  const calculatedClientStatus = useMemo(() => {
    if (jobGroups.length && jobGroups.every(job => job.status === 'Scrapped')) return 'Inactive'
    if (jobGroups.some(job => ['Ongoing (P1)', 'Delivered (P2)', 'Paused (P3)', 'Completed'].includes(job.status))) return 'Active'
    return client?.status || '-'
  }, [client?.status, jobGroups])

  const selectedCandidates = useMemo(() => {
    if (!selectedGroup) return []
    const group = jobGroups.find(item => item.key === selectedGroup.groupKey)
    const rows = group?.candidates || []
    return selectedGroup.status ? rows.filter(candidate => candidate.status === selectedGroup.status) : rows
  }, [jobGroups, selectedGroup])

  const sortedCandidates = useMemo(() => {
    const rows = [...selectedCandidates]
    const direction = sortDirection === 'desc' ? -1 : 1
    if (sortField === 'candidate_id') rows.sort((a, b) => (displayIdNumber(a.candidateDisplayId, 'CA') - displayIdNumber(b.candidateDisplayId, 'CA')) * direction)
    if (sortField === 'candidate_name') rows.sort((a, b) => compareText(a.name, b.name) * direction)
    if (sortField === 'consultant') rows.sort((a, b) => compareText(a.consultant, b.consultant))
    return rows
  }, [selectedCandidates, sortDirection, sortField])

  const pagedCandidates = sortedCandidates.slice((page - 1) * pageSize, page * pageSize)
  const activeColumns = CANDIDATE_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key) || column.key === 'jobId')
  const candidateTableMinWidth = activeColumns.reduce((total, column) => total + (column.width || 120), 0)

  const openGroup = (groupKey, jobTitle, status = '') => {
    setSelectedGroup({ groupKey, jobTitle, status })
    setPage(1)
    setTablePopover(null)
  }

  const refreshClientJobs = useCallback(async () => {
    const rootClientId = client?.client_group_id || client?.root_client_id || client?.id || clientId
    const jobsRes = await fetch(`/api/jobs?client_id=${rootClientId}&all=true`)
    if (!jobsRes.ok) throw new Error('Failed to refresh client jobs.')
    const jobsPayload = await jobsRes.json().catch(() => ({}))
    setClientJobs(jobsPayload.data || [])
  }, [client?.client_group_id, client?.id, client?.root_client_id, clientId])

  const updateMandateStatus = async (group, status) => {
    const job = group.relatedJob
    if (!job?.id) return
    setStatusSaving(current => ({ ...current, [job.id]: true }))
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mandate_status: status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to update mandate status.')
      setClientJobs(rows => rows.map(row => row.id === job.id ? { ...row, ...data } : row))
      window.dispatchEvent(new Event('ats:public-roles-updated'))
      setTablePopover(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setStatusSaving(current => ({ ...current, [job.id]: false }))
    }
  }

  const toggleTablePopover = (type, id, element) => {
    if (!element || !id) return
    const anchorRect = element.getBoundingClientRect()
    setTablePopover(current => current?.type === type && current.id === id ? null : { type, id, anchorRect })
  }
  const updateCandidateStatus = async (candidate, status) => {
    const associationId = candidate.associationId || candidate.id
    if (!associationId || candidate.status === status) {
      setTablePopover(null)
      return
    }
    const previousCandidates = candidates
    const optimistic = candidates.map(row => row.associationId === associationId ? { ...row, status } : row)
    setCandidates(optimistic)
    setStatusSaving(current => ({ ...current, [associationId]: true }))
    setTablePopover(null)
    try {
      const response = await fetch(`/api/candidates/${associationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ association_id: associationId, status }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || Object.values(data.errors || {})[0] || 'Unable to update candidate status.')
      const updated = apiCandidateToUi(data)
      setCandidates(current => current.map(row => row.associationId === updated.associationId ? updated : row))
      await refreshClientJobs()
      window.dispatchEvent(new Event('ats:jobs-updated'))
      window.dispatchEvent(new Event('ats:candidates-updated'))
      setError(null)
    } catch (err) {
      setCandidates(previousCandidates)
      setError(err.message)
    } finally {
      setStatusSaving(current => ({ ...current, [associationId]: false }))
    }
  }
  const togglePendingColumn = (key) => setPendingColumns(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  const proceedColumns = () => {
    setVisibleColumns(pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)
    setColumnsOpen(false)
  }
  const saveColumnPreference = async () => {
    try {
      const currentUser = getCurrentUser()
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const value = pendingColumns.length ? pendingColumns : DEFAULT_CANDIDATE_COLUMN_KEYS
      const response = await fetch(`/api/user-preferences/${CLIENT_DETAIL_COLUMNS_PREFERENCE_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, value }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail || payload.error || 'Unable to save column preference.')
      }
      setSavedColumns(value)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }
  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    return option ? `${option.label} ${sortDirection === 'asc' ? '↓' : '↑'}` : 'Sort By'
  }
  const selectSort = (field) => {
    if (sortField === field) setSortDirection(current => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortField(field)
      setSortDirection('asc')
    }
    setSortOpen(false)
  }
  const openEditCandidate = (candidate) => {
    setEditCandidate(candidate)
    setEditForm(candidateToEditForm(candidate))
    setEditError('')
    setEditErrors({})
  }
  useEffect(() => {
    if (editCandidate) focusPopup(editModalRef)
  }, [editCandidate, focusPopup])
  const updateEditField = (field, value) => {
    setEditForm(form => ({ ...form, [field]: value }))
    if (field === 'status' && isCandidateStatusSelected(value)) {
      setEditErrors(current => ({ ...current, status: undefined }))
    }
  }
  const saveEditCandidate = async () => {
    if (!editCandidate || !editForm) return
    if (!isCandidateStatusSelected(editForm.status)) {
      setEditErrors({ status: REQUIRED_CANDIDATE_STATUS_ERROR })
      return
    }
    setSavingCandidate(true)
    setEditError('')
    try {
      const payload = {
        ...editForm,
        skills: editForm.skills.split(',').map(skill => skill.trim()).filter(Boolean),
        experience_years: editForm.experience_years === '' ? null : Number(editForm.experience_years),
        notice_period: editForm.notice_period === '' ? null : Number(editForm.notice_period),
        open_to_relocate: editForm.open_to_relocate === '' ? null : (editForm.open_to_relocate === 'NA' ? 'NA' : editForm.open_to_relocate === 'Yes'),
        current_salary: editForm.current_salary === '' ? null : Number(editForm.current_salary),
        expected_salary: editForm.expected_salary === '' ? null : Number(editForm.expected_salary),
        offered_ctc: editForm.status === 'Hired' && editForm.offered_ctc !== '' ? Number(editForm.offered_ctc) : null,
        date_of_joining: editForm.status === 'Hired' ? editForm.date_of_joining || null : null,
      }
      const response = await fetch(`/api/candidates/${editCandidate.associationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || Object.values(data.errors || {})[0] || 'Unable to update candidate.')
      const updated = apiCandidateToUi(data)
      const nextCandidates = candidates.map(candidate => candidate.associationId === updated.associationId ? updated : candidate)
      setCandidates(nextCandidates)
      if (updated.status === 'Hired') {
        const job = clientJobs.find(item => item.id === updated.jobId) || clientJobs.find(item => (item.job_display_id || '') === (updated.jobDisplayId || ''))
        if (job && normalizeMandateStatus(job.mandate_status || job.status) !== 'Scrapped') {
          setClientJobs(rows => rows.map(row => row.id === job.id ? { ...row, mandate_status: 'Completed', status: 'Completed' } : row))
        }
      }
      setEditCandidate(null)
      setEditForm(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setSavingCandidate(false)
    }
  }

  const toggleExpandedCell = (id, key, event) => {
    event.stopPropagation()
    const cellKey = `${id}-${key}`
    setExpandedCells(current => ({ ...current, [cellKey]: !current[cellKey] }))
  }
  const renderSkillsCell = (candidate) => {
    const skills = normalizeSkills(candidate.skills)
    if (!skills.length) return '-'
    const cellKey = `${candidate.associationId || candidate.id}-skills`
    const expanded = Boolean(expandedCells[cellKey])
    const visibleSkills = expanded ? skills : skills.slice(0, 2)
    return (
      <div className={`table-chip-cell${expanded ? ' is-expanded' : ''}`}>
        <div className="table-chip-list">
          {visibleSkills.map(skill => <span className="table-skill-chip" key={skill}>{skill}</span>)}
        </div>
        {skills.length > 2 && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(candidate.associationId || candidate.id, 'skills', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'View less' : 'View more'}
          </button>
        )}
      </div>
    )
  }
  const renderCommentsCell = (candidate) => {
    const text = String(candidate.notes || '').trim()
    if (!text) return '-'
    const cellId = candidate.associationId || candidate.id
    const cellKey = `${cellId}-comments`
    const expanded = Boolean(expandedCells[cellKey])
    const { isLong, preview } = previewWords(text, 3)
    const displayText = expanded || !isLong ? text : preview
    return (
      <div className="table-comment-cell">
        <div className={`table-comment-text${expanded ? ' is-expanded' : ''}`}>{displayText}</div>
        {isLong && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(cellId, 'comments', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} /> {expanded ? 'View less' : 'View more'}
          </button>
        )}
      </div>
    )
  }

  const renderCandidateCell = ({ key }, c) => {
    const noticeMeta = getNoticeMeta(c.noticePeriod)
    const ctcValue = (value) => {
      const text = String(value ?? '').trim()
      if (!text || text === '-') return '-'
      if (/₹/.test(text) && /lpa/i.test(text)) return text
      const normalized = text.replace(/^rs\.?\s*/i, '').replace(/^â‚¹\s*/i, '').replace(/\s*lpa$/i, '').trim()
      return `₹${normalized} LPA`
    }
    switch (key) {
      case 'candidateDisplayId':
        return (
          <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>
            <span className="candidate-display-id-value">
              <span>{c.candidateDisplayId || '-'}</span>
              {c.isPublicApplicationConversion && <span className="candidate-public-source-dot" role="img" aria-label="From Applied Candidates" title="From Applied Candidates" />}
            </span>
          </td>
        )
      case 'date': return <td key={key}>{formatDate(c.createdAt)}</td>
      case 'consultant': return <td key={key}><ConsultantPill name={c.consultant} /></td>
      case 'client': return <td key={key}>{c.client || '-'}</td>
      case 'clientId': return <td key={key}>{client?.client_display_id ? <span className="table-id-chip table-client-id-chip">{client.client_display_id}</span> : mutedDash}</td>
      case 'jobId': return <td key={key}>{c.jobDisplayId ? <span className="table-id-chip table-job-id-chip">{c.jobDisplayId}</span> : mutedDash}</td>
      case 'job': return <td key={key} className="cell-ellipsis">{getJobText(c)}</td>
      case 'name':
        return <td key={key}><div className="name-cell"><div className="name-avatar">{initials(c.name)}</div><div><div className="name-text">{c.name}</div><div className="sub-text">{c.location || [c.city, c.state].filter(Boolean).join(', ')}</div></div></div></td>
      case 'organisation': return <td key={key}>{c.currentOrganisation || c.currentCompany || '-'}</td>
      case 'designation': return <td key={key}>{c.designation || '-'}</td>
      case 'mobile': return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.mobile || '-'}</td>
      case 'email': return <td key={key}>{c.email || '-'}</td>
      case 'experience': return <td key={key}>{c.exp ? `${c.exp} yrs` : '-'}</td>
      case 'skills': return <td key={key}>{renderSkillsCell(c)}</td>
      case 'salary': return <td key={key}>{c.salary ? <span className="candidate-money-value">{formatClientDetailCtc(c.salary)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'location': return <td key={key}>{c.location || c.city || '-'}</td>
      case 'notice': return <td key={key}>{noticeMeta ? <span className={`candidate-notice-pill candidate-notice-pill-${noticeMeta.tone}`}>{noticeMeta.label}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'expectedSalary': return <td key={key}>{c.expectedSalary ? <span className="candidate-money-value">{formatClientDetailCtc(c.expectedSalary)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'relocate': return <td key={key}>{c.openToRelocate || '-'}</td>
      case 'comments': return <td key={key} className="client-detail-comments-cell">{renderCommentsCell(c)}</td>
      case 'linkedin': {
        const linkedInUrl = normalizeExternalUrl(c.linkedinUrl)
        return <td key={key}>{linkedInUrl ? <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" className="table-link" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openExternalUrl(linkedInUrl) }}>LinkedIn</a> : '-'}</td>
      }
      case 'status': {
        const associationId = c.associationId || c.id
        return (
          <td key={key}>
            <div className="candidate-columns-control mandate-status-control">
              <button
                className={`badge ${STATUS_BADGE_MAP[c.status || '-']}`}
                type="button"
                onMouseDown={event => event.stopPropagation()}
                onClick={(event) => toggleTablePopover('candidate-status', associationId, event.currentTarget)}
                disabled={statusSaving[associationId]}
              >
                {c.status ? statusLabelForValue(c.status) : '-'}
              </button>
            </div>
          </td>
        )
      }
      case 'offeredCtc': return <td key={key}>{c.offeredCtc ? <span className="candidate-money-value">{formatClientDetailCtc(c.offeredCtc)}</span> : <span className="candidate-empty-value">-</span>}</td>
      case 'dateOfJoining': return <td key={key}>{c.status === 'Hired' ? formatDate(c.dateOfJoining) : '-'}</td>
      case 'cv': {
        const cvHref = resolveCandidateCvHref(c)
        const docKey = `cv-${c.associationId || c.id}`
        return <td key={key}>{cvHref ? <a href="#" rel="noopener noreferrer" className="cv-table-link" title="Open CV" onClick={(event) => { event.preventDefault(); event.stopPropagation(); event.nativeEvent?.stopImmediatePropagation?.(); logCandidateCvOpen(c); openDocument(docKey, cvHref) }}>{openingDocument === docKey ? <Loader2 size={15} className="spin" /> : <FileText size={15} />}</a> : '-'}</td>
      }
      case 'month': return <td key={key}>{formatMonth(c.createdAt)}</td>
      case 'action': return <td key={key}><button className="row-action-btn" type="button" title="Edit Candidate" onClick={() => openEditCandidate(c)}><Pencil size={13} /></button></td>
      default: return null
    }
  }

  if (loading) return <div className="loading-state"><FyndbridgeLoader size={88} label="Loading client metrics..." /></div>

  if (error || !client) {
    return (
      <div className="client-detail-container">
        <div className="page-header"><Link to="/dashboard/clients" className="btn-secondary"><ChevronLeft size={15} /> Back to Clients</Link></div>
        <div className="table-card"><div className="empty-state"><div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div><div className="empty-state-title">{error ? 'Error loading client' : 'Client not found'}</div><div className="empty-state-desc">{error || 'The requested client ID does not exist.'}</div></div></div>
      </div>
    )
  }

  return (
    <div className="client-detail-container">
      <div className="page-header" style={{ justifyContent: 'flex-start' }}>
        <Link to="/dashboard/clients" className="btn-secondary"><ChevronLeft size={15} /> Back to Clients</Link>
      </div>

      <div className="client-header-card">
        <div className="client-avatar-large">{initials(client.name)}</div>
        <div className="client-header-info">
          <h2 className="client-title-text">{client.name}</h2>
          <div className="client-metrics-grid">
            <div><span>Client Status</span><strong>{calculatedClientStatus}</strong></div>
            <div><span>Ongoing (P1) Mandates</span><strong>{jobCounts.ongoing}</strong></div>
            <div><span>Delivered (P2) Mandates</span><strong>{jobCounts.delivered}</strong></div>
            <div><span>Paused (P3) Mandates</span><strong>{jobCounts.paused}</strong></div>
            <div><span>Scrapped Mandates</span><strong>{jobCounts.scrapped}</strong></div>
            <div><span>Completed Mandates</span><strong>{jobCounts.completed}</strong></div>
          </div>
        </div>
      </div>

      <div className="section-title"><Briefcase size={18} /><h3>Mandate Groups ({jobGroups.length})</h3></div>
      <div className="table-card table-card-popovers">
        {jobGroups.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No candidate job groups</div><div className="empty-state-desc">No candidates are linked to this client yet.</div></div>
        ) : (
          <div className="table-wrapper">
          <table className="data-table fb-theme-table" aria-label="Client Mandate Groups">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Mandate / Role</th>
                <th className="client-mandate-jd-cell">JD</th>
                <th className="align-center">Status</th>
                <th className="align-center">Candidates Assigned</th>
                {MANDATE_SUMMARY_COLUMNS.map(([, label]) => <th className="align-center" key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {jobGroups.map(group => (
                <tr key={group.key}>
                  <td>{group.relatedJob?.job_display_id ? <span className="table-id-chip table-job-id-chip">{group.relatedJob.job_display_id}</span> : mutedDash}</td>
                  <td><button className="table-link-button" type="button" onClick={() => openGroup(group.key, group.title)}>{group.title}</button></td>
                  <td className="client-mandate-jd-cell">
                    <DocumentIconGroup
                      attachments={jobJdAttachments(group.relatedJob)}
                      keyPrefix={`client-detail-jd-${group.relatedJob?.id || group.key}`}
                      openingKey={openingDocument}
                      onOpen={(key, attachment) => openJdDocument(key, attachment.path, group.relatedJob?.id)}
                      showExternalLinkIcon
                    />
                  </td>
                  <td className="mandate-status-cell">
                    <div className="candidate-columns-control mandate-status-control">
                      <button className={`badge ${MANDATE_STATUS_BADGE_MAP[group.status] || ''}`} type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('status', group.relatedJob?.id, event.currentTarget)} disabled={!group.relatedJob?.id || statusSaving[group.relatedJob?.id]}>
                        {mandateStatusLabel(group.status)}
                      </button>
                    </div>
                  </td>
                  <td className="align-center"><button className="count-badge-link" type="button" onClick={() => openGroup(group.key, group.title)}>{group.stats.total}</button></td>
                  {MANDATE_SUMMARY_COLUMNS.map(([key]) => (
                    <td className="align-center" key={key}>
                      {group.stats[key] ? <button className="count-badge-link" type="button" onClick={() => openGroup(group.key, group.title, key)}>{group.stats[key]}</button> : <span className="count-zero">0</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {tablePopover && (() => {
        if (tablePopover.type === 'candidate-status') {
          const candidate = candidates.find(item => (item.associationId || item.id) === tablePopover.id)
          if (!candidate) return null
          return (
            <TablePopover anchorRect={tablePopover.anchorRect} width={180} onClose={() => setTablePopover(null)}>
              {CLIENT_DETAIL_STATUS_OPTIONS.map(option => (
                <button className="candidate-columns-action" type="button" key={option.value} onClick={() => updateCandidateStatus(candidate, option.value)}>
                  {option.label}
                </button>
              ))}
            </TablePopover>
          )
        }
        const group = jobGroups.find(item => item.relatedJob?.id === tablePopover.id)
        if (!group) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={150} onClose={() => setTablePopover(null)}>
            {MANDATE_STATUSES.map(status => (
              <button className="candidate-columns-action" type="button" key={status} onClick={() => updateMandateStatus(group, status)}>
                {mandateStatusLabel(status)}
              </button>
            ))}
          </TablePopover>
        )
      })()}

      {selectedGroup && (
        <>
          <div className="section-title"><Briefcase size={18} /><h3>{selectedGroup.jobTitle} Candidates{selectedGroup.status ? ` - ${statusLabelForValue(selectedGroup.status)}` : ''}</h3></div>
          <div className="candidate-columns-toolbar">
            <div className="candidate-columns-control" ref={columnsDropdownRef}>
              <button className="filter-select candidate-columns-btn" type="button" onClick={(event) => { setColumnsAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setColumnsOpen(open => !open) }}><span>Columns</span><ChevronDown size={13} /></button>
              <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
              {columnsOpen && (
                <FloatingDropdown anchorRect={columnsAnchor?.rect} ignoreElement={columnsAnchor?.element} className="candidate-columns-dropdown" width={176} onClose={() => setColumnsOpen(false)}>
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(DEFAULT_CANDIDATE_COLUMN_KEYS)}>Select All</button>
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
                  <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
                  <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(savedColumns?.length ? savedColumns : DEFAULT_CANDIDATE_COLUMN_KEYS)}>Reset to Saved Preference</button>
                  <div className="candidate-columns-divider" />
                  {CANDIDATE_TABLE_COLUMNS.map(column => <label className="candidate-column-option" key={column.key}><input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />{column.label}</label>)}
                </FloatingDropdown>
              )}
            </div>
          </div>
          <div className="filter-bar candidates-filter-bar">
            <span className="filter-label">Sort By</span>
            <div className="candidate-sort-control" ref={sortDropdownRef}>
              <button className="filter-select candidate-sort-btn" type="button" onClick={() => setSortOpen(open => !open)}><span>{sortLabel()}</span><ChevronDown size={13} /></button>
              {sortOpen && <div className="filter-dropdown candidate-sort-dropdown">{SORT_OPTIONS.map(option => <button className="candidate-columns-action" type="button" key={option.field} onClick={() => selectSort(option.field)}>{option.toggle ? `${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}` : option.label}</button>)}</div>}
            </div>
            <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc'); setPage(1) }}>Clear</button>
          </div>
          <div className="table-card">
            <div className="table-wrapper">
              <table className="data-table fb-theme-table candidates-master-table client-detail-candidates-table" aria-label="Client Mandate Candidates" style={{ minWidth: candidateTableMinWidth }}>
                <colgroup>
                  {activeColumns.map(column => <col key={column.key} style={{ width: `${column.width}px` }} />)}
                </colgroup>
                <thead><tr>{activeColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
                <tbody>{pagedCandidates.map((candidate, index) => <tr key={candidate.associationId || candidate.id}>{activeColumns.map(column => renderCandidateCell(column, candidate, index))}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="pagination-bar">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(sortedCandidates.length / pageSize))}</span>
            <span>{sortedCandidates.length.toLocaleString('en-IN')} total</span>
            <button className="btn-secondary" disabled={page >= Math.max(1, Math.ceil(sortedCandidates.length / pageSize))} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </>
      )}
      {editCandidate && editForm && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" ref={editModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit Candidate">
            <div className="modal-header">
              <span className="modal-title">Edit Candidate</span>
              <button className="modal-close" type="button" onClick={() => setEditCandidate(null)} disabled={savingCandidate} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              {editError && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{editError}</div>}
              <div className="form-grid-2">
                {[
                  ['full_name', 'Full Name', 'text'],
                  ['email', 'Email', 'email'],
                  ['mobile_number', 'Mobile Number', 'text'],
                  ['consultant_name', 'Consultant', 'text'],
                  ['current_designation', 'Current Designation', 'text'],
                  ['current_organisation', 'Current Organisation', 'text'],
                  ['location', 'Current Location', 'text'],
                  ['experience_years', 'Experience Years', 'number'],
                  ['notice_period', 'Notice Period', 'number'],
                  ['current_salary', 'Current Salary', 'number'],
                  ['expected_salary', 'Expected Salary', 'number'],
                  ['job_title', 'Mandate / Role', 'text'],
                  ['linkedin_url', 'LinkedIn URL', 'text'],
                  ['cv_link', 'CV', 'text'],
                ].map(([field, label, type]) => (
                  <div className="form-group" key={field}>
                    <label className="form-label">{label}</label>
                    <input className="form-control" type={type} value={editForm[field] ?? ''} onChange={(event) => updateEditField(field, event.target.value)} disabled={savingCandidate} />
                  </div>
                ))}
                <div className="form-group">
                  <label className="form-label">Status <span className="req">*</span></label>
                  <select className={`form-control${editErrors.status ? ' is-error' : ''}`} value={editForm.status} onChange={(event) => updateEditField('status', event.target.value)} disabled={savingCandidate}>
                    {CANDIDATE_STATUS_OPTIONS.map(status => <option key={status || '-'} value={status}>{status || '-'}</option>)}
                  </select>
                  {editErrors.status && <span className="form-error">{editErrors.status}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Open to Relocate</label>
                  <select className="form-control" value={editForm.open_to_relocate} onChange={(event) => updateEditField('open_to_relocate', event.target.value)} disabled={savingCandidate}>
                    {RELOCATE_OPTIONS.map(value => <option key={value || '-'} value={value}>{value || '-'}</option>)}
                  </select>
                </div>
                {editForm.status === 'Hired' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Offered CTC</label>
                      <input className="form-control" type="number" value={editForm.offered_ctc ?? ''} onChange={(event) => updateEditField('offered_ctc', event.target.value)} disabled={savingCandidate} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date of Joining</label>
                      <input className="form-control" type="date" value={editForm.date_of_joining || ''} onChange={(event) => updateEditField('date_of_joining', event.target.value)} disabled={savingCandidate} />
                    </div>
                  </>
                )}
                <div className="form-group full">
                  <label className="form-label">Skills</label>
                  <input className="form-control" value={editForm.skills} onChange={(event) => updateEditField('skills', event.target.value)} disabled={savingCandidate} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Education</label>
                  <textarea className="form-control" rows={3} value={editForm.education} onChange={(event) => updateEditField('education', event.target.value)} disabled={savingCandidate} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Comments</label>
                  <textarea className="form-control" rows={3} value={editForm.notes} onChange={(event) => updateEditField('notes', event.target.value)} disabled={savingCandidate} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setEditCandidate(null)} disabled={savingCandidate}>Cancel</button>
              <button className="btn-primary" type="button" onClick={saveEditCandidate} disabled={savingCandidate}>{savingCandidate ? 'Saving...' : 'Save Candidate'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
