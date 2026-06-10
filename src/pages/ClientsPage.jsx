import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Eye, X, Building2, AlertCircle, Loader2 } from 'lucide-react'
import '../styles/Shared.css'

const EMPTY_FORM = {
  name: '', contact: '', phone: '', email: '', city: '', state: '', notes: '',
}

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [clientDuplicate, setClientDuplicate] = useState(null)
  const [editingClient, setEditingClient] = useState(null)

  const fetchClients = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/clients')
      if (!res.ok) throw new Error('Failed to fetch clients from server.')
      const data = await res.json()
      setClients(data.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(fetchClients, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (errors[name]) setErrors(err => ({ ...err, [name]: '' }))
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Client Name is required'
    if (!form.phone.trim()) e.phone = 'Phone Number is required'
    return e
  }

  const openModal = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setEditingClient(null)
    setIsOpen(true)
  }

  const saveClient = async (duplicateAction = '') => {
    const payload = duplicateAction ? { ...form, duplicate_action: duplicateAction } : form
    const res = await fetch(editingClient ? `/api/clients/${editingClient.id}` : '/api/clients', {
      method: editingClient ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 409 && data.duplicate) {
      const error = new Error(data.error || 'Duplicate client found.')
      error.duplicate = data
      throw error
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save client.')
    }

    return data
  }

  const handleSave = async () => {
    const e = validate()
    if (Object.keys(e).length) {
      setErrors(e)
      return
    }

    try {
      setSaving(true)
      await saveClient()

      await fetchClients()
      setIsOpen(false)
      setEditingClient(null)
    } catch (err) {
      if (err.duplicate) {
        setClientDuplicate({ client: form, existing: err.duplicate.existing })
        return
      }
      setErrors({ name: err.message })
    } finally {
      setSaving(false)
    }
  }

  const openEditModal = (client) => {
    setForm({
      name: client.name || '',
      contact: client.contact || '',
      phone: client.phone || '',
      email: client.email || '',
      city: client.city || '',
      state: client.state || '',
      notes: client.notes || ''
    })
    setErrors({})
    setEditingClient(client)
    setIsOpen(true)
  }

  const resolveClientDuplicate = async (duplicateAction) => {
    setSaving(true)
    try {
      await saveClient(duplicateAction)
      setClientDuplicate(null)
      await fetchClients()
      setIsOpen(false)
    } catch (err) {
      setErrors({ name: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <button className="btn-primary" onClick={openModal} id="btn-add-client">
          <Plus size={15} strokeWidth={2.5} /> Add Client
        </button>
      </div>

      {/* Table / Loader */}
      <div className="table-card">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={32} className="spin" color="var(--gold)" />
            <p>Loading clients database...</p>
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
          <table className="data-table" aria-label="Clients">
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Contact Person</th>
                <th>Phone Number</th>
                <th>Email</th>
                <th>City</th>
                <th>Active Jobs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
                <tr key={client.id}>
                  <td>
                    <div className="name-cell">
                      <div className="name-avatar">
                        {client.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div className="name-text">
                          <Link to={`/dashboard/clients/${client.id}`} style={{ textDecoration: 'none', color: 'inherit', fontWeight: 'inherit' }}>
                            {client.name}
                          </Link>
                        </div>
                        {client.state && <div className="sub-text">{client.state}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{client.contact || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{client.phone}</td>
                  <td style={{ color: 'var(--info)', fontSize: 12.5 }}>{client.email || '—'}</td>
                  <td>{client.city || '—'}</td>
                  <td>
                    <span className="active-jobs-pill">
                      {client.activeJobs} Open
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="Edit" id={`edit-client-${client.id}`} onClick={() => openEditModal(client)}><Pencil size={13} strokeWidth={2} /></button>
                      <Link className="row-action-btn" to={`/dashboard/clients/${client.id}`} title="View Jobs" id={`view-jobs-${client.id}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Eye size={13} strokeWidth={2} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== Add Client Modal ===== */}
      {isOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setIsOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label={editingClient ? 'Edit Client' : 'Add Client'}>
            <div className="modal-header">
              <span className="modal-title">{editingClient ? 'Edit Client' : 'Add New Client'}</span>
              <button className="modal-close" onClick={() => { setIsOpen(false); setEditingClient(null) }} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">

                <div className="form-group full">
                  <label className="form-label">Client Name <span className="req">*</span></label>
                  <input name="name" value={form.name} onChange={handleChange}
                    className={`form-control${errors.name ? ' is-error' : ''}`}
                    placeholder="e.g. Acme Corporation" disabled={saving} />
                  {errors.name && <span className="form-error">{errors.name}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Contact Person Name</label>
                  <input name="contact" value={form.contact} onChange={handleChange}
                    className="form-control" placeholder="e.g. Rohan Mehta" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone Number <span className="req">*</span></label>
                  <input name="phone" value={form.phone} onChange={handleChange}
                    className={`form-control${errors.phone ? ' is-error' : ''}`}
                    placeholder="+91 98765 43210" disabled={saving} />
                  {errors.phone && <span className="form-error">{errors.phone}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input name="email" type="email" value={form.email} onChange={handleChange}
                    className="form-control" placeholder="contact@company.com" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">City</label>
                  <input name="city" value={form.city} onChange={handleChange}
                    className="form-control" placeholder="e.g. Bengaluru" disabled={saving} />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <input name="state" value={form.state} onChange={handleChange}
                    className="form-control" placeholder="e.g. Karnataka" disabled={saving} />
                </div>

                <div className="form-group full">
                  <label className="form-label">Notes</label>
                  <textarea name="notes" value={form.notes} onChange={handleChange}
                    className="form-control" rows={2} placeholder="Internal notes about this client..." disabled={saving} />
                </div>

              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setIsOpen(false); setEditingClient(null) }} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-client-btn" disabled={saving}>
                {saving ? 'Saving...' : editingClient ? 'Update Client' : 'Save Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {clientDuplicate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setClientDuplicate(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Duplicate Client">
            <div className="modal-header">
              <span className="modal-title">Duplicate Client</span>
              <button className="modal-close" onClick={() => setClientDuplicate(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="review-banner">
                <AlertCircle size={16} />
                A client with the same name and email already exists.
              </div>
              <div className="duplicate-compare-grid">
                <div className="duplicate-compare-card">
                  <div className="form-section-title">Existing Client</div>
                  <div className="name-text">{clientDuplicate.existing?.name || '-'}</div>
                  <div className="sub-text">{clientDuplicate.existing?.email || '-'}</div>
                  <div className="sub-text">{clientDuplicate.existing?.phone || '-'}</div>
                </div>
                <div className="duplicate-compare-card">
                  <div className="form-section-title">New Client</div>
                  <div className="name-text">{clientDuplicate.client?.name || '-'}</div>
                  <div className="sub-text">{clientDuplicate.client?.email || '-'}</div>
                  <div className="sub-text">{clientDuplicate.client?.phone || '-'}</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => resolveClientDuplicate('add_duplicate')} disabled={saving}>Add Duplicate Entry</button>
              <button className="btn-primary" onClick={() => resolveClientDuplicate('update_current')} disabled={saving}>Update Current Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
