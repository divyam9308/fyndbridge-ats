import { apiFetch } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export const fetchInvoiceEntities = () => json(apiFetch('/api/invoice/entities', { cache: 'no-store' }))
export const createInvoiceEntity = (payload) => json(apiFetch('/api/invoice/entities', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const updateInvoiceEntity = (id, payload) => json(apiFetch(`/api/invoice/entities/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const deleteInvoiceEntity = (id) => json(apiFetch(`/api/invoice/entities/${id}`, { method: 'DELETE' }))
export const fetchNextInvoiceNumber = (billingEntity, invoiceDate) => json(apiFetch(`/api/invoice/next-number?billing_entity=${encodeURIComponent(billingEntity)}&invoice_date=${encodeURIComponent(invoiceDate)}`, { cache: 'no-store' }))
export const generateInvoicePdf = (payload) => json(apiFetch('/api/invoice/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
