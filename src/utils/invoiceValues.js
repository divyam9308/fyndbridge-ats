const MONEY_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

function decimalText(value) {
  const text = String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim()
  if (!text || !MONEY_PATTERN.test(text)) return '0'
  return text
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

export function moneyToPaise(value) {
  const source = decimalText(value)
  const negative = source.startsWith('-')
  const [whole = '0', fraction = ''] = source.replace(/^[+-]/, '').split('.')
  const padded = `${fraction}000`
  let paise = BigInt(whole || '0') * 100n + BigInt(padded.slice(0, 2))
  if (Number(padded[2]) >= 5) paise += 1n
  return negative ? -paise : paise
}

function indianInteger(value) {
  const digits = String(value)
  if (digits.length <= 3) return digits
  const ending = digits.slice(-3)
  const beginning = digits.slice(0, -3)
  return `${beginning.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${ending}`
}

export function formatInrPaise(value) {
  const paise = BigInt(value)
  const negative = paise < 0n
  const absolute = negative ? -paise : paise
  const rupees = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${negative ? '-' : ''}₹${indianInteger(rupees)}.${fraction}`
}

export function formatInvoiceMoney(value) {
  return formatInrPaise(moneyToPaise(value))
}

export function invoiceMoneyValues(invoice = {}) {
  const billValue = moneyToPaise(invoice.taxable_amount)
  const taxValue = moneyToPaise(invoice.total_tax_amount)
  const totalInvoiceValue = hasValue(invoice.total_before_rounding)
    ? moneyToPaise(invoice.total_before_rounding)
    : billValue + taxValue
  return { billValue, taxValue, totalInvoiceValue }
}

export function aggregateInvoiceValues(invoices = []) {
  return invoices.reduce((totals, invoice) => {
    if (invoice?.status === 'cancelled') return totals
    const values = invoiceMoneyValues(invoice)
    return {
      billValue: totals.billValue + values.billValue,
      taxValue: totals.taxValue + values.taxValue,
      totalInvoiceValue: totals.totalInvoiceValue + values.totalInvoiceValue
    }
  }, { billValue: 0n, taxValue: 0n, totalInvoiceValue: 0n })
}

export function formatInvoicePercentage(value) {
  if (!hasValue(value)) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${numeric.toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`
}
