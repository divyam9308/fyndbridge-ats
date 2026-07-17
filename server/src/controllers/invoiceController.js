const supabase = require('../services/supabaseAdmin')
const { normalizeGstin } = require('../services/gstLookup')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('../services/storageBuckets')
const {
  BILLING_ENTITIES, GST_COMPONENTS, INVOICE_TYPES, MODELS, clean, financialYear,
  detectGstComponent, calculateInvoice, createInvoicePdf
} = require('../services/invoiceService')

const ENTITY_FIELDS = 'id, invoice_id, entity_display_id, legal_entity_name, optional_name, address, pan, place_of_supply, state, state_code, gstin, contact_person, email, sac, billing_entity, gst_component, igst_rate, cgst_rate, sgst_rate, created_at, updated_at'
const INVOICE_FIELDS = 'id, invoice_entity_id, invoice_type, invoice_display_id, invoice_number, financial_year, sequence_number, invoice_date, consultant_name, candidate_name, professional_fee_text, model, ctc_lpa, model_percent, model_flat_fee, retainer_amount, project_amount, jra_adjustment_value, jra_base_value, jra_flat_fee, others_amount, sac, billing_entity, taxable_amount, gst_component, igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, total_tax_amount, total_before_rounding, rounding_type, rounding_amount, grand_total, pdf_storage_path, status, cancelled_at, cancelled_by, created_at'

const SAFE_ERROR_MESSAGES = [
  /^Entity not found$/,
  /^Invoice not found$/,
  /^Invoice PDF version not found$/,
  /^Amount fields must be numeric$/,
  /^Calculation fields must be numeric and non-negative$/,
  /^GST rates must be numeric and non-negative$/,
  /^Taxable amount cannot be negative$/,
  /^Invalid billing entity$/,
  /^Invalid invoice type$/,
  /^Stored invoice PDF is missing\.$/
]
function httpError(message, statusCode, code = '') {
  return Object.assign(new Error(message), { statusCode, code })
}
function publicInvoiceError(err) {
  if (err?.statusCode) return err
  if (err?.message === 'INVOICE_NUMBER_CHANGED') return httpError('Invoice number changed. Return to edit and generate again.', 409, 'INVOICE_NUMBER_CHANGED')
  if (err?.message === 'INVOICE_NOT_FOUND') return httpError('Invoice not found.', 404)
  if (err?.code === '23505') return httpError('An invoice number conflict occurred. Please try again.', 409, 'INVOICE_NUMBER_CONFLICT')
  if (SAFE_ERROR_MESSAGES.some(pattern => pattern.test(err?.message || ''))) return httpError(err.message, 400)
  console.error('[invoice]', err)
  return httpError('The invoice request could not be completed. Please try again.', 500)
}
const sendError = (res, err) => {
  const safe = publicInvoiceError(err)
  return res.status(safe.statusCode || 500).json({ error: safe.message, ...(safe.code ? { code: safe.code } : {}) })
}
const nullable = value => clean(value) || null
function normalizeInvoiceType(value) {
  const normalized = clean(value) || 'tax_invoice'
  if (!INVOICE_TYPES.has(normalized)) throw httpError('Invalid invoice type', 400)
  return normalized
}
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(/₹|â‚¹|Rs\.?|,/gi, '').trim())
  if (!Number.isFinite(parsed)) throw Object.assign(new Error('Amount fields must be numeric'), { statusCode: 400 })
  return parsed
}

async function nextDisplayId(table, field, prefix) {
  const { data, error } = await supabase.from(table).select(field)
  if (error) throw error
  const max = (data || []).reduce((value, row) => Math.max(value, Number(String(row[field] || '').replace(new RegExp(`^${prefix}`, 'i'), '')) || 0), 0)
  return `${prefix}${max + 1}`
}

async function nextInvoiceDisplayId() {
  const { data, error } = await supabase.rpc('next_invoice_display_id')
  if (error) throw error
  return data
}

function entityPayload(body) {
  const billing = BILLING_ENTITIES.has(body.billing_entity) ? body.billing_entity : 'FCS'
  const gst = GST_COMPONENTS.has(body.gst_component) ? body.gst_component : detectGstComponent(body.state_code, body.state, body.place_of_supply, body.address)
  const gstin = nullable(body.gstin)
  return {
    legal_entity_name: nullable(body.legal_entity_name),
    optional_name: clean(body.optional_name) || '-',
    address: nullable(body.address), pan: nullable(body.pan), place_of_supply: nullable(body.place_of_supply),
    state: nullable(body.state), state_code: nullable(body.state_code),
    gstin: gstin ? normalizeGstin(gstin) : null,
    contact_person: nullable(body.contact_person), email: nullable(body.email),
    sac: clean(body.sac) || '998512', billing_entity: billing, gst_component: gst,
    igst_rate: numberOrNull(body.igst_rate) ?? 18,
    cgst_rate: numberOrNull(body.cgst_rate) ?? 9,
    sgst_rate: numberOrNull(body.sgst_rate) ?? 9,
    updated_at: new Date().toISOString()
  }
}

const decorateInvoice = row => ({ ...row })
const decoratePdfVersion = row => ({ ...row })
const rpcRow = data => Array.isArray(data) ? data[0] : data

async function listEntities(req, res) {
  try {
    const { data, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).order('created_at', { ascending: false })
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return sendError(res, err) }
}

async function getEntity(req, res) {
  try {
    const invoiceType = normalizeInvoiceType(req.query.invoice_type)
    const { data: entity, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!entity) return res.status(404).json({ error: 'Entity not found' })
    const { data: invoices, error: invoiceError } = await supabase
      .from('invoices')
      .select(INVOICE_FIELDS)
      .eq('invoice_entity_id', entity.id)
      .eq('invoice_type', invoiceType)
      .order('created_at', { ascending: false })
    if (invoiceError) throw invoiceError
    const invoiceIds = (invoices || []).map(invoice => invoice.id)
    let versions = []
    if (invoiceIds.length) {
      const result = await supabase.from('invoice_pdf_versions').select('*').in('invoice_id', invoiceIds).order('created_at', { ascending: false })
      if (result.error) throw result.error
      versions = result.data || []
    }
    const versionsByInvoice = new Map()
    versions.forEach(version => versionsByInvoice.set(version.invoice_id, [...(versionsByInvoice.get(version.invoice_id) || []), decoratePdfVersion(version)]))
    return res.json({ data: { entity, invoices: (invoices || []).map(row => ({ ...decorateInvoice(row), pdf_versions: versionsByInvoice.get(row.id) || [] })) } })
  } catch (err) { return sendError(res, err) }
}

async function createEntity(req, res) {
  try {
    const payload = entityPayload(req.body)
    payload.entity_display_id = await nextDisplayId('invoice_entities', 'entity_display_id', 'EID')
    payload.invoice_id = payload.entity_display_id
    const { data, error } = await supabase.from('invoice_entities').insert(payload).select(ENTITY_FIELDS).single()
    if (error) throw error
    return res.status(201).json({ data })
  } catch (err) { return sendError(res, err) }
}

async function updateEntity(req, res) {
  try {
    const { data, error } = await supabase.from('invoice_entities').update(entityPayload(req.body)).eq('id', req.params.id).select(ENTITY_FIELDS).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Entity not found' })
    return res.json({ data })
  } catch (err) { return sendError(res, err) }
}

async function deleteEntity(req, res) {
  try {
    const { error } = await supabase.from('invoice_entities').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return sendError(res, err) }
}

async function nextNumberParts(billingEntity, invoiceDate, invoiceType = 'tax_invoice') {
  const fy = financialYear(invoiceDate)
  const { data, error } = await supabase.rpc('next_available_invoice_number_by_type', {
    p_billing_entity: billingEntity,
    p_financial_year: fy,
    p_invoice_type: invoiceType
  })
  if (error) throw error
  const next = rpcRow(data)
  if (!next?.sequence_number || !next?.invoice_number) throw new Error('Invoice number allocation failed')
  return { financialYear: next.financial_year, sequence: Number(next.sequence_number), invoiceNumber: next.invoice_number }
}

async function nextNumber(req, res) {
  try {
    const invoiceType = normalizeInvoiceType(req.query.invoice_type)
    const billing = BILLING_ENTITIES.has(req.query.billing_entity) ? req.query.billing_entity : 'FCS'
    return res.json(await nextNumberParts(billing, req.query.invoice_date || new Date().toISOString().slice(0, 10), invoiceType))
  } catch (err) { return sendError(res, err) }
}

async function invoiceInput(body) {
  const invoiceType = normalizeInvoiceType(body.invoice_type)
  const { data: entity, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).eq('id', body.invoice_entity_id || body.entity_id).maybeSingle()
  if (error) throw error
  if (!entity) throw Object.assign(new Error('Entity not found'), { statusCode: 404 })
  const requestedBilling = BILLING_ENTITIES.has(body.billing_entity) ? body.billing_entity : entity.billing_entity || 'FCS'
  const input = {
    ...entity, ...body,
    invoice_type: invoiceType,
    billing_entity: invoiceType === 'proforma_invoice' ? entity.billing_entity || 'FCS' : requestedBilling,
    model: MODELS.has(body.model) ? body.model : 'joining_percentage',
    gst_component: detectGstComponent(entity.state_code, entity.state, entity.place_of_supply, entity.address)
  }
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)
  return { entity, input, invoiceDate, billing: input.billing_entity, calc: calculateInvoice(input) }
}

function invoicePayload(entity, input, invoiceDate, parts, calc) {
  return {
    invoice_entity_id: entity.id, invoice_type: input.invoice_type, billing_entity: input.billing_entity,
    invoice_number: parts.invoiceNumber, financial_year: parts.financialYear,
    sequence_number: parts.sequence, invoice_date: invoiceDate,
    consultant_name: nullable(input.consultant_name), candidate_name: nullable(input.candidate_name),
    professional_fee_text: clean(input.professional_fee_text), model: input.model,
    ctc_lpa: numberOrNull(input.ctc_lpa), model_percent: numberOrNull(input.model_percent),
    model_flat_fee: numberOrNull(input.model_flat_fee), retainer_amount: numberOrNull(input.retainer_amount),
    project_amount: numberOrNull(input.project_amount), jra_adjustment_value: numberOrNull(input.jra_adjustment_value),
    jra_base_value: numberOrNull(input.jra_base_value), jra_flat_fee: numberOrNull(input.jra_flat_fee),
    others_amount: numberOrNull(input.others_amount), sac: clean(input.sac || entity.sac) || '998512', ...calc
  }
}

async function uploadInvoicePdf(entityId, displayId, pdf) {
  const path = `invoices/${entityId}/${displayId}-v${Date.now()}.pdf`
  const { error } = await supabase.storage.from(STORAGE_BUCKETS.INVOICE).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Invoice PDF upload failed: ${error.message}`)
  return path
}

async function preview(req, res) {
  try {
    const { entity, input, invoiceDate, billing, calc } = await invoiceInput(req.body)
    const parts = await nextNumberParts(billing, invoiceDate, input.invoice_type)
    const record = invoicePayload(entity, input, invoiceDate, parts, calc)
    const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: record, overrides: input })
    return res.json({ data: record, fileName: invoiceFileName(record), pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

function invoiceFileName(invoice) {
  const label = invoice.invoice_type === 'proforma_invoice' ? 'Proforma-Invoice' : 'Invoice'
  return `${label}-${invoice.invoice_number.replace(/\//g, '-')}.pdf`
}

async function createStoredInvoice(body, expectedNumber = '') {
  const { entity, input, invoiceDate, calc } = await invoiceInput(body)
  const payload = invoicePayload(entity, input, invoiceDate, {
    invoiceNumber: '',
    financialYear: financialYear(invoiceDate),
    sequence: null
  }, calc)
  payload.invoice_display_id = await nextInvoiceDisplayId()
  const allocation = await supabase.rpc('create_invoice_with_lowest_sequence', {
    p_invoice: payload,
    p_expected_invoice_number: clean(expectedNumber) || null
  })
  if (allocation.error) throw allocation.error
  const allocated = rpcRow(allocation.data)
  if (!allocated?.id) throw new Error('Invoice number allocation failed')

  let storagePath = ''
  try {
    const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: allocated, overrides: input })
    storagePath = await uploadInvoicePdf(entity.id, allocated.invoice_display_id, pdf)
    const attached = await supabase.rpc('attach_invoice_pdf', {
      p_invoice_id: allocated.id,
      p_storage_path: storagePath
    })
    if (attached.error) throw attached.error
    return { record: decorateInvoice(rpcRow(attached.data)), pdf }
  } catch (err) {
    if (storagePath) {
      const cleanPath = normalizeStoragePath(storagePath, STORAGE_BUCKETS.INVOICE)
      if (cleanPath) await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([cleanPath])
    }
    const cleanup = await supabase.from('invoices').delete().eq('id', allocated.id)
    if (cleanup.error) console.error('[invoice] Failed to release incomplete invoice allocation', cleanup.error)
    throw err
  }
}

async function generate(req, res) {
  try {
    const { record, pdf } = await createStoredInvoice(req.body)
    return res.status(201).json({ data: record, fileName: invoiceFileName(record), pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function commitPreview(req, res) {
  try {
    const { record, pdf } = await createStoredInvoice(req.body, req.body.invoice_number)
    return res.status(201).json({ data: record, fileName: invoiceFileName(record), pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function regenerationData(invoiceId, body) {
  const { data: existing, error } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (error) throw error
  if (!existing) throw httpError('Invoice not found', 404)
  if (existing.status === 'cancelled') throw httpError('Cancelled invoices cannot be regenerated.', 409)
  const { entity, input, calc } = await invoiceInput({ ...existing, ...body, invoice_type: existing.invoice_type, invoice_entity_id: existing.invoice_entity_id })
  const updated = { ...invoicePayload(entity, input, input.invoice_date || existing.invoice_date, { invoiceNumber: existing.invoice_number, financialYear: existing.financial_year, sequence: existing.sequence_number }, calc), invoice_display_id: existing.invoice_display_id }
  const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: updated, overrides: input })
  return { existing, entity, updated, pdf }
}

async function previewRegeneration(req, res) {
  try {
    const { existing, updated, pdf } = await regenerationData(req.params.id, req.body)
    return res.json({ data: { ...updated, id: existing.id }, fileName: invoiceFileName(existing), pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function regenerate(req, res) {
  try {
    const { existing, entity, updated, pdf } = await regenerationData(req.params.id, req.body)
    const storagePath = await uploadInvoicePdf(entity.id, existing.invoice_display_id || 'IID', pdf)
    const versionResult = await supabase.from('invoice_pdf_versions').insert({ invoice_id: existing.id, storage_path: storagePath }).select('*').single()
    if (versionResult.error) {
      await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([storagePath])
      throw versionResult.error
    }
    updated.pdf_storage_path = storagePath
    const { data, error: updateError } = await supabase
      .from('invoices')
      .update(updated)
      .eq('id', existing.id)
      .eq('invoice_type', existing.invoice_type)
      .select(INVOICE_FIELDS)
      .single()
    if (updateError) {
      await supabase.from('invoice_pdf_versions').delete().eq('id', versionResult.data.id)
      await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([storagePath])
      throw updateError
    }
    return res.json({ data: decorateInvoice(data), version: decoratePdfVersion(versionResult.data), fileName: invoiceFileName(existing), pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function deletePdfVersion(req, res) {
  try {
    const { data: version, error } = await supabase.from('invoice_pdf_versions').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!version) return res.status(404).json({ error: 'Invoice PDF version not found' })
    const { data: invoice, error: invoiceError } = await supabase.from('invoices').select('pdf_storage_path, status').eq('id', version.invoice_id).maybeSingle()
    if (invoiceError) throw invoiceError
    if (invoice?.status === 'cancelled') throw httpError('PDF versions of cancelled invoices cannot be deleted.', 409)
    const storagePath = normalizeStoragePath(version.storage_path, STORAGE_BUCKETS.INVOICE)
    if (!storagePath) throw httpError('Stored invoice PDF is missing.', 404)
    const { error: storageError } = await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([storagePath])
    if (storageError) throw storageError
    const { error: deleteError } = await supabase.from('invoice_pdf_versions').delete().eq('id', version.id)
    if (deleteError) throw deleteError
    if (invoice?.pdf_storage_path === version.storage_path) {
      const { data: latest } = await supabase.from('invoice_pdf_versions').select('storage_path').eq('invoice_id', version.invoice_id).order('created_at', { ascending: false }).limit(1)
      await supabase.from('invoices').update({ pdf_storage_path: latest?.[0]?.storage_path || null }).eq('id', version.invoice_id)
    }
    return res.json({ ok: true })
  } catch (err) { return sendError(res, err) }
}

async function cancelInvoice(req, res) {
  try {
    const invoiceType = normalizeInvoiceType(req.query.invoice_type)
    const { data: existing, error } = await supabase
      .from('invoices')
      .select(INVOICE_FIELDS)
      .eq('id', req.params.id)
      .eq('invoice_entity_id', req.params.entityId)
      .eq('invoice_type', invoiceType)
      .maybeSingle()
    if (error) throw error
    if (!existing) throw httpError('Invoice not found.', 404)
    if (existing.status === 'cancelled') throw httpError('This invoice is already cancelled.', 409)

    const cancelledAt = new Date().toISOString()
    const { data, error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'cancelled', cancelled_at: cancelledAt, cancelled_by: req.user.id })
      .eq('id', existing.id)
      .eq('invoice_entity_id', req.params.entityId)
      .eq('invoice_type', invoiceType)
      .eq('status', 'active')
      .select(INVOICE_FIELDS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!data) throw httpError('This invoice is already cancelled.', 409)
    return res.json({ data: decorateInvoice(data) })
  } catch (err) { return sendError(res, err) }
}

async function deleteInvoice(req, res) {
  try {
    const invoiceType = normalizeInvoiceType(req.query.invoice_type)
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(INVOICE_FIELDS)
      .eq('id', req.params.id)
      .eq('invoice_entity_id', req.params.entityId)
      .eq('invoice_type', invoiceType)
      .maybeSingle()
    if (error) throw error
    if (!invoice) throw httpError('Invoice not found or already deleted.', 404)

    const { data: versions, error: versionError } = await supabase
      .from('invoice_pdf_versions')
      .select('storage_path')
      .eq('invoice_id', invoice.id)
    if (versionError) throw versionError

    const storagePaths = [...new Set([
      invoice.pdf_storage_path,
      ...(versions || []).map(version => version.storage_path)
    ].map(path => normalizeStoragePath(path, STORAGE_BUCKETS.INVOICE)).filter(Boolean))]

    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove(storagePaths)
      if (storageError) throw httpError('The invoice file could not be removed. The invoice was not deleted.', 502)
    }

    const { data: deleted, error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoice.id)
      .eq('invoice_entity_id', req.params.entityId)
      .eq('invoice_type', invoiceType)
      .select('id')
      .maybeSingle()
    if (deleteError) {
      throw httpError('Invoice files were removed, but the database row could not be deleted. Please contact an administrator.', 500)
    }
    if (!deleted) throw httpError('Invoice not found or already deleted.', 404)
    return res.json({ ok: true, released: { invoice_type: invoice.invoice_type, billing_entity: invoice.billing_entity, financial_year: invoice.financial_year, sequence_number: invoice.sequence_number } })
  } catch (err) { return sendError(res, err) }
}

module.exports = {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  nextNumber,
  preview,
  generate,
  commitPreview,
  previewRegeneration,
  regenerate,
  deletePdfVersion,
  cancelInvoice,
  deleteInvoice
}
