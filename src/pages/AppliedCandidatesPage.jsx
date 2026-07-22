import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  UserRoundCheck,
  X,
  XCircle,
} from 'lucide-react'
import { ConsultantPillGroup } from '../components/ConsultantPill'
import PaginationBar from '../components/PaginationBar'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { isColumnDisabled, isColumnHidden, useAdminAccess } from '../hooks/useAdminAccess'
import { useStaffDirectory } from '../hooks/useStaffDirectory'
import {
  AppliedCandidatesApiError,
  convertAppliedCandidate,
  fetchAppliedCandidate,
  fetchAppliedCandidates,
  openAppliedCandidateCv,
  updateAppliedCandidateStatus,
} from '../services/appliedCandidatesApi'
import { CANDIDATE_STATUS_OPTIONS, isCandidateStatusSelected, REQUIRED_CANDIDATE_STATUS_ERROR } from '../utils/candidateStatuses'
import { normalizeMandateStatus } from '../utils/mandateStatuses'
import '../styles/Shared.css'
import './AppliedCandidatesPage.css'

const DEFAULT_FILTERS = {
  search: '',
  role: '',
  client: '',
  consultant: '',
  date_from: '',
  date_to: '',
  location: '',
}

const EMPTY_CONVERSION = {
  full_name: '',
  email: '',
  mobile_number: '',
  current_designation: '',
  current_organisation: '',
  experience_years: '',
  location: '',
  skills: [],
  notice_period: '',
  current_salary: '',
  expected_salary: '',
  linkedin_url: '',
  open_to_relocate: '',
  comments: '',
  status: '',
  consultant: '',
  consultant_user_id: '',
}

const CONVERSION_FIELD_PERMISSIONS = Object.freeze({
  candidate_display_id: 'candidate_display_id',
  full_name: 'full_name',
  email: 'email',
  mobile_number: 'mobile_number',
  current_designation: 'current_designation',
  current_organisation: 'current_organisation',
  experience_years: 'experience_years',
  location: 'location',
  skills: 'skills',
  notice_period: 'notice_period',
  current_salary: 'current_salary',
  expected_salary: 'expected_salary',
  linkedin_url: 'linkedin_url',
  open_to_relocate: 'open_to_relocate',
  comments: 'notes',
  status: 'status',
  consultant: 'consultant_name',
  cv: 'cv_link',
  client_name: 'client_name',
  client_id: 'client_id',
  job_title: 'job_title',
})

const BLANK_FILL_PERMISSION_FIELDS = Object.freeze([
  ['full_name', 'full_name'],
  ['email', 'email'],
  ['mobile_number', 'mobile_number'],
  ['current_designation', 'current_designation'],
  ['current_company', 'current_organisation'],
  ['current_organisation', 'current_organisation'],
  ['experience_years', 'experience_years'],
  ['notice_period', 'notice_period'],
  ['open_to_relocate', 'open_to_relocate'],
  ['skills', 'skills'],
  ['location', 'location'],
  ['linkedin_url', 'linkedin_url'],
  ['cv', 'cv'],
])

const APPLIED_CANDIDATE_COLUMNS = [
  'Candidate Name', 'Applied Public Role', 'Internal Mandate/Role', 'Client Name', 'Client ID', 'Email', 'Mobile',
  'Current Designation', 'Current Organization', 'Experience', 'Current Location', 'Skills', 'Current CTC',
  'Expected CTC', 'Notice Period', 'Open to Relocate', 'Applied On', 'Application Status', 'CV',
  'Assigned Consultant', 'Actions',
]
const APPLIED_CANDIDATE_TABLE_WIDTH = 3440

const clean = value => String(value ?? '').trim()
const asList = value => (Array.isArray(value) ? value : String(value || '').split(','))
  .map(clean)
  .filter(Boolean)
const display = value => clean(value) || '-'
const roleName = row => row?.public_role_name || row?.applied_public_role || row?.public_name || '-'
const internalRole = row => row?.internal_job_title_snapshot || row?.internal_job_title || row?.job_title || row?.mandate_title || '-'
const clientName = row => row?.client_name_snapshot || row?.client_name || '-'
const consultants = row => asList(row?.mandate_consultants_snapshot || row?.mandate_consultants || row?.consultants)
const relocateDisplay = value => {
  if (value === true || value === 'true' || value === 'Yes') return 'Yes'
  if (value === false || value === 'false' || value === 'No') return 'No'
  return display(value)
}
const initials = name => clean(name).split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join('').toUpperCase()
const avatarPalette = [
  ['#7c3aed', '#a855f7'], ['#2563eb', '#3b82f6'], ['#059669', '#10b981'], ['#ea580c', '#f97316'],
  ['#db2777', '#ec4899'], ['#4f46e5', '#6366f1'], ['#65a30d', '#84cc16'], ['#0891b2', '#06b6d4'],
]
const avatarColorsFor = value => {
  const hash = [...clean(value)].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  const [start, end] = avatarPalette[hash % avatarPalette.length]
  return { background: `linear-gradient(135deg, ${start}, ${end})`, color: '#fff' }
}
const formatCandidateCtc = value => {
  const text = clean(value)
  if (!text) return '-'
  return `${text.includes('₹') ? text : `₹${text}`}${/lpa/i.test(text) ? '' : ' LPA'}`
}
const noticeMeta = value => {
  const text = clean(value)
  if (!text) return null
  const numeric = Number(text.replace(/[^\d.]/g, ''))
  const label = /days/i.test(text) ? text : `${text} Days`
  if (!Number.isFinite(numeric)) return { label, tone: 'mid' }
  if (numeric <= 30) return { label, tone: 'low' }
  if (numeric < 60) return { label, tone: 'mid' }
  return { label, tone: 'high' }
}

function formatAppliedDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function candidateFormFromApplication(row = {}) {
  const assigned = consultants(row)[0] || ''
  return {
    ...EMPTY_CONVERSION,
    full_name: clean(row.full_name),
    email: clean(row.email),
    mobile_number: clean(row.mobile_number),
    current_designation: clean(row.current_designation),
    current_organisation: clean(row.current_organisation),
    experience_years: clean(row.experience_years),
    location: clean(row.location),
    skills: asList(row.skills),
    notice_period: clean(row.notice_period),
    current_salary: clean(row.current_salary),
    expected_salary: clean(row.expected_salary),
    linkedin_url: clean(row.linkedin_url),
    open_to_relocate: row.open_to_relocate === true || row.open_to_relocate === 'true' || row.open_to_relocate === 'Yes'
      ? 'Yes'
      : row.open_to_relocate === false || row.open_to_relocate === 'false' || row.open_to_relocate === 'No'
        ? 'No'
        : clean(row.open_to_relocate),
    comments: clean(row.comments || row.notes),
    consultant: assigned,
  }
}

function statusClass(value) {
  return `applied-status applied-status-${clean(value).toLowerCase().replace(/_/g, '-') || 'pending'}`
}

function conversionNeedsConfirmation(row) {
  if (row?.requires_closed_role_confirmation || row?.requires_conversion_confirmation || row?.role_is_closed || row?.role_is_expired) return true
  const status = clean(row?.mandate_status || row?.current_mandate_status || row?.job_status)
  if (status && normalizeMandateStatus(status) !== 'Ongoing (P1)') return true
  const deadline = clean(row?.application_deadline || row?.current_application_deadline)
  if (deadline && deadline < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())) return true
  return false
}

function applicationDetails(row) {
  return [
    ['Candidate Name', row.full_name],
    ['Applied Public Role', roleName(row)],
    ['Internal Mandate/Role', internalRole(row)],
    ['Client Name', clientName(row)],
    ['Client ID', row.client_display_id || row.client_id],
    ['Email', row.email],
    ['Mobile', row.mobile_number],
    ['Current Designation', row.current_designation],
    ['Current Organization', row.current_organisation],
    ['Experience', row.experience_years],
    ['Current Location', row.location],
    ['Skills', asList(row.skills).join(', ')],
    ['Current CTC', row.current_salary === null || row.current_salary === undefined ? '' : `₹ ${row.current_salary} LPA`],
    ['Expected CTC', row.expected_salary === null || row.expected_salary === undefined ? '' : `₹ ${row.expected_salary} LPA`],
    ['Notice Period', row.notice_period === null || row.notice_period === undefined ? '' : `${row.notice_period} days`],
    ['Open to Relocate', relocateDisplay(row.open_to_relocate)],
    ['LinkedIn', row.linkedin_url],
    ['Comments', row.comments],
    ['Assigned Consultant(s)', consultants(row).join(', ')],
    ['Applied On', formatAppliedDate(row.created_at)],
    ['Application Status', row.application_status],
    ['Rejection Reason', row.rejection_reason],
  ]
}

export default function AppliedCandidatesPage() {
  const { selectableStaff } = useStaffDirectory()
  const { isAdmin, permissions, loading: accessLoading } = useAdminAccess()
  const [rows, setRows] = useState([])
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [drawer, setDrawer] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [conversionForm, setConversionForm] = useState(EMPTY_CONVERSION)
  const [conversionErrors, setConversionErrors] = useState({})
  const [conversionSaving, setConversionSaving] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [duplicateState, setDuplicateState] = useState(null)
  const [selectedExistingId, setSelectedExistingId] = useState('')
  const [fillBlankFields, setFillBlankFields] = useState(false)
  const [confirmClosedRole, setConfirmClosedRole] = useState(false)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectSaving, setRejectSaving] = useState(false)
  const [expandedSkills, setExpandedSkills] = useState({})
  const requestRef = useRef(null)
  const drawerRequestRef = useRef(null)
  const conversionBusyRef = useRef(false)
  const drawerRef = useRef(null)
  const rejectDialogRef = useRef(null)
  const modalReturnFocusRef = useRef(null)
  const noticeSequenceRef = useRef(0)

  const reload = useCallback(() => setRefreshVersion(value => value + 1), [])
  const showNotice = useCallback((message, tone, title) => {
    noticeSequenceRef.current += 1
    setNotice({ id: noticeSequenceRef.current, message, tone, title, visible: true })
  }, [])
  const closeDrawer = useCallback(() => {
    drawerRequestRef.current?.controller.abort()
    drawerRequestRef.current = null
    setDrawer(null)
    setDrawerLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters(current => current.search === searchInput ? current : { ...current, search: searchInput })
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    fetchAppliedCandidates({ ...filters, page, limit: pageSize, sortField: 'created_at', sortDirection: 'desc' }, { signal: controller.signal })
      .then(result => {
        setRows(result.rows)
        setTotal(result.total)
        setTotalPages(Math.max(1, result.totalPages))
      })
      .catch(requestError => {
        if (requestError?.name !== 'AbortError') setError(requestError.message || 'Applied candidates could not be loaded.')
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [filters, page, pageSize, refreshVersion])

  useEffect(() => () => drawerRequestRef.current?.controller.abort(), [])

  useEffect(() => {
    if (!notice) return undefined
    const fadeTimer = window.setTimeout(() => {
      setNotice(current => current ? { ...current, visible: false } : current)
    }, 4600)
    const removeTimer = window.setTimeout(() => setNotice(null), 5000)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(removeTimer)
    }
  }, [notice?.id])

  useEffect(() => {
    if (!drawer && !rejectTarget) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = event => {
      if (event.key !== 'Escape' || conversionSaving || rejectSaving) return
      if (rejectTarget) setRejectTarget(null)
      else closeDrawer()
    }
    window.requestAnimationFrame(() => {
      const target = rejectTarget ? rejectDialogRef.current : drawerRef.current
      ;(target?.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])') || target)?.focus({ preventScroll: true })
    })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeDrawer, conversionSaving, drawer, rejectSaving, rejectTarget])

  useEffect(() => {
    if (drawer || rejectTarget) {
      if (!modalReturnFocusRef.current) modalReturnFocusRef.current = document.activeElement
      return
    }
    const returnTarget = modalReturnFocusRef.current
    modalReturnFocusRef.current = null
    if (returnTarget instanceof HTMLElement && document.contains(returnTarget)) returnTarget.focus({ preventScroll: true })
  }, [drawer, rejectTarget])

  const filterOptions = useMemo(() => ({
    roles: [...new Set(rows.map(roleName).filter(value => value !== '-'))].sort(),
    clients: [...new Set(rows.map(clientName).filter(value => value !== '-'))].sort(),
    consultants: [...new Set(rows.flatMap(consultants))].sort(),
    locations: [...new Set(rows.map(row => clean(row.location)).filter(Boolean))].sort(),
  }), [rows])

  const setFilter = (name, value) => {
    setFilters(current => ({ ...current, [name]: value }))
    setPage(1)
  }

  const isConversionFieldHidden = name => isColumnHidden(
    permissions,
    'candidates',
    CONVERSION_FIELD_PERMISSIONS[name] || name,
    isAdmin,
  )
  const isConversionFieldDisabled = name => isColumnDisabled(
    permissions,
    'candidates',
    CONVERSION_FIELD_PERMISSIONS[name] || name,
    isAdmin,
  )
  const canEditConversionField = name => !isConversionFieldHidden(name) && !isConversionFieldDisabled(name)

  const loadDrawer = async (row, mode) => {
    drawerRequestRef.current?.controller.abort()
    const controller = new AbortController()
    const requestId = Symbol(`applied-candidate-${row.id}`)
    drawerRequestRef.current = { controller, requestId }
    setNotice(null)
    setDrawer({ mode, row })
    setDrawerLoading(true)
    setDuplicateState(null)
    setSelectedExistingId('')
    setFillBlankFields(false)
    setConfirmClosedRole(false)
    setConversionErrors({})
    try {
      const detail = await fetchAppliedCandidate(row.id, { signal: controller.signal })
      if (drawerRequestRef.current?.requestId !== requestId) return
      const nextRow = detail || row
      setDrawer({ mode, row: nextRow })
      if (mode === 'convert') {
        const nextForm = candidateFormFromApplication(nextRow)
        const matchedConsultant = selectableStaff.find(user => user.name === nextForm.consultant)
        setConversionForm({ ...nextForm, consultant_user_id: matchedConsultant?.id || '' })
      }
    } catch (drawerError) {
      if (controller.signal.aborted || drawerError?.name === 'AbortError' || drawerRequestRef.current?.requestId !== requestId) return
      setDrawer(current => current ? { ...current, error: drawerError.message || 'Application details could not be loaded.' } : current)
    } finally {
      if (drawerRequestRef.current?.requestId === requestId) {
        drawerRequestRef.current = null
        setDrawerLoading(false)
      }
    }
  }

  const setConversionField = (name, value) => {
    setConversionForm(current => ({ ...current, [name]: value }))
    setConversionErrors(current => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const addSkill = () => {
    if (!canEditConversionField('skills')) return
    const value = clean(skillInput)
    if (!value) return
    setConversionField('skills', [...new Set([...conversionForm.skills, value])])
    setSkillInput('')
  }

  const validateConversion = () => {
    const next = {}
    if (!clean(conversionForm.full_name)) next.full_name = 'Full Name is required.'
    if (!clean(conversionForm.email)) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(conversionForm.email))) next.email = 'Enter a valid email address.'
    if (!clean(conversionForm.mobile_number)) next.mobile_number = 'Mobile is required.'
    const experience = Number(conversionForm.experience_years)
    if (!clean(conversionForm.experience_years) || !Number.isFinite(experience) || experience < 0) next.experience_years = 'Experience must be zero or greater.'
    const notice = Number(conversionForm.notice_period)
    if (!clean(conversionForm.notice_period) || !Number.isInteger(notice) || notice < 0) next.notice_period = 'Notice Period must be a non-negative whole number.'
    const currentSalary = Number(conversionForm.current_salary)
    if (!clean(conversionForm.current_salary) || !Number.isInteger(currentSalary) || currentSalary <= 0 || currentSalary > 999999999) next.current_salary = 'CTC must be a positive whole LPA value.'
    const expectedSalary = Number(conversionForm.expected_salary)
    if (clean(conversionForm.expected_salary) && (!Number.isInteger(expectedSalary) || expectedSalary <= 0 || expectedSalary > 999999999)) next.expected_salary = 'CTC must be a positive whole LPA value.'
    if (!asList(conversionForm.skills).length) next.skills = 'At least one skill is required.'
    if (!['Yes', 'No', 'NA'].includes(conversionForm.open_to_relocate)) next.open_to_relocate = 'Select whether the candidate is open to relocate.'
    if (clean(conversionForm.linkedin_url)) {
      try {
        const url = new URL(clean(conversionForm.linkedin_url))
        if (!['http:', 'https:'].includes(url.protocol)) next.linkedin_url = 'Enter a valid LinkedIn URL.'
      } catch { next.linkedin_url = 'Enter a valid LinkedIn URL.' }
    }
    if (!clean(conversionForm.current_designation)) next.current_designation = 'Current Designation is required.'
    if (!clean(conversionForm.current_organisation)) next.current_organisation = 'Current Organization is required.'
    if (!clean(conversionForm.location)) next.location = 'Current Location is required.'
    if (!isCandidateStatusSelected(conversionForm.status)) next.status = REQUIRED_CANDIDATE_STATUS_ERROR
    if (clean(conversionForm.consultant) && conversionForm.consultant !== '-' && !conversionForm.consultant_user_id) next.consultant = 'Select a valid consultant.'
    if (conversionNeedsConfirmation(drawer?.row) && !confirmClosedRole) next.confirm_closed_role = 'Confirm conversion for this closed or expired role.'
    const protectedMissing = Object.keys(next).some(field => (
      field !== 'confirm_closed_role' && field !== 'form' && !canEditConversionField(field)
    ))
    if (protectedMissing) next.form = 'A required Candidate field is missing or invalid but protected by column permissions. Ask an admin to complete this conversion.'
    return next
  }

  const conversionPayload = (action, existingCandidateId = '') => {
    const payload = {
      action,
      existing_candidate_id: existingCandidateId || undefined,
      fill_blank_fields: fillBlankFields
        ? BLANK_FILL_PERMISSION_FIELDS
          .filter(([, permissionField]) => canEditConversionField(permissionField))
          .map(([field]) => field)
        : false,
      confirm_closed_role: Boolean(confirmClosedRole),
    }
    if (canEditConversionField('full_name')) payload.full_name = conversionForm.full_name
    if (canEditConversionField('email')) payload.email = conversionForm.email
    if (canEditConversionField('mobile_number')) payload.mobile_number = conversionForm.mobile_number
    if (canEditConversionField('current_designation')) payload.current_designation = conversionForm.current_designation
    if (canEditConversionField('current_organisation')) payload.current_organisation = conversionForm.current_organisation
    if (canEditConversionField('experience_years')) payload.experience_years = conversionForm.experience_years
    if (canEditConversionField('location')) payload.location = conversionForm.location
    if (canEditConversionField('skills')) payload.skills = asList(conversionForm.skills)
    if (canEditConversionField('notice_period')) payload.notice_period = conversionForm.notice_period
    if (canEditConversionField('current_salary')) payload.current_salary = conversionForm.current_salary
    if (canEditConversionField('expected_salary')) payload.expected_salary = conversionForm.expected_salary
    if (canEditConversionField('linkedin_url')) payload.linkedin_url = conversionForm.linkedin_url
    if (canEditConversionField('open_to_relocate')) {
      payload.open_to_relocate = conversionForm.open_to_relocate === 'Yes'
        ? true
        : conversionForm.open_to_relocate === 'No'
          ? false
          : conversionForm.open_to_relocate
    }
    if (canEditConversionField('comments')) payload.notes = conversionForm.comments
    if (canEditConversionField('status')) payload.status = conversionForm.status
    if (canEditConversionField('consultant')) {
      payload.consultant_name = conversionForm.consultant
      payload.consultant_user_id = conversionForm.consultant_user_id
    }
    return payload
  }

  const saveConversion = async (action = 'create') => {
    if (!drawer?.row?.id || conversionBusyRef.current) return
    const nextErrors = validateConversion()
    if (action === 'link_existing' && !selectedExistingId) nextErrors.duplicate = 'Select an existing candidate to link.'
    if (Object.keys(nextErrors).length) {
      setConversionErrors(nextErrors)
      return
    }
    conversionBusyRef.current = true
    setConversionSaving(true)
    setConversionErrors({})
    try {
      await convertAppliedCandidate(drawer.row.id, conversionPayload(action, selectedExistingId))
      closeDrawer()
      showNotice(
        action === 'link_existing' ? 'The existing candidate was linked to this mandate.' : 'The candidate was added and removed from the pending applications list.',
        'accepted',
        'Application accepted',
      )
      window.dispatchEvent(new Event('ats:applied-candidates-updated'))
      reload()
    } catch (conversionError) {
      const isDuplicate = conversionError instanceof AppliedCandidatesApiError
        && (conversionError.code === 'CANDIDATE_DUPLICATE' || conversionError.payload?.duplicate || Array.isArray(conversionError.payload?.existing))
      if (isDuplicate) {
        const existing = conversionError.payload?.existing || conversionError.payload?.data?.existing || []
        setDuplicateState({ existing: Array.isArray(existing) ? existing : [], message: conversionError.message })
        setSelectedExistingId(existing[0]?.candidate_id || existing[0]?.id || '')
      } else if (/confirm/i.test(conversionError.message) && /closed|expired|role|mandate/i.test(conversionError.message)) {
        setConversionErrors({ confirm_closed_role: conversionError.message })
      } else {
        const fieldErrors = conversionError.payload?.errors && typeof conversionError.payload.errors === 'object' ? conversionError.payload.errors : {}
        setConversionErrors({ ...fieldErrors, form: conversionError.message || 'Candidate conversion failed. The application remains recoverable.' })
      }
    } finally {
      conversionBusyRef.current = false
      setConversionSaving(false)
    }
  }

  const submitReject = async () => {
    if (!rejectTarget || rejectSaving) return
    setRejectSaving(true)
    try {
      await updateAppliedCandidateStatus(rejectTarget.id, 'rejected')
      setRejectTarget(null)
      closeDrawer()
      showNotice('The staged CV and application row were deleted.', 'rejected', 'Application rejected')
      window.dispatchEvent(new Event('ats:applied-candidates-updated'))
      reload()
    } catch (rejectError) {
      showNotice(rejectError.message || 'Application could not be rejected.', 'error', 'Action failed')
    } finally {
      setRejectSaving(false)
    }
  }

  const renderAppliedSkills = row => {
    const skills = asList(row.skills)
    if (!skills.length) return <span className="candidate-empty-value">-</span>
    const expanded = Boolean(expandedSkills[row.id])
    const visible = expanded ? skills : skills.slice(0, 2)
    return <div className={`table-chip-cell${expanded ? ' is-expanded' : ''}`}><div className="table-chip-list">{visible.map(skill => <span className="table-skill-chip" key={skill}>{skill}</span>)}</div>{skills.length > 2 && <button type="button" className="table-view-more" aria-expanded={expanded} onClick={() => setExpandedSkills(current => ({ ...current, [row.id]: !current[row.id] }))}><ChevronDown size={12} className={expanded ? 'is-open' : ''} />{expanded ? 'View less' : 'View more'}</button>}</div>
  }

  const hasFilters = Object.values(filters).some(Boolean) || Boolean(searchInput)

  return (
    <div className="candidates-page applied-candidates-page">
      {notice && <div className={`applied-action-toast applied-action-toast-${notice.tone}${notice.visible ? ' is-visible' : ' is-hidden'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
        {notice.tone === 'accepted' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        <div><strong>{notice.title}</strong><span>{notice.message}</span></div>
        <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={14} /></button>
      </div>}
      <div className="filter-bar candidates-filter-bar applied-filter-bar">
        <label className="applied-search"><Search size={15} /><input className="filter-input" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search candidate, email or mobile" /></label>
        <input className="filter-input applied-filter-input" list="applied-role-options" value={filters.role} onChange={event => setFilter('role', event.target.value)} aria-label="Applied Role" placeholder="Applied Role" /><datalist id="applied-role-options">{filterOptions.roles.map(value => <option key={value} value={value} />)}</datalist>
        <input className="filter-input applied-filter-input" list="applied-client-options" value={filters.client} onChange={event => setFilter('client', event.target.value)} aria-label="Client" placeholder="Client" /><datalist id="applied-client-options">{filterOptions.clients.map(value => <option key={value} value={value} />)}</datalist>
        <input className="filter-input applied-filter-input" list="applied-consultant-options" value={filters.consultant} onChange={event => setFilter('consultant', event.target.value)} aria-label="Consultant" placeholder="Consultant" /><datalist id="applied-consultant-options">{filterOptions.consultants.map(value => <option key={value} value={value} />)}</datalist>
        <input className="filter-input applied-filter-input" list="applied-location-options" value={filters.location} onChange={event => setFilter('location', event.target.value)} aria-label="Location" placeholder="Location" /><datalist id="applied-location-options">{filterOptions.locations.map(value => <option key={value} value={value} />)}</datalist>
        <label className="applied-date-filter"><span>From</span><input className="filter-input" type="date" value={filters.date_from} onChange={event => setFilter('date_from', event.target.value)} /></label>
        <label className="applied-date-filter"><span>To</span><input className="filter-input" type="date" value={filters.date_to} onChange={event => setFilter('date_to', event.target.value)} /></label>
        <button className="filter-clear" type="button" onClick={() => { setFilters(DEFAULT_FILTERS); setSearchInput(''); setPage(1) }} disabled={!hasFilters}>Clear Filters</button>
      </div>

      {error && <div className="table-error-banner" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" className="filter-clear" onClick={reload}>Retry</button></div>}
      <div className="table-card table-card-popovers candidates-table-card" style={{ minWidth: `max(100%, ${APPLIED_CANDIDATE_TABLE_WIDTH}px)` }}>
        {loading ? (
          <div className="table-wrapper candidates-table-scroll">
            <table className="data-table fb-theme-table candidates-master-table applied-candidates-table table-loading-table" aria-label="Loading applied candidates" style={{ minWidth: APPLIED_CANDIDATE_TABLE_WIDTH }}>
              <thead><tr>{APPLIED_CANDIDATE_COLUMNS.map(column => <th key={column}>{column}</th>)}</tr></thead>
              <tbody><tr className="table-loading-row"><td className="table-loading-cell" colSpan={APPLIED_CANDIDATE_COLUMNS.length}><FyndbridgeLoader size={88} label="Loading applied candidates..." className="table-inline-loader" /></td></tr></tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrapper candidates-table-scroll">
            <table className="data-table fb-theme-table candidates-master-table applied-candidates-table" aria-label="Applied Candidates" style={{ minWidth: APPLIED_CANDIDATE_TABLE_WIDTH }}>
              <thead><tr>{APPLIED_CANDIDATE_COLUMNS.map(column => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {!rows.length ? <tr><td colSpan="21" className="table-empty-cell"><div className="empty-state"><div className="empty-state-icon"><UserRoundCheck size={28} /></div><div className="empty-state-title">No applied candidates found</div><div className="empty-state-desc">Try changing the filters or wait for a new public application.</div></div></td></tr> : rows.map(row => {
                  const pending = row.application_status === 'pending'
                  const canConvert = pending || row.application_status === 'converting'
                  return <tr key={row.id} className={drawer?.row?.id === row.id ? 'is-selected' : ''}>
                    <td><div className="name-cell"><div className="name-avatar" style={avatarColorsFor(row.full_name)}>{initials(row.full_name)}</div><div className="candidate-name-content"><span className="name-text candidate-name-text">{display(row.full_name)}</span><span className="sub-text">Public applicant</span></div></div></td>
                    <td><span className="applied-public-role">{roleName(row)}</span></td>
                    <td><span className="applied-mandate-role">{internalRole(row)}</span></td>
                    <td><span className="applied-client-name">{clientName(row)}</span></td>
                    <td className="applied-cell-center">{clean(row.client_display_id || row.client_id) ? <span className="candidate-id-chip candidate-client-id-chip">{display(row.client_display_id || row.client_id)}</span> : <span className="candidate-muted-dash">-</span>}</td>
                    <td><a className="applied-email-link" href={`mailto:${clean(row.email)}`}>{display(row.email)}</a></td>
                    <td><span className="applied-mobile-value">{display(row.mobile_number)}</span></td>
                    <td><span className="applied-designation">{display(row.current_designation)}</span></td>
                    <td><span className="applied-organisation">{display(row.current_organisation)}</span></td>
                    <td className="applied-cell-center">{clean(row.experience_years) ? `${row.experience_years} yrs` : <span className="candidate-empty-value">-</span>}</td>
                    <td><span className="applied-location-value">{display(row.location)}</span></td>
                    <td>{renderAppliedSkills(row)}</td>
                    <td className="applied-cell-center">{row.current_salary === null || row.current_salary === undefined ? <span className="candidate-empty-value">-</span> : <span className="candidate-money-value">{formatCandidateCtc(row.current_salary)}</span>}</td>
                    <td className="applied-cell-center">{row.expected_salary === null || row.expected_salary === undefined ? <span className="candidate-empty-value">-</span> : <span className="candidate-money-value">{formatCandidateCtc(row.expected_salary)}</span>}</td>
                    <td className="applied-cell-center">{(() => { const meta = noticeMeta(row.notice_period); return meta ? <span className={`candidate-notice-pill candidate-notice-pill-${meta.tone}`}>{meta.label}</span> : <span className="candidate-empty-value">-</span> })()}</td>
                    <td className="applied-cell-center">{clean(relocateDisplay(row.open_to_relocate)) !== '-' ? <span className={`candidate-relocate-pill${relocateDisplay(row.open_to_relocate) === 'Yes' ? ' is-yes' : ' is-no'}`}>{relocateDisplay(row.open_to_relocate)}</span> : <span className="candidate-empty-value">-</span>}</td>
                    <td className="applied-cell-center"><span className="applied-date-value">{formatAppliedDate(row.created_at)}</span></td>
                    <td className="applied-cell-center"><span className={statusClass(row.application_status)}>{display(row.application_status).replace(/_/g, ' ')}</span></td>
                    <td className="applied-cell-center"><button className="row-action-btn" type="button" title="View CV" onClick={() => openAppliedCandidateCv(row.id)}><FileText size={13} /></button></td>
                    <td><ConsultantPillGroup consultants={consultants(row)} /></td>
                    <td className="applied-cell-center"><div className="row-actions applied-row-actions">
                      <button className="row-action-btn" type="button" title="View Details" onClick={() => loadDrawer(row, 'details')}><Eye size={13} /></button>
                      {canConvert && <button className="row-action-btn applied-convert-action" type="button" title={pending ? 'Add to Candidates' : 'Retry Conversion'} onClick={() => loadDrawer(row, 'convert')}>{pending ? <Plus size={13} /> : <RotateCcw size={13} />}<span>{pending ? 'Add to Candidates' : 'Retry Conversion'}</span></button>}
                      {pending && <button className="row-action-btn applied-reject-action" type="button" title="Reject" onClick={() => setRejectTarget(row)}><XCircle size={13} /></button>}
                    </div></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} loading={loading} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1) }} />

      {drawer && !rejectTarget && createPortal(
        <div className="applied-content-overlay" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && !conversionSaving) closeDrawer()
        }}>
          <aside ref={drawerRef} tabIndex={-1} className="applied-candidate-drawer" role="dialog" aria-modal="true" aria-label={drawer.mode === 'convert' ? 'Add to Candidates' : 'Applied Candidate Details'}>
            <header className="applied-drawer-header">
              <div><span>Public Roles application</span><h2>{drawer.mode === 'convert' ? 'Add to Candidates' : display(drawer.row.full_name)}</h2></div>
              <button className="modal-close" type="button" onClick={closeDrawer} disabled={conversionSaving} aria-label="Close drawer"><X size={17} /></button>
            </header>
            {drawerLoading || (drawer.mode === 'convert' && accessLoading) ? <FyndbridgeLoader fullHeight={false} label="Loading application..." /> : drawer.error ? <div className="applied-drawer-error"><AlertTriangle size={18} />{drawer.error}</div> : drawer.mode === 'details' ? (
              <div className="applied-drawer-body">
                <div className="applied-context-grid">{applicationDetails(drawer.row).map(([label, value]) => <div key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}</div>
                <div className="applied-drawer-actions">
                  <button className="btn-secondary" type="button" onClick={() => openAppliedCandidateCv(drawer.row.id)}><FileText size={14} />View CV</button>
                  {['pending', 'converting'].includes(drawer.row.application_status) && <button className="btn-primary" type="button" onClick={() => loadDrawer(drawer.row, 'convert')}>{drawer.row.application_status === 'pending' ? <Plus size={14} /> : <RotateCcw size={14} />}{drawer.row.application_status === 'pending' ? 'Add to Candidates' : 'Retry Conversion'}</button>}
                </div>
              </div>
            ) : (
              <div className="applied-drawer-body">
                <div className="applied-readonly-context">
                  {!isConversionFieldHidden('client_name') && <div><span>Client Name</span><strong>{clientName(drawer.row)}</strong></div>}
                  {!isConversionFieldHidden('client_id') && <div><span>Client ID</span><strong>{display(drawer.row.client_display_id || drawer.row.client_id)}</strong></div>}
                  {!isConversionFieldHidden('job_title') && <div><span>Internal Mandate</span><strong>{internalRole(drawer.row)}</strong></div>}
                  <div><span>Public Role Name</span><strong>{roleName(drawer.row)}</strong></div>
                  {!isConversionFieldHidden('consultant') && <div><span>Assigned Consultant(s)</span><strong>{consultants(drawer.row).join(', ') || '-'}</strong></div>}
                  {!isConversionFieldHidden('cv') && <div><span>CV</span><button type="button" className="applied-inline-link" onClick={() => openAppliedCandidateCv(drawer.row.id)}>Use staged CV · View</button></div>}
                </div>
                {conversionNeedsConfirmation(drawer.row) && <div className="applied-warning"><AlertTriangle size={18} /><div><strong>Closed or expired role</strong><span>This historical application can be converted only after explicit confirmation.</span><label><input type="checkbox" checked={confirmClosedRole} onChange={event => setConfirmClosedRole(event.target.checked)} />Confirm conversion to this mandate</label>{conversionErrors.confirm_closed_role && <small>{conversionErrors.confirm_closed_role}</small>}</div></div>}
                {conversionErrors.form && <div className="table-error-banner"><AlertTriangle size={16} />{conversionErrors.form}</div>}
                <div className="applied-conversion-grid">
                  {!isConversionFieldHidden('full_name') && <ConversionField label="Candidate Name" required missing={!clean(conversionForm.full_name)} error={conversionErrors.full_name}><input value={conversionForm.full_name} onChange={event => setConversionField('full_name', event.target.value)} disabled={isConversionFieldDisabled('full_name')} /></ConversionField>}
                  {!isConversionFieldHidden('email') && <ConversionField label="Email" required missing={!clean(conversionForm.email)} error={conversionErrors.email}><input type="email" value={conversionForm.email} onChange={event => setConversionField('email', event.target.value)} disabled={isConversionFieldDisabled('email')} /></ConversionField>}
                  {!isConversionFieldHidden('mobile_number') && <ConversionField label="Mobile" required missing={!clean(conversionForm.mobile_number)} error={conversionErrors.mobile_number}><input value={conversionForm.mobile_number} onChange={event => setConversionField('mobile_number', event.target.value)} disabled={isConversionFieldDisabled('mobile_number')} /></ConversionField>}
                  {!isConversionFieldHidden('current_designation') && <ConversionField label="Current Designation" required missing={!clean(conversionForm.current_designation)} error={conversionErrors.current_designation}><input value={conversionForm.current_designation} onChange={event => setConversionField('current_designation', event.target.value)} disabled={isConversionFieldDisabled('current_designation')} /></ConversionField>}
                  {!isConversionFieldHidden('current_organisation') && <ConversionField label="Current Organization" required missing={!clean(conversionForm.current_organisation)} error={conversionErrors.current_organisation}><input value={conversionForm.current_organisation} onChange={event => setConversionField('current_organisation', event.target.value)} disabled={isConversionFieldDisabled('current_organisation')} /></ConversionField>}
                  {!isConversionFieldHidden('experience_years') && <ConversionField label="Experience (years)" required missing={!clean(conversionForm.experience_years)} error={conversionErrors.experience_years}><input type="number" min="0" step="0.1" value={conversionForm.experience_years} onChange={event => setConversionField('experience_years', event.target.value)} disabled={isConversionFieldDisabled('experience_years')} /></ConversionField>}
                  {!isConversionFieldHidden('location') && <ConversionField label="Current Location" required missing={!clean(conversionForm.location)} error={conversionErrors.location}><input value={conversionForm.location} onChange={event => setConversionField('location', event.target.value)} disabled={isConversionFieldDisabled('location')} /></ConversionField>}
                  {!isConversionFieldHidden('notice_period') && <ConversionField label="Notice Period (days)" required missing={!clean(conversionForm.notice_period)} error={conversionErrors.notice_period}><input type="number" min="0" step="1" value={conversionForm.notice_period} onChange={event => setConversionField('notice_period', event.target.value)} disabled={isConversionFieldDisabled('notice_period')} /></ConversionField>}
                  {!isConversionFieldHidden('current_salary') && <ConversionField label="Current CTC (LPA)" required missing={!clean(conversionForm.current_salary)} error={conversionErrors.current_salary}><input type="number" min="1" step="1" value={conversionForm.current_salary} onChange={event => setConversionField('current_salary', event.target.value)} disabled={isConversionFieldDisabled('current_salary')} /></ConversionField>}
                  {!isConversionFieldHidden('expected_salary') && <ConversionField label="Expected CTC (LPA)" error={conversionErrors.expected_salary}><input type="number" min="1" step="1" value={conversionForm.expected_salary} onChange={event => setConversionField('expected_salary', event.target.value)} disabled={isConversionFieldDisabled('expected_salary')} /></ConversionField>}
                  {!isConversionFieldHidden('linkedin_url') && <ConversionField label="LinkedIn" error={conversionErrors.linkedin_url}><input type="url" value={conversionForm.linkedin_url} onChange={event => setConversionField('linkedin_url', event.target.value)} disabled={isConversionFieldDisabled('linkedin_url')} /></ConversionField>}
                  {!isConversionFieldHidden('open_to_relocate') && <ConversionField label="Open to Relocate" required missing={!clean(conversionForm.open_to_relocate)} error={conversionErrors.open_to_relocate}><select value={conversionForm.open_to_relocate} onChange={event => setConversionField('open_to_relocate', event.target.value)} disabled={isConversionFieldDisabled('open_to_relocate')}><option value="">-</option><option value="Yes">Yes</option><option value="No">No</option><option value="NA">NA</option></select></ConversionField>}
                  {!isConversionFieldHidden('status') && <ConversionField label="Candidate Status" required missing={!isCandidateStatusSelected(conversionForm.status)} error={conversionErrors.status}><select value={conversionForm.status} onChange={event => setConversionField('status', event.target.value)} disabled={isConversionFieldDisabled('status')}>{CANDIDATE_STATUS_OPTIONS.map(value => <option key={value || '-'} value={value}>{value || '-'}</option>)}</select></ConversionField>}
                  {!isConversionFieldHidden('consultant') && <ConversionField label="Consultant" error={conversionErrors.consultant}><select value={conversionForm.consultant_user_id} onChange={event => { const user = selectableStaff.find(item => item.id === event.target.value); setConversionForm(current => ({ ...current, consultant: user?.name || '', consultant_user_id: user?.id || '' })); setConversionErrors(current => ({ ...current, consultant: '' })) }} disabled={isConversionFieldDisabled('consultant')}><option value="">-</option>{selectableStaff.map(user => <option key={user.id || user.name} value={user.id}>{user.name}</option>)}</select></ConversionField>}
                  {!isConversionFieldHidden('skills') && <ConversionField label="Skills" required full missing={!conversionForm.skills.length} error={conversionErrors.skills}><div className="applied-skill-editor"><div>{conversionForm.skills.map(skill => <span key={skill}>{skill}<button type="button" onClick={() => setConversionField('skills', conversionForm.skills.filter(item => item !== skill))} disabled={isConversionFieldDisabled('skills')}><X size={11} /></button></span>)}</div><label><input value={skillInput} onChange={event => setSkillInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addSkill() } }} disabled={isConversionFieldDisabled('skills')} /><button type="button" onClick={addSkill} disabled={isConversionFieldDisabled('skills')}>Add</button></label></div></ConversionField>}
                  {!isConversionFieldHidden('comments') && <ConversionField label="Comments" full error={conversionErrors.comments}><textarea rows="3" value={conversionForm.comments} onChange={event => setConversionField('comments', event.target.value)} disabled={isConversionFieldDisabled('comments')} /></ConversionField>}
                </div>
                {duplicateState && <div className="applied-duplicate-panel">
                  <div className="applied-warning"><Link2 size={18} /><div><strong>Existing candidate found</strong><span>{duplicateState.message || 'Choose the existing candidate that should receive this mandate association.'}</span></div></div>
                  <div className="applied-existing-list">{duplicateState.existing.map(candidate => {
                    const id = candidate.candidate_id || candidate.id
                    const identity = [
                      !isConversionFieldHidden('candidate_display_id') && candidate.candidate_display_id,
                      !isConversionFieldHidden('email') && candidate.email,
                      !isConversionFieldHidden('mobile_number') && candidate.mobile_number,
                    ].filter(Boolean)
                    return <label key={id}><input type="radio" name="existing-candidate" value={id} checked={selectedExistingId === id} onChange={() => setSelectedExistingId(id)} /><span><strong>{!isConversionFieldHidden('full_name') ? display(candidate.full_name || candidate.name) : 'Existing candidate'}</strong><small>{identity.length ? identity.join(' · ') : 'Protected candidate record'}</small></span></label>
                  })}</div>
                  <label className="applied-fill-blank"><input type="checkbox" checked={fillBlankFields} onChange={event => setFillBlankFields(event.target.checked)} disabled={!BLANK_FILL_PERMISSION_FIELDS.some(([, permissionField]) => canEditConversionField(permissionField))} />Fill only permitted blank fields on the selected existing candidate with reviewed values</label>
                  {conversionErrors.duplicate && <small className="form-error">{conversionErrors.duplicate}</small>}
                </div>}
                <p className="applied-conversion-note">Successful save will remove this application from the default pending Applied Candidates list. The staged CV will be reused; no upload is required.</p>
                <div className="applied-drawer-actions">
                  <button className="btn-secondary" type="button" onClick={closeDrawer} disabled={conversionSaving}>Cancel</button>
                  {duplicateState && <button className="btn-secondary applied-danger-button" type="button" onClick={() => setRejectTarget(drawer.row)} disabled={conversionSaving}>Reject</button>}
                  {duplicateState && <button className="btn-primary" type="button" onClick={() => saveConversion('link_existing')} disabled={conversionSaving}>{conversionSaving ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}Link Existing Candidate</button>}
                  {!duplicateState && <button className="btn-primary" type="button" onClick={() => saveConversion('create')} disabled={conversionSaving}>{conversionSaving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}Save to Candidates</button>}
                </div>
              </div>
            )}
          </aside>
        </div>,
        document.body,
      )}

      {rejectTarget && createPortal(
        <div className="applied-content-overlay applied-reject-overlay" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && !rejectSaving) setRejectTarget(null)
        }}>
          <section ref={rejectDialogRef} tabIndex={-1} className="applied-reject-dialog" role="alertdialog" aria-modal="true" aria-labelledby="applied-reject-title" aria-describedby="applied-reject-description">
            <header><h2 id="applied-reject-title">Reject Application</h2><button className="modal-close" type="button" onClick={() => setRejectTarget(null)} disabled={rejectSaving} aria-label="Close rejection dialog"><X size={16} /></button></header>
            <div><p id="applied-reject-description">Reject {display(rejectTarget.full_name)} for {roleName(rejectTarget)}? This permanently deletes the application row and its staged CV.</p></div>
            <footer><button className="btn-secondary" type="button" onClick={() => setRejectTarget(null)} disabled={rejectSaving}>Cancel</button><button className="btn-primary applied-danger-button" type="button" onClick={submitReject} disabled={rejectSaving}>{rejectSaving ? 'Rejecting...' : 'Reject Application'}</button></footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}

function ConversionField({ label, required = false, missing = false, error = '', full = false, children }) {
  return <label className={`applied-conversion-field${full ? ' is-full' : ''}${missing ? ' is-missing' : ''}${error ? ' is-error' : ''}`}><span>{label}{required && <b>*</b>}{missing && <em>Missing</em>}</span>{children}{error && <small>{error}</small>}</label>
}
