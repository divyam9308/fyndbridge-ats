import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Download, FileText, LoaderCircle, Pencil, Trash2, X } from 'lucide-react'
import { deleteInvoicePdfVersion, fetchInvoiceEntity, previewRegeneratedInvoice, regenerateInvoice } from '../services/invoiceApi'
import { openProtectedUrl } from '../services/apiClient'
import { ModelFields } from './InvoicePage'
import { EMPTY_INVOICE, INVOICE_MODEL_LABELS, INVOICE_MODELS, calculateInvoicePreview } from '../utils/invoiceModels'
import '../styles/Shared.css'
import './InvoicePage.css'

const show = value => String(value ?? '').trim() || '-'
const number = value => Number(value || 0)
const money = value => `₹${number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function Field({ label, children, full = false }) { return <div className={`form-group${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div> }
function Input({ name, value, update, ...props }) { return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} /> }

function EditInvoiceModal({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_INVOICE, ...invoice })
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
      <Field label="SAC"><Input name="sac" value={form.sac} update={update} /></Field><Field label="GST Component"><select className="form-control" name="gst_component" value={form.gst_component} onChange={update}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option></select></Field>
      {form.gst_component === 'IGST' ? <Field label="IGST Rate"><Input name="igst_rate" value={form.igst_rate} update={update} /></Field> : <><Field label="CGST Rate"><Input name="cgst_rate" value={form.cgst_rate} update={update} /></Field><Field label="SGST Rate"><Input name="sgst_rate" value={form.sgst_rate} update={update} /></Field></>}
    </div></section><section className="invoice-form-section"><h3>Updated Total</h3><div className="invoice-preview"><span>Taxable<b>{money(calc.taxable)}</b></span><span>Grand Total<b>{money(calc.grand)}</b></span></div></section>
    {(saved || preview) && <section className="invoice-form-section"><h3>{saved ? 'Regenerated Invoice Saved' : 'Regenerated Invoice Preview'}</h3><div className="invoice-pdf-preview"><iframe title="Regenerated invoice preview" src={`data:application/pdf;base64,${(saved || preview).pdfBase64}`} /></div></section>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Close</button>{saved ? <button className="btn-primary" onClick={downloadRegenerated}><Download size={14} />Download Regenerated Invoice</button> : preview ? <button className="btn-primary" onClick={saveRegenerated} disabled={saving}>{saving ? 'Saving...' : 'Save Regenerated Invoice'}</button> : <button className="btn-primary" onClick={generatePreview} disabled={saving}>{saving ? 'Preparing...' : 'Regenerate Preview'}</button>}</div>
  </div></div>, document.body)
}

function details(invoice) {
  const fields = [`Model: ${INVOICE_MODEL_LABELS[invoice.model] || '-'}`]
  if (['joining_percentage', 'jra_adjustment_percentage'].includes(invoice.model)) fields.push(`CTC: ${money(invoice.ctc_lpa)}`, `Percent: ${number(invoice.model_percent)}%`)
  if (invoice.model === 'joining_flat_fee') fields.push(`Amount: ${money(invoice.model_flat_fee)}`)
  if (invoice.model === 'retainer') fields.push(`Amount: ${money(invoice.retainer_amount)}`)
  if (invoice.model === 'project') fields.push(`Amount: ${money(invoice.project_amount)}`)
  if (invoice.model === 'jra_adjustment_flat_fee') fields.push(`Value: ${money(invoice.jra_base_value)}`, `Adjustment: ${money(invoice.jra_flat_fee)}`)
  if (invoice.model === 'others') fields.push(`Amount: ${money(invoice.others_amount)}`)
  return fields.join(' · ')
}

export default function InvoiceEntityDetailPage() {
  const { entityId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [opening, setOpening] = useState('')
  const load = useCallback(async () => { setError(''); try { setData((await fetchInvoiceEntity(entityId)).data) } catch (err) { setError(err.message) } finally { setLoading(false) } }, [entityId])
  useEffect(() => { Promise.resolve().then(load) }, [load])
  const openInvoice = async invoice => { if (!invoice.invoice_open_url) return setError('Stored invoice PDF is missing.'); setOpening(invoice.id); await openProtectedUrl(invoice.invoice_open_url, { notFoundMessage: 'Invoice PDF not found.' }); setOpening('') }
  const deleteVersion = async version => { if (!window.confirm('Delete this PDF version?')) return; try { await deleteInvoicePdfVersion(version.id); await load() } catch (err) { setError(err.message) } }
  if (loading) return <div className="invoice-access-card"><div className="invoice-loader"><LoaderCircle size={22} />Loading entity...</div></div>
  if (error && !data) return <div className="invoice-access-card"><div className="invoice-denied">{error}</div></div>
  const entity = data.entity
  const optionalName = show(entity.optional_name) !== '-' ? entity.optional_name : ''
  const rate = entity.gst_component === 'IGST' ? `IGST ${number(entity.igst_rate)}%` : `CGST ${number(entity.cgst_rate)}% + SGST ${number(entity.sgst_rate)}%`
  return <div className="invoice-page invoice-entity-details">
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>{entity.entity_display_id || entity.invoice_id}</p></div></div>
    {error && <div className="invoice-table-error">{error}</div>}
    <section className="invoice-entity-summary"><div><span className="invoice-id">{entity.entity_display_id || entity.invoice_id}</span><h3>{show(entity.legal_entity_name)}</h3>{optionalName && <p>{optionalName}</p>}</div><div className="invoice-entity-summary-grid">{[['GSTIN', entity.gstin], ['PAN', entity.pan], ['Address', entity.address], ['Contact Person', entity.contact_person], ['Contact Email', entity.email], ['GST Component', entity.gst_component === 'CGST_SGST' ? 'CGST + SGST' : entity.gst_component], ['Rate', rate]].map(([label, value]) => <span key={label}><small>{label}</small><b>{show(value)}</b></span>)}</div></section>
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><strong>Generated Invoices</strong><span>{data.invoices.length} invoices</span></div><div className="table-scroll"><table className="data-table invoice-detail-table"><thead><tr>{['Invoice ID', 'Consultant Name', 'Candidate Name', 'Calculation Details', 'Invoice', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {data.invoices.map(invoice => <tr key={invoice.id}><td><span className="invoice-id">{invoice.invoice_display_id || invoice.invoice_number}</span></td><td>{show(invoice.consultant_name)}</td><td>{show(invoice.candidate_name)}</td><td>{details(invoice)}</td><td><div className="invoice-version-list">{(invoice.pdf_versions || []).map((version, index) => <span className="invoice-version" key={version.id}><button className="invoice-document-button" onClick={() => openInvoice(version)} title={`Open PDF version ${invoice.pdf_versions.length - index}`}>{opening === version.id ? <LoaderCircle size={16} /> : <FileText size={16} />}<small>v{invoice.pdf_versions.length - index}</small></button><button className="invoice-version-delete" onClick={() => deleteVersion(version)} title="Delete this PDF version"><Trash2 size={12} /></button></span>)}{!invoice.pdf_versions?.length ? '-' : null}</div></td><td><button className="row-action-btn" onClick={() => setEditing(invoice)} aria-label="Edit invoice"><Pencil size={14} /></button></td></tr>)}
      {!data.invoices.length && <tr><td className="invoice-empty-cell" colSpan={6}>No invoices generated for this entity.</td></tr>}
    </tbody></table></div></div>
    {editing && <EditInvoiceModal invoice={editing} onClose={() => setEditing(null)} onSaved={load} />}
  </div>
}
