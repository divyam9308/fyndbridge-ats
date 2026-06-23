const supabase = require('../services/supabaseAdmin')
const {
  BILLING_ENTITIES,
  GST_COMPONENTS,
  MODELS,
  clean,
  financialYear,
  detectGstComponent,
  calculateInvoice,
  createInvoicePdf
} = require('../services/invoiceService')

const ENTITY_FIELDS = 'id, invoice_id, legal_entity_name, address, pan, place_of_supply, state, state_code, gstin, contact_person, email, model, ctc_lpa, model_percent, model_flat_fee, retainer_amount, jra_adjustment_value, jra_base_value, jra_flat_fee, others_amount, sac, billing_entity, gst_component, igst_rate, cgst_rate, sgst_rate, created_at, updated_at'

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' })
}

function nullable(value) {
  const text = clean(value)
  return text || null
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(/₹|Rs\.?|,/gi, '').trim())
  if (!Number.isFinite(parsed)) throw Object.assign(new Error('Amount fields must be numeric'), { statusCode: 400 })
  return parsed
}

async function nextEntityId() {
  const { data, error } = await supabase.from('invoice_entities').select('invoice_id')
  if (error) throw error
  const max = (data || []).reduce((acc, row) => Math.max(acc, Number(String(row.invoice_id || '').replace(/^IID/i, '')) || 0), 0)
  return `IID${max + 1}`
}

function entityPayload(body) {
  const billing = body.billing_entity
  const gst = body.gst_component || detectGstComponent(body.address, body.state, body.place_of_supply)
  if (!clean(body.legal_entity_name)) throw Object.assign(new Error('Legal Entity Name is required'), { statusCode: 400 })
  if (!clean(body.address)) throw Object.assign(new Error('Address is required'), { statusCode: 400 })
  if (!BILLING_ENTITIES.has(billing)) throw Object.assign(new Error('Billing Entity is required'), { statusCode: 400 })
  if (!clean(body.sac || '998512')) throw Object.assign(new Error('SAC is required'), { statusCode: 400 })
  if (!GST_COMPONENTS.has(gst)) throw Object.assign(new Error('Invalid GST component'), { statusCode: 400 })
  const payload = {
    legal_entity_name: clean(body.legal_entity_name),
    address: clean(body.address),
    pan: nullable(body.pan),
    place_of_supply: nullable(body.place_of_supply),
    state: nullable(body.state),
    state_code: nullable(body.state_code),
    gstin: nullable(body.gstin),
    contact_person: nullable(body.contact_person),
    email: nullable(body.email),
    model: body.model,
    ctc_lpa: numberOrNull(body.ctc_lpa),
    model_percent: numberOrNull(body.model_percent),
    model_flat_fee: numberOrNull(body.model_flat_fee),
    retainer_amount: numberOrNull(body.retainer_amount),
    jra_adjustment_value: numberOrNull(body.jra_adjustment_value),
    jra_base_value: numberOrNull(body.jra_base_value),
    jra_flat_fee: numberOrNull(body.jra_flat_fee),
    others_amount: numberOrNull(body.others_amount),
    sac: clean(body.sac || '998512'),
    billing_entity: billing,
    gst_component: gst,
    igst_rate: numberOrNull(body.igst_rate) ?? 18,
    cgst_rate: numberOrNull(body.cgst_rate) ?? 9,
    sgst_rate: numberOrNull(body.sgst_rate) ?? 9,
    updated_at: new Date().toISOString()
  }
  if (!MODELS.has(payload.model)) throw Object.assign(new Error('Model is required'), { statusCode: 400 })
  calculateInvoice(payload)
  return payload
}

async function listEntities(req, res) {
  try {
    const { data, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).order('created_at', { ascending: false })
    if (error) throw error
    const ids = (data || []).map(row => row.id)
    const invoiceNumbers = new Map()
    if (ids.length) {
      const { data: invoiceRows, error: invoiceError } = await supabase
        .from('invoices')
        .select('invoice_entity_id, invoice_number, created_at')
        .in('invoice_entity_id', ids)
        .order('created_at', { ascending: false })
      if (invoiceError) throw invoiceError
      for (const row of invoiceRows || []) {
        const current = invoiceNumbers.get(row.invoice_entity_id) || []
        current.push(row.invoice_number)
        invoiceNumbers.set(row.invoice_entity_id, current)
      }
    }
    return res.json({ data: (data || []).map(row => {
      const numbers = invoiceNumbers.get(row.id) || []
      return { ...row, latest_invoice_number: numbers[0] || '', invoice_numbers: numbers }
    }) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function createEntity(req, res) {
  try {
    const payload = entityPayload(req.body)
    payload.invoice_id = await nextEntityId()
    const { data, error } = await supabase.from('invoice_entities').insert(payload).select(ENTITY_FIELDS).single()
    if (error) throw error
    return res.status(201).json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function updateEntity(req, res) {
  try {
    const payload = entityPayload(req.body)
    const { data, error } = await supabase.from('invoice_entities').update(payload).eq('id', req.params.id).select(ENTITY_FIELDS).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Entity not found' })
    return res.json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function deleteEntity(req, res) {
  try {
    const { error } = await supabase.from('invoice_entities').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err)
  }
}

async function nextNumberParts(billingEntity, invoiceDate) {
  const fy = financialYear(invoiceDate)
  const { data, error } = await supabase
    .from('invoices')
    .select('sequence_number')
    .eq('billing_entity', billingEntity)
    .eq('financial_year', fy)
    .order('sequence_number', { ascending: false })
    .limit(1)
  if (error) throw error
  const sequence = Number(data?.[0]?.sequence_number || 0) + 1
  const prefix = billingEntity === 'FCAPL' ? 'FCAPL' : 'FB'
  return { financialYear: fy, sequence, invoiceNumber: `${prefix}/${fy}/${String(sequence).padStart(3, '0')}` }
}

async function nextNumber(req, res) {
  try {
    const billing = req.query.billing_entity || 'FCS'
    if (!BILLING_ENTITIES.has(billing)) return res.status(400).json({ error: 'Invalid billing entity' })
    const parts = await nextNumberParts(billing, req.query.invoice_date || new Date().toISOString().slice(0, 10))
    return res.json(parts)
  } catch (err) {
    return sendError(res, err)
  }
}

async function generate(req, res) {
  try {
    const entityId = req.body.invoice_entity_id || req.body.entity_id
    const { data: entity, error } = await supabase.from('invoice_entities').select(ENTITY_FIELDS).eq('id', entityId).maybeSingle()
    if (error) throw error
    if (!entity) return res.status(404).json({ error: 'Entity not found' })
    const input = { ...entity, ...req.body }
    const invoiceDate = req.body.invoice_date || new Date().toISOString().slice(0, 10)
    const billing = input.billing_entity
    if (!clean(input.professional_fee_text)) return res.status(400).json({ error: 'Professional Fee Text is required' })
    if (!MODELS.has(input.model)) return res.status(400).json({ error: 'Model is required' })
    const calc = calculateInvoice(input)

    let record
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = await nextNumberParts(billing, invoiceDate)
      const payload = {
        invoice_entity_id: entity.id,
        billing_entity: billing,
        invoice_number: parts.invoiceNumber,
        financial_year: parts.financialYear,
        sequence_number: parts.sequence,
        invoice_date: invoiceDate,
        professional_fee_text: clean(input.professional_fee_text),
        model: input.model,
        ctc_lpa: numberOrNull(input.ctc_lpa),
        model_percent: numberOrNull(input.model_percent),
        model_flat_fee: numberOrNull(input.model_flat_fee),
        retainer_amount: numberOrNull(input.retainer_amount),
        jra_adjustment_value: numberOrNull(input.jra_adjustment_value),
        jra_base_value: numberOrNull(input.jra_base_value),
        jra_flat_fee: numberOrNull(input.jra_flat_fee),
        others_amount: numberOrNull(input.others_amount),
        sac: clean(input.sac || entity.sac || '998512'),
        ...calc
      }
      const result = await supabase.from('invoices').insert(payload).select('*').single()
      if (!result.error) {
        record = result.data
        break
      }
      if (result.error.code !== '23505') throw result.error
    }
    if (!record) throw new Error('Unable to reserve invoice number')
    const fileName = `Invoice-${record.invoice_number.replace(/\//g, '-')}.pdf`
    let pdf
    try {
      pdf = await createInvoicePdf({ entity: { ...entity, ...input }, invoice: record, overrides: input })
      const { data, error: updateError } = await supabase.from('invoices').update({ pdf_storage_path: fileName }).eq('id', record.id).select('*').single()
      if (updateError) throw updateError
      record = data
    } catch (pdfError) {
      await supabase.from('invoices').delete().eq('id', record.id)
      throw pdfError
    }
    return res.json({
      data: record,
      fileName,
      pdfBase64: pdf.toString('base64')
    })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = { listEntities, createEntity, updateEntity, deleteEntity, nextNumber, generate }
