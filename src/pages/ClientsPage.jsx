import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Plus, Pencil, X, Building2, AlertCircle, Loader2, ChevronDown } from 'lucide-react'
import '../styles/Shared.css'
import { supabase } from '../services/supabaseClient'

const STATUSES = ['Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
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
const EMPTY_FORM = {
  client_group_id: '',
  client_display_id: '',
  consultant_name: '',
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
  contract_signed: 'No',
  contract_document: '',
  gstin: '',
  pan: '',
  address_on_invoice: ''
}

const dash = (value) => value || '-'
const convertedDash = (client, value) => client.status === 'Converted' ? dash(value) : '-'
const termsLabel = (client) => client.terms_signed_type === 'Any Other' ? client.terms_signed_custom : client.terms_signed_type
const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}
const CLIENT_TABLE_COLUMNS = [
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'location', label: 'Location' },
  { key: 'region', label: 'Region' },
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
  { key: 'termsSigned', label: 'Terms Signed' },
  { key: 'value', label: 'Value' },
  { key: 'contractSigned', label: 'Contract Signed' },
  { key: 'contractDocument', label: 'Contract Document' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'pan', label: 'PAN' },
  { key: 'addressOnInvoice', label: 'Address on Invoice' },
  { key: 'actions', label: 'Actions' }
]
const DEFAULT_CLIENT_COLUMN_KEYS = CLIENT_TABLE_COLUMNS.map(column => column.key)
const SORT_OPTIONS = [
  { field: 'client_id', label: 'Client ID' },
  { field: 'client_name', label: 'Alphabetical Order' }
]

const getCurrentUser = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
  } catch {
    return {}
  }
}

const getNumericId = (id) => Number(String(id || '').replace(/\D/g, '')) || 0

const getConsultantNameFromUser = (user) => {
  const email = String(user?.email || user?.id || '').trim()
  const prefix = email.includes('@') ? email.split('@')[0] : ''
  return prefix || user?.name || 'hr'
}

function clientToForm(client) {
  return {
    client_group_id: client.client_group_id || client.id || '',
    client_display_id: client.client_display_id || '',
    consultant_name: client.consultant_name || client.consultant || '',
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
    contract_signed: client.contract_signed ? 'Yes' : 'No',
    contract_document: client.contract_document || '',
    gstin: client.gstin || '',
    pan: client.pan || '',
    address_on_invoice: client.address_on_invoice || ''
  }
}

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [selectedFollowUps, setSelectedFollowUps] = useState({})
  const [selectedContacts, setSelectedContacts] = useState({})
  const [followUpClient, setFollowUpClient] = useState(null)
  const [followUpForm, setFollowUpForm] = useState({ follow_up_date: '', follow_up_comments: '' })
  const [contractFile, setContractFile] = useState(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_CLIENT_COLUMN_KEYS)
  const [pendingColumns, setPendingColumns] = useState(DEFAULT_CLIENT_COLUMN_KEYS)
  const [savedColumns, setSavedColumns] = useState(null)
  const [sortField, setSortField] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('All')
  const [statusOpen, setStatusOpen] = useState(false)
  const columnsDropdownRef = useRef(null)
  const sortDropdownRef = useRef(null)
  const statusDropdownRef = useRef(null)
  const clientModalRef = useRef(null)
  const followUpModalRef = useRef(null)

  const focusPopup = useCallback((ref) => {
    window.requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const target = node.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      ;(target || node).focus({ preventScroll: true })
    })
  }, [])

  useEffect(() => {
    if (!isOpen && !followUpClient) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [isOpen, followUpClient])

  const fetchClients = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) setLoading(true)
      const params = new URLSearchParams()
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDirection', sortDirection)
      }
      const res = await fetch(`/api/clients${params.toString() ? `?${params.toString()}` : ''}`)
      if (!res.ok) throw new Error('Failed to fetch clients from server.')
      const data = await res.json()
      setClients(data.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [sortDirection, sortField])

  useEffect(() => {
    const timer = window.setTimeout(fetchClients, 0)
    return () => window.clearTimeout(timer)
  }, [fetchClients])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null
        const currentUser = getCurrentUser()
        const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
        const response = await fetch(`/api/user-preferences/client_columns?user_id=${encodeURIComponent(userId)}`)
        const payload = await response.json().catch(() => ({}))
        const value = Array.isArray(payload.data?.value) ? payload.data.value.filter(key => DEFAULT_CLIENT_COLUMN_KEYS.includes(key)) : null

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
      if (!sortDropdownRef.current?.contains(event.target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sortOpen])

  useEffect(() => {
    if (!statusOpen) return
    const handleClickOutside = (event) => {
      if (!statusDropdownRef.current?.contains(event.target)) setStatusOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [statusOpen])

  const sortedClients = useMemo(() => {
    const rows = [...clients]
    if (sortField === 'client_id') {
      rows.sort((a, b) => {
        const result = getNumericId(a.client_display_id) - getNumericId(b.client_display_id)
        return sortDirection === 'asc' ? result : -result
      })
    } else if (sortField === 'client_name') {
      rows.sort((a, b) => {
        const result = String(a.client_name || a.name || '').localeCompare(String(b.client_name || b.name || ''))
        return sortDirection === 'asc' ? result : -result
      })
    }
    return rows
  }, [clients, sortDirection, sortField])

  const filteredClients = useMemo(() => (
    statusFilter === 'All' ? sortedClients : sortedClients.filter(client => statusFilter === '-' ? !client.status || client.status === '-' : client.status === statusFilter)
  ), [sortedClients, statusFilter])

  const groupedClients = useMemo(() => {
    const groups = new Map()
    filteredClients.forEach((client) => {
      const key = client.client_group_id || client.id
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(client)
    })

    return [...groups.entries()].map(([key, contacts]) => {
      const selectedId = selectedContacts[key] || contacts[0]?.id
      const selected = contacts.find(contact => contact.id === selectedId) || contacts[0]
      return { ...selected, _contact_group_id: key, _contacts: contacts }
    })
  }, [filteredClients, selectedContacts])

  const activeColumns = CLIENT_TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'contract_signed' && value === 'No') setContractFile(null)
    setForm((current) => {
      const next = { ...current, [name]: value }
      if (name === 'status' && value !== 'Converted') {
        next.terms_signed_type = ''
        next.terms_signed_custom = ''
        next.terms_value = ''
        next.gstin = ''
        next.pan = ''
        next.address_on_invoice = ''
      }
      if (name === 'contract_signed' && value === 'No') next.contract_document = ''
      return next
    })
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const handleContractFile = (event) => {
    const file = event.target.files?.[0] || null
    if (file && file.type !== 'application/pdf') {
      setErrors((current) => ({ ...current, contract_document: 'Contract document must be a PDF' }))
      setContractFile(null)
      event.target.value = ''
      return
    }
    setErrors((current) => ({ ...current, contract_document: '' }))
    setContractFile(file)
  }

  const validate = () => {
    const next = {}
    if (!form.client_name.trim()) next.client_name = 'Client Name is required'
    if (!form.email.trim()) next.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email'
    if (form.client_group_id && !form.contact_person.trim()) next.contact_person = 'Contact Person is required'
    if (form.status && !STATUSES.includes(form.status)) next.status = 'Select a valid status'
    if (!['Yes', 'No'].includes(form.contract_signed)) next.contract_signed = 'Select Yes or No'
    return next
  }

  const openModal = () => {
    setForm({ ...EMPTY_FORM, consultant_name: getConsultantNameFromUser(getCurrentUser()), connected_on_date: todayLocal(), follow_up_date: todayLocal() })
    setErrors({})
    setContractFile(null)
    setEditingClient(null)
    setIsOpen(true)
  }

  const openEditModal = (client) => {
    setForm(clientToForm(client))
    setErrors({})
    setContractFile(null)
    setEditingClient(client)
    setIsOpen(true)
  }

  useEffect(() => {
    if (isOpen) focusPopup(clientModalRef)
  }, [isOpen, focusPopup])

  useEffect(() => {
    if (followUpClient) focusPopup(followUpModalRef)
  }, [followUpClient, focusPopup])

  const openContactModal = (client) => {
    setForm({
      ...clientToForm(client),
      client_group_id: client.client_group_id || client.id,
      connected_on_date: todayLocal(),
      follow_up_date: todayLocal(),
      status: '',
      contact_person: '',
      mobile: '',
      email: '',
      designation: '',
      linkedin: ''
    })
    setErrors({})
    setContractFile(null)
    setEditingClient(null)
    setIsOpen(true)
  }

  const handleSave = async () => {
    const nextErrors = validate()
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    setSaving(true)
    try {
      const body = new FormData()
      Object.entries(form).forEach(([key, value]) => body.append(key, value ?? ''))
      if (contractFile) body.append('contract_document_file', contractFile)
      const res = await fetch(editingClient ? `/api/clients/${editingClient.id}` : '/api/clients', {
        method: editingClient ? 'PATCH' : 'POST',
        body
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save client.')
      setIsOpen(false)
      setContractFile(null)
      setEditingClient(null)
      await fetchClients({ showLoading: false })
    } catch (err) {
      setErrors({ client_name: err.message })
    } finally {
      setSaving(false)
    }
  }

  const selectedFollowUp = (client) => {
    const followUps = client.follow_ups || []
    const selected = selectedFollowUps[client.id] || followUps[followUps.length - 1]?.id
    return followUps.find((item) => item.id === selected) || followUps[followUps.length - 1] || null
  }

  const selectedContact = (client) => {
    const contacts = client._contacts || [client]
    const selected = selectedContacts[client._contact_group_id] || client.id
    return contacts.find((item) => item.id === selected) || contacts[0] || client
  }

  const saveFollowUp = async () => {
    if (!followUpForm.follow_up_date) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${followUpClient.id}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followUpForm)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to save follow-up.')
      setSelectedFollowUps((current) => ({ ...current, [followUpClient.id]: data.id }))
      setFollowUpClient(null)
      setFollowUpForm({ follow_up_date: '', follow_up_comments: '' })
      await fetchClients()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const togglePendingColumn = (key) => {
    setPendingColumns(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const proceedColumns = () => {
    setVisibleColumns(pendingColumns.length ? pendingColumns : DEFAULT_CLIENT_COLUMN_KEYS)
    setColumnsOpen(false)
  }

  const saveColumnPreference = async () => {
    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const currentUser = getCurrentUser()
      const userId = session?.user?.id || currentUser?.id || currentUser?.email || 'anonymous'
      const value = pendingColumns.length ? pendingColumns : DEFAULT_CLIENT_COLUMN_KEYS
      const response = await fetch('/api/user-preferences/client_columns', {
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
    setSortOpen(false)
  }

  const renderClientCell = ({ key }, client) => {
    const followUp = selectedFollowUp(client)
    const contact = selectedContact(client)
    switch (key) {
      case 'clientId':
        return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{dash(client.client_display_id)}</td>
      case 'consultant':
        return <td key={key}>{dash(client.consultant_name || client.consultant)}</td>
      case 'clientName':
        return <td key={key}><Link className="name-text" to={`/dashboard/clients/${client.id}`}>{client.client_name}</Link></td>
      case 'location':
        return <td key={key}>{dash(client.location)}</td>
      case 'region':
        return <td key={key}>{dash(client.region)}</td>
      case 'contactPerson':
        return (
          <td key={key}>
            <span className="inline-action-cell">
              {(client._contacts || []).length > 1 ? (
                <select className="filter-select compact-select" value={contact.id} onChange={(event) => setSelectedContacts((current) => ({ ...current, [client._contact_group_id]: event.target.value }))}>
                  {client._contacts.map((item, index) => <option key={item.id} value={item.id}>{item.contact_person || item.contact || `Contact ${index + 1}`}</option>)}
                </select>
              ) : (
                <span>{dash(contact.contact_person || contact.contact)}</span>
              )}
              <button className="row-action-btn" type="button" title="Add Contact" onClick={() => openContactModal(client)}><Plus size={12} /></button>
            </span>
          </td>
        )
      case 'mobile':
        return <td key={key} style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{dash(contact.mobile || contact.phone)}</td>
      case 'email':
        return <td key={key} style={{ color: 'var(--info)', fontSize: 12.5 }}>{dash(contact.email)}</td>
      case 'designation':
        return <td key={key}>{dash(contact.designation)}</td>
      case 'linkedin':
        return <td key={key}>{contact.linkedin ? <a className="cv-table-link" href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`} target="_blank" rel="noreferrer">LinkedIn</a> : '-'}</td>
      case 'sector':
        return <td key={key}>{dash(client.sector)}</td>
      case 'connectedOnDate':
        return <td key={key}>{dash(client.connected_on_date)}</td>
      case 'comments':
        return <td key={key}>{dash(followUp?.follow_up_comments || client.comments)}</td>
      case 'followUpDate':
        return (
          <td key={key}>
            <span className="inline-action-cell">
              {(client.follow_ups || []).length ? (
                <select className="filter-select compact-select" value={followUp?.id || ''} onChange={(event) => setSelectedFollowUps((current) => ({ ...current, [client.id]: event.target.value }))}>
                  {client.follow_ups.map((item) => <option key={item.id} value={item.id}>Follow Up {item.follow_up_number}</option>)}
                </select>
              ) : (
                <span>{dash(client.follow_up_date)}</span>
              )}
              <span>{followUp?.follow_up_date || ''}</span>
              <button className="row-action-btn" type="button" title="Add Follow Up" onClick={() => { setFollowUpClient(client); setFollowUpForm({ follow_up_date: todayLocal(), follow_up_comments: '' }) }}><Plus size={12} /></button>
            </span>
          </td>
        )
      case 'status':
        return <td key={key}><span className={`badge ${STATUS_BADGE_MAP[client.status] || 'badge-not-converted'}`}>{dash(client.status)}</span></td>
      case 'termsSigned':
        return <td key={key}>{convertedDash(client, termsLabel(client))}</td>
      case 'value':
        return <td key={key}>{convertedDash(client, client.terms_value)}</td>
      case 'contractSigned':
        return <td key={key}>{client.contract_signed ? 'Yes' : 'No'}</td>
      case 'contractDocument':
        return <td key={key}>{client.contract_signed ? (client.contract_document ? <a className="cv-table-link" href={client.contract_document} target="_blank" rel="noreferrer">Open PDF</a> : 'Missing') : '-'}</td>
      case 'gstin':
        return <td key={key}>{convertedDash(client, client.gstin)}</td>
      case 'pan':
        return <td key={key}>{convertedDash(client, client.pan)}</td>
      case 'addressOnInvoice':
        return <td key={key}>{convertedDash(client, client.address_on_invoice)}</td>
      case 'actions':
        return <td key={key}><div className="row-actions"><button className="row-action-btn" title="Edit" id={`edit-client-${client.id}`} onClick={() => openEditModal(client)}><Pencil size={13} strokeWidth={2} /></button></div></td>
      default:
        return null
    }
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn-primary" onClick={openModal} id="btn-add-client">
          <Plus size={15} strokeWidth={2.5} /> Add Client
        </button>
      </div>

      <div className="candidate-columns-toolbar">
        <div className="candidate-columns-control" ref={columnsDropdownRef}>
          <button className="filter-select candidate-columns-btn" type="button" onClick={() => { setPendingColumns(visibleColumns); setColumnsOpen(open => !open) }}>
            <span>Columns</span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button className="btn-primary candidate-columns-proceed" type="button" onClick={proceedColumns}>Proceed</button>
          {columnsOpen && (
            <div className="filter-dropdown candidate-columns-dropdown">
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(DEFAULT_CLIENT_COLUMN_KEYS)}>Select All</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns([])}>Clear All</button>
              <button className="candidate-columns-action" type="button" onClick={saveColumnPreference}>Save Preference</button>
              <button className="candidate-columns-action" type="button" onClick={() => setPendingColumns(savedColumns?.length ? savedColumns : DEFAULT_CLIENT_COLUMN_KEYS)}>Reset to Saved Preference</button>
              <div className="candidate-columns-divider" />
              {CLIENT_TABLE_COLUMNS.map(column => (
                <label className="candidate-column-option" key={column.key}>
                  <input type="checkbox" checked={pendingColumns.includes(column.key)} onChange={() => togglePendingColumn(column.key)} />
                  {column.label}
                </label>
              ))}
            </div>
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
              <button className="candidate-columns-action" type="button" onClick={() => { setStatusFilter('All'); setStatusOpen(false) }}>All Statuses</button>
              <button className="candidate-columns-action" type="button" onClick={() => { setStatusFilter('-'); setStatusOpen(false) }}>-</button>
              {STATUSES.map(status => (
                <button className="candidate-columns-action" type="button" key={status} onClick={() => { setStatusFilter(status); setStatusOpen(false) }}>
                  {status}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => setStatusFilter('All')}>Clear Filter</button>
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
                  {`${option.label} ${sortField === option.field && sortDirection === 'desc' ? '↑' : '↓'}`}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="filter-clear" type="button" onClick={() => { setSortField(''); setSortDirection('asc') }}>Clear</button>
      </div>

      <div className="table-card">
        {loading ? (
          <div className="loading-state"><Loader2 size={32} className="spin" color="var(--gold)" /><p>Loading clients database...</p></div>
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
          <table className="data-table" aria-label="Clients">
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
        )}
      </div>

      {isOpen && createPortal((
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setIsOpen(false)}>
          <div className="modal-card modal-card-lg" ref={clientModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editingClient ? 'Edit Client' : 'Add Client'}>
            <div className="modal-header">
              <span className="modal-title">{editingClient ? 'Edit Client' : 'Add New Client'}</span>
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                {editingClient && (
                  <div className="form-group">
                    <label className="form-label">Client ID</label>
                    <input value={form.client_display_id || ''} className="form-control" disabled readOnly />
                  </div>
                )}
                {[
                  ['consultant_name', 'Consultant', 'text'],
                  ['client_name', 'Client Name', 'text', true],
                  ['location', 'Location', 'text'],
                  ['region', 'Region', 'text'],
                  ['contact_person', 'Contact Person', 'text', Boolean(form.client_group_id)],
                  ['mobile', 'Mobile', 'text'],
                  ['email', 'Email', 'email', true],
                  ['designation', 'Designation', 'text'],
                  ['linkedin', 'LinkedIn', 'text'],
                  ['sector', 'Sector', 'text'],
                  ['connected_on_date', 'Connected On Date', 'date'],
                  ['follow_up_date', 'Follow Up Date', 'date']
                ].map(([name, label, type, required]) => (
                  <div className="form-group" key={name}>
                    <label className="form-label">{label} {required && <span className="req">*</span>}</label>
                    <input name={name} type={type} value={form[name]} onChange={handleChange} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving || (name === 'client_name' && !editingClient && Boolean(form.client_group_id))} readOnly={name === 'client_name' && !editingClient && Boolean(form.client_group_id)} />
                    {errors[name] && <span className="form-error">{errors[name]}</span>}
                  </div>
                ))}
                <div className="form-group full">
                  <label className="form-label">Comments</label>
                  <textarea name="comments" value={form.comments} onChange={handleChange} className="form-control" rows={2} disabled={saving} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className="form-control" disabled={saving}>
                    {STATUS_OPTIONS.map((status) => <option key={status || '-'} value={status}>{status || '-'}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Contract Signed</label>
                  <select name="contract_signed" value={form.contract_signed} onChange={handleChange} className={`form-control${errors.contract_signed ? ' is-error' : ''}`} disabled={saving}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                  {errors.contract_signed && <span className="form-error">{errors.contract_signed}</span>}
                </div>
                {form.contract_signed === 'Yes' && (
                  <div className="form-group">
                    <label className="form-label">Contract PDF</label>
                    <input type="file" accept="application/pdf" onChange={handleContractFile} className={`form-control${errors.contract_document ? ' is-error' : ''}`} disabled={saving} />
                    {form.contract_document && <a className="cv-table-link" href={form.contract_document} target="_blank" rel="noreferrer">Current Contract</a>}
                    {errors.contract_document && <span className="form-error">{errors.contract_document}</span>}
                  </div>
                )}
                {form.status === 'Converted' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Terms Signed</label>
                      <select name="terms_signed_type" value={form.terms_signed_type} onChange={handleChange} className="form-control" disabled={saving}>
                        <option value="">Select Terms</option>
                        {TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
                      </select>
                    </div>
                    {form.terms_signed_type === 'Any Other' && (
                      <div className="form-group">
                        <label className="form-label">Custom Terms</label>
                        <input name="terms_signed_custom" value={form.terms_signed_custom} onChange={handleChange} className="form-control" disabled={saving} />
                      </div>
                    )}
                    {[
                      ['terms_value', 'Value'],
                      ['gstin', 'GSTIN'],
                      ['pan', 'PAN'],
                      ['address_on_invoice', 'Address on Invoice']
                    ].map(([name, label]) => (
                      <div className={name === 'address_on_invoice' ? 'form-group full' : 'form-group'} key={name}>
                        <label className="form-label">{label}</label>
                        <input name={name} value={form[name]} onChange={handleChange} className="form-control" disabled={saving} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-client-btn" disabled={saving}>{saving ? 'Saving...' : editingClient ? 'Update Client' : 'Save Client'}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {followUpClient && createPortal((
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setFollowUpClient(null)}>
          <div className="modal-card" ref={followUpModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add Follow Up">
            <div className="modal-header">
              <span className="modal-title">Add Follow Up {(followUpClient.follow_ups || []).length + 1}</span>
              <button className="modal-close" onClick={() => setFollowUpClient(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Follow Up Date <span className="req">*</span></label>
                  <input type="date" className="form-control" value={followUpForm.follow_up_date} onChange={(event) => setFollowUpForm((current) => ({ ...current, follow_up_date: event.target.value }))} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Follow Up Comments</label>
                  <textarea className="form-control" rows={3} value={followUpForm.follow_up_comments} onChange={(event) => setFollowUpForm((current) => ({ ...current, follow_up_comments: event.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setFollowUpClient(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveFollowUp} disabled={saving || !followUpForm.follow_up_date}>Save Follow Up</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
