import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Plus, Pencil, X, Building2, AlertCircle, Loader2, ChevronDown, FileText, Search, Trash2, Lock } from 'lucide-react'
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
import { normalizeExternalUrl, openExternalUrl, openProtectedDocumentPath, isValidStoragePath } from '../services/apiClient'
import { STORAGE_BUCKETS } from '../utils/storageBuckets'
import { SECTOR_OPTIONS } from '../utils/sectorOptions'
import { highlightText, keywordFilters } from '../utils/aiFilterUi'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { parseDashboardFiltersFromUrl } from '../utils/dashboardDrilldown'
import { ConsultantPill } from '../components/ConsultantPill'

const STATUSES = ['Active', 'Inactive', 'Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
const STATUS_OPTIONS = ['', ...STATUSES]
const STATUS_BADGE_MAP = {
  Converted: 'badge-converted',
  'Not Converted': 'badge-not-converted',
  'Follow Up Required': 'badge-follow-up',
  'Not Hiring': 'badge-not-hiring',
  'Not Adding Consultants': 'badge-not-adding-consultants',
  "Didn't Pick Up": 'badge-didnt-pick-up'
}
const TERMS = ['%', 'Fixed Fee Model', 'Slab %', 'Any Other']
const BILLING_ENTITIES = ['FCS', 'FCAPL']
const REGION_OPTIONS = ['', 'North', 'South', 'East', 'West', 'International']
const EMPTY_FORM = {
  client_group_id: '',
  client_display_id: '',
  consultant_name: '',
  consultant_user_id: '',
  client_name: '',
  location: '',
  region: '',
  contact_person: '',
  designation: '',
  mobile: '',
  email: '',
  linkedin: '',
  sector: '',
  connected_on_date: '',
  comments: '',
  follow_up_date: '',
  status: '',
  terms_signed_type: '',
  terms_signed_custom: '',
  terms_value: '',
  billing_entity: '',
  contract_signed: 'No',
  contract_document: '',
  gstin: '',
  pan: '',
  address_on_invoice: ''
}

const dash = (value) => value || '-'
const mutedDash = <span className="table-muted-dash">-</span>
const termsLabel = (client) => client.terms_signed_type === 'Any Other' ? client.terms_signed_custom : client.terms_signed_type
const showCommercialFields = (client) => client.contract_signed === true || client.contract_signed === 'Yes'
const commercialDash = (client, value) => showCommercialFields(client) ? dash(value) : '-'
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const contactNameFor = (client) => String(client?.contact_person || client?.contact || '').replace(/\s+/g, ' ').trim()
const isRealContact = (client) => {
  const name = contactNameFor(client)
  return Boolean(name && !/^contact\s+\d+$/i.test(name))
}
const isPlaceholderContact = (client) => {
  if (!client.client_group_id || client.id === client.client_group_id) return false
  const contactName = normalizeText(client.contact_person || client.contact)
  const hasOnlyPlaceholderName = !contactName || /^contact\s+\d+$/.test(contactName)
  const hasContactDetails = ['mobile', 'phone', 'email', 'linkedin', 'designation']
    .some(key => normalizeText(client[key]))
  return hasOnlyPlaceholderName && !hasContactDetails
}
const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}
const normalizeFollowUpDate = (value) => {
  const text = String(value || '').trim()
  if (!text) return ''
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10)
}
const CLIENT_TABLE_COLUMNS = [
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'contactPerson', label: 'Contact Person' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'designation', label: 'Designation' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'sector', label: 'Sector' },
  { key: 'connectedOnDate', label: 'Connected On Date' },
  { key: 'comments', label: 'Comments' },
  { key: 'followUpDate', label: 'Follow Up Date' },
  { key: 'status', label: 'Status' },
  { key: 'contractSigned', label: 'Contract Signed' },
  { key: 'termsSigned', label: 'Terms Signed' },
  { key: 'value', label: 'Value' },
  { key: 'billingEntity', label: 'Billing Entity' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'pan', label: 'PAN' },
  { key: 'addressOnInvoice', label: 'Address on Invoice' },
  { key: 'contractPdf', label: 'Contract PDF' },
  { key: 'actions', label: 'Actions' }
]
const DEFAULT_CLIENT_COLUMN_KEYS = CLIENT_TABLE_COLUMNS.map(column => column.key)
const REMOVED_CLIENT_COLUMN_KEYS = new Set(['location', 'region'])
const SORT_OPTIONS = [
  { field: 'client_id', label: 'Client ID' },
  { field: 'client_name', label: 'Alphabetical Order' }
]
const CLIENTS_TABLE_COLUMNS_PREFERENCE_KEY = 'clientsTableColumns'
const CLIENT_AI_SEARCH_FIELDS = ['client_id', 'client_name', 'location', 'region', 'consultant', 'contact_person', 'mobile', 'email', 'linkedin', 'sector', 'connected_on_date', 'comments', 'follow_up_date', 'status', 'terms_signed', 'value', 'billing_entity', 'gstin', 'pan', 'address_on_invoice', 'designation', 'contract_signed', 'contract_document']
const CLIENT_PERMISSION_BY_COLUMN = {
  clientId: 'client_display_id',
  clientName: 'client_name',
  consultant: 'consultant_name',
  contactPerson: 'contact_person',
  mobile: 'mobile',
  email: 'email',
  designation: 'designation',
  linkedin: 'linkedin',
  sector: 'sector',
  connectedOnDate: 'connected_on_date',
  comments: 'comments',
  followUpDate: 'follow_up_date',
  status: 'status',
  contractSigned: 'contract_signed',
  termsSigned: 'terms_signed_type',
  value: 'terms_value',
  billingEntity: 'terms_value',
  gstin: 'gstin',
  pan: 'pan',
  addressOnInvoice: 'address_on_invoice',
  contractPdf: 'contract_document'
}
const CLIENT_PERMISSION_BY_AI_FIELD = {
  client_id: 'client_display_id',
  client_name: 'client_name',
  location: 'location',
  region: 'region',
  consultant: 'consultant_name',
  contact_person: 'contact_person',
  mobile: 'mobile',
  email: 'email',
  linkedin: 'linkedin',
  sector: 'sector',
  connected_on_date: 'connected_on_date',
  comments: 'comments',
  follow_up_date: 'follow_up_date',
  status: 'status',
  terms_signed: 'terms_signed_type',
  value: 'terms_value',
  billing_entity: 'terms_value',
  gstin: 'gstin',
  pan: 'pan',
  address_on_invoice: 'address_on_invoice',
  designation: 'designation',
  contract_signed: 'contract_signed',
  contract_document: 'contract_document'
}

const getCurrentUser = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
  } catch {
    return {}
  }
}

const getCanonicalClients = (clients) => {
  const map = new Map()
  clients.forEach(client => {
    if (isPlaceholderContact(client)) return
    const name = client.client_name || client.name || ''
    const key = String(client.client_group_id || client.client_display_id || name).trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, client)
  })
  return [...map.values()].sort((a, b) => String(a.client_name || a.name || '').localeCompare(String(b.client_name || b.name || ''), undefined, { sensitivity: 'base' }))
}

const followUpClientKey = (client) => client?._contact_group_id || client?.client_group_id || client?.id || ''

const formatLocationRegion = (location, region) => {
  const parts = [location, region].map(value => String(value || '').trim()).filter(Boolean)
  return parts.join(', ')
}

function clientToForm(client) {
  return {
    client_group_id: client.client_group_id || client.id || '',
    client_display_id: client.client_display_id || '',
    consultant_name: client.consultant_name || client.consultant || '',
    consultant_user_id: client.consultant_user_id || '',
    client_name: client.client_name || client.name || '',
    location: client.location || client.city || '',
    region: client.region || client.state || '',
    contact_person: client.contact_person || client.contact || '',
    designation: client.designation || '',
    mobile: client.mobile || client.phone || '',
    email: client.email || '',
    linkedin: client.linkedin || '',
    sector: client.sector || '',
    connected_on_date: client.connected_on_date || '',
    comments: client.comments || client.notes || '',
    follow_up_date: client.follow_up_date || '',
    status: STATUSES.includes(client.status) ? client.status : '',
    terms_signed_type: client.terms_signed_type || '',
    terms_signed_custom: client.terms_signed_custom || '',
    terms_value: client.terms_value || '',
    billing_entity: client.billing_entity || '',
    contract_signed: client.contract_signed ? 'Yes' : 'No',
    contract_document: client.contract_pdf_storage_path || client.contract_document || client.contract_pdf_url || '',
    gstin: client.gstin || '',
    pan: client.pan || '',
    address_on_invoice: client.address_on_invoice || ''
  }
}

export default function ClientsPage() {
  const { loadProfile } = useAuth()
  const { isAdmin, permissions } = useAdminAccess()
  const location = useLocation()
  const navigate = useNavigate()
  const dashboardFilters = useMemo(() => parseDashboardFiltersFromUrl(location.search), [location.search])
  const [clients, setClients] = useState([])
  const [allClients, setAllClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [contractUploading, setContractUploading] = useState(false)
  const [saveStep, setSaveStep] = useState('')
  const [editingClient, setEditingClient] = useState(null)
  const [selectedFollowUps, setSelectedFollowUps] = useState({})
  const [selectedContacts, setSelectedContacts] = useState({})
  const [followUpClient, setFollowUpClient] = useState(null)
  const [followUpForm, setFollowUpForm] = useState({ follow_up_date: '', follow_up_comments: '' })
  const [followUpError, setFollowUpError] = useState('')
  const [editingFollowUp, setEditingFollowUp] = useState(null)
  const [deletingFollowUp, setDeletingFollowUp] = useState(null)
  const [clientDuplicate, setClientDuplicate] = useState(null)
  const [clientAlreadyAdded, setClientAlreadyAdded] = useState(false)
  const [duplicateMoreOpen, setDuplicateMoreOpen] = useState(false)
  const [contractFile, setContractFile] = useState(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnsAnchor, setColumnsAnchor] = useState(null)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CLIENT_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CLIENT_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [sortAnchor, setSortAnchor] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => dashboardFilters?.status || 'All')
  const effectiveStatusFilter = dashboardFilters?.status || statusFilter
  const [aiFilterText, setAiFilterText] = useState('')
  const [aiFilters, setAiFilters] = useState(null)
  const [aiFilterLoading, setAiFilterLoading] = useState(false)
  const [aiFilterError, setAiFilterError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalClients, setTotalClients] = useState(0)
  const [openingDocument, setOpeningDocument] = useState('')
  const [statusOpen, setStatusOpen] = useState(false)
  const [tablePopover, setTablePopover] = useState(null)
  const [statusSaving, setStatusSaving] = useState({})
  const [contactSaving, setContactSaving] = useState({})
  const [statusUpdateError, setStatusUpdateError] = useState('')
  const [expandedCells, setExpandedCells] = useState({})
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [selectedExistingClientId, setSelectedExistingClientId] = useState(null)
  const [addingNewClient, setAddingNewClient] = useState(false)
  const [addingContactPerson, setAddingContactPerson] = useState(false)
  const [sectorSearch, setSectorSearch] = useState('')
  const [sectorOpen, setSectorOpen] = useState(false)
  const [consultantOptions, setConsultantOptions] = useState([])
  const [consultantSearch, setConsultantSearch] = useState('')
  const [consultantOpen, setConsultantOpen] = useState(false)
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)
  const statusDropdownRef = useRef(null)
  const clientModalRef = useRef(null)
  const clientNameInputRef = useRef(null)
  const clientIdRequestRef = useRef(0)
  const followUpModalRef = useRef(null)
  const duplicateModalRef = useRef(null)
  const contactSavingRef = useRef({})
  const pendingRealtimeRefreshRef = useRef(false)
  const suppressRealtimeUntilRef = useRef(0)

  const focusPopup = useCallback((ref) => {
    window.requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const target = node.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || node).focus({ preventScroll: true })
    })
  }, [])

  useEffect(() => {
    if (!isOpen && !followUpClient && !deletingFollowUp && !clientDuplicate && !clientAlreadyAdded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [isOpen, followUpClient, deletingFollowUp, clientDuplicate, clientAlreadyAdded])

  const fetchClientOptions = useCallback(async () => {
    const res = await fetch('/api/clients?all=true')
    const data = await res.json().catch(() => ({}))
    if (res.ok) setAllClients(data.data || [])
  }, [])

  const fetchClients = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) setLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pageSize))
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      if (effectiveStatusFilter !== 'All') params.set('status', effectiveStatusFilter)
      if (dashboardFilters?.consultant) params.set('consultant', dashboardFilters.consultant)
      if (dashboardFilters?.period) params.set('period', dashboardFilters.period)
      if (aiFilters) params.set('ai_filters', JSON.stringify(aiFilters))
      const res = await fetch(`/api/clients${params.toString() ? `?${params.toString()}` : ''}`)
      if (!res.ok) throw new Error('Failed to fetch clients from server.')
      const data = await res.json()
      setClients(data.data || [])
      setTotalClients(Number(data.total) || 0)
      setPage(Number(data.page) || 1)
      if (import.meta.env.DEV && aiFilters) console.debug('Clients AI filter', { filters: aiFilters, matched: Number(data.total) || 0 })
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [aiFilters, dashboardFilters, effectiveStatusFilter, page, pageSize, sortDirection, sortField])

  const refreshClientsRealtime = useCallback(() => {
    if (Date.now() < suppressRealtimeUntilRef.current) return
    if (isOpen || followUpClient || clientDuplicate || clientAlreadyAdded) {
      pendingRealtimeRefreshRef.current = true
      return
    }
    fetchClients({ showLoading: false })
    fetchClientOptions()
  }, [clientAlreadyAdded, clientDuplicate, fetchClientOptions, fetchClients, followUpClient, isOpen])

  const openDocument = useCallback(async (key, path) => {
    setOpeningDocument(key)
    try {
      await openProtectedDocumentPath('contract', path, {
        missingMessage: 'Contract PDF is missing or needs to be reuploaded',
        notFoundMessage: 'Contract PDF not found.'
      })
    } finally {
      setOpeningDocument('')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(fetchClients, 0)
    return () => window.clearTimeout(timer)
  }, [fetchClients])

  useEffect(() => {
    if (isOpen || followUpClient || clientDuplicate || clientAlreadyAdded || !pendingRealtimeRefreshRef.current) return
    pendingRealtimeRefreshRef.current = false
    fetchClients({ showLoading: false })
    fetchClientOptions()
  }, [clientAlreadyAdded, clientDuplicate, fetchClientOptions, fetchClients, followUpClient, isOpen])

  useRealtimeRefresh({
    channelName: 'realtime:clients-page',
    tables: ['clients', 'client_follow_ups'],
    onChange: refreshClientsRealtime
  })

  useEffect(() => {
    const timer = window.setTimeout(fetchClientOptions, 0)
    return () => window.clearTimeout(timer)
  }, [fetchClientOptions])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null
        const currentUser = getCurrentUser()
        const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/${CLIENTS_TABLE_COLUMNS_PREFERENCE_KEY}?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = Array.isArray(payload.data?.value)
          ? payload.data.value.filter(key => !REMOVED_CLIENT_COLUMN_KEYS.has(key) && DEFAULT_CLIENT_COLUMN_KEYS.includes(key))
          : null

        if (value?.length) {
          setVisibleColumns(value)
          setPendingColumns(value)
          setSavedColumns(value)
        }
      } catch {
        setVisibleColumns(DEFAULT_CLIENT_COLUMN_KEYS)
        setPendingColumns(DEFAULT_CLIENT_COLUMN_KEYS)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!statusOpen) return
    const handleClickOutside = (event) => {
      if (!statusDropdownRef.current?.contains(event.target)) setStatusOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [statusOpen])

  const groupedClients = useMemo(() => {
    const groups = new Map()
    clients.forEach((client) => {
      if (isPlaceholderContact(client)) return
      const key = client.client_group_id || client.id
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(client)
    })

    return [...groups.entries()].map(([key, contacts]) => {
      const validContacts = contacts.filter(isRealContact)
      const selectedId = selectedContacts[key]
      const selected = validContacts.find(contact => contact.id === selectedId) || validContacts[0] || contacts[0]
      return { ...selected, _contact_group_id: key, _contacts: validContacts }
    })
  }, [clients, selectedContacts])

  const activeColumns = CLIENT_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key) && !isColumnHidden(permissions, 'clients', CLIENT_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const availableColumns = CLIENT_TABLE_COLUMNS.filter(column => !isColumnHidden(permissions, 'clients', CLIENT_PERMISSION_BY_COLUMN[column.key], isAdmin))
  const visibleAiFields = CLIENT_AI_SEARCH_FIELDS.filter(field => !isColumnHidden(permissions, 'clients', CLIENT_PERMISSION_BY_AI_FIELD[field], isAdmin))
  const clientFieldPermission = {
    client_display_id: 'client_display_id',
    consultant_name: 'consultant_name',
    client_name: 'client_name',
    location: 'location',
    region: 'region',
    contact_person: 'contact_person',
    mobile: 'mobile',
    email: 'email',
    designation: 'designation',
    linkedin: 'linkedin',
    sector: 'sector',
    connected_on_date: 'connected_on_date',
    follow_up_date: 'follow_up_date',
    comments: 'comments',
    status: 'status',
    contract_signed: 'contract_signed',
    contract_document: 'contract_document',
    terms_signed_type: 'terms_signed_type',
    terms_signed_custom: 'terms_signed_type',
    terms_value: 'terms_value',
    billing_entity: 'terms_value',
    gstin: 'gstin',
    pan: 'pan',
    address_on_invoice: 'address_on_invoice'
  }
  const isClientFieldHidden = (name) => isColumnHidden(permissions, 'clients', clientFieldPermission[name] || name, isAdmin)
  const isClientFieldDisabled = (name) => isColumnDisabled(permissions, 'clients', clientFieldPermission[name] || name, isAdmin)
  const canonicalClients = useMemo(() => getCanonicalClients(allClients), [allClients])
  const matchingClients = useMemo(() => (
    canonicalClients
      .filter(client => normalizeText(client.client_name || client.name).includes(normalizeText(form.client_name)))
  ), [canonicalClients, form.client_name])
  const matchingSectors = useMemo(() => SECTOR_OPTIONS.filter(value => value.toLowerCase().includes(sectorSearch.trim().toLowerCase())), [sectorSearch])
  const consultantByName = useMemo(() => new Map(consultantOptions.map(user => [String(user.name || '').trim(), user])), [consultantOptions])
  const matchingConsultants = useMemo(() => {
    const query = consultantSearch.trim().toLowerCase()
    return consultantOptions.filter(user => !query || user.name.toLowerCase().includes(query))
  }, [consultantOptions, consultantSearch])

  const updateClientLockState = async (record) => {
    setClients(current => current.map(client => client.id === record.id ? { ...client, ...record } : client))
    setAllClients(current => current.map(client => client.id === record.id ? { ...client, ...record } : client))
    await fetchClients({ showLoading: false })
    await fetchClientOptions()
  }

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

  const selectConsultant = (name) => {
    const user = consultantByName.get(name)
    setConsultantSearch(name)
    setForm(current => ({ ...current, consultant_name: name, consultant_user_id: user?.id || '' }))
    setConsultantOpen(false)
  }

  const selectExistingClient = (client) => {
    clientIdRequestRef.current += 1
    setForm(current => ({
      ...current,
      client_group_id: client.client_group_id || client.id,
      client_display_id: client.client_display_id || '',
      client_name: client.client_name || client.name || '',
      location: client.location || client.city || current.location,
      region: client.region || client.state || current.region,
      sector: client.sector || current.sector
    }))
    setSectorSearch(client.sector || '')
    setSelectedExistingClientId(client.client_group_id || client.id)
    setAddingNewClient(false)
    setErrors({})
    setClientSuggestionsOpen(false)
  }

  const selectNewClient = async () => {
    const requestId = clientIdRequestRef.current + 1
    clientIdRequestRef.current = requestId
    setForm(current => ({
      ...current,
      client_group_id: '',
      client_display_id: '',
      client_name: '',
    }))
    setSelectedExistingClientId(null)
    setAddingNewClient(true)
    setErrors({})
    setClientSuggestionsOpen(false)
    window.setTimeout(() => clientNameInputRef.current?.focus(), 0)
    try {
      const response = await fetch('/api/clients/next-display-id')
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.client_display_id || clientIdRequestRef.current !== requestId) return
      setForm(current => current.client_group_id ? current : { ...current, client_display_id: data.client_display_id })
    } catch {
      if (clientIdRequestRef.current === requestId) setErrors(current => ({ ...current, client_display_id: 'Unable to load Client ID' }))
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'contract_signed' && value === 'No') setContractFile(null)
    if (name === 'client_name') setClientSuggestionsOpen(!addingNewClient)
    setForm((current) => {
      const next = { ...current, [name]: value }
      if (name === 'client_name' && selectedExistingClientId && value !== current.client_name) {
        next.client_group_id = ''
        next.client_display_id = addingNewClient ? current.client_display_id : ''
      }
      if (name === 'contract_signed' && value === 'No') next.contract_document = ''
      return next
    })
    if (name === 'client_name' && selectedExistingClientId) setSelectedExistingClientId(null)
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const handleContractFile = (event) => {
    const file = event.target.files?.[0] || null
    if (file && file.type !== 'application/pdf') {
      setErrors((current) => ({ ...current, contract_document: 'Contract document must be a PDF file.' }))
      setContractFile(null)
      event.target.value = ''
      return
    }
    setErrors((current) => ({ ...current, contract_document: '' }))
    setContractFile(file)
  }

  const validate = () => {
    const next = {}
    if (addingNewClient && !form.client_display_id.trim()) next.client_display_id = 'Client ID is loading'
    if (!form.client_name.trim()) next.client_name = 'Client Name is required'
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email'
    if (form.client_group_id && !form.contact_person.trim()) next.contact_person = 'Contact Person is required'
    if (form.status && !STATUSES.includes(form.status)) next.status = 'Select a valid status'
    if (!['Yes', 'No'].includes(form.contract_signed)) next.contract_signed = 'Select Yes or No'
    return next
  }

  const openModal = useCallback(async () => {
    setForm({ ...EMPTY_FORM, connected_on_date: todayLocal(), follow_up_date: todayLocal() })
    setConsultantSearch('')
    setConsultantOpen(false)
    setErrors({})
    setContractFile(null)
    setEditingClient(null)
    setSelectedExistingClientId(null)
    setAddingNewClient(false)
    setAddingContactPerson(false)
    setSectorSearch('')
    setClientSuggestionsOpen(false)
    setIsOpen(true)

    const [profile, users] = await Promise.all([
      loadProfile({ force: true }).catch(() => null),
      fetchConsultantOptions().catch(() => [])
    ])
    const consultantName = String(profile?.name || profile?.display_name || '').trim()
    const consultantUser = users.find(user => user.id && user.id === profile?.user_id) || users.find(user => user.name === consultantName)
    setForm(current => ({
      ...current,
      consultant_name: consultantName,
      consultant_user_id: consultantUser?.id || ''
    }))
    setConsultantSearch(consultantName)
  }, [fetchConsultantOptions, loadProfile])

  useEffect(() => {
    const action = location.state?.action
    if (!action) return
    navigate(location.pathname, { replace: true, state: null })
    if (action !== 'add-client') return
    const timer = window.setTimeout(openModal, 0)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.state?.action, navigate, openModal])

  const openEditModal = (client) => {
    const followUp = selectedFollowUp(client)
    setForm({ ...clientToForm(client), follow_up_id: followUp?.id || '', follow_up_date: followUp?.follow_up_date || '' })
    setConsultantSearch(client.consultant_name || client.consultant || '')
    setConsultantOpen(false)
    fetchConsultantOptions().catch(() => {})
    setErrors({})
    setContractFile(null)
    setEditingClient(client)
    setSelectedExistingClientId(null)
    setAddingNewClient(false)
    setAddingContactPerson(false)
    setSectorSearch(client.sector || '')
    setClientSuggestionsOpen(false)
    setIsOpen(true)
  }

  useEffect(() => {
    if (isOpen) focusPopup(clientModalRef)
  }, [isOpen, focusPopup])

  useEffect(() => {
    if (followUpClient) focusPopup(followUpModalRef)
  }, [followUpClient, focusPopup])

  useEffect(() => {
    if (clientDuplicate) focusPopup(duplicateModalRef)
  }, [clientDuplicate, focusPopup])

  const openContactModal = (client) => {
    const currentContact = selectedContact(client)
    const source = isRealContact(currentContact)
      ? currentContact
      : (client._contacts || []).find(isRealContact) || client
    setForm({
      ...clientToForm({ ...client, ...source }),
      client_group_id: client.client_group_id || client.id,
      client_display_id: client.client_display_id || source.client_display_id || '',
      follow_up_id: '',
      follow_up_date: '',
      comments: source.comments || client.comments || '',
      contact_person: '',
      mobile: '',
      email: '',
      designation: '',
      linkedin: ''
    })
    setConsultantSearch(client.consultant_name || client.consultant || '')
    setConsultantOpen(false)
    fetchConsultantOptions().catch(() => {})
    setErrors({})
    setContractFile(null)
    setEditingClient(null)
    setSelectedExistingClientId(client.client_group_id || client.id)
    setAddingNewClient(false)
    setAddingContactPerson(true)
    setSectorSearch(client.sector || '')
    setClientSuggestionsOpen(false)
    setIsOpen(true)
  }

  const contractStoragePath = (clientId, file) => {
    const baseName = String(file.name || 'contract.pdf')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'contract'
    return `contracts/${clientId}/${Date.now()}-${baseName}.pdf`
  }

  const uploadContractFile = async (clientId) => {
    if (!contractFile) return null
    if (!supabase) throw new Error('Supabase is not configured.')
    if (!clientId) throw new Error('Client ID is required before uploading contract.')
    if (contractFile.type !== 'application/pdf') throw new Error('Contract document must be a PDF file.')

    const path = contractStoragePath(clientId, contractFile)
    if (import.meta.env.DEV) console.debug('[clients:contract-upload]', { clientId, path, fileName: contractFile.name, fileSize: contractFile.size })
    setSaveStep('Uploading contract...')
    setContractUploading(true)
    const { error } = await supabase.storage.from(STORAGE_BUCKETS.CONTRACT).upload(path, contractFile, {
      contentType: 'application/pdf',
      upsert: true
    })
    setContractUploading(false)
    if (error) throw new Error(error.message || 'Contract upload failed.')
    return { path, name: contractFile.name }
  }

  const saveClientMetadata = async ({ method, url, payload }) => {
    if (import.meta.env.DEV) console.debug('[clients:metadata-request]', { method, url, payload })
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json().catch(() => ({}))
    if (import.meta.env.DEV) console.debug('[clients:metadata-response]', { method, url, status: res.status, body: data })
    if (res.status === 409 && data.duplicate) {
      const error = new Error(data.error || 'Duplicate client found.')
      error.duplicate = data
      throw error
    }
    if (!res.ok) throw new Error(data.detail || data.error || 'Failed to save client.')
    return data
  }

  const validateContactPerson = () => {
    const next = {}
    if (!form.contact_person.trim()) next.contact_person = 'Contact Person is required'
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email'
    if (!form.mobile.trim() && !form.email.trim()) next.mobile = 'Enter mobile or email'
    return next
  }

  const handleAddContactPerson = async () => {
    const clientId = form.client_group_id || selectedExistingClientId
    if (!clientId || contactSavingRef.current[clientId]) return
    const nextErrors = validateContactPerson()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    const payload = { ...form }
    delete payload.follow_up_id
    delete payload.follow_up_date
    if (import.meta.env.DEV) console.debug('[clients]', { actionType: 'add_contact_person', clientId, payload })
    contactSavingRef.current[clientId] = true
    setContactSaving(current => ({ ...current, [clientId]: true }))
    setSaving(true)
    try {
      const data = await saveClientMetadata({ method: 'POST', url: '/api/clients', payload })
      if (import.meta.env.DEV) console.debug('[clients]', { actionType: 'add_contact_person', clientId, status: 201 })
      setIsOpen(false)
      setAddingContactPerson(false)
      setSelectedContacts(current => ({ ...current, [clientId]: data.id || data.data?.id || current[clientId] || '' }))
      await fetchClients({ showLoading: false })
      await fetchClientOptions()
    } catch (err) {
      setErrors({ contact_person: err.message })
    } finally {
      setSaving(false)
      contactSavingRef.current[clientId] = false
      setContactSaving(current => ({ ...current, [clientId]: false }))
    }
  }

  const saveClientToApi = async (duplicateAction = '') => {
    const payload = { ...form }
    if (duplicateAction) payload.duplicate_action = duplicateAction

    if (editingClient) {
      setSaveStep(contractFile ? 'Uploading contract...' : 'Saving client...')
      const contract = await uploadContractFile(editingClient.id)
      if (contract) {
        setSaveStep('Finalizing contract...')
        try {
          const data = await saveClientMetadata({
            method: 'PATCH',
            url: `/api/clients/${editingClient.id}`,
            payload: {
              contract_signed: true,
              contract_document_path: contract.path,
              contract_document_name: contract.name
            }
          })
          window.dispatchEvent(new Event('ats:clients-updated'))
          setSaveStep('Done')
          return data
        } catch (err) {
          throw new Error(import.meta.env.DEV ? `Contract uploaded, but client record update failed: ${err.message}` : 'Contract uploaded, but client record update failed. Please retry saving.', { cause: err })
        }
      }
      const data = await saveClientMetadata({ method: 'PATCH', url: `/api/clients/${editingClient.id}`, payload })
      window.dispatchEvent(new Event('ats:clients-updated'))
      setSaveStep('Done')
      return data
    }

    setSaveStep('Saving client...')
    const data = await saveClientMetadata({ method: 'POST', url: '/api/clients', payload })
    const clientId = data.id || data.data?.id
    if (contractFile) {
      let contract
      try {
        contract = await uploadContractFile(clientId)
      } catch (err) {
        throw new Error(import.meta.env.DEV ? `Client was saved, but contract upload failed: ${err.message}` : 'Client was saved, but contract upload failed. Please upload the contract again from Edit Client.', { cause: err })
      }
      setSaveStep('Finalizing contract...')
      try {
        await saveClientMetadata({
          method: 'PATCH',
          url: `/api/clients/${clientId}`,
          payload: {
            contract_signed: true,
            contract_document_path: contract.path,
            contract_document_name: contract.name
          }
        })
      } catch (err) {
        throw new Error(import.meta.env.DEV ? `Contract uploaded, but client record update failed: ${err.message}` : 'Contract uploaded, but client record update failed. Please retry saving.', { cause: err })
      }
    }
    window.dispatchEvent(new Event('ats:clients-updated'))
    setSaveStep('Done')
    return data
  }

  const handleSave = async () => {
    if (addingContactPerson) {
      await handleAddContactPerson()
      return
    }
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    if (!editingClient && selectedExistingClientId && !addingNewClient && !addingContactPerson) {
      setClientAlreadyAdded(true)
      return
    }

    setSaving(true)
    try {
      await saveClientToApi()
      setIsOpen(false)
      setContractFile(null)
      setEditingClient(null)
      setAddingContactPerson(false)
      await fetchClients({ showLoading: false })
      await fetchClientOptions()
    } catch (err) {
      if (err.duplicate) {
        setClientDuplicate({ client: { ...form }, existing: err.duplicate.existing, message: err.message })
        setDuplicateMoreOpen(false)
        return
      }
      setErrors(contractFile ? { contract_document: err.message } : { client_name: err.message })
    } finally {
      setContractUploading(false)
      setSaving(false)
      setSaveStep('')
    }
  }

  const resolveClientDuplicate = () => {
    if (!clientDuplicate?.existing) return
    setForm({
      ...clientDuplicate.client,
      client_group_id: clientDuplicate.existing.client_group_id || clientDuplicate.existing.id || '',
      client_display_id: clientDuplicate.existing.client_display_id || ''
    })
    setEditingClient(clientDuplicate.existing)
    setSelectedExistingClientId(clientDuplicate.existing.client_group_id || clientDuplicate.existing.id)
    setAddingNewClient(false)
    setClientDuplicate(null)
    setDuplicateMoreOpen(false)
    setErrors({})
    setIsOpen(true)
  }

  const duplicateClientValue = (row, key) => {
    switch (key) {
      case 'clientId': return row.client_display_id || row.clientId || '-'
      case 'clientName': return row.client_name || row.name || '-'
      case 'consultant': return row.consultant_name || row.consultant || '-'
      case 'location': return row.location || row.city || '-'
      case 'region': return row.region || row.state || '-'
      case 'contactPerson': return row.contact_person || row.contact || '-'
      case 'mobile': return row.mobile || row.phone || '-'
      case 'email': return row.email || '-'
      case 'designation': return row.designation || '-'
      case 'linkedin': return row.linkedin || '-'
      case 'sector': return row.sector || '-'
      case 'connectedOnDate': return row.connected_on_date || '-'
      case 'comments': return row.comments || row.notes || '-'
      case 'followUpDate': return row.follow_up_date || '-'
      case 'status': return row.status || '-'
      case 'termsSigned': return row.terms_signed_type === 'Any Other' ? row.terms_signed_custom || '-' : row.terms_signed_type || '-'
      case 'value': return row.terms_value || '-'
      case 'billingEntity': return row.billing_entity || '-'
      case 'contractSigned': return row.contract_signed === 'Yes' || row.contract_signed === true ? 'Yes' : 'No'
      case 'contractDocument': return row.contract_document || '-'
      case 'gstin': return row.gstin || '-'
      case 'pan': return row.pan || '-'
      case 'addressOnInvoice': return row.address_on_invoice || '-'
      case 'actions': return '-'
      default: return '-'
    }
  }

  const selectedFollowUp = (client) => {
    const followUps = client.follow_ups || []
    const selected = selectedFollowUps[followUpClientKey(client)] || followUps[followUps.length - 1]?.id
    return followUps.find((item) => item.id === selected) || followUps[followUps.length - 1] || null
  }

  const mergeClientUpdate = useCallback((updatedClient) => {
    if (!updatedClient?.id) return
    const updatedKey = followUpClientKey(updatedClient)
    const merge = (client) => {
      if (client.id === updatedClient.id) return { ...client, ...updatedClient }
      if (updatedKey && followUpClientKey(client) === updatedKey) {
        return {
          ...client,
          follow_ups: Array.isArray(updatedClient.follow_ups) ? updatedClient.follow_ups : client.follow_ups,
          follow_up_date: updatedClient.follow_up_date,
          comments: updatedClient.comments,
          notes: updatedClient.notes
        }
      }
      return client
    }
    setClients((current) => current.map(merge))
    setAllClients((current) => current.map(merge))
  }, [])

  const selectedContact = (client) => {
    const contacts = client._contacts || []
    if (!contacts.length) return {}
    const selected = selectedContacts[client._contact_group_id]
    return contacts.find((item) => item.id === selected) || contacts[0]
  }

  const deleteSelectedContact = async (client) => {
    const contacts = client._contacts || []
    const contact = selectedContact(client)
    if (!contact?.id || contacts.length <= 1) return
    if (!window.confirm(`Delete ${contactNameFor(contact)}?`)) return
    try {
      const res = await fetch(`/api/clients/${contact.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to delete contact.')
      const nextContact = contacts.find(item => item.id !== contact.id)
      setSelectedContacts(current => ({ ...current, [client._contact_group_id]: nextContact?.id || '' }))
      await fetchClients({ showLoading: false })
      await fetchClientOptions()
    } catch (err) {
      setError(err.message)
    }
  }

  const openAddFollowUp = (client) => {
    setEditingFollowUp(null)
    setFollowUpClient(client)
    setFollowUpForm({ follow_up_date: todayLocal(), follow_up_comments: '' })
    setFollowUpError('')
  }

  const openEditFollowUp = (client, followUp) => {
    setTablePopover(null)
    setEditingFollowUp(followUp)
    setFollowUpClient(client)
    setFollowUpError('')
    setFollowUpForm({
      follow_up_date: followUp.follow_up_date || '',
      follow_up_comments: followUp.follow_up_comments || ''
    })
  }

  const saveFollowUp = async () => {
    if (!followUpForm.follow_up_date) return
    const normalizedDate = normalizeFollowUpDate(followUpForm.follow_up_date)
    const duplicate = (followUpClient?.follow_ups || []).some((item) => (
      normalizeFollowUpDate(item.follow_up_date) === normalizedDate &&
      item.id !== editingFollowUp?.id
    ))
    if (duplicate) {
      setFollowUpError('A follow up already exists for this date.')
      return
    }
    setSaving(true)
    try {
      setError(null)
      setFollowUpError('')
      const clientId = followUpClientKey(followUpClient)
      const payload = { ...followUpForm, follow_up_date: normalizedDate }
      if (import.meta.env.DEV) console.debug('[clients]', { actionType: 'add_follow_up_date', clientId, payload })
      suppressRealtimeUntilRef.current = Date.now() + 2500
      const res = await fetch(editingFollowUp ? `/api/clients/${clientId}/follow-ups/${editingFollowUp.id}` : `/api/clients/${clientId}/follow-ups`, {
        method: editingFollowUp ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json().catch(() => ({}))
      if (import.meta.env.DEV) console.debug('[clients]', { actionType: 'add_follow_up_date', clientId, status: res.status })
      if (!res.ok) throw new Error(data.error || 'Unable to save follow-up.')
      if (data.client) mergeClientUpdate(data.client)
      const latestFollowUps = Array.isArray(data.client?.follow_ups) ? data.client.follow_ups : []
      const selectedId = data.data?.id || editingFollowUp?.id || latestFollowUps[latestFollowUps.length - 1]?.id || ''
      setSelectedFollowUps((current) => ({ ...current, [clientId]: selectedId }))
      pendingRealtimeRefreshRef.current = false
      suppressRealtimeUntilRef.current = Date.now() + 2500
      setFollowUpClient(null)
      setEditingFollowUp(null)
      setFollowUpForm({ follow_up_date: '', follow_up_comments: '' })
    } catch (err) {
      setFollowUpError(err.message)
    } finally {
      setSaving(false)
    }
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
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const currentUser = getCurrentUser()
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const allowed = availableColumns.map(column => column.key)
      const value = (pendingColumns.length ? pendingColumns : allowed).filter(key => allowed.includes(key))
      const response = await fetch(`/api/user-preferences/${CLIENTS_TABLE_COLUMNS_PREFERENCE_KEY}`, {
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

  const toggleTablePopover = (type, id, element) => {
    if (!element || !id) return
    const anchorRect = element.getBoundingClientRect()
    setTablePopover(current => current?.type === type && current.id === id ? null : { type, id, anchorRect })
  }

  const updateClientStatus = async (client, status) => {
    const previousClients = clients
    const previousAllClients = allClients
    const nextStatus = status === '-' ? '' : status
    setStatusUpdateError('')
    setClients(current => current.map(row => row.id === client.id ? { ...row, status: nextStatus } : row))
    setAllClients(current => current.map(row => row.id === client.id ? { ...row, status: nextStatus } : row))
    setStatusSaving(current => ({ ...current, [client.id]: true }))
    setTablePopover(null)
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || data.error || 'Unable to update client status.')
      setClients(current => current.map(row => row.id === client.id ? { ...row, ...data } : row))
      setAllClients(current => current.map(row => row.id === client.id ? { ...row, ...data } : row))
    } catch (err) {
      setClients(previousClients)
      setAllClients(previousAllClients)
      setStatusUpdateError(err.message)
    } finally {
      setStatusSaving(current => ({ ...current, [client.id]: false }))
    }
  }

  const confirmDeleteFollowUp = async () => {
    if (!deletingFollowUp?.client?.id || !deletingFollowUp?.followUp?.id) return
    setSaving(true)
    try {
      setError(null)
      const { client, followUp } = deletingFollowUp
      const clientId = followUpClientKey(client)
      suppressRealtimeUntilRef.current = Date.now() + 2500
      const res = await fetch(`/api/clients/${clientId}/follow-ups/${followUp.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to delete follow-up.')
      if (data.client) mergeClientUpdate(data.client)
      const remaining = Array.isArray(data.client?.follow_ups) ? data.client.follow_ups : (Array.isArray(data.follow_ups) ? data.follow_ups : [])
      const latest = remaining[remaining.length - 1] || null
      setSelectedFollowUps((current) => ({ ...current, [clientId]: current[clientId] === followUp.id ? latest?.id || '' : current[clientId] || latest?.id || '' }))
      pendingRealtimeRefreshRef.current = false
      suppressRealtimeUntilRef.current = Date.now() + 2500
      setDeletingFollowUp(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const sortLabel = () => {
    const option = SORT_OPTIONS.find(item => item.field === sortField)
    return option ? `${option.label} ${sortDirection === 'asc' ? '↓' : '↑'}` : 'Sort By'
  }

  const selectSort = (field) => {
    if (sortField === field) {
      setSortDirection(current => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
    setPage(1)
    setSortOpen(false)
  }

  const applyAiFilter = async (event) => {
    event.preventDefault()
    const prompt = aiFilterText.trim()
    if (!prompt) {
      clearFilters()
      return
    }
    setAiFilterLoading(true)
    setAiFilterError('')
    try {
      const res = await fetch('/api/clients/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not parse Clients filter.')
      setAiFilters(data.filters || null)
      setPage(1)
    } catch {
      setAiFilters(keywordFilters('clients', prompt, visibleAiFields))
      setAiFilterError('')
      setPage(1)
    } finally {
      setAiFilterLoading(false)
    }
  }

  const clearFilters = () => {
    setStatusFilter('All')
    setAiFilterText('')
    setAiFilters(null)
    setAiFilterError('')
    setAiFilterLoading(false)
    setPage(1)
  }

  const toggleExpandedCell = (id, key, event) => {
    event.stopPropagation()
    const cellKey = `${id}-${key}`
    setExpandedCells(current => ({ ...current, [cellKey]: !current[cellKey] }))
  }

  const renderCommentsCell = (client, text) => {
    const value = String(text || '').trim()
    if (!value) return mutedDash
    const cellKey = `${client.id}-comments`
    const expanded = Boolean(expandedCells[cellKey])
    const words = value.split(/\s+/)
    const isLong = words.length > 4
    const displayText = expanded || !isLong ? value : words.slice(0, 4).join(' ')
    return (
      <div className="table-comment-cell">
        <div className={`table-comment-text${expanded ? ' is-expanded' : ''}`}>{highlightText(displayText, aiFilters)}</div>
        {isLong && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(client.id, 'comments', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} />
            {expanded ? <span>Show less</span> : <span><span>View full</span><span>comment</span></span>}
          </button>
        )}
      </div>
    )
  }

  const renderValueCell = (client, text) => {
    const value = String(text || '').trim()
    if (!value) return mutedDash
    const cellKey = `${client.id}-value`
    const expanded = Boolean(expandedCells[cellKey])
    const words = value.split(/\s+/)
    const isLong = words.length > 4
    const displayText = expanded || !isLong ? value : words.slice(0, 4).join(' ')
    return (
      <div className="table-comment-cell">
        <div className={`table-comment-text${expanded ? ' is-expanded' : ''}`}>{highlightText(displayText, aiFilters)}</div>
        {isLong && (
          <button type="button" className="table-view-more" onClick={(event) => toggleExpandedCell(client.id, 'value', event)}>
            <ChevronDown size={12} className={expanded ? 'is-open' : ''} />
            {expanded ? <span>View less</span> : <span>View more</span>}
          </button>
        )}
      </div>
    )
  }

  const renderClientCell = ({ key }, client) => {
    const followUp = selectedFollowUp(client)
    const contact = selectedContact(client)
    switch (key) {
      case 'clientId':
        return <td key={key}>{client.client_display_id ? <span className="table-id-chip table-client-id-chip">{client.client_display_id}</span> : mutedDash}</td>
      case 'consultant':
        return <td key={key}><ConsultantPill name={client.consultant_name || client.consultant} /></td>
      case 'clientName':
        return (
          <td key={key}>
            <div>
              <Link className="name-text" to={`/dashboard/clients/${client.id}`}>{client.is_locked && <Lock size={12} className="fb-lock-icon" />} {highlightText(client.client_name, aiFilters)}</Link>
              <div className="sub-text candidate-location-text">{highlightText(formatLocationRegion(client.location, client.region) || '-', aiFilters)}</div>
            </div>
          </td>
        )
      case 'contactPerson': {
        const contactSaveKey = client._contact_group_id || client.client_group_id || client.id
        const isContactSaving = Boolean(contactSaving[contactSaveKey])
        return (
          <td key={key}>
            <span className="inline-action-cell">
              {(client._contacts || []).length > 1 ? (
                <>
                  <select className="filter-select compact-select" value={contact.id || ''} onChange={(event) => setSelectedContacts((current) => ({ ...current, [client._contact_group_id]: event.target.value }))}>
                    {client._contacts.map((item) => <option key={item.id} value={item.id}>{contactNameFor(item)}</option>)}
                  </select>
                  <button className="row-action-btn" type="button" title="Delete Contact" onClick={(event) => { event.stopPropagation(); deleteSelectedContact(client) }}><Trash2 size={12} /></button>
                </>
              ) : (
                <span>{highlightText(dash(contactNameFor(contact)), aiFilters)}</span>
              )}
              <button className="row-action-btn" type="button" title="Add Contact" disabled={isContactSaving} onClick={(event) => { event.preventDefault(); event.stopPropagation(); openContactModal(client) }}>{isContactSaving ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}</button>
            </span>
          </td>
        )
      }
      case 'mobile':
        return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{highlightText(dash(contact.mobile || contact.phone), aiFilters)}</td>
      case 'email':
        return <td key={key} style={{ color: 'var(--info)', fontSize: 12.5 }}>{highlightText(dash(contact.email), aiFilters)}</td>
      case 'designation':
        return <td key={key}>{highlightText(dash(contact.designation), aiFilters)}</td>
      case 'linkedin':
        {
          const linkedInUrl = normalizeExternalUrl(contact.linkedin)
          return <td key={key}>{linkedInUrl ? <a className="candidate-linkedin-link" href={linkedInUrl} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openExternalUrl(linkedInUrl) }}>LinkedIn ↗</a> : mutedDash}</td>
        }
      case 'sector':
        return <td key={key}>{highlightText(dash(client.sector), aiFilters)}</td>
      case 'connectedOnDate':
        return <td key={key}>{highlightText(formatDateDDMMYYYY(client.connected_on_date), aiFilters)}</td>
      case 'comments':
        return <td key={key}>{renderCommentsCell(client, followUp?.follow_up_comments || client.comments)}</td>
      case 'followUpDate':
        {
          const followUps = client.follow_ups || []
          const followUpText = formatDateDDMMYYYY(followUp?.follow_up_date)
          const hasMultipleFollowUps = followUps.length > 1
          return (
            <td key={key}>
              <span className="inline-action-cell">
                {hasMultipleFollowUps ? (
                  <button className="filter-select compact-select" type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('client-follow-up', client.id, event.currentTarget)}>
                    <span className="client-follow-up-date-text">{followUpText}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                ) : (
                  <span className="client-follow-up-date-text">{followUpText || '-'}</span>
                )}
                <button className="row-action-btn" type="button" title="Add Follow Up" onClick={() => openAddFollowUp(client)}><Plus size={12} /></button>
              </span>
            </td>
          )
        }
      case 'status':
        return (
          <td key={key}>
            <div className="candidate-columns-control mandate-status-control">
              <button className={`badge ${STATUS_BADGE_MAP[client.status] || 'badge-not-converted'}`} type="button" onMouseDown={event => event.stopPropagation()} onClick={(event) => toggleTablePopover('client-status', client.id, event.currentTarget)} disabled={statusSaving[client.id]}>
                {highlightText(dash(client.status), aiFilters)}
              </button>
            </div>
          </td>
        )
      case 'termsSigned':
        return <td key={key}>{commercialDash(client, termsLabel(client))}</td>
      case 'value':
        if (!showCommercialFields(client)) return <td key={key}>-</td>
        return <td key={key}>{renderValueCell(client, client.terms_value)}</td>
      case 'billingEntity':
        return <td key={key}>{client.contract_signed ? dash(client.billing_entity) : '-'}</td>
      case 'contractSigned':
        return <td key={key}>{client.contract_signed ? 'Yes' : 'No'}</td>
      case 'contractDocument':
        return null
      case 'gstin':
        return <td key={key}>{commercialDash(client, client.gstin)}</td>
      case 'pan':
        return <td key={key}>{commercialDash(client, client.pan)}</td>
      case 'addressOnInvoice':
        return <td key={key}>{commercialDash(client, client.address_on_invoice)}</td>
      case 'contractPdf': {
        const contractPath = client.contract_pdf_storage_path || client.contract_document || client.contract_pdf_url
        const docKey = `contract-${client.id}`
        return <td key={key}>{isValidStoragePath(contractPath) ? <a className="cv-table-link" href="#" target="_blank" rel="noreferrer" title="Open Contract PDF" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openDocument(docKey, contractPath) }}>{openingDocument === docKey ? <Loader2 size={15} className="spin" /> : <FileText size={15} />}</a> : '-'}</td>
      }
      case 'actions':
        return <td key={key}><div className="row-actions"><button className="row-action-btn" title="Edit" id={`edit-client-${client.id}`} onClick={() => openEditModal(client)} disabled={client.is_locked && !isAdmin}><Pencil size={13} strokeWidth={2} /></button>{isAdmin && <RecordLockButton tableName="clients" recordId={client.id} locked={client.is_locked} onChanged={updateClientLockState} />}</div></td>
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
          onAddClient={openModal}
          onAddJob={() => navigate('/dashboard/jobs', { state: { action: 'add-job' } })}
        />
        <div className="candidate-columns-control" ref={columnsDropdownRef}>
          <button className="filter-select candidate-columns-btn" type="button" onClick={(event) => { setColumnsAnchor({ rect: event.currentTarget.getBoundingClientRect(), element: event.currentTarget }); setColumnsOpen(open => !open) }}>
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
          {columnsOpen && (
            <FloatingDropdown anchorRect={columnsAnchor?.rect} ignoreElement={columnsAnchor?.element} className="candidate-columns-dropdown" width={176} onClose={() => setColumnsOpen(false)}>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(availableColumns.map(column => column.key))}>Select All</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns((savedColumns?.length ? savedColumns : DEFAULT_CLIENT_COLUMN_KEYS).filter(key => availableColumns.some(column => column.key === key)))}>Reset to Saved Preference</button>
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
        <span className="filter-label">Filter</span>
        <div className="candidate-sort-control" ref={statusDropdownRef}>
          <button className="filter-select candidate-sort-btn" type="button" onClick={() => setStatusOpen(open => !open)}>
            <span>{statusFilter === 'All' ? 'Status' : statusFilter}</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {statusOpen && (
            <div className="filter-dropdown candidate-sort-dropdown">
              <button className="candidate-columns-action" type="button" onClick={() => { setStatusFilter('All'); setPage(1); setStatusOpen(false) }}>All Statuses</button>
              <button className="candidate-columns-action" type="button" onClick={() => { setStatusFilter('-'); setPage(1); setStatusOpen(false) }}>-</button>
              {STATUSES.map(status => (
                <button className="candidate-columns-action" type="button" key={status} onClick={() => { setStatusFilter(status); setPage(1); setStatusOpen(false) }}>
                  {status}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => { setStatusFilter('All'); setPage(1) }}>Clear Filter</button>
        <div className="filter-divider" />
        <form onSubmit={applyAiFilter} className="candidate-ai-filter-form">
          <span className="filter-label">AI Filter</span>
          <input
            className="filter-input candidate-ai-filter-input"
            value={aiFilterText}
            onChange={e => { setAiFilterText(e.target.value); setAiFilterError('') }}
            id="filter-ai-clients"
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
                  {`${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}`}
                </button>
              ))}
            </FloatingDropdown>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc'); setPage(1) }}>Clear</button>
        <div className="filter-bar-spacer" />
        <CompactPagination page={page} totalPages={Math.max(1, Math.ceil(totalClients / pageSize))} onPageChange={setPage} loading={loading} />
      </div>

      {aiFilterError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {aiFilterError}
        </div>
      )}
      {statusUpdateError && (
        <div className="form-error" style={{ display:'block', marginBottom:12 }}>
          {statusUpdateError}
        </div>
      )}

      <div className="table-card">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Loader2 size={28} color="var(--gold)" className="spin" /></div>
            <div className="empty-state-title">Loading clients</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon"><AlertCircle size={28} color="var(--danger)" /></div>
            <div className="empty-state-title">Error loading data</div>
            <div className="empty-state-desc">{error}</div>
          </div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Building2 size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No clients yet</div>
            <div className="empty-state-desc">Add your first client to get started.</div>
          </div>
        ) : (
          <div className="table-wrapper">
          <table className="data-table fb-theme-table" aria-label="Clients">
            <thead>
              <tr>
                {activeColumns.map(column => <th key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groupedClients.map((client) => (
                <tr key={client._contact_group_id || client.id}>
                  {activeColumns.map(column => renderClientCell(column, client))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <PaginationBar
        page={page}
        totalPages={Math.max(1, Math.ceil(totalClients / pageSize))}
        total={totalClients}
        pageSize={pageSize}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
      />

      {tablePopover?.type === 'client-status' && (() => {
        const client = groupedClients.find(item => item.id === tablePopover.id)
        if (!client) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={190} onClose={() => setTablePopover(null)}>
            <button className="candidate-columns-action" type="button" onClick={() => updateClientStatus(client, '-')}>-</button>
            {STATUSES.map(status => (
              <button className="candidate-columns-action" type="button" key={status} onClick={() => updateClientStatus(client, status)}>
                {status}
              </button>
            ))}
          </TablePopover>
        )
      })()}
      {tablePopover?.type === 'client-follow-up' && (() => {
        const client = groupedClients.find(item => item.id === tablePopover.id)
        if (!client || (client.follow_ups || []).length <= 1) return null
        return (
          <TablePopover anchorRect={tablePopover.anchorRect} width={220} onClose={() => setTablePopover(null)}>
            {client.follow_ups.map((item) => (
              <div className="follow-up-popover-row" key={item.id}>
                <button
                  className="candidate-columns-action follow-up-date-action"
                  type="button"
                  onClick={() => {
                    setSelectedFollowUps((current) => ({ ...current, [followUpClientKey(client)]: item.id }))
                    setTablePopover(null)
                  }}
                >
                  {formatDateDDMMYYYY(item.follow_up_date)}
                </button>
                <button className="row-action-btn" type="button" title="Edit Follow Up" onClick={(event) => { event.stopPropagation(); openEditFollowUp(client, item) }}><Pencil size={12} /></button>
                <button className="row-action-btn" type="button" title="Delete Follow Up" onClick={(event) => { event.stopPropagation(); setTablePopover(null); setDeletingFollowUp({ client, followUp: item }) }}><Trash2 size={12} /></button>
              </div>
            ))}
          </TablePopover>
        )
      })()}

      {isOpen && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" ref={clientModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editingClient ? 'Edit Client' : 'Add Client'}>
            <div className="modal-header">
              <span className="modal-title">{editingClient ? 'Edit Client' : 'Add New Client'}</span>
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                {(editingClient || addingNewClient) && !isClientFieldHidden('client_display_id') && (
                  <div className="form-group">
                    <label className="form-label">Client ID</label>
                    <input value={form.client_display_id || ''} placeholder="Loading..." className={`form-control${errors.client_display_id ? ' is-error' : ''}`} disabled readOnly />
                    {errors.client_display_id && <span className="form-error">{errors.client_display_id}</span>}
                  </div>
                )}
                {[
                  ['consultant_name', 'Consultant', 'text'],
                  ['client_name', 'Client Name', 'text', true],
                  ['location', 'Location', 'text'],
                  ['region', 'Region', 'text'],
                  ['contact_person', 'Contact Person', 'text', Boolean(form.client_group_id)],
                  ['mobile', 'Mobile', 'text'],
                  ['email', 'Email', 'email'],
                  ['designation', 'Designation', 'text'],
                  ['linkedin', 'LinkedIn', 'text'],
                  ['sector', 'Sector', 'text'],
                  ['connected_on_date', 'Connected On Date', 'date'],
                  ['follow_up_date', 'Follow Up Date', 'date']
                ].filter(([name]) => !isClientFieldHidden(name)).map(([name, label, type, required]) => (
                  <div className="form-group" key={name}>
                    <label className="form-label">{label} {required && <span className="req">*</span>}</label>
                    {name === 'client_name' && !editingClient ? (
                      <div className="client-search-wrap">
                        {addingNewClient && (
                          <div className="sub-text" style={{ marginBottom: 6 }}>
                            Adding new client
                            <button type="button" className="filter-clear" style={{ marginLeft: 8 }} onMouseDown={(event) => { event.preventDefault(); clientIdRequestRef.current += 1; setAddingNewClient(false); setSelectedExistingClientId(null); setForm(current => ({ ...current, client_group_id: '', client_display_id: '', client_name: '' })); setClientSuggestionsOpen(true) }}>Switch</button>
                          </div>
                        )}
                        <input ref={clientNameInputRef} name={name} type={type} value={form[name]} onChange={handleChange} onFocus={() => !addingNewClient && setClientSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setClientSuggestionsOpen(false), 120)} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving || isClientFieldDisabled(name)} autoComplete="off" />
                        {clientSuggestionsOpen && !addingNewClient && (
                        <div className="client-suggestions manual-suggestions is-open">
                          <button type="button" onMouseDown={(event) => { event.preventDefault(); selectNewClient() }}>
                            <span>Add New Client</span>
                          </button>
                          {matchingClients.map(client => (
                            <button type="button" key={client.client_group_id || client.id} onMouseDown={(event) => { event.preventDefault(); selectExistingClient(client) }}>
                              <span>{client.client_name || client.name}</span>
                              <small>{client.client_display_id || ''}</small>
                            </button>
                          ))}
                        </div>
                        )}
                      </div>
                    ) : name === 'consultant_name' ? (
                      <div className="client-search-wrap">
                        <input className={`form-control${errors[name] ? ' is-error' : ''}`} value={consultantSearch || form.consultant_name} onChange={e => {
                          setConsultantSearch(e.target.value)
                          setForm(current => ({ ...current, consultant_name: e.target.value, consultant_user_id: '' }))
                          setConsultantOpen(true)
                        }} onFocus={() => { setConsultantSearch(current => current || form.consultant_name); setConsultantOpen(true) }} onBlur={() => window.setTimeout(() => setConsultantOpen(false), 120)} disabled={saving || isClientFieldDisabled(name)} autoComplete="off" />
                        {consultantOpen && (
                          <div className="client-suggestions manual-suggestions is-open">
                            {matchingConsultants.length ? matchingConsultants.map(user => (
                              <button type="button" key={user.id || user.name} onMouseDown={event => {
                                event.preventDefault()
                                selectConsultant(user.name)
                              }}><span>{user.name}</span></button>
                            )) : <div className="candidate-column-option">No results found</div>}
                          </div>
                        )}
                      </div>
                    ) : name === 'region' ? (
                      <select name={name} value={form[name]} onChange={handleChange} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving || isClientFieldDisabled(name)}>
                        {REGION_OPTIONS.map(option => <option key={option || '-'} value={option}>{option || '-'}</option>)}
                      </select>
                    ) : name === 'sector' ? (
                      <div className="client-search-wrap">
                        <input className={`form-control${errors[name] ? ' is-error' : ''}`} value={sectorSearch || form.sector} onChange={e => {
                          setSectorSearch(e.target.value)
                          setForm(current => ({ ...current, sector: '' }))
                          setSectorOpen(true)
                        }} onFocus={() => setSectorOpen(true)} onBlur={() => window.setTimeout(() => setSectorOpen(false), 120)} disabled={saving || isClientFieldDisabled(name)} autoComplete="off" />
                        {sectorOpen && (
                          <div className="client-suggestions manual-suggestions is-open">
                            {matchingSectors.length ? matchingSectors.map(value => (
                              <button type="button" key={value} onMouseDown={event => {
                                event.preventDefault()
                                setSectorSearch(value)
                                setForm(current => ({ ...current, sector: value }))
                                setSectorOpen(false)
                              }}><span>{value}</span></button>
                            )) : <div className="candidate-column-option">No results found</div>}
                          </div>
                        )}
                      </div>
                    ) : type === 'date' ? (
                      <FormattedDateInput name={name} value={form[name]} onChange={(value) => setForm(current => ({ ...current, [name]: value }))} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving || isClientFieldDisabled(name)} />
                    ) : (
                      <input name={name} type={type} value={form[name]} onChange={handleChange} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving || isClientFieldDisabled(name)} />
                    )}
                    {errors[name] && <span className="form-error">{errors[name]}</span>}
                  </div>
                ))}
                {!isClientFieldHidden('comments') && <div className="form-group full">
                  <label className="form-label">Comments</label>
                  <textarea name="comments" value={form.comments} onChange={handleChange} className="form-control" rows={2} disabled={saving || isClientFieldDisabled('comments')} />
                </div>}
                {!isClientFieldHidden('status') && <div className="form-group">
                  <label className="form-label">Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled('status')}>
                    {STATUS_OPTIONS.map((status) => <option key={status || '-'} value={status}>{status || '-'}</option>)}
                  </select>
                </div>}
                {!isClientFieldHidden('contract_signed') && <div className="form-group">
                  <label className="form-label">Contract Signed</label>
                  <select name="contract_signed" value={form.contract_signed} onChange={handleChange} className={`form-control${errors.contract_signed ? ' is-error' : ''}`} disabled={saving || isClientFieldDisabled('contract_signed')}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                  {errors.contract_signed && <span className="form-error">{errors.contract_signed}</span>}
                </div>}
                {form.contract_signed === 'Yes' && !isClientFieldHidden('contract_document') && (
                  <div className="form-group">
                    <label className="form-label">Contract PDF</label>
                    <input type="file" accept="application/pdf,.pdf" onChange={handleContractFile} className={`form-control${errors.contract_document ? ' is-error' : ''}`} disabled={saving || contractUploading || isClientFieldDisabled('contract_document')} />
                    {isValidStoragePath(form.contract_document) && <a className="cv-table-link" href="#" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openDocument('contract-form', form.contract_document) }}>{openingDocument === 'contract-form' ? 'Opening...' : 'Current Contract'}</a>}
                    {contractUploading && <span className="form-error">Uploading contract...</span>}
                    {errors.contract_document && <span className="form-error">{errors.contract_document}</span>}
                  </div>
                )}
                {form.contract_signed === 'Yes' && (
                  <>
                    {!isClientFieldHidden('terms_signed_type') && <div className="form-group">
                      <label className="form-label">Terms Signed</label>
                      <select name="terms_signed_type" value={form.terms_signed_type} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled('terms_signed_type')}>
                        <option value="">-</option>
                        {TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
                      </select>
                    </div>}
                    {form.terms_signed_type === 'Any Other' && !isClientFieldHidden('terms_signed_custom') && (
                      <div className="form-group">
                        <label className="form-label">Custom Terms</label>
                        <input name="terms_signed_custom" value={form.terms_signed_custom} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled('terms_signed_custom')} />
                      </div>
                    )}
                    {!isClientFieldHidden('terms_value') && <div className="form-group">
                      <label className="form-label">Value</label>
                      <input name="terms_value" value={form.terms_value} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled('terms_value')} />
                    </div>}
                    {!isClientFieldHidden('billing_entity') && <div className="form-group">
                      <label className="form-label">Billing Entity</label>
                      <select name="billing_entity" value={form.billing_entity} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled('billing_entity')}>
                        <option value="">-</option>
                        {BILLING_ENTITIES.map(entity => <option key={entity} value={entity}>{entity}</option>)}
                      </select>
                    </div>}
                    {[
                      ['gstin', 'GSTIN'],
                      ['pan', 'PAN'],
                      ['address_on_invoice', 'Address on Invoice']
                    ].filter(([name]) => !isClientFieldHidden(name)).map(([name, label]) => (
                      <div className={name === 'address_on_invoice' ? 'form-group full' : 'form-group'} key={name}>
                        <label className="form-label">{label}</label>
                        <input name={name} value={form[name]} onChange={handleChange} className="form-control" disabled={saving || isClientFieldDisabled(name)} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)} disabled={saving || contractUploading}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-client-btn" disabled={saving || contractUploading}>{saveStep || (editingClient ? 'Update Client' : 'Save Client')}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {clientAlreadyAdded && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Client Already Added">
            <div className="modal-header">
              <span className="modal-title">Client Already Added</span>
              <button className="modal-close" onClick={() => setClientAlreadyAdded(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-error">This client is already added.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setClientAlreadyAdded(false)}>OK</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {clientDuplicate && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" ref={duplicateModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Duplicate Client">
            <div className="modal-header">
              <span className="modal-title">Duplicate Client</span>
              <button className="modal-close" onClick={() => setClientDuplicate(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-error" style={{ marginBottom: 12 }}>
                {clientDuplicate.message || 'A client with the same name and email already exists.'}
              </div>
              <div className="duplicate-compare-grid">
                <div className="duplicate-compare-card">
                  <div className="section-label">Existing Client</div>
                  <div className="name-text">{clientDuplicate.existing?.client_name || clientDuplicate.existing?.name || '-'}</div>
                  <div className="sub-text">{clientDuplicate.existing?.email || '-'}</div>
                  <div className="sub-text">{clientDuplicate.existing?.mobile || clientDuplicate.existing?.phone || '-'}</div>
                </div>
                <div className="duplicate-compare-card">
                  <div className="section-label">New Client</div>
                  <div className="name-text">{clientDuplicate.client?.client_name || '-'}</div>
                  <div className="sub-text">{clientDuplicate.client?.email || '-'}</div>
                  <div className="sub-text">{clientDuplicate.client?.mobile || '-'}</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDuplicateMoreOpen(true)} disabled={saving}>View More</button>
              <button className="btn-secondary" onClick={() => { setClientDuplicate(null); setDuplicateMoreOpen(false) }} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={resolveClientDuplicate} disabled={saving}>Update Client</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {clientDuplicate && duplicateMoreOpen && createPortal((() => {
        const existing = clientDuplicate.existing || {}
        const incoming = clientDuplicate.client || {}
        return (
          <div className="modal-overlay">
            <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label="Duplicate Client Details">
              <div className="modal-header">
                <span className="modal-title">Duplicate Client Details</span>
                <button className="modal-close" onClick={() => setDuplicateMoreOpen(false)} aria-label="Close"><X size={16} /></button>
              </div>
              <div className="modal-body">
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Existing Client</th>
                        <th>New Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CLIENT_TABLE_COLUMNS.map(column => (
                        <tr key={column.key}>
                          <td>{column.label}</td>
                          <td>{duplicateClientValue(existing, column.key)}</td>
                          <td>{duplicateClientValue(incoming, column.key)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setDuplicateMoreOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )
      })(), document.body)}

      {deletingFollowUp && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Delete Follow Up">
            <div className="modal-header">
              <span className="modal-title">Delete Follow Up</span>
              <button className="modal-close" onClick={() => setDeletingFollowUp(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-error">Delete this follow-up?</div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeletingFollowUp(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={confirmDeleteFollowUp} disabled={saving}>{saving ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {followUpClient && createPortal((
        <div className="modal-overlay">
          <div className="modal-card" ref={followUpModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editingFollowUp ? 'Edit Follow Up' : 'Add Follow Up'}>
            <div className="modal-header">
              <span className="modal-title">{editingFollowUp ? 'Edit Follow Up' : `Add Follow Up ${(followUpClient.follow_ups || []).length + 1}`}</span>
              <button className="modal-close" onClick={() => { setFollowUpClient(null); setEditingFollowUp(null); setFollowUpError('') }} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              {followUpError && <div className="form-error" style={{ display:'block', marginBottom:12 }}>{followUpError}</div>}
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Follow Up Date <span className="req">*</span></label>
                  <FormattedDateInput value={followUpForm.follow_up_date} onChange={(value) => { setFollowUpError(''); setFollowUpForm((current) => ({ ...current, follow_up_date: value })) }} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Follow Up Comments</label>
                  <textarea className="form-control" rows={3} value={followUpForm.follow_up_comments} onChange={(event) => setFollowUpForm((current) => ({ ...current, follow_up_comments: event.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setFollowUpClient(null); setEditingFollowUp(null); setFollowUpError('') }} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveFollowUp} disabled={saving || !followUpForm.follow_up_date}>{editingFollowUp ? 'Save Follow Up' : 'Save Follow Up'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
