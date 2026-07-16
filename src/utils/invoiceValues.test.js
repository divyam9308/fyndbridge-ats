import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateInvoiceValues,
  formatInrPaise,
  invoiceMoneyValues,
  moneyToPaise
} from './invoiceValues.js'

test('invoice aggregate cards sum authoritative bill, tax, and rounded grand-total values', () => {
  const totals = aggregateInvoiceValues([
    { taxable_amount: '10', total_tax_amount: '5', total_before_rounding: '15.49', grand_total: '15', status: 'active' },
    { taxable_amount: '20', total_tax_amount: '10', total_before_rounding: '30.50', grand_total: '31', status: 'active' },
    { taxable_amount: '30', total_tax_amount: '15', total_before_rounding: '45.01', grand_total: '45', status: 'active' }
  ])

  assert.deepEqual(totals, {
    billValue: 6000n,
    taxValue: 3000n,
    totalInvoiceValue: 9100n
  })
  assert.equal(formatInrPaise(totals.billValue), '₹60.00')
  assert.equal(formatInrPaise(totals.taxValue), '₹30.00')
  assert.equal(formatInrPaise(totals.totalInvoiceValue), '₹91.00')
})

test('cancelled invoices remain readable but are excluded from all aggregate values', () => {
  const invoices = [
    { taxable_amount: '10', total_tax_amount: '5', total_before_rounding: '15.49', grand_total: '15', status: 'active' },
    { taxable_amount: '20', total_tax_amount: '10', total_before_rounding: '30.50', grand_total: '31', status: 'cancelled' },
    { taxable_amount: '30', total_tax_amount: '15', total_before_rounding: '45.01', grand_total: '45', status: 'active' }
  ]

  assert.deepEqual(invoiceMoneyValues(invoices[1]), {
    billValue: 2000n,
    taxValue: 1000n,
    totalInvoiceValue: 3100n
  })
  assert.deepEqual(aggregateInvoiceValues(invoices), {
    billValue: 4000n,
    taxValue: 2000n,
    totalInvoiceValue: 6000n
  })
})

test('legacy invoices derive a rounded total from total-before-rounding and then bill plus tax', () => {
  assert.deepEqual(invoiceMoneyValues({
    taxable_amount: '123.45',
    total_tax_amount: '22.22',
    total_before_rounding: '145.49'
  }), {
    billValue: 12345n,
    taxValue: 2222n,
    totalInvoiceValue: 14500n
  })
  assert.deepEqual(invoiceMoneyValues({ taxable_amount: '123.45', total_tax_amount: '22.22' }), {
    billValue: 12345n,
    taxValue: 2222n,
    totalInvoiceValue: 14600n
  })
})

test('money conversion rounds to paise without binary floating-point drift', () => {
  assert.equal(moneyToPaise('1,23,456.789'), 12345679n)
  assert.equal(formatInrPaise(12345679n), '₹1,23,456.79')
})
