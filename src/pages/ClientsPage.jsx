import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, X, Building2, AlertCircle, Loader2 } from 'lucide-react'
import '../styles/Shared.css'

const STATUSES = ['Converted', 'Not Converted', 'Follow Up Required', 'Not Hiring', 'Not Adding Consultants', "Didn't Pick Up"]
const TERMS = ['%', 'Fixed Fee Model', 'Slab %', 'Any Other']
const EMPTY_FORM = {
  client_group_id: '',
  client_display_id: '',
  client_name: '',
  location: '',
  region: '',
  contact_person: '',
  mobile: '',
  email: '',
  linkedin: '',
  sector: '',
  connected_on_date: '',
  comments: '',
  follow_up_date: '',
  status: 'Not Converted',
  terms_signed_type: '',
  terms_signed_custom: '',
  terms_value: '',
  gstin: '',
  pan: '',
  address_on_invoice: ''
}

const dash = (value) => value || '-'
const convertedDash = (client, value) => client.status === 'Converted' ? dash(value) : '-'
const termsLabel = (client) => client.terms_signed_type === 'Any Other' ? client.terms_signed_custom : client.terms_signed_type

function clientToForm(client) {
  return {
    client_group_id: client.client_group_id || client.id || '',
    client_display_id: client.client_display_id || '',
    client_name: client.client_name || client.name || '',
    location: client.location || client.city || '',
    region: client.region || client.state || '',
    contact_person: client.contact_person || client.contact || '',
    mobile: client.mobile || client.phone || '',
    email: client.email || '',
    linkedin: client.linkedin || '',
    sector: client.sector || '',
    connected_on_date: client.connected_on_date || '',
    comments: client.comments || client.notes || '',
    follow_up_date: client.follow_up_date || '',
    status: STATUSES.includes(client.status) ? client.status : 'Not Converted',
    terms_signed_type: client.terms_signed_type || '',
    terms_signed_custom: client.terms_signed_custom || '',
    terms_value: client.terms_value || '',
    gstin: client.gstin || '',
    pan: client.pan || '',
    address_on_invoice: client.address_on_invoice || ''
  }
}

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [selectedFollowUps, setSelectedFollowUps] = useState({})
  const [followUpClient, setFollowUpClient] = useState(null)
  const [followUpForm, setFollowUpForm] = useState({ follow_up_date: '', follow_up_comments: '' })

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (searchText.trim()) params.set('search', searchText.trim())
      const res = await fetch(`/api/clients${params.toString() ? `?${params.toString()}` : ''}`)
      if (!res.ok) throw new Error('Failed to fetch clients from server.')
      const data = await res.json()
      setClients(data.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [searchText])

  useEffect(() => {
    const timer = window.setTimeout(fetchClients, 0)
    return () => window.clearTimeout(timer)
  }, [fetchClients])

  const serials = useMemo(() => {
    const map = {}
    let serial = 0
    clients.forEach((client) => {
      const key = client.client_group_id || client.id
      if (!map[key]) map[key] = ++serial
    })
    return map
  }, [clients])

  const handleChange = (e) => {
    const { name, value } = e.target
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
      return next
    })
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const validate = () => {
    const next = {}
    if (!form.client_name.trim()) next.client_name = 'Client Name is required'
    if (!form.mobile.trim()) next.mobile = 'Mobile is required'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email'
    if (!STATUSES.includes(form.status)) next.status = 'Select a valid status'
    return next
  }

  const openModal = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setEditingClient(null)
    setIsOpen(true)
  }

  const openEditModal = (client) => {
    setForm(clientToForm(client))
    setErrors({})
    setEditingClient(client)
    setIsOpen(true)
  }

  const openContactModal = (client) => {
    setForm(clientToForm(client))
    setErrors({})
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
      const res = await fetch(editingClient ? `/api/clients/${editingClient.id}` : '/api/clients', {
        method: editingClient ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save client.')
      await fetchClients()
      setIsOpen(false)
      setEditingClient(null)
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

  return (
    <div>
      <div className="page-header">
        <input className="filter-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search clients" />
        <button className="btn-primary" onClick={openModal} id="btn-add-client">
          <Plus size={15} strokeWidth={2.5} /> Add Client
        </button>
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
                <th>S.No.</th><th>Client ID</th><th>Client Name</th><th>Location</th><th>Region</th><th>Contact Person</th><th>Mobile</th><th>Email</th><th>LinkedIn</th><th>Sector</th><th>Connected On Date</th><th>Comments</th><th>Follow Up Date</th><th>Status</th><th>Terms Signed</th><th>Value</th><th>GSTIN</th><th>PAN</th><th>Address on Invoice</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const followUp = selectedFollowUp(client)
                return (
                  <tr key={client.id}>
                    <td>{serials[client.client_group_id || client.id]}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{dash(client.client_display_id)}</td>
                    <td>
                      <Link className="name-text" to={`/dashboard/clients/${client.id}`}>{client.client_name}</Link>
                    </td>
                    <td>{dash(client.location)}</td>
                    <td>{dash(client.region)}</td>
                    <td>
                      <span className="inline-action-cell">
                        {dash(client.contact_person)}
                        <button className="row-action-btn" type="button" title="Add Contact" onClick={() => openContactModal(client)}><Plus size={12} /></button>
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{dash(client.mobile)}</td>
                    <td style={{ color: 'var(--info)', fontSize: 12.5 }}>{dash(client.email)}</td>
                    <td>{client.linkedin ? <a className="cv-table-link" href={client.linkedin.startsWith('http') ? client.linkedin : `https://${client.linkedin}`} target="_blank" rel="noreferrer">LinkedIn</a> : '-'}</td>
                    <td>{dash(client.sector)}</td>
                    <td>{dash(client.connected_on_date)}</td>
                    <td>{dash(followUp?.follow_up_comments || client.comments)}</td>
                    <td>
                      <span className="inline-action-cell">
                        {(client.follow_ups || []).length ? (
                          <select className="filter-select compact-select" value={followUp?.id || ''} onChange={(event) => setSelectedFollowUps((current) => ({ ...current, [client.id]: event.target.value }))}>
                            {client.follow_ups.map((item) => <option key={item.id} value={item.id}>Follow Up {item.follow_up_number}</option>)}
                          </select>
                        ) : (
                          <span>{dash(client.follow_up_date)}</span>
                        )}
                        <span>{followUp?.follow_up_date || ''}</span>
                        <button className="row-action-btn" type="button" title="Add Follow Up" onClick={() => { setFollowUpClient(client); setFollowUpForm({ follow_up_date: '', follow_up_comments: '' }) }}><Plus size={12} /></button>
                      </span>
                    </td>
                    <td>{dash(client.status)}</td>
                    <td>{convertedDash(client, termsLabel(client))}</td>
                    <td>{convertedDash(client, client.terms_value)}</td>
                    <td>{convertedDash(client, client.gstin)}</td>
                    <td>{convertedDash(client, client.pan)}</td>
                    <td>{convertedDash(client, client.address_on_invoice)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn" title="Edit" id={`edit-client-${client.id}`} onClick={() => openEditModal(client)}><Pencil size={13} strokeWidth={2} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {isOpen && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setIsOpen(false)}>
          <div className="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-label={editingClient ? 'Edit Client' : 'Add Client'}>
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
                  ['client_name', 'Client Name', 'text', true],
                  ['location', 'Location', 'text'],
                  ['region', 'Region', 'text'],
                  ['contact_person', 'Contact Person', 'text'],
                  ['mobile', 'Mobile', 'text', true],
                  ['email', 'Email', 'email'],
                  ['linkedin', 'LinkedIn', 'text'],
                  ['sector', 'Sector', 'text'],
                  ['connected_on_date', 'Connected On Date', 'date'],
                  ['follow_up_date', 'Follow Up Date', 'date']
                ].map(([name, label, type, required]) => (
                  <div className="form-group" key={name}>
                    <label className="form-label">{label} {required && <span className="req">*</span>}</label>
                    <input name={name} type={type} value={form[name]} onChange={handleChange} className={`form-control${errors[name] ? ' is-error' : ''}`} disabled={saving} />
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
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>
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
      )}

      {followUpClient && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setFollowUpClient(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Add Follow Up">
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
      )}
    </div>
  )
}
