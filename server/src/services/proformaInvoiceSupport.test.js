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

test('list and cancellation are scoped by invoice type while permanent deletion stays unavailable', () => {
  const getEntitySection = controller.slice(controller.indexOf('async function getEntity'), controller.indexOf('async function createEntity'))
  const cancelSection = controller.slice(controller.indexOf('async function cancelInvoice'), controller.indexOf('module.exports'))
  assert.match(getEntitySection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(cancelSection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(controller, /invoice_type: existing\.invoice_type/)
  assert.doesNotMatch(routes, /router\.delete\('\/entities\/:entityId\/invoices\/:id'/)
  assert.doesNotMatch(routes, /router\.delete\('\/invoice-pdf-versions\/:id'/)
  assert.doesNotMatch(controller, /async function deleteInvoice\(/)
  assert.doesNotMatch(controller, /async function deletePdfVersion\(/)
  assert.doesNotMatch(invoiceApi, /export const deleteInvoice =/)
  assert.doesNotMatch(invoiceApi, /export const deleteInvoicePdfVersion =/)
  assert.doesNotMatch(detailPage, /invoice-delete-action|invoice-version-delete|Delete Invoice|Delete this PDF version/)
})

test('regeneration can move an invoice to another legal entity without changing invoice identity', () => {
  const regenerationSection = controller.slice(controller.indexOf('async function regenerationData'), controller.indexOf('async function previewRegeneration'))
  assert.match(regenerationSection, /targetEntityId = clean\(body\.invoice_entity_id\) \|\| existing\.invoice_entity_id/)
  assert.match(regenerationSection, /invoice_entity_id: targetEntityId/)
  assert.match(regenerationSection, /\{ billingEntity: existing\.billing_entity \}/)
  assert.match(regenerationSection, /invoiceNumber: existing\.invoice_number/)
  assert.match(regenerationSection, /financialYear: existing\.financial_year/)
  assert.match(regenerationSection, /sequence: existing\.sequence_number/)
  assert.match(detailPage, /<h3>Select Entity<\/h3><select className="form-control" value=\{form\.invoice_entity_id\}/)
  assert.match(detailPage, /fetchInvoiceEntities\(\)/)
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
