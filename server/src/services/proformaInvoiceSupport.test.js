const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pdfParse = require('pdf-parse')
const { calculateInvoice, financialYear, renderInvoicePdf, selectInvoiceLayout } = require('./invoiceService')

const root = path.resolve(__dirname, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260717084023_proforma_invoice_support.sql')
const reassignmentMigration = read('supabase/migrations/20260717093241_invoice_entity_reassignment_renumbering.sql')
const correctedSequenceMigration = read('supabase/migrations/20260717094913_proforma_sequence_per_billing_entity_and_fcs_fb_prefix.sql')
const controller = read('server/src/controllers/invoiceController.js')
const routes = read('server/src/routes/invoice.js')
const invoiceApi = read('src/services/invoiceApi.js')
const invoicePage = read('src/pages/InvoicePage.jsx')
const detailPage = read('src/pages/InvoiceEntityDetailPage.jsx')

test('proforma sequences are shared across customer entities within each billing entity', () => {
  assert.match(migration, /set invoice_type = 'tax_invoice'[\s\S]*where invoice_type is null or btrim\(invoice_type\) = ''/)
  assert.match(migration, /alter column invoice_type set default 'tax_invoice'[\s\S]*alter column invoice_type set not null/)
  assert.match(migration, /check \(invoice_type in \('tax_invoice', 'proforma_invoice'\)\)/)
  assert.match(correctedSequenceMigration, /invoices_proforma_invoice_sequence_key[\s\S]*\(billing_entity, financial_year, sequence_number\)[\s\S]*where invoice_type = 'proforma_invoice'/)
  assert.match(correctedSequenceMigration, /where invoice\.billing_entity = p_billing_entity[\s\S]*and invoice\.financial_year = p_financial_year[\s\S]*and invoice\.invoice_type = p_invoice_type/)
  assert.match(correctedSequenceMigration, /v_invoice_type \|\| ':' \|\| v_billing_entity \|\| ':' \|\| v_financial_year/)
  assert.doesNotMatch(correctedSequenceMigration, /all-entities/)
})

test('FCS proformas render PI/FB while the stored billing entity remains FCS', () => {
  assert.match(correctedSequenceMigration, /p_invoice_type = 'proforma_invoice' and p_billing_entity = 'FCS' then 'PI\/FB'/)
  assert.match(correctedSequenceMigration, /v_invoice_type = 'proforma_invoice' and v_billing_entity = 'FCS' then 'PI\/FB'/)
  assert.match(correctedSequenceMigration, /when p_invoice_type = 'proforma_invoice' then 'PI\/FCAPL'/)
  assert.match(correctedSequenceMigration, /when v_invoice_type = 'proforma_invoice' then 'PI\/FCAPL'/)
  assert.match(correctedSequenceMigration, /v_billing_entity not in \('FCS', 'FCAPL'\)/)
  assert.match(correctedSequenceMigration, /billing_entity = v_billing_entity/)
  assert.match(migration, /next_available_invoice_number_by_type\([\s\S]*p_invoice_type text/)
  assert.match(controller, /\.rpc\('next_available_invoice_number_by_type'/)
  assert.match(controller, /p_invoice_type: invoiceType/)
  assert.match(controller, /billingEntity === 'FCS' \? 'PI\/FB' : 'PI\/FCAPL'/)
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

test('invoice reassignment renumbers atomically inside the target billing-entity series', () => {
  assert.match(reassignmentMigration, /update_invoice_with_reassigned_sequence\(/)
  assert.match(correctedSequenceMigration, /select entity\.billing_entity[\s\S]*from public\.invoice_entities entity/)
  assert.match(correctedSequenceMigration, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*v_invoice_type \|\| ':' \|\| v_billing_entity \|\| ':' \|\| v_financial_year/)
  assert.match(correctedSequenceMigration, /v_existing\.financial_year = v_financial_year[\s\S]*and v_existing\.billing_entity = v_billing_entity/)
  assert.match(correctedSequenceMigration, /v_sequence := public\.next_typed_invoice_sequence/)
  assert.match(correctedSequenceMigration, /message = 'INVOICE_NUMBER_CHANGED'/)
  assert.match(correctedSequenceMigration, /billing_entity = v_billing_entity/)
  assert.match(correctedSequenceMigration, /revoke all on function public\.update_invoice_with_reassigned_sequence\(uuid, jsonb, text\)[\s\S]*from public, anon, authenticated/)
  assert.match(correctedSequenceMigration, /grant execute on function public\.update_invoice_with_reassigned_sequence\(uuid, jsonb, text\)[\s\S]*to service_role/)
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

test('FCS and FCAPL proforma PDFs reuse normal invoice layouts with their own PI numbers', async () => {
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
  const layoutCases = [
    { state_code: '09', state: 'Uttar Pradesh', others_amount: '560000' },
    { state_code: '09', state: 'Uttar Pradesh', others_amount: '558720' },
    { state_code: '07', state: 'Delhi', others_amount: '558720' }
  ]
  for (const billingEntity of ['FCS', 'FCAPL']) {
    const invoicePrefix = billingEntity === 'FCS' ? 'PI/FB' : 'PI/FCAPL'
    const taxPrefix = billingEntity === 'FCS' ? 'FB' : 'FCAPL'
    for (const layoutCase of layoutCases) {
      const input = {
        ...entity,
        ...layoutCase,
        billing_entity: billingEntity,
        model: 'others',
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
      const taxNumber = `${taxPrefix}/26-27/001`
      const proformaNumber = `${invoicePrefix}/26-27/001`
      const taxInvoice = { ...baseInvoice, invoice_type: 'tax_invoice', invoice_number: taxNumber }
      const proformaInvoice = { ...baseInvoice, invoice_type: 'proforma_invoice', invoice_number: proformaNumber }
      const tax = await renderInvoicePdf({ entity, invoice: taxInvoice, overrides: input })
      const proforma = await renderInvoicePdf({ entity, invoice: proformaInvoice, overrides: input })
      const taxText = (await pdfParse(tax.buffer)).text
      const proformaText = (await pdfParse(proforma.buffer)).text
      const normalizeDocumentText = (text, title, number) => text
        .replace(title, 'INVOICE TITLE')
        .replace(number, 'INVOICE NUMBER')
        .replace(/\s+/g, ' ')
        .trim()

      assert.strictEqual(selectInvoiceLayout(proformaInvoice), selectInvoiceLayout(taxInvoice))
      assert.equal(
        normalizeDocumentText(proformaText, 'PROFORMA INVOICE', proformaNumber),
        normalizeDocumentText(taxText, 'TAX INVOICE', taxNumber)
      )
      assert.match(proformaText, /PROFORMA INVOICE/)
      assert.ok(proformaText.includes(proformaNumber))
      assert.doesNotMatch(proformaText, /TAX INVOICE/)
      assert.match(proformaText, billingEntity === 'FCS'
        ? /FyndBridge Consulting Services/
        : /FyndBridge Consultants & Advisors Private Limited/)
      assert.equal(tax.pageCount, 1)
      assert.equal(proforma.pageCount, 1)
    }
  }
})
