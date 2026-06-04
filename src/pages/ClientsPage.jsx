import { useState } from 'react'
import { Plus, Pencil, Eye, X, Building2 } from 'lucide-react'
import '../styles/Shared.css'

const INITIAL_CLIENTS = [
  { id: 1, name: 'Zeta FinTech',     contact: 'Rohan Mehta',    phone: '+91 98765 43210', email: 'rohan@zetafintech.com',    city: 'Bengaluru', state: 'Karnataka', activeJobs: 2, notes: '' },
  { id: 2, name: 'Nexus Tech',       contact: 'Priya Sharma',   phone: '+91 98234 56789', email: 'priya@nexustech.in',       city: 'Mumbai',    state: 'Maharashtra', activeJobs: 2, notes: '' },
  { id: 3, name: 'Bright Minds Ltd', contact: 'Arjun Kulkarni', phone: '+91 99012 34567', email: 'arjun@brightminds.co.in', city: 'Pune',      state: 'Maharashtra', activeJobs: 1, notes: '' },
  { id: 4, name: 'Acme Corp',        contact: 'Sunita Verma',   phone: '+91 97654 32109', email: 'sunita@acmecorp.com',      city: 'Delhi',     state: 'Delhi', activeJobs: 1, notes: '' },
  { id: 5, name: 'CloudBridge Labs', contact: 'Aditya Rao',     phone: '+91 91234 56780', email: 'aditya@cloudbridgelabs.io',city: 'Hyderabad', state: 'Telangana', activeJobs: 1, notes: '' },
  { id: 6, name: 'Lumino Health',    contact: 'Kavita Nair',    phone: '+91 94567 89012', email: 'kavita@luminohealth.com',  city: 'Chennai',   state: 'Tamil Nadu', activeJobs: 0, notes: '' },
]

const EMPTY_FORM = {
  name: '', contact: '', phone: '', email: '', city: '', state: '', notes: '',
}

export default function ClientsPage() {
  const [clients, setClients] = useState(INITIAL_CLIENTS)
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

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

  const openModal = () => { setForm(EMPTY_FORM); setErrors({}); setIsOpen(true) }

  const handleSave = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setClients(c => [{
      id: Date.now(), name: form.name, contact: form.contact,
      phone: form.phone, email: form.email, city: form.city,
      state: form.state, activeJobs: 0, notes: form.notes,
    }, ...c])
    setIsOpen(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <button className="btn-primary" onClick={openModal} id="btn-add-client">
          <Plus size={15} strokeWidth={2.5} /> Add Client
        </button>
      </div>

      {/* Table */}
      <div className="table-card">
        {clients.length === 0 ? (
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
                        {client.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div className="name-text">{client.name}</div>
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
                      <button className="row-action-btn" title="Edit" id={`edit-client-${client.id}`}><Pencil size={13} strokeWidth={2} /></button>
                      <button className="row-action-btn" title="View Jobs" id={`view-jobs-${client.id}`}><Eye size={13} strokeWidth={2} /></button>
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Add Client">
            <div className="modal-header">
              <span className="modal-title">Add New Client</span>
              <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">

                <div className="form-group full">
                  <label className="form-label">Client Name <span className="req">*</span></label>
                  <input name="name" value={form.name} onChange={handleChange}
                    className={`form-control${errors.name ? ' is-error' : ''}`}
                    placeholder="e.g. Acme Corporation" />
                  {errors.name && <span className="form-error">{errors.name}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Contact Person Name</label>
                  <input name="contact" value={form.contact} onChange={handleChange}
                    className="form-control" placeholder="e.g. Rohan Mehta" />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone Number <span className="req">*</span></label>
                  <input name="phone" value={form.phone} onChange={handleChange}
                    className={`form-control${errors.phone ? ' is-error' : ''}`}
                    placeholder="+91 98765 43210" />
                  {errors.phone && <span className="form-error">{errors.phone}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input name="email" type="email" value={form.email} onChange={handleChange}
                    className="form-control" placeholder="contact@company.com" />
                </div>

                <div className="form-group">
                  <label className="form-label">City</label>
                  <input name="city" value={form.city} onChange={handleChange}
                    className="form-control" placeholder="e.g. Bengaluru" />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <input name="state" value={form.state} onChange={handleChange}
                    className="form-control" placeholder="e.g. Karnataka" />
                </div>

                <div className="form-group full">
                  <label className="form-label">Notes</label>
                  <textarea name="notes" value={form.notes} onChange={handleChange}
                    className="form-control" rows={2} placeholder="Internal notes about this client..." />
                </div>

              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} id="save-client-btn">Save Client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
