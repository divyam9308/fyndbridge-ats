const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pdfParse = require('pdf-parse')
const { calculateInvoice, financialYear, renderInvoicePdf } = require('./invoiceService')

const root = path.resolve(__dirname, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260717084023_proforma_invoice_support.sql')
const controller = read('server/src/controllers/invoiceController.js')
const invoicePage = read('src/pages/InvoicePage.jsx')
const detailPage = read('src/pages/InvoiceEntityDetailPage.jsx')

test('existing invoices default to tax and typed series remain independently unique', () => {
  assert.match(migration, /set invoice_type = 'tax_invoice'[\s\S]*where invoice_type is null or btrim\(invoice_type\) = ''/)
  assert.match(migration, /alter column invoice_type set default 'tax_invoice'[\s\S]*alter column invoice_type set not null/)
  assert.match(migration, /check \(invoice_type in \('tax_invoice', 'proforma_invoice'\)\)/)
  assert.match(migration, /unique \(invoice_type, billing_entity, financial_year, sequence_number\)/)
  assert.match(migration, /invoice\.invoice_type = p_invoice_type/)
  assert.match(migration, /v_invoice_type \|\| ':' \|\| v_billing_entity \|\| ':' \|\| v_financial_year/)
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

test('list and lifecycle mutations are scoped by invoice type without replacing tax delete UI', () => {
  const getEntitySection = controller.slice(controller.indexOf('async function getEntity'), controller.indexOf('async function createEntity'))
  const cancelSection = controller.slice(controller.indexOf('async function cancelInvoice'), controller.indexOf('async function deleteInvoice'))
  const deleteSection = controller.slice(controller.indexOf('async function deleteInvoice'), controller.indexOf('module.exports'))
  assert.match(getEntitySection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(cancelSection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(deleteSection, /\.eq\('invoice_type', invoiceType\)/)
  assert.match(controller, /invoice_type: existing\.invoice_type/)
  assert.match(detailPage, /className="row-action-btn invoice-delete-action"/)
  assert.match(detailPage, /onClick=\{\(\) => openAction\('delete', invoice\)\}/)
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

test('proforma PDF changes only the heading and identifying number', async () => {
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
  const input = {
    ...entity,
    billing_entity: 'FCS',
    model: 'others',
    others_amount: '1000',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9,
    professional_fee_text: 'Recruitment services'
  }
  const values = calculateInvoice(input)
  const baseInvoice = {
    ...values,
    billing_entity: 'FCS',
    invoice_date: '2026-07-17',
    sac: entity.sac
  }
  const proforma = await renderInvoicePdf({
    entity,
    invoice: { ...baseInvoice, invoice_type: 'proforma_invoice', invoice_number: 'PI/FCS/26-27/001' },
    overrides: input
  })
  const tax = await renderInvoicePdf({
    entity,
    invoice: { ...baseInvoice, invoice_type: 'tax_invoice', invoice_number: 'FB/26-27/001' },
    overrides: input
  })
  const proformaText = (await pdfParse(proforma.buffer)).text
  const taxText = (await pdfParse(tax.buffer)).text

  assert.match(proformaText, /PROFORMA INVOICE/)
  assert.match(proformaText, /PI\/FCS\/26-27\/001/)
  assert.doesNotMatch(proformaText, /TAX INVOICE/)
  assert.match(taxText, /TAX INVOICE/)
  assert.match(taxText, /FB\/26-27\/001/)
  assert.equal(proforma.pageCount, 1)
  assert.equal(tax.pageCount, 1)
})
