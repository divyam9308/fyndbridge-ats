const MONEY_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const BILLING_ENTITIES = ['FCS', 'FCAPL']

function decimalText(value) {
  const text = String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim()
  if (!text || !MONEY_PATTERN.test(text)) return '0'
  return text
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function moneyToPaise(value) {
  const source = decimalText(value)
  const negative = source.startsWith('-')
  const [whole = '0', fraction = ''] = source.replace(/^[+-]/, '').split('.')
  const padded = `${fraction}000`
  let paise = BigInt(whole || '0') * 100n + BigInt(padded.slice(0, 2))
  if (Number(padded[2]) >= 5) paise += 1n
  return negative ? -paise : paise
}

function roundPaiseToNearestRupee(value) {
  const paise = BigInt(value)
  const negative = paise < 0n
  const absolute = negative ? -paise : paise
  const rounded = ((absolute + 50n) / 100n) * 100n
  return negative ? -rounded : rounded
}

function invoiceMoneyValues(invoice = {}) {
  const billValue = moneyToPaise(invoice.taxable_amount)
  const taxValue = moneyToPaise(invoice.total_tax_amount)
  const fallbackTotal = hasValue(invoice.total_before_rounding)
    ? moneyToPaise(invoice.total_before_rounding)
    : billValue + taxValue
  const totalInvoiceValue = hasValue(invoice.grand_total)
    ? moneyToPaise(invoice.grand_total)
    : roundPaiseToNearestRupee(fallbackTotal)
  return { billValue, taxValue, totalInvoiceValue }
}

function emptyTotals() {
  return { billValue: 0n, taxValue: 0n, totalInvoiceValue: 0n }
}

function aggregateTaxInvoiceTotals(invoices = []) {
  const totals = Object.fromEntries(BILLING_ENTITIES.map(entity => [entity, emptyTotals()]))

  for (const invoice of invoices) {
    if ((invoice?.invoice_type || 'tax_invoice') !== 'tax_invoice' || invoice?.status === 'cancelled') continue
    const billingEntity = String(invoice?.billing_entity || '').trim().toUpperCase()
    if (!totals[billingEntity]) continue
    const values = invoiceMoneyValues(invoice)
    totals[billingEntity].billValue += values.billValue
    totals[billingEntity].taxValue += values.taxValue
    totals[billingEntity].totalInvoiceValue += values.totalInvoiceValue
  }

  return Object.fromEntries(BILLING_ENTITIES.map(entity => [
    entity,
    Object.fromEntries(Object.entries(totals[entity]).map(([key, value]) => [key, value.toString()]))
  ]))
}

module.exports = {
  aggregateTaxInvoiceTotals,
  invoiceMoneyValues,
  moneyToPaise
}
