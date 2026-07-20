import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, FileClock, ReceiptText, X } from 'lucide-react'
import { FyndbridgeLoader } from '../components/FyndbridgeLoader'
import { useInvoiceRowControls } from '../hooks/useInvoiceRowControls'
import { fetchInvoiceEntities, fetchInvoiceEntity } from '../services/invoiceApi'
import { INVOICE_MODEL_LABELS, INVOICE_TYPE_LABELS } from '../utils/invoiceModels'
import { formatDateDDMMYYYY } from '../utils/dateFormat'
import {
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

function InvoiceDetailLoading() {
  return <div className="invoice-page invoice-entity-details">
    <div className="candidate-page-header"><div><Link className="invoice-back-link" to="/invoice"><ChevronLeft size={16} />Back to Invoice</Link><h2>Entity Details</h2><p>Loading invoice history…</p></div></div>
    <FyndbridgeLoader size={88} label="Loading invoices..." className="invoice-page-loader" />
  </div>
}

function InvoiceTableLoading({ label }) {
  return <div className="invoice-detail-table-loading"><FyndbridgeLoader size={76} label={label} className="invoice-inline-loader" /></div>
}

export default function InvoiceEntityDetailPage() {
  const { entityId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const invoiceType = searchParams.get('type') === 'proforma' ? 'proforma_invoice' : 'tax_invoice'
  const [data, setData] = useState(null)
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
  const rowControls = useInvoiceRowControls({
    entities,
    onRefresh: load,
    onCancelled: async (result, cancelledInvoice) => setData(current => ({
      ...current,
      invoices: current.invoices.map(invoice => invoice.id === cancelledInvoice.id
        ? { ...invoice, ...result.data, pdf_versions: invoice.pdf_versions || [] }
        : invoice)
    })),
    onError: setError,
    onToast: setToast
  })
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
    <div className="table-card invoice-table-card"><div className="invoice-card-toolbar"><strong>{typeLabel}s</strong><span>{typeLoading ? 'Loading…' : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}</span></div>{typeLoading ? <InvoiceTableLoading label={`Loading ${typeLabel.toLowerCase()}s...`} /> : <div className="table-scroll"><table className="data-table invoice-detail-table" style={tableStyle}><colgroup>{columns.map(column => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
      {invoices.map(invoice => {
        const cancelled = invoice.status === 'cancelled'
        const values = invoiceMoneyValues(invoice)
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
          <td>{rowControls.renderInvoiceControl(invoice)}</td>
          <td>{rowControls.renderActionControls(invoice, entity)}</td>
        </tr>
      })}
      {!invoices.length && <tr><td className="invoice-empty-cell" colSpan={columns.length}>No {typeLabel.toLowerCase()}s found for this entity.</td></tr>}
    </tbody></table></div>}</div>
    {rowControls.dialogs}
  </div>
}
