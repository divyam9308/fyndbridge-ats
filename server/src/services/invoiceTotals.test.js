const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { aggregateTaxInvoiceTotals } = require('./invoiceTotals')

test('invoice totals group all active tax invoices by billing entity', () => {
  const totals = aggregateTaxInvoiceTotals([
    { invoice_type: 'tax_invoice', billing_entity: 'FCS', taxable_amount: '100.10', total_tax_amount: '18.02', grand_total: '118', status: 'active' },
    { invoice_type: 'tax_invoice', billing_entity: 'FCS', taxable_amount: '200.20', total_tax_amount: '36.04', grand_total: '236', status: 'active' },
    { invoice_type: 'tax_invoice', billing_entity: 'FCAPL', taxable_amount: '300.30', total_tax_amount: '54.05', grand_total: '354', status: 'active' }
  ])

  assert.deepEqual(totals, {
    FCS: { billValue: '30030', taxValue: '5406', totalInvoiceValue: '35400' },
    FCAPL: { billValue: '30030', taxValue: '5405', totalInvoiceValue: '35400' }
  })
})

test('invoice totals exclude proformas and cancelled tax invoices', () => {
  const totals = aggregateTaxInvoiceTotals([
    { invoice_type: 'tax_invoice', billing_entity: 'FCS', taxable_amount: '10', total_tax_amount: '1.80', grand_total: '12', status: 'active' },
    { invoice_type: 'proforma_invoice', billing_entity: 'FCS', taxable_amount: '500', total_tax_amount: '90', grand_total: '590', status: 'active' },
    { invoice_type: 'tax_invoice', billing_entity: 'FCAPL', taxable_amount: '700', total_tax_amount: '126', grand_total: '826', status: 'cancelled' }
  ])

  assert.deepEqual(totals, {
    FCS: { billValue: '1000', taxValue: '180', totalInvoiceValue: '1200' },
    FCAPL: { billValue: '0', taxValue: '0', totalInvoiceValue: '0' }
  })
})

test('invoice totals preserve legacy rounded-total fallbacks without floating-point drift', () => {
  const totals = aggregateTaxInvoiceTotals([
    { invoice_type: 'tax_invoice', billing_entity: 'FCS', taxable_amount: '123.45', total_tax_amount: '22.22', total_before_rounding: '145.49', grand_total: null, status: 'active' },
    { invoice_type: 'tax_invoice', billing_entity: 'FCAPL', taxable_amount: '123.45', total_tax_amount: '22.22', total_before_rounding: null, grand_total: null, status: 'active' }
  ])

  assert.equal(totals.FCS.totalInvoiceValue, '14500')
  assert.equal(totals.FCS.billValue, '12345')
  assert.equal(totals.FCAPL.totalInvoiceValue, '14600')
})

test('main invoice response paginates and aggregates only active tax invoices', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../controllers/invoiceController.js'), 'utf8')
  const totalQuery = controller.slice(
    controller.indexOf('async function listTaxInvoiceTotalRows'),
    controller.indexOf('async function listEntities')
  )
  const entityList = controller.slice(
    controller.indexOf('async function listEntities'),
    controller.indexOf('async function getEntity')
  )

  assert.match(totalQuery, /\.eq\('invoice_type', 'tax_invoice'\)/)
  assert.match(totalQuery, /\.eq\('status', 'active'\)/)
  assert.match(totalQuery, /\.range\(from, from \+ INVOICE_TOTAL_PAGE_SIZE - 1\)/)
  assert.match(entityList, /listInvoicePdfVersions\(taxInvoices\.map\(invoice => invoice\.id\)\)/)
  assert.match(entityList, /invoices: taxInvoices\.map\(invoice => \(\{[\s\S]*pdf_versions:/)
  assert.match(entityList, /totals: aggregateTaxInvoiceTotals\(taxInvoices\)/)
})
