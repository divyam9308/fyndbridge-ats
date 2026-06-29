import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Download, FileText, LoaderCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import {
  commitInvoicePreview, createInvoiceEntity, deleteInvoiceEntity, fetchInvoiceEntities,
  fetchNextInvoiceNumber, lookupGstin, previewInvoicePdf, updateInvoiceEntity
} from '../services/invoiceApi'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { EMPTY_INVOICE, INVOICE_MODELS, calculateInvoicePreview } from '../utils/invoiceModels'
import '../styles/Shared.css'
import './InvoicePage.css'

const EMPTY_ENTITY = {
  billing_entity: 'FCS', legal_entity_name: '', optional_name: '-', address: '', gstin: '', pan: '', place_of_supply: '', state: '',
  state_code: '', contact_person: '', email: '', sac: '998512', gst_component: 'IGST', igst_rate: 18, cgst_rate: 9, sgst_rate: 9
}
const ENTITY_FIELDS = Object.keys(EMPTY_ENTITY)
const SEARCH_FIELDS = ['entity_display_id', 'invoice_id', 'legal_entity_name', 'optional_name', 'gstin', 'pan', 'contact_person', 'email', 'billing_entity']
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const number = value => Number(String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim() || 0)
const money = value => `₹${number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const display = value => String(value ?? '').trim() || '-'
const isDelhi = form => /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/i.test([form.address, form.state, form.place_of_supply].join(' '))
const withAutoGst = form => ({ ...form, gst_component: isDelhi(form) ? 'CGST_SGST' : 'IGST' })

function Field({ label, children, full = false }) {
  return <div className={`form-group${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
}
function Input({ name, value, update, ...props }) {
  return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} />
}
export function ModelFields({ form, update }) {
  if (form.model === 'joining_percentage') return <><Field label="CTC"><Input name="ctc_lpa" value={form.ctc_lpa} update={update} inputMode="decimal" /></Field><Field label="Percent Value"><Input name="model_percent" value={form.model_percent} update={update} inputMode="decimal" /></Field></>
  if (form.model === 'joining_flat_fee') return <Field label="Flat Fee (₹)"><Input name="model_flat_fee" value={form.model_flat_fee} update={update} inputMode="decimal" /></Field>
  if (form.model === 'retainer') return <Field label="Retainer Amount (₹)"><Input name="retainer_amount" value={form.retainer_amount} update={update} inputMode="decimal" /></Field>
  if (form.model === 'project') return <Field label="Project Amount (₹)"><Input name="project_amount" value={form.project_amount} update={update} inputMode="decimal" /></Field>
  if (form.model === 'jra_adjustment_percentage') return <><Field label="CTC"><Input name="ctc_lpa" value={form.ctc_lpa} update={update} inputMode="decimal" /></Field><Field label="Percent Value"><Input name="model_percent" value={form.model_percent} update={update} inputMode="decimal" /></Field><Field label="Adjustment Value (₹)"><Input name="jra_adjustment_value" value={form.jra_adjustment_value} update={update} inputMode="decimal" /></Field></>
  if (form.model === 'jra_adjustment_flat_fee') return <><Field label="Value (₹)"><Input name="jra_base_value" value={form.jra_base_value} update={update} inputMode="decimal" /></Field><Field label="Flat Fee / Adjustment (₹)"><Input name="jra_flat_fee" value={form.jra_flat_fee} update={update} inputMode="decimal" /></Field></>
  return <Field label="Amount (₹)"><Input name="others_amount" value={form.others_amount} update={update} inputMode="decimal" /></Field>
}
function Loader({ label }) { return <div className="invoice-loader"><LoaderCircle size={22} /><span>{label}</span></div> }

function EntityModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_ENTITY, ...initial, optional_name: initial?.optional_name || '-' }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const update = event => {
    const { name, value } = event.target
    setForm(current => ['address', 'state', 'place_of_supply'].includes(name) ? withAutoGst({ ...current, [name]: value }) : { ...current, [name]: value })
  }
  const searchGstin = async () => {
    if (!form.gstin) return
    setLookupLoading(true); setError('')
    try {
      const data = await lookupGstin(form.gstin)
      setForm(current => withAutoGst({ ...current, gstin: data.gstin || current.gstin, legal_entity_name: data.legalEntityName || current.legal_entity_name, pan: data.pan || current.pan, state_code: data.stateCode || current.state_code, state: data.state || current.state, address: data.address || current.address }))
    } catch (err) { setError(err.message) } finally { setLookupLoading(false) }
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await onSave(Object.fromEntries(ENTITY_FIELDS.map(key => [key, form[key]]))); onClose() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">{initial ? 'Edit Entity' : 'Add Entity'}</span><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body">{error && <div className="invoice-form-error">{error}</div>}
      <section className="invoice-form-section"><h3>Entity Details</h3><div className="form-grid-2">
        <Field label="Default Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Legal Entity Name"><Input name="legal_entity_name" value={form.legal_entity_name} update={update} /></Field>
        <Field label="Optional Name"><Input name="optional_name" value={form.optional_name} update={update} /></Field>
        <Field label="Address" full><textarea className="form-control" name="address" value={form.address || ''} onChange={update} rows={3} /></Field>
        <Field label="GSTIN"><div className="invoice-inline-field"><Input name="gstin" value={form.gstin} update={update} /><button type="button" className="btn-secondary" onClick={searchGstin} disabled={!form.gstin || lookupLoading}>{lookupLoading ? 'Searching...' : 'Search'}</button></div></Field>
        {['pan', 'place_of_supply', 'state', 'state_code', 'contact_person', 'email'].map(key => <Field key={key} label={key.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())}><Input name={key} value={form[key]} update={update} /></Field>)}
      </div></section>
      <section className="invoice-form-section"><h3>Tax Details</h3><div className="form-grid-2">
        <Field label="SAC"><Input name="sac" value={form.sac} update={update} /></Field>
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} inputMode="decimal" /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} inputMode="decimal" /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} inputMode="decimal" /></Field></>}
      </div></section>
    </div><div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Entity'}</button></div>
  </div></div>, document.body)
}

function CreateInvoiceModal({ entities, onClose, onCreated }) {
  const [selectedId, setSelectedId] = useState('')
  const selected = entities.find(entity => entity.id === selectedId)
  const [form, setForm] = useState({ ...EMPTY_INVOICE, invoice_date: today() })
  const [nextNumber, setNextNumber] = useState('')
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { fetchNextInvoiceNumber(form.billing_entity || 'FCS', form.invoice_date || today()).then(data => setNextNumber(data.invoiceNumber)).catch(() => setNextNumber('')) }, [form.billing_entity, form.invoice_date])
  const update = event => { const { name, value } = event.target; setResult(null); setForm(current => ({ ...current, [name]: value })) }
  const select = event => {
    const entity = entities.find(item => item.id === event.target.value)
    setSelectedId(event.target.value); setResult(null)
    if (entity) setForm(current => ({ ...current, billing_entity: entity.billing_entity || 'FCS', sac: entity.sac || '998512', gst_component: entity.gst_component || 'IGST', igst_rate: entity.igst_rate ?? 18, cgst_rate: entity.cgst_rate ?? 9, sgst_rate: entity.sgst_rate ?? 9 }))
  }
  const preview = async () => {
    if (!selected) return setError('Select an entity.')
    setSaving(true); setError('')
    try { setResult(await previewInvoicePdf({ ...form, invoice_entity_id: selected.id })) } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const create = async () => {
    setSaving(true); setError('')
    try {
      const saved = await commitInvoicePreview({ ...form, invoice_entity_id: selected.id, invoice_number: result.data.invoice_number })
      const bytes = Uint8Array.from(atob(result.pdfBase64), char => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a'); link.href = url; link.download = result.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
      await onCreated(saved.data); onClose()
    } catch (err) { setError(err.message); setSaving(false) }
  }
  const calc = calculateInvoicePreview(form)
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal invoice-generate-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">Create Invoice</span><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body">{error && <div className="invoice-form-error">{error}</div>}
      <section className="invoice-form-section"><h3>Select Entity</h3><select className="form-control" value={selectedId} onChange={select}><option value="" disabled hidden>Select Entity</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.entity_display_id || entity.invoice_id} - {display(entity.legal_entity_name)}</option>)}</select>{selected && <div className="invoice-selected-chip"><Check size={14} />{display(selected.legal_entity_name)}</div>}</section>
      <section className="invoice-form-section"><h3>Invoice Details</h3><div className="form-grid-2">
        <Field label="Consultant Name"><Input name="consultant_name" value={form.consultant_name} update={update} /></Field><Field label="Candidate Name"><Input name="candidate_name" value={form.candidate_name} update={update} /></Field>
        <Field label="Invoice Date"><Input type="date" name="invoice_date" value={form.invoice_date} update={update} /></Field><Field label="Invoice Number Preview"><input className="form-control" value={nextNumber || 'Auto-generated'} readOnly /></Field>
        <Field label="Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{INVOICE_MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text} onChange={update} rows={3} /></Field>
        <ModelFields form={form} update={update} />
        <Field label="SAC"><Input name="sac" value={form.sac} update={update} /></Field><Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} /></Field></>}
      </div></section>
      <section className="invoice-form-section"><h3>Calculation Preview</h3><div className="invoice-preview"><span>Taxable<b>{money(calc.taxable)}</b></span><span>IGST<b>{money(calc.igst)}</b></span><span>CGST<b>{money(calc.cgst)}</b></span><span>SGST<b>{money(calc.sgst)}</b></span><span>Grand Total<b>{money(calc.grand)}</b></span></div></section>
      {result && <section className="invoice-form-section"><h3>Invoice Preview</h3><div className="invoice-selected-chip"><FileText size={14} />{result.data.invoice_number}</div><div className="invoice-pdf-preview"><iframe title="Invoice PDF preview" src={`data:application/pdf;base64,${result.pdfBase64}`} /></div></section>}
    </div><div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Cancel</button>{result ? <button className="btn-primary" onClick={create} disabled={saving}><Download size={14} />{saving ? 'Creating...' : 'Create & Download'}</button> : <button className="btn-primary" onClick={preview} disabled={saving || !selected}>{saving ? 'Preparing...' : 'Preview Invoice'}</button>}</div>
  </div></div>, document.body)
}

function rate(entity) {
  if (entity.gst_component === 'IGST') return `IGST ${number(entity.igst_rate)}%`
  if (entity.gst_component === 'CGST_SGST') return `CGST ${number(entity.cgst_rate)}% + SGST ${number(entity.sgst_rate)}%`
  return 'No GST / 0%'
}

export default function InvoicePage() {
  const { isAdmin, loading: adminLoading } = useAdminAccess({ loadPermissions: false, realtime: false })
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => { setError(''); try { setEntities((await fetchInvoiceEntities()).data || []) } catch (err) { setError(err.message) } finally { setLoading(false) } }, [])
  useEffect(() => { if (!adminLoading && isAdmin) Promise.resolve().then(load); else if (!adminLoading) Promise.resolve().then(() => setLoading(false)) }, [adminLoading, isAdmin, load])
  const filtered = useMemo(() => { const term = query.toLowerCase().trim(); return entities.filter(entity => !term || SEARCH_FIELDS.some(field => String(entity[field] || '').toLowerCase().includes(term))) }, [entities, query])
  const save = async form => { if (editing) await updateInvoiceEntity(editing.id, form); else await createInvoiceEntity(form); await load() }
  const remove = async entity => { if (!window.confirm(`Delete ${entity.entity_display_id || entity.invoice_id}?`)) return; try { await deleteInvoiceEntity(entity.id); await load() } catch (err) { setError(err.message) } }
  if (adminLoading) return <div className="invoice-access-card"><Loader label="Checking invoice access..." /></div>
  if (!isAdmin) return <div className="invoice-access-card"><div className="invoice-denied">Admin access required.</div></div>
  return <div className="invoice-page">
    <div className="header-actions"><button className="btn-secondary" onClick={() => setCreating(true)}><FileText size={15} />Create Invoice</button><button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} />Add Entity</button></div>
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><div className="invoice-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search billing entities..." /></div><span>{filtered.length} {filtered.length === 1 ? 'entity' : 'entities'}</span></div>
      {error && <div className="invoice-table-error">{error}</div>}
      {loading ? <div className="invoice-table-loading"><Loader label="Loading entities..." /></div> : <div className="table-scroll"><table className="data-table invoice-table"><thead><tr>{['Entity ID', 'Default Billing Entity', 'Legal Entity Name', 'Optional Name', 'Address', 'GSTIN', 'PAN', 'Place of Supply', 'State', 'State Code', 'Contact Person', 'Contact Email', 'SAC', 'GST Component', 'Rate', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {filtered.map(entity => <tr key={entity.id}><td><span className="invoice-id">{entity.entity_display_id || entity.invoice_id}</span></td><td><span className="invoice-badge is-navy">{display(entity.billing_entity)}</span></td><td><Link className="invoice-name-link" to={`/invoice/entities/${entity.id}`}><b>{display(entity.legal_entity_name)}</b></Link></td><td>{display(entity.optional_name)}</td><td><span className="invoice-address" title={entity.address || ''}>{display(entity.address)}</span></td><td>{display(entity.gstin)}</td><td>{display(entity.pan)}</td><td>{display(entity.place_of_supply)}</td><td>{display(entity.state)}</td><td>{display(entity.state_code)}</td><td>{display(entity.contact_person)}</td><td>{display(entity.email)}</td><td>{display(entity.sac)}</td><td><span className="invoice-badge">{display(entity.gst_component === 'CGST_SGST' ? 'CGST + SGST' : entity.gst_component)}</span></td><td>{rate(entity)}</td><td><div className="row-actions"><button className="row-action-btn" onClick={() => setEditing(entity)} aria-label="Edit entity"><Pencil size={13} /></button><button className="row-action-btn" onClick={() => remove(entity)} aria-label="Delete entity"><Trash2 size={13} /></button></div></td></tr>)}
        {!filtered.length && <tr><td className="invoice-empty-cell" colSpan={16}>No billing entities found.</td></tr>}
      </tbody></table></div>}
    </div>
    {(adding || editing) && <EntityModal initial={editing} onClose={() => { setAdding(false); setEditing(null) }} onSave={save} />}
    {creating && <CreateInvoiceModal entities={entities} onClose={() => setCreating(false)} onCreated={load} />}
  </div>
}
