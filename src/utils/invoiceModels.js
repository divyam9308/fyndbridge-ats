export const INVOICE_MODELS = [
  ['joining_percentage', 'Joining % Model'], ['joining_flat_fee', 'Joining Flat Fee'], ['retainer', 'Retainer'],
  ['jra_adjustment_percentage', 'JRA Adjustment %'], ['jra_adjustment_flat_fee', 'JRA Adjustment Flat Fee'], ['project', 'Project'], ['others', 'Others']
]
export const INVOICE_MODEL_LABELS = Object.fromEntries(INVOICE_MODELS)
export const INVOICE_TYPE_LABELS = {
  tax_invoice: 'Tax Invoice',
  proforma_invoice: 'Proforma Invoice'
}
export const EMPTY_INVOICE = {
  consultant_name: '', candidate_name: '', professional_fee_text: '', model: 'joining_percentage', ctc_lpa: '', model_percent: '',
  model_flat_fee: '', retainer_amount: '', project_amount: '', jra_adjustment_value: '', jra_base_value: '', jra_flat_fee: '',
  others_amount: '', sac: '998512', billing_entity: 'FCS', gst_component: 'IGST', igst_rate: 18, cgst_rate: 9, sgst_rate: 9
}
export function detectInvoiceGstComponent(location = {}) {
  const match = String(location.state_code ?? '').trim().match(/^0*(\d{1,2})$/)
  if (match) {
    const stateCode = Number(match[1])
    const isValidGstStateCode = (stateCode >= 1 && stateCode <= 38) || stateCode === 97 || stateCode === 99
    if (isValidGstStateCode) return stateCode === 7 ? 'CGST_SGST' : 'IGST'
  }
  const text = [location.address, location.state, location.place_of_supply].map(value => String(value ?? '')).join(' ')
  return /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/i.test(text) ? 'CGST_SGST' : 'IGST'
}
const decimalString = value => {
  const text = String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim()
  if (!text) return '0'
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return text
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') : '0'
}
const scaledInteger = (value, decimals) => {
  const source = decimalString(value)
  const negative = source.startsWith('-')
  const [whole = '0', fraction = ''] = source.replace(/^[+-]/, '').split('.')
  const padded = `${fraction}${'0'.repeat(decimals + 1)}`
  let result = BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(padded.slice(0, decimals) || '0')
  if (Number(padded[decimals] || '0') >= 5) result += 1n
  return negative ? -result : result
}
const paise = value => scaledInteger(value, 2)
const percentage = (amount, rate) => (amount * scaledInteger(rate, 4) + 500000n) / 1000000n
const amount = value => Number(value) / 100
export function calculateInvoicePreview(form) {
  let taxablePaise = 0n
  if (form.model === 'joining_percentage') taxablePaise = percentage(paise(form.ctc_lpa), form.model_percent)
  if (form.model === 'joining_flat_fee') taxablePaise = paise(form.model_flat_fee)
  if (form.model === 'retainer') taxablePaise = paise(form.retainer_amount)
  if (form.model === 'project') taxablePaise = paise(form.project_amount)
  if (form.model === 'jra_adjustment_percentage') taxablePaise = percentage(paise(form.ctc_lpa), form.model_percent) - paise(form.jra_adjustment_value)
  if (form.model === 'jra_adjustment_flat_fee') taxablePaise = paise(form.jra_base_value) - paise(form.jra_flat_fee)
  if (form.model === 'others') taxablePaise = paise(form.others_amount)
  taxablePaise = taxablePaise < 0n ? 0n : taxablePaise
  const igstPaise = form.gst_component === 'IGST' ? percentage(taxablePaise, form.igst_rate) : 0n
  const cgstPaise = form.gst_component === 'CGST_SGST' ? percentage(taxablePaise, form.cgst_rate) : 0n
  const sgstPaise = form.gst_component === 'CGST_SGST' ? percentage(taxablePaise, form.sgst_rate) : 0n
  const exactPaise = taxablePaise + igstPaise + cgstPaise + sgstPaise
  const wholeRupees = exactPaise / 100n + (exactPaise % 100n >= 50n ? 1n : 0n)
  return { taxable: amount(taxablePaise), igst: amount(igstPaise), cgst: amount(cgstPaise), sgst: amount(sgstPaise), grand: Number(wholeRupees) }
}
