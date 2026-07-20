import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleX, Download, FileText, LoaderCircle, Pencil, Trash2, X } from 'lucide-react'
import {
  fetchReassignedInvoiceNumber,
  previewRegeneratedInvoice,
  regenerateInvoice
} from '../services/invoiceApi'
import { useDialogFocus } from '../hooks/useDialogFocus'
import ModelFields from './InvoiceModelFields'
import {
  EMPTY_INVOICE,
  INVOICE_MODELS,
  INVOICE_TYPE_LABELS,
  calculateInvoicePreview,
  detectInvoiceGstComponent
} from '../utils/invoiceModels'
import { formatInvoiceMoney } from '../utils/invoiceValues'

const show = value => String(value ?? '').trim() || '—'

function Field({ label, children, full = false }) {
  return <div className={`form-group${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
}

function Input({ name, value, update, ...props }) {
  return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} />
}

export function InvoiceActionDialog({ action, busy, error, onClose, onConfirm }) {
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

export function EditInvoiceModal({ invoice, entity, entities, onClose, onSaved }) {
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
    </div></section><section className="invoice-form-section"><h3>Updated Total</h3><div className="invoice-preview"><span>Taxable<b>{formatInvoiceMoney(calc.taxable)}</b></span><span>Grand Total<b>{formatInvoiceMoney(calc.grand)}</b></span></div></section>
    {(saved || preview) && <section className="invoice-form-section"><h3>{saved ? 'Regenerated Invoice Saved' : 'Regenerated Invoice Preview'}</h3><div className="invoice-pdf-preview"><iframe title="Regenerated invoice preview" src={`data:application/pdf;base64,${(saved || preview).pdfBase64}`} /></div></section>}
    </div>
    <div className="modal-footer"><button className="btn-secondary" onClick={onClose}>Close</button>{saved ? <button className="btn-primary" onClick={downloadRegenerated}><Download size={14} />Download Regenerated Invoice</button> : preview ? <button className="btn-primary" onClick={saveRegenerated} disabled={saving}>{saving ? 'Saving...' : 'Save Regenerated Invoice'}</button> : <button className="btn-primary" onClick={generatePreview} disabled={saving}>{saving ? 'Preparing...' : 'Regenerate Preview'}</button>}</div>
  </div></div>, document.body)
}

export function InvoiceDocumentControl({ invoice, opening, deletingVersion, onOpen, onDelete }) {
  const cancelled = invoice.status === 'cancelled'
  return <div className="invoice-version-list">{(invoice.pdf_versions || []).map(version => {
    const versionNumber = version.version_number
    return <span className="invoice-version" key={version.id}><button className="invoice-document-button" type="button" onClick={() => onOpen(version)} disabled={deletingVersion === version.id} title={`Open PDF version ${versionNumber}`} aria-label={`Open PDF version ${versionNumber}`}>{opening === version.id ? <LoaderCircle className="invoice-button-spin" size={16} /> : <FileText size={16} />}<small>v{versionNumber}</small></button>{!cancelled && <button className="invoice-version-delete" type="button" onClick={() => onDelete(invoice, version, versionNumber)} disabled={Boolean(deletingVersion)} title={`Delete PDF version ${versionNumber}`} aria-label={`Delete PDF version ${versionNumber}`}>{deletingVersion === version.id ? <LoaderCircle className="invoice-button-spin" size={11} /> : <Trash2 size={11} />}</button>}</span>
  })}{!invoice.pdf_versions?.length ? '—' : null}</div>
}

export function InvoiceActionControls({ invoice, entity, pendingAction, onEdit, onCancel }) {
  const cancelled = invoice.status === 'cancelled'
  const rowBusy = pendingAction?.id === invoice.id
  return <div className="row-actions invoice-row-actions">
    <button className="row-action-btn" type="button" onClick={() => onEdit(invoice, entity)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'} title={cancelled ? 'Cancelled invoices cannot be edited' : 'Edit invoice'}><Pencil size={14} /></button>
    <button className="row-action-btn invoice-cancel-action" type="button" onClick={() => onCancel(invoice, entity)} disabled={cancelled || rowBusy} aria-label={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'} title={cancelled ? 'Invoice already cancelled' : 'Cancel invoice'}>{rowBusy ? <LoaderCircle className="invoice-button-spin" size={14} /> : <CircleX size={14} />}</button>
  </div>
}
