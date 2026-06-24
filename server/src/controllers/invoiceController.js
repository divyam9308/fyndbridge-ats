const supabase = require('../services/supabaseAdmin')
const { normalizeGstin } = require('../services/gstLookup')
const { STORAGE_BUCKETS, documentOpenUrl } = require('../services/storageBuckets')
const {
  BILLING_ENTITIES, GST_COMPONENTS, MODELS, clean, financialYear,
  detectGstComponent, calculateInvoice, createInvoicePdf
} = require('../services/invoiceService')

const ENTITY_FIELDS = 'id, invoice_id, entity_display_id, legal_entity_name, optional_name, address, pan, place_of_supply, state, state_code, gstin, contact_person, email, sac, billing_entity, gst_component, igst_rate, cgst_rate, sgst_rate, created_at, updated_at'
const INVOICE_FIELDS = 'id, invoice_entity_id, invoice_display_id, invoice_number, invoice_date, consultant_name, candidate_name, professional_fee_text, model, ctc_lpa, model_percent, model_flat_fee, retainer_amount, project_amount, jra_adjustment_value, jra_base_value, jra_flat_fee, others_amount, sac, billing_entity, taxable_amount, gst_component, igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, total_tax_amount, total_before_rounding, rounding_type, rounding_amount, grand_total, pdf_storage_path, created_at'

const sendError = (res, err) => res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' })
const nullable = value => clean(value) || null
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
  const gst = GST_COMPONENTS.has(body.gst_component) ? body.gst_component : detectGstComponent(body.address, body.state, body.place_of_supply)
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

const decorateInvoice = row => ({ ...row, invoice_open_url: documentOpenUrl('invoice', row.pdf_storage_path) })
const decoratePdfVersion = row => ({ ...row, invoice_open_url: documentOpenUrl('invoice', row.storage_path) })

async function listEntities(req, res) {
  try {
    const { data, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).order('created_at', { ascending: false })
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return sendError(res, err) }
}

async function getEntity(req, res) {
  try {
    const { data: entity, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!entity) return res.status(404).json({ error: 'Entity not found' })
    const { data: invoices, error: invoiceError } = await supabase.from('invoices').select(INVOICE_FIELDS).eq('invoice_entity_id', entity.id).order('created_at', { ascending: false })
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

async function nextNumberParts(billingEntity, invoiceDate) {
  const fy = financialYear(invoiceDate)
  const { data, error } = await supabase.from('invoices').select('sequence_number').eq('billing_entity', billingEntity).eq('financial_year', fy).order('sequence_number', { ascending: false }).limit(1)
  if (error) throw error
  const sequence = Number(data?.[0]?.sequence_number || 0) + 1
  return { financialYear: fy, sequence, invoiceNumber: `${billingEntity === 'FCAPL' ? 'FCAPL' : 'FB'}/${fy}/${String(sequence).padStart(3, '0')}` }
}

async function nextNumber(req, res) {
  try {
    const billing = BILLING_ENTITIES.has(req.query.billing_entity) ? req.query.billing_entity : 'FCS'
    return res.json(await nextNumberParts(billing, req.query.invoice_date || new Date().toISOString().slice(0, 10)))
  } catch (err) { return sendError(res, err) }
}

async function invoiceInput(body) {
  const { data: entity, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).eq('id', body.invoice_entity_id || body.entity_id).maybeSingle()
  if (error) throw error
  if (!entity) throw Object.assign(new Error('Entity not found'), { statusCode: 404 })
  const input = {
    ...entity, ...body,
    billing_entity: BILLING_ENTITIES.has(body.billing_entity) ? body.billing_entity : entity.billing_entity || 'FCS',
    model: MODELS.has(body.model) ? body.model : 'joining_percentage',
    gst_component: GST_COMPONENTS.has(body.gst_component) ? body.gst_component : entity.gst_component || detectGstComponent(entity.address, entity.state, entity.place_of_supply)
  }
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)
  return { entity, input, invoiceDate, billing: input.billing_entity, calc: calculateInvoice(input) }
}

function invoicePayload(entity, input, invoiceDate, parts, calc) {
  return {
    invoice_entity_id: entity.id, billing_entity: input.billing_entity,
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
    const parts = await nextNumberParts(billing, invoiceDate)
    const record = invoicePayload(entity, input, invoiceDate, parts, calc)
    const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: record, overrides: input })
    return res.json({ data: record, fileName: `Invoice-${record.invoice_number.replace(/\//g, '-')}.pdf`, pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function createStoredInvoice(body, expectedNumber = '') {
  const { entity, input, invoiceDate, billing, calc } = await invoiceInput(body)
  const parts = await nextNumberParts(billing, invoiceDate)
  if (expectedNumber && parts.invoiceNumber !== clean(expectedNumber)) throw Object.assign(new Error('Invoice number changed. Return to edit and generate again.'), { statusCode: 409 })
  const payload = invoicePayload(entity, input, invoiceDate, parts, calc)
  payload.invoice_display_id = await nextInvoiceDisplayId()
  const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: payload, overrides: input })
  payload.pdf_storage_path = await uploadInvoicePdf(entity.id, payload.invoice_display_id, pdf)
  const { data, error } = await supabase.from('invoices').insert(payload).select(INVOICE_FIELDS).single()
  if (error) {
    await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([payload.pdf_storage_path])
    throw error
  }
  const versionResult = await supabase.from('invoice_pdf_versions').insert({ invoice_id: data.id, storage_path: payload.pdf_storage_path })
  if (versionResult.error) {
    await supabase.from('invoices').delete().eq('id', data.id)
    await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([payload.pdf_storage_path])
    throw versionResult.error
  }
  return { record: decorateInvoice(data), pdf }
}

async function generate(req, res) {
  try {
    const { record, pdf } = await createStoredInvoice(req.body)
    return res.status(201).json({ data: record, fileName: `Invoice-${record.invoice_number.replace(/\//g, '-')}.pdf`, pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function commitPreview(req, res) {
  try {
    const { record } = await createStoredInvoice(req.body, req.body.invoice_number)
    return res.status(201).json({ data: record, fileName: `Invoice-${record.invoice_number.replace(/\//g, '-')}.pdf` })
  } catch (err) { return sendError(res, err) }
}

async function regenerationData(invoiceId, body) {
  const { data: existing, error } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (error) throw error
  if (!existing) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  const { entity, input, calc } = await invoiceInput({ ...existing, ...body, invoice_entity_id: existing.invoice_entity_id })
  const updated = { ...invoicePayload(entity, input, input.invoice_date || existing.invoice_date, { invoiceNumber: existing.invoice_number, financialYear: existing.financial_year, sequence: existing.sequence_number }, calc), invoice_display_id: existing.invoice_display_id }
  const pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: updated, overrides: input })
  return { existing, entity, updated, pdf }
}

async function previewRegeneration(req, res) {
  try {
    const { existing, updated, pdf } = await regenerationData(req.params.id, req.body)
    return res.json({ data: { ...updated, id: existing.id }, fileName: `Invoice-${existing.invoice_number.replace(/\//g, '-')}.pdf`, pdfBase64: pdf.toString('base64') })
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
    const { data, error: updateError } = await supabase.from('invoices').update(updated).eq('id', existing.id).select(INVOICE_FIELDS).single()
    if (updateError) {
      await supabase.from('invoice_pdf_versions').delete().eq('id', versionResult.data.id)
      await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([storagePath])
      throw updateError
    }
    return res.json({ data: decorateInvoice(data), version: decoratePdfVersion(versionResult.data), fileName: `Invoice-${existing.invoice_number.replace(/\//g, '-')}.pdf`, pdfBase64: pdf.toString('base64') })
  } catch (err) { return sendError(res, err) }
}

async function deletePdfVersion(req, res) {
  try {
    const { data: version, error } = await supabase.from('invoice_pdf_versions').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!version) return res.status(404).json({ error: 'Invoice PDF version not found' })
    const { error: storageError } = await supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove([version.storage_path])
    if (storageError) throw storageError
    const { error: deleteError } = await supabase.from('invoice_pdf_versions').delete().eq('id', version.id)
    if (deleteError) throw deleteError
    const { data: invoice } = await supabase.from('invoices').select('pdf_storage_path').eq('id', version.invoice_id).maybeSingle()
    if (invoice?.pdf_storage_path === version.storage_path) {
      const { data: latest } = await supabase.from('invoice_pdf_versions').select('storage_path').eq('invoice_id', version.invoice_id).order('created_at', { ascending: false }).limit(1)
      await supabase.from('invoices').update({ pdf_storage_path: latest?.[0]?.storage_path || null }).eq('id', version.invoice_id)
    }
    return res.json({ ok: true })
  } catch (err) { return sendError(res, err) }
}

module.exports = { listEntities, getEntity, createEntity, updateEntity, deleteEntity, nextNumber, preview, generate, commitPreview, previewRegeneration, regenerate, deletePdfVersion }
