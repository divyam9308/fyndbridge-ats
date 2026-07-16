import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, CircleX, Download, FileText, LoaderCircle, Pencil, Trash2, X } from 'lucide-react'
import ReportKpiCard from '../components/ReportKpiCard'
import {
  cancelInvoice as cancelInvoiceRequest,
  deleteInvoice as deleteInvoiceRequest,
  deleteInvoicePdfVersion,
  fetchInvoiceEntity,
  previewRegeneratedInvoice,
  regenerateInvoice
} from '../services/invoiceApi'
import { isValidStoragePath, openProtectedDocumentPath } from '../services/apiClient'
import { ModelFields } from './InvoicePage'
import { EMPTY_INVOICE, INVOICE_MODEL_LABELS, INVOICE_MODELS, calculateInvoicePreview, detectInvoiceGstComponent } from '../utils/invoiceModels'
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

const DETAIL_HEADERS = [
  'Invoice ID',
  'Invoice Number',
  'Invoice Date',
  'Status',
  'Consultant Name',
  'Candidate Name',
  'Model',
  'CTC',
  'Percentage',
  'Flat Fee',
  'Retainer Amount',
  'Project Amount',
  'JRA Adjustment',
  'JRA Base Value',
  'JRA Flat Fee',
  'Other Amount',
  'Bill Value',
  'Tax Value',
  'Total Invoice Value',
  'Invoice',
  'Actions'
]

function InvoiceKpis({ totals, loading = false }) {
  return <section className="invoice-kpi-grid" aria-label="Invoice totals">{KPI_CARDS.map(card => <ReportKpiCard key={card.key} label={card.label} value={formatInrPaise(totals?.[card.key] || 0n)} tone={card.tone} loading={loading} />)}</section>
}

function InvoiceActionDialog({ action, busy, error, onClose, onConfirm }) {
  if (!action) return null
  const deleting = action.type === 'delete'
  const invoiceNumber = show(action.invoice.invoice_number)
  return createPortal(<div className="modal-overlay invoice-confirm-overlay"><div className="modal-card invoice-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="invoice-action-title" aria-describedby="invoice-action-description">
    <div className="modal-header"><div><span className="modal-title" id="invoice-action-title">{deleting ? 'Delete invoice permanently?' : 'Cancel invoice?'}</span><p>{invoiceNumber}</p></div><button className="modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close confirmation"><X size={16} /></button></div>
    <div className="modal-body">
      <p className="invoice-confirm-copy" id="invoice-action-description">{deleting
        ? 'This permanently removes the invoice record and every stored PDF version. The released sequence number may be used by the next invoice in this same billing-entity and financial-year series.'
        : 'The invoice will remain visible with its original number, values, and PDF history, but it will be excluded from all aggregate totals.'}</p>
      <ul className={`invoice-confirm-list${deleting ? ' is-destructive' : ''}`}>
        {deleting ? <><li>This action cannot be undone.</li><li>Existing invoice numbers will not be renumbered.</li><li>Candidate, consultant, client, mandate, and entity records are not affected.</li></> : <><li>The invoice number remains permanently consumed.</li><li>The next invoice will continue with the next available number.</li><li>Cancelled invoices cannot be edited or have PDF versions removed.</li></>}
      </ul>
      {error && <div className="invoice-form-error" role="alert">{error}</div>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>Keep invoice</button><button className={deleting ? 'invoice-danger-button' : 'invoice-cancel-button'} type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="invoice-button-spin" size={15} /> : deleting ? <Trash2 size={15} /> : <CircleX size={15} />}{busy ? deleting ? 'Deleting…' : 'Cancelling…' : deleting ? 'Delete Invoice' : 'Cancel Invoice'}</button></div>
  </div></div>, document.body)
}

function InvoiceDetailLoading() {
  return <div className="invoice-page invoice-entity-details">
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>Loading invoice history…</p></div></div>
    <div className="invoice-entity-summary invoice-entity-summary-loading"><div className="invoice-skeleton"><span /><span /></div></div>
    <InvoiceKpis totals={null} loading />
    <div className="table-card invoice-table-card"><div className="invoice-table-loading"><div className="invoice-loader"><LoaderCircle size={22} /><span>Loading invoices…</span></div><div className="invoice-skeleton"><span /><span /><span /></div></div></div>
  </div>
}

function EditInvoiceModal({ invoice, entity, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_INVOICE, ...invoice, gst_component: detectInvoiceGstComponent(entity) })
  const [preview, setPreview] = useState(null)
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = event => { const { name, value } = event.target; setPreview(null); setSaved(null); setForm(current => ({ ...current, [name]: value })) }
  const generatePreview = async () => {
    setSaving(true); setError('')
    try { setPreview(await previewRegeneratedInvoice(invoice.id, form)) } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const saveRegenerated = async () => {
    setSaving(true); setError('')
    try { const result = await regenerateInvoice(invoice.id, form); setSaved(result); await onSaved() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const downloadRegenerated = () => {
    if (!saved?.pdfBase64) return
    const bytes = Uint8Array.from(atob(saved.pdfBase64), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const link = document.createElement('a'); link.href = url; link.download = saved.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const calc = calculateInvoicePreview(form)
  return createPortal(<div className="modal-overlay"><div className="modal-card modal-card-lg invoice-modal invoice-generate-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><span className="modal-title">Edit Invoice {invoice.invoice_display_id}</span><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
    <div className="modal-body">{error && <div className="invoice-form-error">{error}</div>}<section className="invoice-form-section"><h3>Invoice Details</h3><div className="form-grid-2">
      <Field label="Consultant Name"><Input name="consultant_name" value={form.consultant_name} update={update} /></Field><Field label="Candidate Name"><Input name="candidate_name" value={form.candidate_name} update={update} /></Field>
      <Field label="Invoice Number"><input className="form-control" value={invoice.invoice_number} readOnly /></Field><Field label="Invoice Date"><Input type="date" name="invoice_date" value={form.invoice_date} update={update} /></Field>
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [opening, setOpening] = useState('')
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [pendingAction, setPendingAction] = useState(null)
  const [toast, setToast] = useState('')
  const load = useCallback(async () => { setError(''); try { setData((await fetchInvoiceEntity(entityId)).data) } catch (err) { setError(err.message) } finally { setLoading(false) } }, [entityId])
  useEffect(() => { Promise.resolve().then(load) }, [load])
  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])
  const invoices = useMemo(() => data?.invoices || [], [data?.invoices])
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
  const deleteVersion = async version => { if (!window.confirm('Delete this PDF version?')) return; try { await deleteInvoicePdfVersion(version.id); await load() } catch (err) { setError(err.message) } }
  const openAction = (type, invoice) => { setActionError(''); setAction({ type, invoice }) }
  const closeAction = () => { if (!pendingAction) { setAction(null); setActionError('') } }
  const confirmAction = async () => {
    if (!action || pendingAction) return
    const pending = { type: action.type, id: action.invoice.id }
    setPendingAction(pending); setActionError(''); setError('')
    try {
      if (action.type === 'cancel') {
        const result = await cancelInvoiceRequest(entityId, action.invoice.id)
        setData(current => ({
          ...current,
          invoices: current.invoices.map(invoice => invoice.id === action.invoice.id
            ? { ...invoice, ...result.data, pdf_versions: invoice.pdf_versions || [] }
            : invoice)
        }))
        setToast(`${action.invoice.invoice_number} was cancelled. Its number remains consumed.`)
      } else {
        await deleteInvoiceRequest(entityId, action.invoice.id)
        setData(current => ({ ...current, invoices: current.invoices.filter(invoice => invoice.id !== action.invoice.id) }))
        setToast(`${action.invoice.invoice_number} was deleted. Its sequence is now available in the same series.`)
      }
      setAction(null)
    } catch (err) { setActionError(err.message) } finally { setPendingAction(null) }
  }
  if (loading) return <InvoiceDetailLoading />
  if (error && !data) return <div className="invoice-access-card"><div className="invoice-denied">{error}</div></div>
  const entity = data.entity
  const optionalValue = String(entity.optional_name ?? '').trim()
  const optionalName = optionalValue && optionalValue !== '-' ? optionalValue : ''
  const rate = entity.gst_component === 'IGST' ? `IGST ${number(entity.igst_rate)}%` : `CGST ${number(entity.cgst_rate)}% + SGST ${number(entity.sgst_rate)}%`
  return <div className="invoice-page invoice-entity-details">
    {toast && <div className="notice-toast is-visible invoice-toast" role="status" aria-live="polite"><CheckCircle2 size={17} /><span>{toast}</span><button className="notice-toast-close" type="button" onClick={() => setToast('')} aria-label="Close notification"><X size={14} /></button></div>}
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>{entity.entity_display_id || entity.invoice_id}</p></div></div>
    {error && <div className="invoice-table-error">{error}</div>}
    <section className="invoice-entity-summary"><div><span className="invoice-id">{entity.entity_display_id || entity.invoice_id}</span><h3>{show(entity.legal_entity_name)}</h3>{optionalName && <p>{optionalName}</p>}</div><div className="invoice-entity-summary-grid">{[['GSTIN', entity.gstin], ['PAN', entity.pan], ['Address', entity.address], ['Contact Person', entity.contact_person], ['Contact Email', entity.email], ['GST Component', entity.gst_component === 'CGST_SGST' ? 'CGST + SGST' : entity.gst_component], ['Rate', rate]].map(([label, value]) => <span key={label}><small>{label}</small><b>{show(value)}</b></span>)}</div></section>
    <InvoiceKpis totals={totals} />
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><strong>Generated Invoices</strong><span>{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</span></div><div className="table-scroll"><table className="data-table invoice-detail-table"><thead><tr>{DETAIL_HEADERS.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {invoices.map(invoice => {
        const cancelled = invoice.status === 'cancelled'
        const values = invoiceMoneyValues(invoice)
        const rowBusy = pendingAction?.id === invoice.id
        return <tr className={cancelled ? 'is-cancelled' : ''} key={invoice.id}>
          <td><span className="invoice-id">{invoice.invoice_display_id || invoice.invoice_number}</span></td>
          <td className="invoice-number-cell" title={invoice.invoice_number}>{show(invoice.invoice_number)}</td>
          <td>{formatDateDDMMYYYY(invoice.invoice_date)}</td>
          <td><span className={`invoice-status-badge is-${cancelled ? 'cancelled' : 'active'}`}>{cancelled ? 'Cancelled' : 'Active'}</span></td>
          <td>{show(invoice.consultant_name)}</td>
          <td>{show(invoice.candidate_name)}</td>
          <td>{INVOICE_MODEL_LABELS[invoice.model] || show(invoice.model)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.ctc_lpa)}</td>
          <td className="invoice-number-value">{formatInvoicePercentage(invoice.model_percent)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.model_flat_fee)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.retainer_amount)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.project_amount)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_adjustment_value)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_base_value)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.jra_flat_fee)}</td>
          <td className="invoice-money-cell">{moneyOrDash(invoice.others_amount)}</td>
          <td className="invoice-money-cell">{formatInrPaise(values.billValue)}</td>
          <td className="invoice-money-cell">{formatInrPaise(values.taxValue)}</td>
          <td className="invoice-money-cell invoice-total-cell">{formatInrPaise(values.totalInvoiceValue)}</td>
          <td><div className="invoice-version-list">{(invoice.pdf_versions || []).map((version, index) => <span className="invoice-version" key={version.id}><button className="invoice-document-button" type="button" onClick={() => openInvoice(version)} title={`Open PDF version ${invoice.pdf_versions.length - index}`} aria-label={`Open PDF version ${invoice.pdf_versions.length - index}`}>{opening === version.id ? <LoaderCircle className="invoice-button-spin" size={16} /> : <FileText size={16} />}<small>v{invoice.pdf_versions.length - index}</small></button>{!cancelled && <button className="invoice-version-delete" type="button" onClick={() => deleteVersion(version)} title="Delete this PDF version" aria-label={`Delete PDF version ${invoice.pdf_versions.length - index}`}><Trash2 size={12} /></button>}</span>)}{!invoice.pdf_versions?.length ? '—' : null}</div></td>
          <td><div className="row-actions invoice-row-actions">
            <button className="row-action-btn" type="button" onClick={() => setEditing(invoice)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'} title={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'}><Pencil size={14} /></button>
            <button className="row-action-btn invoice-cancel-action" type="button" onClick={() => openAction('cancel', invoice)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'} title={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'}>{rowBusy && pendingAction.type === 'cancel' ? <LoaderCircle className="invoice-button-spin" size={14} /> : <CircleX size={14} />}</button>
            <button className="row-action-btn invoice-delete-action" type="button" onClick={() => openAction('delete', invoice)} disabled={rowBusy} aria-label="Delete invoice" title="Delete invoice">{rowBusy && pendingAction.type === 'delete' ? <LoaderCircle className="invoice-button-spin" size={14} /> : <Trash2 size={14} />}</button>
          </div></td>
        </tr>
      })}
      {!invoices.length && <tr><td className="invoice-empty-cell" colSpan={DETAIL_HEADERS.length}>No invoices generated for this entity.</td></tr>}
    </tbody></table></div></div>
    {editing && <EditInvoiceModal invoice={editing} entity={entity} onClose={() => setEditing(null)} onSaved={load} />}
    <InvoiceActionDialog action={action} busy={Boolean(pendingAction)} error={actionError} onClose={closeAction} onConfirm={confirmAction} />
  </div>
}
