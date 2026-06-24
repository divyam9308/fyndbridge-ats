export const INVOICE_MODELS = [
  ['joining_percentage', 'Joining % Model'], ['joining_flat_fee', 'Joining Flat Fee'], ['retainer', 'Retainer'],
  ['jra_adjustment_percentage', 'JRA Adjustment %'], ['jra_adjustment_flat_fee', 'JRA Adjustment Flat Fee'], ['project', 'Project'], ['others', 'Others']
]
export const INVOICE_MODEL_LABELS = Object.fromEntries(INVOICE_MODELS)
export const EMPTY_INVOICE = {
  consultant_name: '', candidate_name: '', professional_fee_text: '', model: 'joining_percentage', ctc_lpa: '', model_percent: '',
  model_flat_fee: '', retainer_amount: '', project_amount: '', jra_adjustment_value: '', jra_base_value: '', jra_flat_fee: '',
  others_amount: '', sac: '998512', billing_entity: 'FCS', gst_component: 'IGST', igst_rate: 18, cgst_rate: 9, sgst_rate: 9
}
const number = value => Number(String(value ?? '').replace(/₹|â‚¹|Rs\.?|,/gi, '').trim() || 0)
export function calculateInvoicePreview(form) {
  const ctc = number(form.ctc_lpa)
  let taxable = 0
  if (form.model === 'joining_percentage') taxable = ctc * number(form.model_percent) / 100
  if (form.model === 'joining_flat_fee') taxable = number(form.model_flat_fee)
  if (form.model === 'retainer') taxable = number(form.retainer_amount)
  if (form.model === 'project') taxable = number(form.project_amount)
  if (form.model === 'jra_adjustment_percentage') taxable = ctc * number(form.model_percent) / 100 - number(form.jra_adjustment_value)
  if (form.model === 'jra_adjustment_flat_fee') taxable = number(form.jra_base_value) - number(form.jra_flat_fee)
  if (form.model === 'others') taxable = number(form.others_amount)
  taxable = Math.max(0, Math.round(taxable * 100) / 100)
  const igst = form.gst_component === 'IGST' ? taxable * number(form.igst_rate) / 100 : 0
  const cgst = form.gst_component === 'CGST_SGST' ? taxable * number(form.cgst_rate) / 100 : 0
  const sgst = form.gst_component === 'CGST_SGST' ? taxable * number(form.sgst_rate) / 100 : 0
  return { taxable, igst, cgst, sgst, grand: Math.round(taxable + igst + cgst + sgst) }
}
