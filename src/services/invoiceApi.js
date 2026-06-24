import { apiFetch } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export const fetchInvoiceEntities = async () => json(await apiFetch('/api/invoice/entities', { cache: 'no-store' }))
export const fetchInvoiceEntity = async (id) => json(await apiFetch(`/api/invoice/entities/${id}`, { cache: 'no-store' }))
export const createInvoiceEntity = async (payload) => json(await apiFetch('/api/invoice/entities', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const updateInvoiceEntity = async (id, payload) => json(await apiFetch(`/api/invoice/entities/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const deleteInvoiceEntity = async (id) => json(await apiFetch(`/api/invoice/entities/${id}`, { method: 'DELETE' }))
export const lookupGstin = async (gstin) => {
  const response = await apiFetch('/api/gst/lookup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ gstin })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || 'GST lookup failed. You can enter details manually.')
    error.fallback = payload.fallback
    throw error
  }
  return payload
}
export const fetchNextInvoiceNumber = async (billingEntity, invoiceDate) => json(await apiFetch(`/api/invoice/next-number?billing_entity=${encodeURIComponent(billingEntity)}&invoice_date=${encodeURIComponent(invoiceDate)}`, { cache: 'no-store' }))
export const generateInvoicePdf = async (payload) => json(await apiFetch('/api/invoice/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const previewInvoicePdf = async (payload) => json(await apiFetch('/api/invoice/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const commitInvoicePreview = async (payload) => json(await apiFetch('/api/invoice/commit-preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const regenerateInvoice = async (id, payload) => json(await apiFetch(`/api/invoice/invoices/${id}/regenerate`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const previewRegeneratedInvoice = async (id, payload) => json(await apiFetch(`/api/invoice/invoices/${id}/regeneration-preview`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const deleteInvoicePdfVersion = async (id) => json(await apiFetch(`/api/invoice/invoice-pdf-versions/${id}`, { method: 'DELETE' }))
