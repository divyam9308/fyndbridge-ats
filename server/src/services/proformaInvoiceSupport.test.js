const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pdfParse = require('pdf-parse')
const { calculateInvoice, financialYear, renderInvoicePdf } = require('./invoiceService')

const root = path.resolve(__dirname, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260717084023_proforma_invoice_support.sql')
const sharedSequenceMigration = read('supabase/migrations/20260717091000_shared_proforma_invoice_sequence.sql')
const reassignmentMigration = read('supabase/migrations/20260717093241_invoice_entity_reassignment_renumbering.sql')
const controller = read('server/src/controllers/invoiceController.js')
const routes = read('server/src/routes/invoice.js')
const invoiceApi = read('src/services/invoiceApi.js')
const invoicePage = read('src/pages/InvoicePage.jsx')
const detailPage = read('src/pages/InvoiceEntityDetailPage.jsx')

test('tax sequences stay entity-scoped while proforma sequences are shared across entities', () => {
  assert.match(migration, /set invoice_type = 'tax_invoice'[\s\S]*where invoice_type is null or btrim\(invoice_type\) = ''/)
  assert.match(migration, /alter column invoice_type set default 'tax_invoice'[\s\S]*alter column invoice_type set not null/)
  assert.match(migration, /check \(invoice_type in \('tax_invoice', 'proforma_invoice'\)\)/)
  assert.match(sharedSequenceMigration, /unique index if not exists invoices_tax_invoice_sequence_key[\s\S]*\(billing_entity, financial_year, sequence_number\)[\s\S]*where invoice_type = 'tax_invoice'/)
  assert.match(sharedSequenceMigration, /unique index if not exists invoices_proforma_invoice_sequence_key[\s\S]*\(financial_year, sequence_number\)[\s\S]*where invoice_type = 'proforma_invoice'/)
  assert.match(sharedSequenceMigration, /p_invoice_type = 'proforma_invoice'[\s\S]*or invoice\.billing_entity = p_billing_entity/)
  assert.match(sharedSequenceMigration, /when v_invoice_type = 'proforma_invoice' then 'all-entities'[\s\S]*else v_billing_entity/)
  assert.match(sharedSequenceMigration, /v_invoice_type \|\| ':' \|\| v_sequence_scope \|\| ':' \|\| v_financial_year/)
})

test('proforma and tax formats are generated from separate typed database series', () => {
  assert.match(migration, /when p_invoice_type = 'proforma_invoice' then 'PI\/' \|\| p_billing_entity/)
  assert.match(migration, /when v_invoice_type = 'proforma_invoice' then 'PI\/' \|\| v_billing_entity/)
  assert.match(migration, /when p_billing_entity = 'FCAPL' then 'FCAPL'[\s\S]*else 'FB'/)
  assert.match(migration, /next_available_invoice_number_by_type\([\s\S]*p_invoice_type text/)
  assert.match(controller, /\.rpc\('next_available_invoice_number_by_type'/)
  assert.match(controller, /p_invoice_type: invoiceType/)
  assert.equal(financialYear('2026-07-17'), '26-27')
  assert.equal(financialYear('2027-04-01'), '27-28')
})

test('list and cancellation are scoped by invoice type while only PDF-version deletion is available', () => {
  const getEntitySection = controller.slice(controller.indexOf('async function getEntity'), controller.indexOf('async function createEntity'))
  const cancelSection = controller.slice(controller.indexOf('async function cancelInvoice'), controller.indexOf('module.exports'))
  assert.match(getEntitySection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(cancelSection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(controller, /invoice_type: existing\.invoice_type/)
  assert.doesNotMatch(routes, /router\.delete\('\/entities\/:entityId\/invoices\/:id'/)
  assert.match(routes, /router\.delete\('\/invoice-pdf-versions\/:id', controller\.deletePdfVersion\)/)
  assert.doesNotMatch(controller, /async function deleteInvoice\(/)
  assert.match(controller, /async function deletePdfVersion\(/)
  assert.doesNotMatch(invoiceApi, /export const deleteInvoice =/)
  assert.match(invoiceApi, /export const deleteInvoicePdfVersion =/)
  assert.match(detailPage, /invoice-version-delete/)
  assert.doesNotMatch(detailPage, /invoice-delete-action|Delete Invoice/)
})

test('regeneration moves an invoice to the selected entity, billing series, and issuer format', () => {
  const regenerationSection = controller.slice(controller.indexOf('async function regenerationData'), controller.indexOf('async function previewRegeneration'))
  const regenerateSection = controller.slice(controller.indexOf('async function regenerate'), controller.indexOf('async function deletePdfVersion'))
  assert.match(regenerationSection, /targetEntityId = clean\(body\.invoice_entity_id\) \|\| existing\.invoice_entity_id/)
  assert.match(regenerationSection, /invoice_entity_id: targetEntityId/)
  assert.match(regenerationSection, /\{ entityControlsInvoice: true \}/)
  assert.match(regenerationSection, /reassignmentNumberParts\(existing, entity, invoiceDate\)/)
  assert.match(regenerationSection, /expectedNumber !== parts\.invoiceNumber/)
  assert.match(regenerateSection, /\.rpc\('update_invoice_with_reassigned_sequence'/)
  assert.match(regenerateSection, /p_expected_invoice_number: updated\.invoice_number/)
  assert.match(controller, /billing_entity: \(entityControlsInvoice \|\| invoiceType === 'proforma_invoice'\) \? entity\.billing_entity \|\| 'FCS'/)
  assert.match(controller, /sac: entityControlsInvoice \? clean\(entity\.sac\) \|\| '998512'/)
  assert.match(controller, /createInvoicePdf\(\{ entity: \{ \.\.\.entity, \.\.\.input \}, invoice: updated/)
  assert.match(detailPage, /<h3>Select Entity<\/h3><select className="form-control" value=\{form\.invoice_entity_id\}/)
  assert.match(detailPage, /fetchInvoiceEntities\(\)/)
  assert.match(detailPage, /billing_entity: nextEntity\.billing_entity \|\| 'FCS'/)
  assert.match(detailPage, /fetchReassignedInvoiceNumber\(invoice\.id, form\.invoice_entity_id, form\.invoice_date\)/)
  assert.match(detailPage, /value=\{form\.billing_entity\} readOnly/)
  assert.match(detailPage, /expected_invoice_number: preview\.data\.invoice_number/)
  assert.match(routes, /router\.get\('\/invoices\/:id\/reassignment-number', controller\.reassignmentNumber\)/)
  assert.match(invoiceApi, /export const fetchReassignedInvoiceNumber =/)
})

test('invoice reassignment renumbers atomically inside tax or shared proforma series', () => {
  assert.match(reassignmentMigration, /update_invoice_with_reassigned_sequence\(/)
  assert.match(reassignmentMigration, /select entity\.billing_entity[\s\S]*from public\.invoice_entities entity/)
  assert.match(reassignmentMigration, /when v_invoice_type = 'proforma_invoice' then 'all-entities'/)
  assert.match(reassignmentMigration, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*v_invoice_type \|\| ':' \|\| v_sequence_scope \|\| ':' \|\| v_financial_year/)
  assert.match(reassignmentMigration, /v_invoice_type = 'proforma_invoice'[\s\S]*or v_existing\.billing_entity = v_billing_entity/)
  assert.match(reassignmentMigration, /v_sequence := public\.next_typed_invoice_sequence/)
  assert.match(reassignmentMigration, /when v_invoice_type = 'proforma_invoice' then 'PI\/' \|\| v_billing_entity[\s\S]*when v_billing_entity = 'FCAPL' then 'FCAPL'[\s\S]*else 'FB'/)
  assert.match(reassignmentMigration, /message = 'INVOICE_NUMBER_CHANGED'/)
  assert.match(reassignmentMigration, /billing_entity = v_billing_entity/)
  assert.match(reassignmentMigration, /revoke all on function public\.update_invoice_with_reassigned_sequence\(uuid, jsonb, text\)[\s\S]*from public, anon, authenticated/)
  assert.match(reassignmentMigration, /grant execute on function public\.update_invoice_with_reassigned_sequence\(uuid, jsonb, text\)[\s\S]*to service_role/)
})

test('creation chooser, URL-backed switcher, KPI isolation, and proforma columns are wired', () => {
  assert.match(invoicePage, /function InvoiceTypeChooser/)
  assert.match(invoicePage, /tax_invoice/)
  assert.match(invoicePage, /proforma_invoice/)
  assert.match(invoicePage, /Create \{typeLabel\}/)
  assert.match(invoicePage, /Automatically determined by the selected entity/)
  assert.match(detailPage, /useSearchParams/)
  assert.match(detailPage, /searchParams\.get\('type'\) === 'proforma'/)
  assert.match(detailPage, /invoiceType === 'tax_invoice' && <InvoiceKpis/)
  assert.match(detailPage, /PROFORMA_DETAIL_COLUMNS = DETAIL_COLUMNS\.filter\(column => !\['bill', 'tax', 'total'\]\.includes\(column\.key\)\)/)
  assert.match(detailPage, /No \{typeLabel\.toLowerCase\(\)\}s found for this entity\./)
})

test('tax and proforma number previews refresh whenever the selected legal entity changes', () => {
  assert.match(invoicePage, /fetchNextInvoiceNumber\(form\.billing_entity \|\| 'FCS', form\.invoice_date \|\| today\(\), invoiceType\)/)
  assert.match(invoicePage, /\[form\.billing_entity, form\.invoice_date, invoiceType, selectedId\]/)
  assert.match(invoicePage, /nextNumberLoading \? 'Loading invoice number\.\.\.' : nextNumberFailed \? 'Unable to load invoice number'/)
  assert.doesNotMatch(invoicePage, /nextNumber \|\| 'Auto-generated'/)
})

test('FCS and FCAPL proforma PDFs use their supplied formats with PI numbers', async () => {
  const entity = {
    legal_entity_name: 'PROFORMA PDF TEST CLIENT',
    optional_name: '-',
    address: '123 TEST STREET, NOIDA, UTTAR PRADESH, 201301',
    pan: 'AABTS7575D',
    place_of_supply: 'Noida',
    state: 'Uttar Pradesh',
    state_code: '09',
    gstin: '09AABTS7575D1Z6',
    contact_person: 'Test Contact',
    email: 'billing@example.com',
    sac: '998312'
  }
  for (const billingEntity of ['FCS', 'FCAPL']) {
    const input = {
      ...entity,
      billing_entity: billingEntity,
      model: 'others',
      others_amount: '100000',
      igst_rate: 18,
      cgst_rate: 9,
      sgst_rate: 9,
      professional_fee_text: 'Professional Fees'
    }
    const baseInvoice = {
      ...calculateInvoice(input),
      billing_entity: billingEntity,
      invoice_date: '2026-07-17',
      sac: entity.sac
    }
    const proforma = await renderInvoicePdf({
      entity,
      invoice: { ...baseInvoice, invoice_type: 'proforma_invoice', invoice_number: `PI/${billingEntity}/26-27/001` },
      overrides: input
    })
    const proformaText = (await pdfParse(proforma.buffer)).text

    assert.match(proformaText, /PROFORMA INVOICE/)
    assert.match(proformaText, new RegExp(`PI\\/${billingEntity}\\/26-27\\/001`))
    assert.doesNotMatch(proformaText, /TAX INVOICE/)
    assert.match(proformaText, billingEntity === 'FCS'
      ? /FyndBridge Consulting Services/
      : /FyndBridge Consultants & Advisors Private Limited/)
    assert.equal(proforma.pageCount, 1)
  }
})
