import { apiFetch, cachedApiJson, invalidateApiJsonCache } from './apiClient'

async function json(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

export const fetchInvoiceEntities = async () => cachedApiJson('/api/invoice/entities', {}, { ttlMs: 30000 })
export const fetchInvoiceEntity = async (id) => cachedApiJson(`/api/invoice/entities/${id}`, {}, { ttlMs: 30000 })
export const createInvoiceEntity = async (payload) => {
  const result = await json(await apiFetch('/api/invoice/entities', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
  }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const updateInvoiceEntity = async (id, payload) => {
  const result = await json(await apiFetch(`/api/invoice/entities/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
  }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const deleteInvoiceEntity = async (id) => {
  const result = await json(await apiFetch(`/api/invoice/entities/${id}`, { method: 'DELETE' }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
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
export const commitInvoicePreview = async (payload) => {
  const result = await json(await apiFetch('/api/invoice/commit-preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
  }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const regenerateInvoice = async (id, payload) => {
  const result = await json(await apiFetch(`/api/invoice/invoices/${id}/regenerate`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
  }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const previewRegeneratedInvoice = async (id, payload) => json(await apiFetch(`/api/invoice/invoices/${id}/regeneration-preview`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}))
export const deleteInvoicePdfVersion = async (id) => {
  const result = await json(await apiFetch(`/api/invoice/invoice-pdf-versions/${id}`, { method: 'DELETE' }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const cancelInvoice = async (entityId, id) => {
  const result = await json(await apiFetch(`/api/invoice/entities/${entityId}/invoices/${id}/cancel`, { method: 'POST' }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
export const deleteInvoice = async (entityId, id) => {
  const result = await json(await apiFetch(`/api/invoice/entities/${entityId}/invoices/${id}`, { method: 'DELETE' }))
  invalidateApiJsonCache('/api/invoice/entities')
  return result
}
