import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, CircleX, Download, FileClock, FileText, LoaderCircle, Pencil, ReceiptText, Trash2, X } from 'lucide-react'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import ReportKpiCard from '../components/ReportKpiCard'
import {
  cancelInvoice as cancelInvoiceRequest,
  deleteInvoicePdfVersion,
  fetchInvoiceEntities,
  fetchInvoiceEntity,
  fetchReassignedInvoiceNumber,
  previewRegeneratedInvoice,
  regenerateInvoice
} from '../services/invoiceApi'
import { isValidStoragePath, openProtectedDocumentPath } from '../services/apiClient'
import { ModelFields } from './InvoicePage'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { EMPTY_INVOICE, INVOICE_MODEL_LABELS, INVOICE_MODELS, INVOICE_TYPE_LABELS, calculateInvoicePreview, detectInvoiceGstComponent } from '../utils/invoiceModels'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import {
  aggregateInvoiceValues,
  formatInrPaise,
  formatInvoiceMoney,
  formatInvoicePercentage,
  invoiceMoneyValues
} from '../utils/invoiceValues'
import '../styles/Shared.css'
import './InvoicePage.css'

const show = value => String(value ?? '').trim() || '—'
const number = value => Number(value || 0)
const money = formatInvoiceMoney
const moneyOrDash = value => value === null || value === undefined || String(value).trim() === '' ? '—' : money(value)
function Field({ label, children, full = false }) { return <div className={`form-group${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div> }
function Input({ name, value, update, ...props }) { return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} /> }

const KPI_CARDS = [
  { key: 'billValue', label: 'Total Bill Value', tone: 'navy' },
  { key: 'taxValue', label: 'Total Tax Value', tone: 'amber' },
  { key: 'totalInvoiceValue', label: 'Total Invoice Value', tone: 'green' }
]

const DETAIL_COLUMNS = [
  { key: 'displayId', label: 'Invoice ID', width: 120 },
  { key: 'number', label: 'Invoice Number', width: 190 },
  { key: 'date', label: 'Invoice Date', width: 130 },
  { key: 'status', label: 'Status', width: 120 },
  { key: 'consultant', label: 'Consultant Name', width: 220 },
  { key: 'candidate', label: 'Candidate Name', width: 220 },
  { key: 'model', label: 'Model', width: 180 },
  { key: 'ctc', label: 'CTC', width: 145 },
  { key: 'percentage', label: 'Percentage', width: 125 },
  { key: 'flatFee', label: 'Flat Fee', width: 155 },
  { key: 'retainer', label: 'Retainer Amount', width: 155 },
  { key: 'project', label: 'Project Amount', width: 155 },
  { key: 'jraAdjustment', label: 'JRA Adjustment', width: 155 },
  { key: 'jraBase', label: 'JRA Base Value', width: 155 },
  { key: 'jraFlatFee', label: 'JRA Flat Fee', width: 155 },
  { key: 'other', label: 'Other Amount', width: 155 },
  { key: 'bill', label: 'Bill Value', width: 160 },
  { key: 'tax', label: 'Tax Value', width: 150 },
  { key: 'total', label: 'Total Invoice Value', width: 190 },
  { key: 'invoice', label: 'Invoice', width: 130 },
  { key: 'actions', label: 'Actions', width: 150 }
]
const DETAIL_TABLE_WIDTH = DETAIL_COLUMNS.reduce((total, column) => total + column.width, 0)
const DETAIL_TABLE_STYLE = { width: `${DETAIL_TABLE_WIDTH}px`, minWidth: `${DETAIL_TABLE_WIDTH}px` }
const PROFORMA_DETAIL_COLUMNS = DETAIL_COLUMNS.filter(column => !['bill', 'tax', 'total'].includes(column.key))
const PROFORMA_TABLE_WIDTH = PROFORMA_DETAIL_COLUMNS.reduce((total, column) => total + column.width, 0)
const PROFORMA_TABLE_STYLE = { width: `${PROFORMA_TABLE_WIDTH}px`, minWidth: `${PROFORMA_TABLE_WIDTH}px` }

function InvoiceKpis({ totals, loading = false }) {
  return <section className="invoice-kpi-grid" aria-label="Invoice totals">{KPI_CARDS.map(card => <ReportKpiCard key={card.key} label={card.label} value={formatInrPaise(totals?.[card.key] || 0n)} tone={card.tone} loading={loading} />)}</section>
}

function InvoiceActionDialog({ action, busy, error, onClose, onConfirm }) {
  const dialogRef = useDialogFocus(onClose, { closeDisabled: busy })
  const invoiceNumber = show(action.invoice.invoice_number)
  return createPortal(<div className="modal-overlay invoice-confirm-overlay"><div className="modal-card invoice-confirm-modal" ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="invoice-action-title" aria-describedby="invoice-action-description">
    <div className="modal-header"><div><span className="modal-title" id="invoice-action-title">Cancel invoice?</span><p>{invoiceNumber}</p></div><button className="modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close confirmation"><X size={16} /></button></div>
    <div className="modal-body">
      <p className="invoice-confirm-copy" id="invoice-action-description">The invoice will remain visible with its original number, values, and PDF history, but it will be excluded from all aggregate totals.</p>
      <ul className="invoice-confirm-list"><li>The invoice number remains permanently consumed.</li><li>The next invoice will continue with the next available number.</li><li>Cancelled invoices cannot be edited or have PDF versions removed.</li></ul>
      {error && <div className="invoice-form-error" role="alert">{error}</div>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>Keep invoice</button><button className="invoice-cancel-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="invoice-button-spin" size={15} /> : <CircleX size={15} />}{busy ? 'Cancelling…' : 'Cancel Invoice'}</button></div>
  </div></div>, document.body)
}

function InvoiceDetailLoading() {
  return <div className="invoice-page invoice-entity-details">
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>Loading invoice history…</p></div></div>
    <FyndbridgeLoader size={88} label="Loading invoices..." className="invoice-page-loader" />
  </div>
}

function InvoiceTableLoading({ label }) {
  return <div className="invoice-detail-table-loading"><FyndbridgeLoader size={76} label={label} className="invoice-inline-loader" /></div>
}

function EditInvoiceModal({ invoice, entity, entities, onClose, onSaved }) {
  const availableEntities = entities.length ? entities : [entity]
  const initialEntityId = invoice.invoice_entity_id || entity.id
  const initialSelectedEntity = availableEntities.find(item => item.id === initialEntityId) || entity
  const [form, setForm] = useState({
    ...EMPTY_INVOICE,
    ...invoice,
    invoice_entity_id: initialEntityId,
    billing_entity: initialSelectedEntity.billing_entity || 'FCS',
    sac: initialSelectedEntity.sac || '998512',
    gst_component: detectInvoiceGstComponent(initialSelectedEntity),
    igst_rate: initialSelectedEntity.igst_rate ?? 18,
    cgst_rate: initialSelectedEntity.cgst_rate ?? 9,
    sgst_rate: initialSelectedEntity.sgst_rate ?? 9
  })
  const [invoiceNumberPreview, setInvoiceNumberPreview] = useState(invoice.invoice_number)
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true)
  const [invoiceNumberFailed, setInvoiceNumberFailed] = useState(false)
  const [preview, setPreview] = useState(null)
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useDialogFocus(onClose, { closeDisabled: saving })
  const typeLabel = INVOICE_TYPE_LABELS[invoice.invoice_type] || INVOICE_TYPE_LABELS.tax_invoice
  const selectedEntity = availableEntities.find(item => item.id === form.invoice_entity_id) || entity
  useEffect(() => {
    let active = true
    fetchReassignedInvoiceNumber(invoice.id, form.invoice_entity_id, form.invoice_date)
      .then(result => {
        if (!active) return
        setInvoiceNumberPreview(result.invoiceNumber)
        setInvoiceNumberLoading(false)
      })
      .catch(() => {
        if (!active) return
        setInvoiceNumberPreview('')
        setInvoiceNumberFailed(true)
        setInvoiceNumberLoading(false)
      })
    return () => { active = false }
  }, [form.invoice_date, form.invoice_entity_id, invoice.id])
  const update = event => {
    const { name, value } = event.target
    setPreview(null); setSaved(null)
    if (name === 'invoice_date') {
      setInvoiceNumberPreview('')
      setInvoiceNumberLoading(true)
      setInvoiceNumberFailed(false)
    }
    setForm(current => ({ ...current, [name]: value }))
  }
  const selectEntity = event => {
    const nextEntity = availableEntities.find(item => item.id === event.target.value)
    setPreview(null); setSaved(null)
    if (!nextEntity) return
    setInvoiceNumberPreview('')
    setInvoiceNumberLoading(true)
    setInvoiceNumberFailed(false)
    setForm(current => ({
      ...current,
      invoice_entity_id: nextEntity.id,
      billing_entity: nextEntity.billing_entity || 'FCS',
      sac: nextEntity.sac || '998512',
      gst_component: detectInvoiceGstComponent(nextEntity),
      igst_rate: nextEntity.igst_rate ?? 18,
      cgst_rate: nextEntity.cgst_rate ?? 9,
      sgst_rate: nextEntity.sgst_rate ?? 9
    }))
  }
  const generatePreview = async () => {
    setSaving(true); setError('')
    try {
      const result = await previewRegeneratedInvoice(invoice.id, {
        ...form,
        invoice_type: invoice.invoice_type,
        expected_invoice_number: invoiceNumberPreview || undefined
      })
      setInvoiceNumberPreview(result.data.invoice_number)
      setPreview(result)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const saveRegenerated = async () => {
    setSaving(true); setError('')
    try {
      const result = await regenerateInvoice(invoice.id, {
        ...form,
        invoice_type: invoice.invoice_type,
        expected_invoice_number: preview.data.invoice_number
      })
      setInvoiceNumberPreview(result.data.invoice_number)
      setSaved(result)
      await onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const downloadRegenerated = () => {
    if (!saved?.pdfBase64) return
    const bytes = Uint8Array.from(atob(saved.pdfBase64), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const link = document.createElement('a'); link.href = url; link.download = saved.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const calc = calculateInvoicePreview(form)
  const displayedInvoiceNumber = invoiceNumberPreview || (invoiceNumberLoading
    ? 'Loading invoice number...'
    : invoiceNumberFailed ? 'Unable to load invoice number' : '')
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal invoice-generate-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edit-invoice-title">
    <div className="modal-header"><span className="modal-title" id="edit-invoice-title">Edit {typeLabel} {invoice.invoice_display_id}</span><button className="modal-close" type="button" onClick={onClose} disabled={saving} aria-label={`Close Edit ${typeLabel}`}><X size={16} /></button></div>
    <div className="modal-body">{error && <div className="invoice-form-error">{error}</div>}
    <section className="invoice-form-section"><h3>Select Entity</h3><select className="form-control" value={form.invoice_entity_id} onChange={selectEntity}>{availableEntities.map(item => <option key={item.id} value={item.id}>{item.entity_display_id || item.invoice_id} - {show(item.legal_entity_name)}</option>)}</select>{selectedEntity && <><div className="invoice-selected-chip"><CheckCircle2 size={14} />{show(selectedEntity.legal_entity_name)}</div><div className="invoice-selected-entity-details">{[
      ['Billing Entity', selectedEntity.billing_entity],
      ['GSTIN', selectedEntity.gstin],
      ['PAN', selectedEntity.pan],
      ['Place of Supply', selectedEntity.place_of_supply],
      ['State', [selectedEntity.state, selectedEntity.state_code].filter(Boolean).join(' · ')],
      ['Address', selectedEntity.address],
      ['SAC', selectedEntity.sac || '998512'],
      ['Contact', [selectedEntity.contact_person, selectedEntity.email].filter(Boolean).join(' · ')]
    ].map(([label, value]) => <span key={label}><small>{label}</small><b>{show(value)}</b></span>)}</div></>}</section>
    <section className="invoice-form-section"><h3>{typeLabel} Details</h3><div className="form-grid-2">
      <Field label="Consultant Name"><Input name="consultant_name" value={form.consultant_name} update={update} /></Field><Field label="Candidate Name"><Input name="candidate_name" value={form.candidate_name} update={update} /></Field>
      <Field label="Invoice Number"><input className="form-control" value={displayedInvoiceNumber} readOnly /></Field><Field label="Invoice Date"><Input type="date" name="invoice_date" value={form.invoice_date} update={update} /></Field>
      <Field label="Billing Entity"><input className="form-control" value={form.billing_entity} readOnly /></Field>
      <Field label="Model"><select className="form-control" name="model" value={form.model} onChange={update}>{INVOICE_MODELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Professional Fee Text" full><textarea className="form-control" name="professional_fee_text" value={form.professional_fee_text || ''} onChange={update} rows={3} /></Field>
      <ModelFields form={form} update={update} />
      <Field label="SAC"><Input name="sac" value={form.sac} update={update} /></Field><Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} disabled title="Derived from the entity's place and state"><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
      {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} /></Field></>}
    </div></section><section className="invoice-form-section"><h3>Updated Total</h3><div className="invoice-preview"><span>Taxable<b>{money(calc.taxable)}</b></span><span>Grand Total<b>{money(calc.grand)}</b></span></div></section>
    {(saved || preview) && <section className="invoice-form-section"><h3>{saved ? 'Regenerated Invoice Saved' : 'Regenerated Invoice Preview'}</h3><div className="invoice-pdf-preview"><iframe title="Regenerated invoice preview" src={`data:application/pdf;base64,${(saved || preview).pdfBase64}`} /></div></section>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Close</button>{saved ? <button className="btn-primary" onClick={downloadRegenerated}><Download size={14} />Download Regenerated Invoice</button> : preview ? <button className="btn-primary" onClick={saveRegenerated} disabled={saving}>{saving ? 'Saving...' : 'Save Regenerated Invoice'}</button> : <button className="btn-primary" onClick={generatePreview} disabled={saving}>{saving ? 'Preparing...' : 'Regenerate Preview'}</button>}</div>
  </div></div>, document.body)
}

export default function InvoiceEntityDetailPage() {
  const { entityId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const invoiceType = searchParams.get('type') === 'proforma' ? 'proforma_invoice' : 'tax_invoice'
  const [data, setData] = useState(null)
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [opening, setOpening] = useState('')
  const [deletingVersion, setDeletingVersion] = useState('')
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [pendingAction, setPendingAction] = useState(null)
  const [toast, setToast] = useState('')
  const requestRef = useRef(0)
  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true); setError('')
    try {
      const [result, entityList] = await Promise.all([
        fetchInvoiceEntity(entityId, invoiceType),
        fetchInvoiceEntities()
      ])
      if (requestId === requestRef.current) {
        setData({ ...result.data, invoiceType })
        setEntities(entityList.data || [])
      }
    } catch (err) {
      if (requestId === requestRef.current) setError(err.message)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [entityId, invoiceType])
  useEffect(() => {
    Promise.resolve().then(() => {
      setEditing(null); setAction(null); setActionError('')
      load()
    })
    return () => { requestRef.current += 1 }
  }, [load])
  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])
  const currentData = data?.invoiceType === invoiceType ? data : null
  const invoices = useMemo(() => currentData?.invoices || [], [currentData?.invoices])
  const totals = useMemo(() => aggregateInvoiceValues(invoices), [invoices])
  const openInvoice = async invoice => {
    const path = invoice.storage_path || invoice.pdf_storage_path
    if (!isValidStoragePath(path)) return setError('Stored invoice PDF is missing.')
    setOpening(invoice.id)
    try {
      await openProtectedDocumentPath('invoice', path, {
        missingMessage: 'Invoice PDF is missing or needs to be reuploaded',
        notFoundMessage: 'Invoice PDF not found.'
      })
    } finally { setOpening('') }
  }
  const deleteVersion = async (invoice, version, versionNumber) => {
    if (deletingVersion) return
    if (!window.confirm(`Delete PDF version v${versionNumber} for ${invoice.invoice_number}?`)) return
    setDeletingVersion(version.id); setError('')
    try {
      await deleteInvoicePdfVersion(version.id)
      setToast(`PDF version v${versionNumber} was deleted. The invoice remains available.`)
      await load()
    } catch (err) { setError(err.message) } finally { setDeletingVersion('') }
  }
  const openAction = invoice => { setActionError(''); setAction({ invoice }) }
  const closeAction = () => { if (!pendingAction) { setAction(null); setActionError('') } }
  const confirmAction = async () => {
    if (!action || pendingAction) return
    const pending = { id: action.invoice.id }
    setPendingAction(pending); setActionError(''); setError('')
    try {
      const result = await cancelInvoiceRequest(entityId, action.invoice.id, action.invoice.invoice_type)
      setData(current => ({
        ...current,
        invoices: current.invoices.map(invoice => invoice.id === action.invoice.id
          ? { ...invoice, ...result.data, pdf_versions: invoice.pdf_versions || [] }
          : invoice)
      }))
      setToast(`${action.invoice.invoice_number} was cancelled. Its number remains consumed.`)
      setAction(null)
    } catch (err) { setActionError(err.message) } finally { setPendingAction(null) }
  }
  if (loading && !data) return <InvoiceDetailLoading />
  if (error && !data) return <div className="invoice-access-card"><div className="invoice-denied">{error}</div></div>
  const entity = data.entity
  const optionalValue = String(entity.optional_name ?? '').trim()
  const optionalName = optionalValue && optionalValue !== '-' ? optionalValue : ''
  const rate = entity.gst_component === 'IGST' ? `IGST ${number(entity.igst_rate)}%` : `CGST ${number(entity.cgst_rate)}% + SGST ${number(entity.sgst_rate)}%`
  const columns = invoiceType === 'proforma_invoice' ? PROFORMA_DETAIL_COLUMNS : DETAIL_COLUMNS
  const tableStyle = invoiceType === 'proforma_invoice' ? PROFORMA_TABLE_STYLE : DETAIL_TABLE_STYLE
  const typeLabel = INVOICE_TYPE_LABELS[invoiceType]
  const typeLoading = loading || !currentData
  const selectInvoiceType = type => setSearchParams({ type: type === 'proforma_invoice' ? 'proforma' : 'tax' })
  return <div className="invoice-page invoice-entity-details">
    {toast && <div className="notice-toast is-visible invoice-toast" role="status" aria-live="polite"><CheckCircle2 size={17} /><span>{toast}</span><button className="notice-toast-close" type="button" onClick={() => setToast('')} aria-label="Close notification"><X size={14} /></button></div>}
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>{entity.entity_display_id || entity.invoice_id}</p></div></div>
    {error && <div className="invoice-table-error">{error}</div>}
    <section className="invoice-entity-summary"><div><span className="invoice-id">{entity.entity_display_id || entity.invoice_id}</span><h3>{show(entity.legal_entity_name)}</h3>{optionalName && <p>{optionalName}</p>}</div><div className="invoice-entity-summary-grid">{[['GSTIN', entity.gstin], ['PAN', entity.pan], ['Address', entity.address], ['Contact Person', entity.contact_person], ['Contact Email', entity.email], ['GST Component', entity.gst_component === 'CGST_SGST' ? 'CGST + SGST' : entity.gst_component], ['Rate', rate]].map(([label, value]) => <span key={label}><small>{label}</small><b>{show(value)}</b></span>)}</div></section>
    <nav className="invoice-type-switcher" aria-label="Invoice type">
      <button className={invoiceType === 'tax_invoice' ? 'is-active' : ''} type="button" onClick={() => selectInvoiceType('tax_invoice')} aria-current={invoiceType === 'tax_invoice' ? 'page' : undefined}><ReceiptText size={17} />Tax Invoice</button>
      <button className={invoiceType === 'proforma_invoice' ? 'is-active' : ''} type="button" onClick={() => selectInvoiceType('proforma_invoice')} aria-current={invoiceType === 'proforma_invoice' ? 'page' : undefined}><FileClock size={17} />Proforma Invoice</button>
    </nav>
    {invoiceType === 'tax_invoice' && <InvoiceKpis totals={totals} loading={typeLoading} />}
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><strong>{typeLabel}s</strong><span>{typeLoading ? 'Loading…' : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}</span></div>{typeLoading ? <InvoiceTableLoading label={`Loading ${typeLabel.toLowerCase()}s...`} /> : <div className="table-scroll"><table className="data-table invoice-detail-table" style={tableStyle}><colgroup>{columns.map(column => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
      {invoices.map(invoice => {
        const cancelled = invoice.status === 'cancelled'
        const values = invoiceMoneyValues(invoice)
        const rowBusy = pendingAction?.id === invoice.id
        return <tr className={cancelled ? 'is-cancelled' : ''} key={invoice.id}>
          <td><span className="invoice-id">{invoice.invoice_display_id || invoice.invoice_number}</span></td>
          <td className="invoice-number-cell" title={invoice.invoice_number}>{show(invoice.invoice_number)}</td>
          <td>{formatDateDDMMYYYY(invoice.invoice_date)}</td>
          <td><span className={`invoice-status-badge is-${cancelled ? 'cancelled' : 'active'}`}>{cancelled ? 'Cancelled' : 'Active'}</span></td>
          <td className="invoice-wrap-cell" title={show(invoice.consultant_name)}>{show(invoice.consultant_name)}</td>
          <td className="invoice-wrap-cell" title={show(invoice.candidate_name)}>{show(invoice.candidate_name)}</td>
          <td className="invoice-wrap-cell" title={INVOICE_MODEL_LABELS[invoice.model] || show(invoice.model)}>{INVOICE_MODEL_LABELS[invoice.model] || show(invoice.model)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.ctc_lpa)}</td>
          <td className="invoice-number-value">{formatInvoicePercentage(invoice.model_percent)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.model_flat_fee)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.retainer_amount)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.project_amount)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_adjustment_value)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_base_value)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_flat_fee)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.others_amount)}</td>
          {invoiceType === 'tax_invoice' && <><td className="invoice-money-cell">{formatInrPaise(values.billValue)}</td>
          <td className="invoice-money-cell">{formatInrPaise(values.taxValue)}</td>
          <td className="invoice-money-cell invoice-total-cell">{formatInrPaise(values.totalInvoiceValue)}</td></>}
          <td><div className="invoice-version-list">{(invoice.pdf_versions || []).map((version, index) => {
            const versionNumber = invoice.pdf_versions.length - index
            return <span className="invoice-version" key={version.id}><button className="invoice-document-button" type="button" onClick={() => openInvoice(version)} disabled={deletingVersion === version.id} title={`Open PDF version ${versionNumber}`} aria-label={`Open PDF version ${versionNumber}`}>{opening === version.id ? <LoaderCircle className="invoice-button-spin" size={16} /> : <FileText size={16} />}<small>v{versionNumber}</small></button>{!cancelled && <button className="invoice-version-delete" type="button" onClick={() => deleteVersion(invoice, version, versionNumber)} disabled={Boolean(deletingVersion)} title={`Delete PDF version ${versionNumber}`} aria-label={`Delete PDF version ${versionNumber}`}>{deletingVersion === version.id ? <LoaderCircle className="invoice-button-spin" size={11} /> : <Trash2 size={11} />}</button>}</span>
          })}{!invoice.pdf_versions?.length ? '—' : null}</div></td>
          <td><div className="row-actions invoice-row-actions">
            <button className="row-action-btn" type="button" onClick={() => setEditing(invoice)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'} title={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'}><Pencil size={14} /></button>
            <button className="row-action-btn invoice-cancel-action" type="button" onClick={() => openAction(invoice)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'} title={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'}>{rowBusy ? <LoaderCircle className="invoice-button-spin" size={14} /> : <CircleX size={14} />}</button>
          </div></td>
        </tr>
      })}
      {!invoices.length && <tr><td className="invoice-empty-cell" colSpan={columns.length}>No {typeLabel.toLowerCase()}s found for this entity.</td></tr>}
    </tbody></table></div>}</div>
    {editing && <EditInvoiceModal invoice={editing} entity={entity} entities={entities} onClose={() => setEditing(null)} onSaved={load} />}
    {action && <InvoiceActionDialog action={action} busy={Boolean(pendingAction)} error={actionError} onClose={closeAction} onConfirm={confirmAction} />}
  </div>
}
