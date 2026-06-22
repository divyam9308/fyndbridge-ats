import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Download, FileText, LoaderCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import {
  createInvoiceEntity,
  deleteInvoiceEntity,
  fetchInvoiceEntities,
  fetchNextInvoiceNumber,
  generateInvoicePdf,
  updateInvoiceEntity
} from '../services/invoiceApi'
import { useAdminAccess } from '../hooks/useAdminAccess'
import '../styles/Shared.css'
import './InvoicePage.css'

const EMPTY = {
  legal_entity_name: '', address: '', pan: '', place_of_supply: '', state: '', state_code: '', gstin: '', contact_person: '', email: '',
  professional_fee_text: '', model: 'joining_percentage', model_percent: '', model_flat_fee: '', retainer_amount: '', jra_adjustment_value: '',
  jra_base_value: '', jra_flat_fee: '', others_amount: '', sac: '998512', billing_entity: 'FCS', ctc_lpa: '', gst_component: 'IGST',
  igst_rate: 18, cgst_rate: 9, sgst_rate: 9
}

const MODELS = [
  ['joining_percentage', 'Joining % Model'], ['joining_flat_fee', 'Joining Flat Fee'], ['retainer', 'Retainer'],
  ['jra_adjustment_percentage', 'JRA Adjustment %'], ['jra_adjustment_flat_fee', 'JRA Adjustment Flat Fee'], ['project', 'Project'], ['others', 'Others']
]
const MODEL_LABELS = Object.fromEntries(MODELS)
const LOCATION_FIELDS = new Set(['address', 'state', 'place_of_supply'])
const SEARCH_FIELDS = ['invoice_id', 'legal_entity_name', 'gstin', 'pan', 'contact_person', 'email']

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const n = value => Number(String(value ?? '').replace(/₹|Rs\.?|,/gi, '').trim() || 0)
const money = value => Number.isFinite(n(value)) ? `₹${n(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const isDelhi = form => /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/i.test([form.address, form.state, form.place_of_supply].join(' '))
const autoGst = form => ({ ...form, gst_component: isDelhi(form) ? 'CGST_SGST' : 'IGST' })

function calculate(form) {
  const ctc = n(form.ctc_lpa)
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
  return { taxable, igst, cgst, sgst, before, grand, rounding: Math.round(Math.abs(grand - before) * 100) / 100, roundingType: grand > before ? 'MORE' : grand < before ? 'LESS' : '' }
}

function validateModel(form) {
  const required = (field, label) => {
    if (!clean(form[field])) throw new Error(`${label} is required.`)
    if (!Number.isFinite(n(form[field]))) throw new Error(`${label} must be numeric.`)
    if (n(form[field]) < 0) throw new Error(`${label} must be non-negative.`)
  }
  if (['joining_percentage', 'project', 'jra_adjustment_percentage'].includes(form.model)) {
    required('ctc_lpa', 'CTC')
    required('model_percent', 'Percent Value')
  }
  if (form.model === 'joining_flat_fee') required('model_flat_fee', 'Flat Fee Value')
  if (form.model === 'retainer') required('retainer_amount', 'Retainer Amount')
  if (form.model === 'jra_adjustment_percentage') required('jra_adjustment_value', 'Adjustment Value')
  if (form.model === 'jra_adjustment_flat_fee') {
    required('jra_base_value', 'Value')
    required('jra_flat_fee', 'Flat Fee / Adjustment')
  }
  if (form.model === 'others') required('others_amount', 'Amount')
  if (calculate(form).taxable < 0) throw new Error('Taxable amount cannot be negative.')
}

function entityPayload(form) {
  const fields = ['legal_entity_name', 'address', 'pan', 'place_of_supply', 'state', 'state_code', 'gstin', 'contact_person', 'email', 'model', 'ctc_lpa', 'model_percent', 'model_flat_fee', 'retainer_amount', 'jra_adjustment_value', 'jra_base_value', 'jra_flat_fee', 'others_amount', 'sac', 'billing_entity', 'gst_component', 'igst_rate', 'cgst_rate', 'sgst_rate']
  return Object.fromEntries(fields.map(field => [field, form[field]]))
}

function Field({ label, children, full = false }) {
  return <div className={full ? 'form-group full' : 'form-group'}><label className="form-label">{label}</label>{children}</div>
}

function AmountInput({ name, value, onChange, placeholder }) {
  return <input className="form-control" inputMode="decimal" name={name} value={value ?? ''} onChange={onChange} placeholder={placeholder} />
}

function ModelFields({ form, update }) {
  if (['joining_percentage', 'project'].includes(form.model)) return <><Field label="CTC"><AmountInput name="ctc_lpa" value={form.ctc_lpa} onChange={update} placeholder="Enter CTC amount" /></Field><Field label="Percent Value"><AmountInput name="model_percent" value={form.model_percent} onChange={update} placeholder="Enter percent" /></Field></>
  if (form.model === 'joining_flat_fee') return <Field label="Flat Fee (₹)"><AmountInput name="model_flat_fee" value={form.model_flat_fee} onChange={update} /></Field>
  if (form.model === 'retainer') return <Field label="Retainer Amount (₹)"><AmountInput name="retainer_amount" value={form.retainer_amount} onChange={update} /></Field>
  if (form.model === 'jra_adjustment_percentage') return <><Field label="CTC"><AmountInput name="ctc_lpa" value={form.ctc_lpa} onChange={update} placeholder="Enter CTC amount" /></Field><Field label="Percent Value"><AmountInput name="model_percent" value={form.model_percent} onChange={update} /></Field><Field label="Adjustment Value (₹)"><AmountInput name="jra_adjustment_value" value={form.jra_adjustment_value} onChange={update} /></Field></>
  if (form.model === 'jra_adjustment_flat_fee') return <><Field label="Value (₹)"><AmountInput name="jra_base_value" value={form.jra_base_value} onChange={update} /></Field><Field label="Flat Fee / Adjustment (₹)"><AmountInput name="jra_flat_fee" value={form.jra_flat_fee} onChange={update} /></Field></>
  return <Field label="Amount (₹)"><AmountInput name="others_amount" value={form.others_amount} onChange={update} /></Field>
}

function InvoiceLoader({ label }) {
  return <div className="invoice-loader" role="status"><LoaderCircle size={22} /><span>{label}</span></div>
}

function EntityModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => initial ? { ...EMPTY, ...initial, model: initial.model || EMPTY.model } : autoGst({ ...EMPTY }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = event => {
    const { name, value } = event.target
    setForm(current => LOCATION_FIELDS.has(name) ? autoGst({ ...current, [name]: value }) : { ...current, [name]: value })
  }
  const save = async () => {
    setSaving(true); setError('')
    try {
      if (!clean(form.legal_entity_name)) throw new Error('Legal Entity Name is required.')
      if (!clean(form.address)) throw new Error('Address is required.')
      validateModel(form)
      await onSave(entityPayload(form))
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">{initial ? 'Edit Entity' : 'Add Entity'}</span><button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="modal-body">
      {error ? <div className="invoice-form-error">{error}</div> : null}
      <section className="invoice-form-section"><h3>Entity Details</h3><div className="form-grid-2">
        <Field label="Default Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Legal Entity Name"><input className="form-control" name="legal_entity_name" value={form.legal_entity_name} onChange={update} /></Field>
        <Field label="Address" full><textarea className="form-control" name="address" value={form.address} onChange={update} rows={3} /></Field>
        {['pan', 'place_of_supply', 'state', 'state_code', 'gstin', 'contact_person', 'email'].map(key => <Field label={key.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} key={key}><input className="form-control" name={key} value={form[key] || ''} onChange={update} /></Field>)}
      </div></section>
      <section className="invoice-form-section"><h3>Tax Defaults</h3><div className="form-grid-2">
        <Field label="SAC"><input className="form-control" name="sac" value={form.sac || ''} onChange={update} /></Field>
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><AmountInput name="igst_rate" value={form.igst_rate} onChange={update} /></Field> : <><Field label="CGST Rate"><AmountInput name="cgst_rate" value={form.cgst_rate} onChange={update} /></Field><Field label="SGST Rate"><AmountInput name="sgst_rate" value={form.sgst_rate} onChange={update} /></Field></>}
      </div></section>
      <section className="invoice-form-section"><h3>Calculation Defaults</h3><div className="form-grid-2">
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <ModelFields form={form} update={update} />
      </div></section>
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Entity'}</button></div>
  </div></div>, document.body)
}

function EntityCombobox({ entities, selected, onSelect }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef(null)
  const matches = useMemo(() => {
    const term = query.toLowerCase().trim()
    return entities.filter(entity => !term || SEARCH_FIELDS.some(field => String(entity[field] || '').toLowerCase().includes(term))).slice(0, 10)
  }, [entities, query])
  useEffect(() => {
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const choose = entity => {
    onSelect(entity)
    setQuery(`${entity.invoice_id} - ${entity.legal_entity_name}`)
    setOpen(false)
  }
  const keyDown = event => {
    if (!open && ['ArrowDown', 'Enter'].includes(event.key)) { event.preventDefault(); setOpen(true); return }
    if (event.key === 'Escape') setOpen(false)
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, matches.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)) }
    if (event.key === 'Enter' && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]) }
  }
  return <div className="invoice-combobox" ref={rootRef}>
    <div className="invoice-combobox-input"><Search size={16} /><input role="combobox" aria-expanded={open} aria-controls="invoice-entity-results" value={query} placeholder="Search entity..." onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(0) }} onKeyDown={keyDown} /><button type="button" onClick={() => setOpen(value => !value)} aria-label="Toggle entities"><ChevronDown size={16} /></button></div>
    {open ? <div className="invoice-combobox-results" id="invoice-entity-results" role="listbox">
      {matches.length ? matches.map((entity, index) => <button type="button" role="option" aria-selected={selected?.id === entity.id} className={index === activeIndex ? 'is-active' : ''} key={entity.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(entity)}><span><b>{entity.invoice_id} · {entity.legal_entity_name}</b><small>{entity.gstin || entity.email || entity.pan || ''}</small></span>{selected?.id === entity.id ? <Check size={15} /> : null}</button>) : <div className="invoice-combobox-empty">No matching entities</div>}
    </div> : null}
  </div>
}

function GenerateModal({ entities, onClose, onGenerated }) {
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ ...EMPTY, invoice_date: today() })
  const [nextNumber, setNextNumber] = useState('')
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetchNextInvoiceNumber(form.billing_entity, form.invoice_date).then(data => { if (active) setNextNumber(data.invoiceNumber) }).catch(() => { if (active) setNextNumber('') })
    return () => { active = false }
  }, [form.billing_entity, form.invoice_date])
  const selectEntity = entity => {
    setSelected(entity)
    setResult(null)
    setForm(current => ({ ...EMPTY, ...entity, model: entity.model || EMPTY.model, invoice_entity_id: entity.id, invoice_date: current.invoice_date || today(), professional_fee_text: '' }))
  }
  const update = event => {
    const { name, value } = event.target
    setForm(current => LOCATION_FIELDS.has(name) ? autoGst({ ...current, [name]: value }) : { ...current, [name]: value })
  }
  const download = useCallback(payload => {
    if (!payload?.pdfBase64) return
    const bytes = Uint8Array.from(atob(payload.pdfBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url; link.download = payload.fileName || 'Invoice.pdf'; link.click()
    URL.revokeObjectURL(url)
  }, [])
  const generate = async () => {
    setSaving(true); setError('')
    try {
      if (!selected) throw new Error('Select an entity.')
      if (!form.invoice_date) throw new Error('Invoice Date is required.')
      if (!clean(form.professional_fee_text)) throw new Error('Professional Fee Text is required.')
      validateModel(form)
      const payload = await generateInvoicePdf({ ...form, invoice_entity_id: selected.id })
      setResult(payload); setNextNumber(payload.data.invoice_number); download(payload)
      await onGenerated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  const calc = calculate(form)
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">Generate Invoice</span><button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="modal-body">
      {error ? <div className="invoice-form-error">{error}</div> : null}
      <section className="invoice-form-section"><h3>1. Select Entity</h3><EntityCombobox entities={entities} selected={selected} onSelect={selectEntity} />{selected ? <div className="invoice-selected-chip"><Check size={14} /><span>{selected.invoice_id} · {selected.legal_entity_name}</span></div> : null}</section>
      {selected ? <><section className="invoice-form-section"><h3>2. Selected Entity Details</h3><div className="invoice-selected-preview">{[['Address', selected.address], ['PAN', selected.pan], ['GSTIN', selected.gstin], ['Contact Person', selected.contact_person], ['Email', selected.email], ['Default Model', MODEL_LABELS[selected.model] || '-']].map(([label, value]) => <span key={label}><small>{label}</small><b>{value || '-'}</b></span>)}</div></section>
      <section className="invoice-form-section"><h3>3. Invoice Details</h3><div className="form-grid-2">
        <Field label="Invoice Date"><input className="form-control" type="date" name="invoice_date" value={form.invoice_date} onChange={update} /></Field>
        <Field label="Invoice Number Preview"><input className="form-control" value={nextNumber || 'Auto-generated'} readOnly /></Field>
        <Field label="Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text} onChange={update} rows={3} /></Field>
        <ModelFields form={form} update={update} />
        <Field label="SAC"><input className="form-control" name="sac" value={form.sac || ''} onChange={update} /></Field>
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><AmountInput name="igst_rate" value={form.igst_rate} onChange={update} /></Field> : <><Field label="CGST Rate"><AmountInput name="cgst_rate" value={form.cgst_rate} onChange={update} /></Field><Field label="SGST Rate"><AmountInput name="sgst_rate" value={form.sgst_rate} onChange={update} /></Field></>}
      </div></section>
      <section className="invoice-form-section"><h3>4. Calculation Preview</h3><div className="invoice-preview"><span>Taxable Amount<b>{money(calc.taxable)}</b></span><span>IGST<b>{money(calc.igst)}</b></span><span>CGST<b>{money(calc.cgst)}</b></span><span>SGST<b>{money(calc.sgst)}</b></span><span>Total before rounding<b>{money(calc.before)}</b></span><span>Rounding<b>{calc.roundingType ? `${calc.roundingType} ${money(calc.rounding)}` : '₹0.00'}</b></span><span>Grand Total<b>{money(calc.grand)}</b></span></div></section></> : null}
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>{result ? <button className="btn-secondary" onClick={() => download(result)}><Download size={14} />Download PDF</button> : null}<button className="btn-primary" onClick={generate} disabled={saving || !selected}>{saving ? 'Generating...' : 'Generate PDF'}</button></div>
  </div></div>, document.body)
}

function amountDetails(entity) {
  if (entity.model === 'joining_flat_fee') return `Flat Fee: ${money(entity.model_flat_fee)}`
  if (entity.model === 'retainer') return `Retainer: ${money(entity.retainer_amount)}`
  if (entity.model === 'jra_adjustment_percentage') return `Adjustment: ${money(entity.jra_adjustment_value)}`
  if (entity.model === 'jra_adjustment_flat_fee') return `Value: ${money(entity.jra_base_value)} · Adjustment: ${money(entity.jra_flat_fee)}`
  if (entity.model === 'others') return `Amount: ${money(entity.others_amount)}`
  return '-'
}

export default function InvoicePage() {
  const { isAdmin, loading: adminLoading } = useAdminAccess({ loadPermissions: false, realtime: false })
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    setError('')
    try { setEntities((await fetchInvoiceEntities()).data || []) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    if (adminLoading) return
    if (!isAdmin) { Promise.resolve().then(() => setLoading(false)); return }
    Promise.resolve().then(() => load(true))
  }, [adminLoading, isAdmin, load])
  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim()
    return entities.filter(entity => !term || [...SEARCH_FIELDS, 'billing_entity', 'model'].some(field => String(entity[field] || '').toLowerCase().includes(term)))
  }, [entities, query])
  const closeEntityModal = () => { setAdding(false); setEditing(null) }
  const save = async form => {
    if (editing) await updateInvoiceEntity(editing.id, form)
    else await createInvoiceEntity(form)
    await load()
  }
  const remove = async entity => {
    if (!window.confirm(`Delete ${entity.invoice_id}?`)) return
    try { await deleteInvoiceEntity(entity.id); await load() } catch (err) { setError(err.message) }
  }
  if (adminLoading) return <div className="invoice-access-card"><InvoiceLoader label="Checking invoice access..." /></div>
  if (!isAdmin) return <div className="invoice-access-card"><div className="invoice-denied">Admin access required.</div></div>
  return <div className="invoice-page">
    <div className="candidate-page-header"><div><h2>Invoice</h2><p>Manage legal entities and generate FCS/FCAPL invoices.</p></div><div className="header-actions"><button className="btn-secondary" onClick={() => setGenerating(true)}><FileText size={15} />Generate Invoice</button><button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} />Add Entity</button></div></div>
    <div className="table-card invoice-table-card">
      <div className="invoice-card-toolbar"><div className="invoice-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search invoice entities..." /></div><span>{filtered.length} {filtered.length === 1 ? 'entity' : 'entities'}</span></div>
      {error ? <div className="invoice-table-error">{error}</div> : null}
      {loading ? <div className="invoice-table-loading"><InvoiceLoader label="Loading entities..." /><div className="invoice-skeleton">{[1, 2, 3].map(row => <span key={row} />)}</div></div> : <div className="table-scroll"><table className="data-table invoice-table"><thead><tr>{['Invoice ID', 'Legal Entity Name', 'Address', 'PAN', 'Place of Supply', 'State', 'State Code', 'GSTIN', 'Contact Person', 'Email', 'Model', 'CTC', 'Percent', 'Model Amounts', 'Billing Entity', 'SAC', 'GST Component', 'GST Rate(s)', 'Latest Invoice No.', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {filtered.map(entity => <tr key={entity.id}><td><span className="invoice-id">{entity.invoice_id}</span></td><td className="invoice-name">{entity.legal_entity_name}</td><td><span className="invoice-address" title={entity.address}>{entity.address}</span></td><td>{entity.pan || '-'}</td><td>{entity.place_of_supply || '-'}</td><td>{entity.state || '-'}</td><td>{entity.state_code || '-'}</td><td>{entity.gstin || '-'}</td><td>{entity.contact_person || '-'}</td><td>{entity.email || '-'}</td><td>{MODEL_LABELS[entity.model] || '-'}</td><td>{entity.ctc_lpa == null ? '-' : money(entity.ctc_lpa)}</td><td>{entity.model_percent == null ? '-' : `${n(entity.model_percent)}%`}</td><td>{amountDetails(entity)}</td><td><span className="invoice-badge is-navy">{entity.billing_entity}</span></td><td>{entity.sac}</td><td><span className="invoice-badge">{entity.gst_component}</span></td><td>{entity.gst_component === 'IGST' ? `${n(entity.igst_rate)}%` : `${n(entity.cgst_rate)}% + ${n(entity.sgst_rate)}%`}</td><td>{entity.latest_invoice_number || '-'}</td><td><div className="row-actions"><button className="row-action-btn" onClick={() => setEditing(entity)} aria-label={`Edit ${entity.legal_entity_name}`}><Pencil size={13} /></button><button className="row-action-btn" onClick={() => remove(entity)} aria-label={`Delete ${entity.legal_entity_name}`}><Trash2 size={13} /></button></div></td></tr>)}
        {!filtered.length ? <tr><td className="invoice-empty-cell" colSpan={20}><div className="invoice-empty">No invoice entities found.</div></td></tr> : null}
      </tbody></table></div>}
    </div>
    {(adding || editing) ? <EntityModal initial={editing} onClose={closeEntityModal} onSave={save} /> : null}
    {generating ? <GenerateModal entities={entities} onClose={() => setGenerating(false)} onGenerated={() => load()} /> : null}
  </div>
}
