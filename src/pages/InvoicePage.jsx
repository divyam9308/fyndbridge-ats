import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Download, FileClock, FileText, Pencil, Plus, ReceiptText, Save as SaveIcon, Search, Trash2, X } from 'lucide-react'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import ModelFields from '../components/InvoiceModelFields'
import ReportKpiCard from '../components/ReportKpiCard'
import {
  commitInvoicePreview, createInvoiceEntity, deleteInvoiceEntity, fetchInvoiceEntities,
  fetchNextInvoiceNumber, lookupGstin, previewInvoicePdf, updateInvoiceEntity
} from '../services/invoiceApi'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useInvoiceRowControls } from '../hooks/useInvoiceRowControls'
import { EMPTY_INVOICE, INVOICE_MODELS, INVOICE_TYPE_LABELS, calculateInvoicePreview, detectInvoiceGstComponent } from '../utils/invoiceModels'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import { formatInrPaise, invoiceMoneyValues } from '../utils/invoiceValues'
import '../styles/Shared.css'
import './DashboardHome.css'
import './InvoicePage.css'

const EMPTY_ENTITY = {
  billing_entity: 'FCS', legal_entity_name: '', optional_name: '-', address: '', gstin: '', pan: '', place_of_supply: '', state: '',
  state_code: '', contact_person: '', email: '', sac: '998512', gst_component: 'IGST', igst_rate: 18, cgst_rate: 9, sgst_rate: 9
}
const ENTITY_FIELDS = Object.keys(EMPTY_ENTITY)
const SEARCH_FIELDS = ['entity_display_id', 'invoice_id', 'legal_entity_name', 'optional_name', 'gstin', 'pan', 'contact_person', 'email', 'billing_entity']
const INVOICE_TABLE_HEADERS = ['Entity ID', 'Default Billing Entity', 'Legal Entity Name', 'Optional Name', 'Address', 'GSTIN', 'PAN', 'Place of Supply', 'State', 'State Code', 'Contact Person', 'Contact Email', 'SAC', 'GST Component', 'Rate', 'Actions']
const BILLING_ENTITIES = ['FCS', 'FCAPL']
const COMBINED_BILLING_ENTITY = 'FCS + FCAPL'
const BILLING_TOTAL_ROWS = [...BILLING_ENTITIES, COMBINED_BILLING_ENTITY]
const KPI_CARDS = [
  { key: 'billValue', label: 'Total Bill Value', tone: 'navy' },
  { key: 'taxValue', label: 'Total Tax Value', tone: 'amber' },
  { key: 'totalInvoiceValue', label: 'Total Invoice Value', tone: 'green' }
]
const POPUP_COLUMNS = [
  { key: 'iid', label: 'IID', width: 110 },
  { key: 'number', label: 'Invoice Number', width: 190 },
  { key: 'date', label: 'Invoice Date', width: 130 },
  { key: 'entity', label: 'Legal Entity Name', width: 270 },
  { key: 'bill', label: 'Bill Value', width: 155 },
  { key: 'tax', label: 'Tax Value', width: 150 },
  { key: 'total', label: 'Invoice Value', width: 170 },
  { key: 'invoice', label: 'Invoice', width: 150 },
  { key: 'action', label: 'Action', width: 140 }
]
const POPUP_TABLE_WIDTH = POPUP_COLUMNS.reduce((total, column) => total + column.width, 0)
const POPUP_TABLE_STYLE = { width: `${POPUP_TABLE_WIDTH}px`, minWidth: `${POPUP_TABLE_WIDTH}px` }
const EMPTY_INVOICE_TOTALS = Object.fromEntries(BILLING_ENTITIES.map(entity => [entity, {
  billValue: '0',
  taxValue: '0',
  totalInvoiceValue: '0'
}]))
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const number = value => Number(String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim() || 0)
const money = value => `₹${number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const display = value => String(value ?? '').trim() || '-'
const withAutoGst = form => ({ ...form, gst_component: detectInvoiceGstComponent(form) })

function Field({ label, children, full = false }) {
  return <div className={`form-group${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
}
function Input({ name, value, update, ...props }) {
  return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} />
}
function InvoiceTableSkeleton({ label }) {
  return (
    <div className="invoice-table-loading">
      <FyndbridgeLoader size={88} label={label} className="invoice-inline-loader" />
    </div>
  )
}

function InvoiceBillingTotals({ totals, loading = false, onSelect }) {
  const combinedTotals = Object.fromEntries(KPI_CARDS.map(card => [
    card.key,
    BILLING_ENTITIES.reduce((sum, billingEntity) => sum + BigInt(totals?.[billingEntity]?.[card.key] || 0), 0n)
  ]))
  const totalsByBillingEntity = { ...totals, [COMBINED_BILLING_ENTITY]: combinedTotals }

  return <section className="invoice-billing-totals" aria-label="Tax invoice totals by billing entity">
    {BILLING_TOTAL_ROWS.map(billingEntity => <div className="invoice-billing-total-row" key={billingEntity}>
      <button className="invoice-billing-total-entity" type="button" onClick={() => onSelect(billingEntity)} disabled={loading} aria-haspopup="dialog" aria-label={`View ${billingEntity} invoices`}><span>Billing Entity</span><strong>{billingEntity}</strong></button>
      <div className="invoice-kpi-grid" aria-label={`${billingEntity} tax invoice totals`}>
        {KPI_CARDS.map(card => <ReportKpiCard
          key={card.key}
          label={card.label}
          value={formatInrPaise(BigInt(totalsByBillingEntity?.[billingEntity]?.[card.key] || 0))}
          tone={card.tone}
          loading={loading}
        />)}
      </div>
    </div>)}
  </section>
}

function compareInvoiceIid(leftInvoice, rightInvoice) {
  const left = String(leftInvoice?.invoice_display_id || '').trim()
  const right = String(rightInvoice?.invoice_display_id || '').trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function InvoiceEntityInvoicesModal({ billingEntity, invoices, entities, onClose, onRefresh, onToast }) {
  const [controlError, setControlError] = useState('')
  const entityById = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities])
  const rowControls = useInvoiceRowControls({
    entities,
    onRefresh,
    onError: setControlError,
    onToast
  })
  const dialogRef = useDialogFocus(onClose, { closeDisabled: rowControls.dialogOpen })
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  const title = `${billingEntity} Invoices`
  const modal = <div className="ats-dashboard-modal-layer invoice-invoices-modal-layer" role="dialog" aria-modal="true" aria-labelledby="invoice-entity-popup-title">
    <div className="ats-dashboard-modal-backdrop" aria-hidden="true" />
    <section className="ats-dashboard-modal-card invoice-invoices-modal" ref={dialogRef} tabIndex={-1}>
      <header className="ats-dashboard-modal-head">
        <div className="ats-dashboard-title-left">
          <span className="ats-dashboard-title-icon gradient-primary shadow-pop"><FileText size={20} /></span>
          <span><h3 id="invoice-entity-popup-title">{title}</h3><p>{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</p></span>
        </div>
        <button type="button" className="ats-dashboard-modal-close" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button>
      </header>
      <div className="ats-dashboard-modal-body invoice-invoices-modal-body">
        {controlError && <div className="invoice-table-error" role="alert">{controlError}</div>}
        <div className="table-card invoice-popup-table-card">
          <div className="invoice-popup-table-scroll">
            <table className="data-table invoice-detail-table invoice-popup-table" style={POPUP_TABLE_STYLE}>
              <colgroup>{POPUP_COLUMNS.map(column => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
              <thead><tr>{POPUP_COLUMNS.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
              <tbody>
                {invoices.map(invoice => {
                  const entity = entityById.get(invoice.invoice_entity_id) || { id: invoice.invoice_entity_id }
                  const values = invoiceMoneyValues(invoice)
                  return <tr key={invoice.id}>
                    <td><span className="invoice-id">{display(invoice.invoice_display_id || invoice.invoice_number)}</span></td>
                    <td className="invoice-number-cell" title={invoice.invoice_number || ''}>{display(invoice.invoice_number)}</td>
                    <td>{formatDateDDMMYYYY(invoice.invoice_date)}</td>
                    <td className="invoice-wrap-cell" title={entity.legal_entity_name || ''}>{display(entity.legal_entity_name)}</td>
                    <td className="invoice-money-cell">{formatInrPaise(values.billValue)}</td>
                    <td className="invoice-money-cell">{formatInrPaise(values.taxValue)}</td>
                    <td className="invoice-money-cell invoice-total-cell">{formatInrPaise(values.totalInvoiceValue)}</td>
                    <td>{rowControls.renderInvoiceControl(invoice)}</td>
                    <td>{rowControls.renderActionControls(invoice, entity)}</td>
                  </tr>
                })}
                {!invoices.length && <tr><td className="invoice-empty-cell" colSpan={POPUP_COLUMNS.length}>No invoices found for {billingEntity}.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
    {rowControls.dialogs}
  </div>
  return createPortal(modal, document.body)
}

function InvoiceTypeChooser({ onClose, onSelect }) {
  const dialogRef = useDialogFocus(onClose)
  const options = [
    {
      type: 'tax_invoice',
      Icon: ReceiptText,
      description: 'Create the standard GST tax invoice using the selected entity and its billing series.'
    },
    {
      type: 'proforma_invoice',
      Icon: FileClock,
      description: 'Create a proforma invoice using the shared PI sequence across billing entities.'
    }
  ]
  return createPortal(<div className="modal-overlay invoice-type-overlay"><div className="modal-card invoice-type-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="invoice-type-title">
    <div className="modal-header"><div><span className="modal-title" id="invoice-type-title">Create Invoice</span><p>Choose the invoice type to continue.</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="Close invoice type chooser"><X size={16} /></button></div>
    <div className="modal-body invoice-type-grid">{options.map(({ type, Icon, description }) => <button className="invoice-type-card" type="button" key={type} onClick={() => onSelect(type)}>
      <span><Icon size={22} /></span>
      <strong>{INVOICE_TYPE_LABELS[type]}</strong>
      <p>{description}</p>
      <em><FileText size={14} />Continue to invoice form</em>
    </button>)}</div>
  </div></div>, document.body)
}

function EntityModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_ENTITY, ...initial, optional_name: initial?.optional_name || '-' }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const update = event => {
    const { name, value } = event.target
    setForm(current => ['address', 'state', 'state_code', 'place_of_supply'].includes(name) ? withAutoGst({ ...current, [name]: value }) : { ...current, [name]: value })
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
        <Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} disabled title="Derived from State Code, State, Place of Supply, and Address"><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} inputMode="decimal" /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} inputMode="decimal" /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} inputMode="decimal" /></Field></>}
      </div></section>
    </div><div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Entity'}</button></div>
  </div></div>, document.body)
}

function CreateInvoiceModal({ entities, invoiceType, onClose, onCreated }) {
  const [selectedId, setSelectedId] = useState('')
  const selected = entities.find(entity => entity.id === selectedId)
  const [form, setForm] = useState({ ...EMPTY_INVOICE, invoice_type: invoiceType, invoice_date: today() })
  const [nextNumber, setNextNumber] = useState('')
  const [nextNumberLoading, setNextNumberLoading] = useState(true)
  const [nextNumberFailed, setNextNumberFailed] = useState(false)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useDialogFocus(onClose, { closeDisabled: saving })
  const typeLabel = INVOICE_TYPE_LABELS[invoiceType]
  useEffect(() => {
    let active = true
    fetchNextInvoiceNumber(form.billing_entity || 'FCS', form.invoice_date || today(), invoiceType)
      .then(data => {
        if (!active) return
        setNextNumber(data.invoiceNumber)
        setNextNumberLoading(false)
      })
      .catch(() => {
        if (!active) return
        setNextNumberFailed(true)
        setNextNumberLoading(false)
      })
    return () => { active = false }
  }, [form.billing_entity, form.invoice_date, invoiceType, selectedId])
  const update = event => {
    const { name, value } = event.target
    setResult(null)
    if (name === 'billing_entity' || name === 'invoice_date') {
      setNextNumber('')
      setNextNumberLoading(true)
      setNextNumberFailed(false)
    }
    setForm(current => ({ ...current, [name]: value }))
  }
  const select = event => {
    const entity = entities.find(item => item.id === event.target.value)
    setSelectedId(event.target.value)
    setResult(null)
    setNextNumber('')
    setNextNumberLoading(true)
    setNextNumberFailed(false)
    if (entity) setForm(current => ({ ...current, billing_entity: entity.billing_entity || 'FCS', sac: entity.sac || '998512', gst_component: detectInvoiceGstComponent(entity), igst_rate: entity.igst_rate ?? 18, cgst_rate: entity.cgst_rate ?? 9, sgst_rate: entity.sgst_rate ?? 9 }))
  }
  const preview = async () => {
    if (!selected) return setError('Select an entity.')
    setSaving(true); setError('')
    try { setResult(await previewInvoicePdf({ ...form, invoice_type: invoiceType, invoice_entity_id: selected.id })) } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const create = async (download = false) => {
    setSaving(true); setError('')
    try {
      const saved = await commitInvoicePreview({ ...form, invoice_type: invoiceType, invoice_entity_id: selected.id, invoice_number: result.data.invoice_number })
      if (download) {
        const bytes = Uint8Array.from(atob(saved.pdfBase64), char => char.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        const link = document.createElement('a'); link.href = url; link.download = saved.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      await onCreated(saved.data); onClose()
    } catch (err) { setError(err.message); setSaving(false) }
  }
  const calc = calculateInvoicePreview(form)
  const nextNumberPreview = nextNumber || (nextNumberLoading ? 'Loading invoice number...' : nextNumberFailed ? 'Unable to load invoice number' : '')
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal invoice-generate-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="create-invoice-title">
    <div className="modal-header"><span className="modal-title" id="create-invoice-title">Create {typeLabel}</span><button className="modal-close" type="button" onClick={onClose} disabled={saving} aria-label={`Close Create ${typeLabel}`}><X size={16} /></button></div>
    <div className="modal-body">{error && <div className="invoice-form-error">{error}</div>}
      <section className="invoice-form-section"><h3>Select Entity</h3><select className="form-control" value={selectedId} onChange={select}><option value="" disabled hidden>Select Entity</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.entity_display_id || entity.invoice_id} - {display(entity.legal_entity_name)}</option>)}</select>{selected && <div className="invoice-selected-chip"><Check size={14} />{display(selected.legal_entity_name)}</div>}</section>
      <section className="invoice-form-section"><h3>{typeLabel} Details</h3><div className="form-grid-2">
        <Field label="Consultant Name"><Input name="consultant_name" value={form.consultant_name} update={update} /></Field><Field label="Candidate Name"><Input name="candidate_name" value={form.candidate_name} update={update} /></Field>
        <Field label="Invoice Date"><Input type="date" name="invoice_date" value={form.invoice_date} update={update} /></Field><Field label="Invoice Number Preview"><input className="form-control" value={nextNumberPreview} readOnly /></Field>
        <Field label="Billing Entity"><select className="form-control" name="billing_entity" value={form.billing_entity} onChange={update} disabled={invoiceType === 'proforma_invoice'} title={invoiceType === 'proforma_invoice' ? 'Automatically determined by the selected entity' : undefined}><option>FCS</option><option>FCAPL</option></select></Field>
        <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{INVOICE_MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text} onChange={update} rows={3} /></Field>
        <ModelFields form={form} update={update} />
        <Field label="SAC"><Input name="sac" value={form.sac} update={update} /></Field><Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} disabled title="Derived from the selected entity's place and state"><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
        {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} /></Field></>}
      </div></section>
      <section className="invoice-form-section"><h3>Calculation Preview</h3><div className="invoice-preview"><span>Taxable<b>{money(calc.taxable)}</b></span><span>IGST<b>{money(calc.igst)}</b></span><span>CGST<b>{money(calc.cgst)}</b></span><span>SGST<b>{money(calc.sgst)}</b></span><span>Grand Total<b>{money(calc.grand)}</b></span></div></section>
      {result && <section className="invoice-form-section"><h3>{typeLabel} Preview</h3><div className="invoice-selected-chip"><FileText size={14} />{result.data.invoice_number}</div><div className="invoice-pdf-preview"><iframe title={`${typeLabel} PDF preview`} src={`data:application/pdf;base64,${result.pdfBase64}`} /></div></section>}
    </div><div className="modal-footer"><button className="btn-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>{result ? <><button className="btn-secondary" type="button" onClick={() => create(false)} disabled={saving}><SaveIcon size={14} />Save</button><button className="btn-primary" type="button" onClick={() => create(true)} disabled={saving}><Download size={14} />Save and Download</button></> : <button className="btn-primary" type="button" onClick={preview} disabled={saving || !selected}>{saving ? 'Preparing...' : `Preview ${typeLabel}`}</button>}</div>
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
  const [invoices, setInvoices] = useState([])
  const [invoiceTotals, setInvoiceTotals] = useState(EMPTY_INVOICE_TOTALS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [choosingInvoiceType, setChoosingInvoiceType] = useState(false)
  const [creatingInvoiceType, setCreatingInvoiceType] = useState('')
  const [selectedEntityInvoiceView, setSelectedEntityInvoiceView] = useState('')
  const [invoiceToast, setInvoiceToast] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const result = await fetchInvoiceEntities()
      setEntities(result.data || [])
      setInvoices(result.invoices || [])
      setInvoiceTotals(result.totals || EMPTY_INVOICE_TOTALS)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { if (!adminLoading && isAdmin) Promise.resolve().then(load); else if (!adminLoading) Promise.resolve().then(() => setLoading(false)) }, [adminLoading, isAdmin, load])
  useEffect(() => {
    if (!invoiceToast) return undefined
    const timeout = window.setTimeout(() => setInvoiceToast(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [invoiceToast])
  const filtered = useMemo(() => { const term = query.toLowerCase().trim(); return entities.filter(entity => !term || SEARCH_FIELDS.some(field => String(entity[field] || '').toLowerCase().includes(term))) }, [entities, query])
  const popupInvoices = useMemo(() => {
    if (!selectedEntityInvoiceView) return []
    const selectedEntities = selectedEntityInvoiceView === COMBINED_BILLING_ENTITY
      ? new Set(BILLING_ENTITIES)
      : new Set([selectedEntityInvoiceView])
    const seen = new Set()
    return invoices
      .filter(invoice => invoice.invoice_type === 'tax_invoice' && invoice.status === 'active' && selectedEntities.has(invoice.billing_entity))
      .filter(invoice => {
        if (!invoice.id || seen.has(invoice.id)) return false
        seen.add(invoice.id)
        return true
      })
      .sort(compareInvoiceIid)
  }, [invoices, selectedEntityInvoiceView])
  const save = async form => { if (editing) await updateInvoiceEntity(editing.id, form); else await createInvoiceEntity(form); await load() }
  const remove = async entity => { if (!window.confirm(`Delete ${entity.entity_display_id || entity.invoice_id}?`)) return; try { await deleteInvoiceEntity(entity.id); await load() } catch (err) { setError(err.message) } }
  const canUseInvoice = !adminLoading && isAdmin
  return <div className="invoice-page">
    {invoiceToast && <div className="notice-toast is-visible invoice-toast invoice-popup-toast" role="status" aria-live="polite"><Check size={17} /><span>{invoiceToast}</span><button className="notice-toast-close" type="button" onClick={() => setInvoiceToast('')} aria-label="Close notification"><X size={14} /></button></div>}
    <div className={`header-actions${!canUseInvoice ? ' is-pending-access' : ''}`} aria-hidden={!canUseInvoice}>
      <button className="btn-secondary" onClick={() => setChoosingInvoiceType(true)} disabled={!canUseInvoice}><FileText size={15} />Create Invoice</button>
      <button className="btn-primary" onClick={() => setAdding(true)} disabled={!canUseInvoice}><Plus size={15} />Add Entity</button>
    </div>
    {canUseInvoice && <InvoiceBillingTotals totals={invoiceTotals} loading={loading} onSelect={setSelectedEntityInvoiceView} />}
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><div className="invoice-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search billing entities..." disabled={!canUseInvoice} /></div><span>{canUseInvoice ? `${filtered.length} ${filtered.length === 1 ? 'entity' : 'entities'}` : 'Access check'}</span></div>
      {error && canUseInvoice && <div className="invoice-table-error">{error}</div>}
      {adminLoading ? <InvoiceTableSkeleton label="Checking invoice access..." /> : !isAdmin ? <div className="invoice-access-panel"><div className="invoice-denied">Admin access required.</div></div> : loading ? <InvoiceTableSkeleton label="Loading entities..." /> : <div className="table-scroll"><table className="data-table invoice-table"><thead><tr>{INVOICE_TABLE_HEADERS.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {filtered.map(entity => <tr key={entity.id}><td><span className="invoice-id">{entity.entity_display_id || entity.invoice_id}</span></td><td><span className="invoice-badge is-navy">{display(entity.billing_entity)}</span></td><td><Link className="invoice-name-link" to={`/invoice/entities/${entity.id}`}><b>{display(entity.legal_entity_name)}</b></Link></td><td>{display(entity.optional_name)}</td><td><span className="invoice-address" title={entity.address || ''}>{display(entity.address)}</span></td><td>{display(entity.gstin)}</td><td>{display(entity.pan)}</td><td>{display(entity.place_of_supply)}</td><td>{display(entity.state)}</td><td>{display(entity.state_code)}</td><td>{display(entity.contact_person)}</td><td>{display(entity.email)}</td><td>{display(entity.sac)}</td><td><span className="invoice-badge">{display(entity.gst_component === 'CGST_SGST' ? 'CGST + SGST' : entity.gst_component)}</span></td><td>{rate(entity)}</td><td><div className="row-actions"><button className="row-action-btn" onClick={() => setEditing(entity)} aria-label="Edit entity"><Pencil size={13} /></button><button className="row-action-btn" onClick={() => remove(entity)} aria-label="Delete entity"><Trash2 size={13} /></button></div></td></tr>)}
        {!filtered.length && <tr><td className="invoice-empty-cell" colSpan={16}>No billing entities found.</td></tr>}
      </tbody></table></div>}
    </div>
    {(adding || editing) && <EntityModal initial={editing} onClose={() => { setAdding(false); setEditing(null) }} onSave={save} />}
    {choosingInvoiceType && <InvoiceTypeChooser onClose={() => setChoosingInvoiceType(false)} onSelect={type => { setChoosingInvoiceType(false); setCreatingInvoiceType(type) }} />}
    {creatingInvoiceType && <CreateInvoiceModal key={creatingInvoiceType} entities={entities} invoiceType={creatingInvoiceType} onClose={() => setCreatingInvoiceType('')} onCreated={load} />}
    {selectedEntityInvoiceView && <InvoiceEntityInvoicesModal billingEntity={selectedEntityInvoiceView} invoices={popupInvoices} entities={entities} onClose={() => setSelectedEntityInvoiceView('')} onRefresh={load} onToast={setInvoiceToast} />}
  </div>
}
