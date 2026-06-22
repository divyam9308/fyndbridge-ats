import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import {
  createInvoiceEntity,
  deleteInvoiceEntity,
  fetchInvoiceEntities,
  fetchNextInvoiceNumber,
  generateInvoicePdf,
  updateInvoiceEntity
} from '../services/invoiceApi'
import '../styles/Shared.css'
import './InvoicePage.css'

const EMPTY = {
  legal_entity_name: '',
  address: '',
  pan: '',
  place_of_supply: '',
  state: '',
  state_code: '',
  gstin: '',
  contact_person: '',
  email: '',
  professional_fee_text: '',
  model: 'joining_percentage',
  model_percent: '',
  model_flat_fee: '',
  retainer_amount: '',
  jra_adjustment_value: '',
  jra_base_value: '',
  jra_flat_fee: '',
  others_amount: '',
  sac: '998512',
  billing_entity: 'FCS',
  ctc_lpa: '',
  gst_component: 'IGST',
  igst_rate: 18,
  cgst_rate: 9,
  sgst_rate: 9
}

const MODELS = [
  ['joining_percentage', 'Joining % Model'],
  ['joining_flat_fee', 'Joining Flat Fee'],
  ['retainer', 'Retainer'],
  ['jra_adjustment_percentage', 'JRA Adjustment %'],
  ['jra_adjustment_flat_fee', 'JRA Adjustment Flat Fee'],
  ['project', 'Project'],
  ['others', 'Others']
]

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const n = value => Number(value || 0)
const money = value => `Rs. ${n(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const isDelhi = form => /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/i.test([form.address, form.state, form.place_of_supply].join(' '))

function calculate(form) {
  const ctc = n(form.ctc_lpa) * 100000
  let taxable = 0
  if (['joining_percentage', 'project'].includes(form.model)) taxable = ctc * n(form.model_percent) / 100
  if (form.model === 'joining_flat_fee') taxable = n(form.model_flat_fee)
  if (form.model === 'retainer') taxable = n(form.retainer_amount)
  if (form.model === 'jra_adjustment_percentage') taxable = ctc * n(form.model_percent) / 100 - n(form.jra_adjustment_value)
  if (form.model === 'jra_adjustment_flat_fee') taxable = n(form.jra_base_value) - n(form.jra_flat_fee)
  if (form.model === 'others') taxable = n(form.others_amount)
  taxable = Math.round(taxable * 100) / 100
  const igst = form.gst_component === 'IGST' ? taxable * n(form.igst_rate) / 100 : 0
  const cgst = form.gst_component === 'CGST_SGST' ? taxable * n(form.cgst_rate) / 100 : 0
  const sgst = form.gst_component === 'CGST_SGST' ? taxable * n(form.sgst_rate) / 100 : 0
  const tax = Math.round((igst + cgst + sgst) * 100) / 100
  const before = Math.round((taxable + tax) * 100) / 100
  const grand = Math.round(before)
  return { taxable, igst, cgst, sgst, tax, before, grand, rounding: Math.round(Math.abs(grand - before) * 100) / 100, roundingType: grand > before ? 'MORE' : grand < before ? 'LESS' : '' }
}

function autoGst(form) {
  return { ...form, gst_component: isDelhi(form) ? 'CGST_SGST' : 'IGST' }
}

function Field({ label, children, full = false, error }) {
  return <div className={full ? 'form-group full' : 'form-group'}><label className="form-label">{label}</label>{children}{error && <span className="form-error">{error}</span>}</div>
}

function ModelFields({ form, update }) {
  if (['joining_percentage', 'project'].includes(form.model)) return <Field label="Percent Value"><input className="form-control" name="model_percent" value={form.model_percent || ''} onChange={update} /></Field>
  if (form.model === 'joining_flat_fee') return <Field label="Flat Fee Value in Rs."><input className="form-control" name="model_flat_fee" value={form.model_flat_fee || ''} onChange={update} /></Field>
  if (form.model === 'retainer') return <Field label="Retainer Amount in Rs."><input className="form-control" name="retainer_amount" value={form.retainer_amount || ''} onChange={update} /></Field>
  if (form.model === 'jra_adjustment_percentage') return <><Field label="Percent Value"><input className="form-control" name="model_percent" value={form.model_percent || ''} onChange={update} /></Field><Field label="Adjustment Value in Rs."><input className="form-control" name="jra_adjustment_value" value={form.jra_adjustment_value || ''} onChange={update} /></Field></>
  if (form.model === 'jra_adjustment_flat_fee') return <><Field label="Value in Rs."><input className="form-control" name="jra_base_value" value={form.jra_base_value || ''} onChange={update} /></Field><Field label="Flat Fee / Adjustment in Rs."><input className="form-control" name="jra_flat_fee" value={form.jra_flat_fee || ''} onChange={update} /></Field></>
  return <Field label="Amount in Rs."><input className="form-control" name="others_amount" value={form.others_amount || ''} onChange={update} /></Field>
}

function EntityModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(autoGst({ ...EMPTY, ...(initial || {}) }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = event => {
    const { name, value } = event.target
    setForm(current => autoGst({ ...current, [name]: value }))
  }
  const save = async () => {
    setSaving(true); setError('')
    try {
      const calc = calculate(form)
      if (calc.taxable < 0) throw new Error('Taxable amount cannot be negative.')
      await onSave(form)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">{initial ? 'Edit Entity' : 'Add Entity'}</span><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body">
      {error && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
      <div className="form-grid-2">
        <Field label="Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Legal Entity Name"><input className="form-control" name="legal_entity_name" value={form.legal_entity_name} onChange={update} /></Field>
        <Field label="Address" full><textarea className="form-control" name="address" value={form.address} onChange={update} rows={3} /></Field>
        {['pan', 'place_of_supply', 'state', 'state_code', 'gstin', 'contact_person', 'email'].map(key => <Field label={key.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} key={key}><input className="form-control" name={key} value={form[key] || ''} onChange={update} /></Field>)}
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="CTC in LPA"><input className="form-control" name="ctc_lpa" value={form.ctc_lpa || ''} onChange={update} /></Field>
        <ModelFields form={form} update={update} />
        <Field label="SAC"><input className="form-control" name="sac" value={form.sac || ''} onChange={update} /></Field>
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><input className="form-control" name="igst_rate" value={form.igst_rate || ''} onChange={update} /></Field> : <><Field label="CGST Rate"><input className="form-control" name="cgst_rate" value={form.cgst_rate || ''} onChange={update} /></Field><Field label="SGST Rate"><input className="form-control" name="sgst_rate" value={form.sgst_rate || ''} onChange={update} /></Field></>}
        <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text || ''} onChange={update} rows={4} /></Field>
      </div>
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Entity'}</button></div>
  </div></div>, document.body)
}

function GenerateModal({ entities, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const selected = entities.find(item => item.id === selectedId)
  const [form, setForm] = useState({ ...EMPTY, invoice_date: today() })
  const [nextNumber, setNextNumber] = useState('')
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (selected) setForm(autoGst({ ...EMPTY, ...selected, invoice_entity_id: selected.id, invoice_date: form.invoice_date || today() })) }, [selectedId])
  useEffect(() => {
    fetchNextInvoiceNumber(form.billing_entity, form.invoice_date).then(data => setNextNumber(data.invoiceNumber)).catch(() => setNextNumber(''))
  }, [form.billing_entity, form.invoice_date])
  const update = event => {
    const { name, value } = event.target
    setForm(current => name === 'gst_component' ? { ...current, [name]: value } : autoGst({ ...current, [name]: value }))
  }
  const matches = entities.filter(entity => [entity.invoice_id, entity.legal_entity_name, entity.gstin, entity.pan, entity.contact_person, entity.email].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const calc = calculate(form)
  const download = (payload = result) => {
    if (!payload?.pdfBase64) return
    const bytes = Uint8Array.from(atob(payload.pdfBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url; a.download = payload.fileName || 'Invoice.pdf'; a.click()
    URL.revokeObjectURL(url)
  }
  const generate = async () => {
    setSaving(true); setError('')
    try {
      if (!selectedId) throw new Error('Select an entity.')
      if (calc.taxable < 0) throw new Error('Taxable amount cannot be negative.')
      const payload = await generateInvoicePdf({ ...form, invoice_entity_id: selectedId })
      setResult(payload)
      download(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">Generate Invoice</span><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body">
      {error && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
      <div className="invoice-entity-picker">
        <input className="form-control" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search entity..." />
        <div>{matches.map(entity => <button type="button" key={entity.id} onClick={() => { setSelectedId(entity.id); setQuery(`${entity.invoice_id} - ${entity.legal_entity_name}`) }}>{entity.invoice_id} - {entity.legal_entity_name}<small>{entity.gstin || entity.email || ''}</small></button>)}</div>
      </div>
      <div className="form-grid-2">
        <Field label="Invoice Date"><input className="form-control" type="date" name="invoice_date" value={form.invoice_date} onChange={update} /></Field>
        <Field label="Invoice Number Preview"><input className="form-control" value={nextNumber || 'Auto-generated'} readOnly /></Field>
        <Field label="Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="CTC in LPA"><input className="form-control" name="ctc_lpa" value={form.ctc_lpa || ''} onChange={update} /></Field>
        <ModelFields form={form} update={update} />
        <Field label="SAC"><input className="form-control" name="sac" value={form.sac || ''} onChange={update} /></Field>
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><input className="form-control" name="igst_rate" value={form.igst_rate || ''} onChange={update} /></Field> : <><Field label="CGST Rate"><input className="form-control" name="cgst_rate" value={form.cgst_rate || ''} onChange={update} /></Field><Field label="SGST Rate"><input className="form-control" name="sgst_rate" value={form.sgst_rate || ''} onChange={update} /></Field></>}
        <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text || ''} onChange={update} rows={3} /></Field>
      </div>
      <div className="invoice-preview">
        <span>Taxable Amount <b>{money(calc.taxable)}</b></span><span>GST <b>{form.gst_component}</b></span>
        <span>IGST <b>{money(calc.igst)}</b></span><span>CGST <b>{money(calc.cgst)}</b></span><span>SGST <b>{money(calc.sgst)}</b></span>
        <span>Total before rounding <b>{money(calc.before)}</b></span><span>Rounding <b>{calc.roundingType ? `${calc.roundingType} ${money(calc.rounding)}` : '-'}</b></span><span>Grand Total <b>{money(calc.grand)}</b></span>
      </div>
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>{result && <button className="btn-secondary" onClick={() => download()}><Download size={14} />Download PDF</button>}<button className="btn-primary" onClick={generate} disabled={saving}>{saving ? 'Generating...' : 'Generate PDF'}</button></div>
  </div></div>, document.body)
}

export default function InvoicePage() {
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const load = async () => {
    setLoading(true); setError('')
    try { setEntities((await fetchInvoiceEntities()).data || []) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const filtered = useMemo(() => entities.filter(entity => [entity.invoice_id, entity.legal_entity_name, entity.gstin, entity.pan, entity.contact_person, entity.email, entity.billing_entity].join(' ').toLowerCase().includes(query.toLowerCase())), [entities, query])
  const save = async form => {
    if (editing) await updateInvoiceEntity(editing.id, form)
    else await createInvoiceEntity(form)
    await load()
  }
  const remove = async entity => {
    if (!window.confirm(`Delete ${entity.invoice_id}?`)) return
    await deleteInvoiceEntity(entity.id); await load()
  }
  return <div className="invoice-page">
    <div className="candidate-page-header">
      <div><h2>Invoice</h2><p>Manage legal entities and generate FCS/FCAPL invoices.</p></div>
      <div className="header-actions"><button className="btn-secondary" onClick={() => setGenerating(true)}><FileText size={15} />Generate Invoice</button><button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} />Add Entity</button></div>
    </div>
    <div className="table-card">
      <div className="filters-row"><div className="search-box"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search invoice entities..." /></div></div>
      {error && <div className="form-error" style={{ display: 'block', margin: 12 }}>{error}</div>}
      {loading ? <div className="table-empty">Loading entities...</div> : <div className="table-scroll"><table className="data-table invoice-table"><thead><tr>{['Invoice ID', 'Legal Entity Name', 'Address', 'PAN', 'Place of Supply', 'State', 'State Code', 'GSTIN', 'Contact Person', 'Email', 'Model', 'Billing Entity', 'SAC', 'GST Component', 'CTC', 'Latest Invoice No.', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(entity => <tr key={entity.id}><td>{entity.invoice_id}</td><td>{entity.legal_entity_name}</td><td>{entity.address}</td><td>{entity.pan || '-'}</td><td>{entity.place_of_supply || '-'}</td><td>{entity.state || '-'}</td><td>{entity.state_code || '-'}</td><td>{entity.gstin || '-'}</td><td>{entity.contact_person || '-'}</td><td>{entity.email || '-'}</td><td>{MODELS.find(([value]) => value === entity.model)?.[1] || entity.model}</td><td><span className="invoice-badge is-navy">{entity.billing_entity}</span></td><td>{entity.sac}</td><td><span className="invoice-badge">{entity.gst_component}</span></td><td>{entity.ctc_lpa || '-'}</td><td>{entity.latest_invoice_number || '-'}</td><td><div className="row-actions"><button className="row-action-btn" onClick={() => setEditing(entity)}><Pencil size={13} /></button><button className="row-action-btn" onClick={() => remove(entity)}><Trash2 size={13} /></button></div></td></tr>)}{!filtered.length && <tr><td colSpan={17} className="table-empty">No invoice entities found.</td></tr>}</tbody></table></div>}
    </div>
    {(adding || editing) && <EntityModal initial={editing} onClose={() => { setAdding(false); setEditing(null) }} onSave={save} />}
    {generating && <GenerateModal entities={entities} onClose={() => { setGenerating(false); load() }} />}
  </div>
}
