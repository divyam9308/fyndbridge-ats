import { apiFetch } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export const fetchInvoiceEntities = async () => json(await apiFetch('/api/invoice/entities', { cache: 'no-store' }))
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
export const lookupGstin = async (gstin) => json(await apiFetch('/api/gst/lookup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ gstin })
}))
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
