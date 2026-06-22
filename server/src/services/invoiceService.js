const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const MODELS = new Set(['joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others'])
const GST_COMPONENTS = new Set(['IGST', 'CGST_SGST'])
const BILLING_ENTITIES = new Set(['FCS', 'FCAPL'])

const COMPANY = {
  FCS: {
    name: 'FyndBridge Consulting Services',
    address: ['Ground Floor, 20, Okhla Industrial Estate Phase 3,', 'New Delhi, South East Delhi, Delhi, 110020'],
    gst: 'GSTIN: 07AAJFF1433D1ZV',
    pan: 'AAJFF1433D',
    bank: ['ICICI Bank Limited', '102305501028', 'ICIC0001023', 'D-1, Alaknanda Shopping Complex,', 'New Delhi - 110019'],
    sign: ['For FyndBridge Consulting Services', 'Authorized Signatory'],
    prefix: 'FB',
    feeLabel: 'Professional Fees'
  },
  FCAPL: {
    name: 'FyndBridge Consultants & Advisors Private Limited',
    address: ['Second Floor, House No- A-34, Pocket A-8,', 'Kalkaji Extension, Behind Aggarwal Sweet House,', 'New Delhi, South East Delhi, Delhi - 110019'],
    gst: 'GSTIN: 07AAFCF8821L1ZA  |  CIN: U70200DL2024PTC429251',
    pan: 'AAFCF8821L',
    bank: ['State Bank of India', '42926962136', 'SBIN0000727', '233 OKHLA INDUSTRIAL ESTATE,', 'New Delhi - 110020'],
    sign: ['For FyndBridge Consultants & Advisors', 'Private Limited', 'Authorized Signatory'],
    prefix: 'FCAPL',
    feeLabel: 'Professional Fee'
  }
}

const NAVY = '#001264'
const BORDER = '#31508f'
const LIGHT = '#f4f7ff'
const WHITE = '#ffffff'
const REGULAR_FONT = 'InvoiceRegular'
const BOLD_FONT = 'InvoiceBold'

const firstExisting = (items) => items.find(item => fs.existsSync(item))
const FONT_PATHS = {
  regular: firstExisting([
    'C:/Windows/Fonts/ARIALUNI.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ]),
  bold: firstExisting([
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  ])
}

const n = (value) => Number(value || 0)
const money = (value, decimals = 2) => Math.round(n(value) * 100) / 100
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

function financialYear(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`)
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`
}

function detectGstComponent(...values) {
  const text = values.map(clean).join(' ').toLowerCase()
  return /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/.test(text) ? 'CGST_SGST' : 'IGST'
}

function calculateTaxable(input) {
  const model = input.model
  if (!MODELS.has(model)) throw new Error('Invalid model')
  const ctc = n(input.ctc_lpa) * 100000
  const required = (field, label) => {
    if (input[field] === '' || input[field] === null || input[field] === undefined) throw new Error(`${label} is required`)
    if (n(input[field]) < 0) throw new Error(`${label} must be non-negative`)
  }
  if (['joining_percentage', 'project', 'jra_adjustment_percentage'].includes(model)) {
    required('ctc_lpa', 'CTC')
    required('model_percent', 'Percent Value')
  }
  if (model === 'joining_flat_fee') required('model_flat_fee', 'Flat Fee Value')
  if (model === 'retainer') required('retainer_amount', 'Retainer Amount')
  if (model === 'jra_adjustment_percentage') required('jra_adjustment_value', 'Adjustment Value')
  if (model === 'jra_adjustment_flat_fee') {
    required('jra_base_value', 'Value')
    required('jra_flat_fee', 'Flat Fee / Adjustment')
  }
  if (model === 'others') required('others_amount', 'Amount')
  if (['joining_percentage', 'project'].includes(model)) return money(ctc * n(input.model_percent) / 100)
  if (model === 'joining_flat_fee') return money(input.model_flat_fee)
  if (model === 'retainer') return money(input.retainer_amount)
  if (model === 'jra_adjustment_percentage') return money(ctc * n(input.model_percent) / 100 - n(input.jra_adjustment_value))
  if (model === 'jra_adjustment_flat_fee') return money(n(input.jra_base_value) - n(input.jra_flat_fee))
  return money(input.others_amount)
}

function calculateInvoice(input) {
  if (!BILLING_ENTITIES.has(input.billing_entity)) throw new Error('Invalid billing entity')
  const gstComponent = GST_COMPONENTS.has(input.gst_component) ? input.gst_component : detectGstComponent(input.address, input.state, input.place_of_supply)
  const taxable = calculateTaxable(input)
  if (taxable < 0) throw new Error('Taxable amount cannot be negative')
  const igstAmount = gstComponent === 'IGST' ? money(taxable * n(input.igst_rate || 18) / 100) : null
  const cgstAmount = gstComponent === 'CGST_SGST' ? money(taxable * n(input.cgst_rate || 9) / 100) : null
  const sgstAmount = gstComponent === 'CGST_SGST' ? money(taxable * n(input.sgst_rate || 9) / 100) : null
  const tax = money((igstAmount || 0) + (cgstAmount || 0) + (sgstAmount || 0))
  const before = money(taxable + tax)
  const grand = Math.round(before)
  const rounding = money(Math.abs(grand - before))
  return {
    taxable_amount: taxable,
    gst_component: gstComponent,
    igst_rate: gstComponent === 'IGST' ? n(input.igst_rate || 18) : null,
    igst_amount: igstAmount,
    cgst_rate: gstComponent === 'CGST_SGST' ? n(input.cgst_rate || 9) : null,
    cgst_amount: cgstAmount,
    sgst_rate: gstComponent === 'CGST_SGST' ? n(input.sgst_rate || 9) : null,
    sgst_amount: sgstAmount,
    total_tax_amount: tax,
    total_before_rounding: before,
    rounding_type: rounding ? (grand > before ? 'MORE' : 'LESS') : null,
    rounding_amount: rounding,
    grand_total: grand,
    amount_in_words: `INR ${amountWords(grand)} Only`,
    tax_amount_in_words: `${input.billing_entity === 'FCAPL' && !String(tax).includes('.') ? 'INR ' : ''}${amountWords(tax)} Only`
  }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function under100(num) {
  if (num < 20) return ONES[num]
  return [TENS[Math.floor(num / 10)], ONES[num % 10]].filter(Boolean).join(' ')
}
function under1000(num) {
  const hundred = Math.floor(num / 100)
  const rest = num % 100
  return [hundred ? `${ONES[hundred]} Hundred` : '', rest ? under100(rest) : ''].filter(Boolean).join(' ')
}
function rupeeWords(num) {
  let value = Math.floor(Math.abs(n(num)))
  if (!value) return 'Zero'
  const parts = []
  const crore = Math.floor(value / 10000000); value %= 10000000
  const lakh = Math.floor(value / 100000); value %= 100000
  const thousand = Math.floor(value / 1000); value %= 1000
  if (crore) parts.push(`${under1000(crore)} Crore`)
  if (lakh) parts.push(`${under1000(lakh)} Lakh`)
  if (thousand) parts.push(`${under1000(thousand)} Thousand`)
  if (value) parts.push(under1000(value))
  return parts.join(' ')
}
function amountWords(value) {
  const rupees = Math.floor(n(value))
  const paise = Math.round((n(value) - rupees) * 100)
  return paise ? `${rupeeWords(rupees)} and ${rupeeWords(paise)} Paise` : rupeeWords(rupees)
}

function formatRs(value, decimals = 0) {
  return `₹${n(value).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function normalizeInvoiceText(value) {
  return String(value || '')
    .replace(/CTC in LPA/gi, 'CTC')
    .replace(/Â¹|â‚¹|¹|\?{1,3}(?=\d)/g, '₹')
    .replace(/\bRs\.?\s*/gi, '₹')
    .replace(/₹\s+/g, '₹')
}

function setupFonts(doc) {
  if (FONT_PATHS.regular) doc.registerFont(REGULAR_FONT, FONT_PATHS.regular)
  if (FONT_PATHS.bold) doc.registerFont(BOLD_FONT, FONT_PATHS.bold)
  return {
    regular: FONT_PATHS.regular ? REGULAR_FONT : 'Helvetica',
    bold: FONT_PATHS.bold ? BOLD_FONT : 'Helvetica-Bold'
  }
}

function drawCell(doc, x, y, w, h, text, opts = {}) {
  const fonts = doc._invoiceFonts || { regular: 'Helvetica', bold: 'Helvetica-Bold' }
  const padding = opts.padding ?? 6
  doc.save()
  doc.lineWidth(opts.lineWidth || 0.7).strokeColor(opts.strokeColor || BORDER)
  if (opts.fill) doc.rect(x, y, w, h).fillAndStroke(opts.fill, opts.strokeColor || BORDER)
  else doc.rect(x, y, w, h).stroke()
  doc.fillColor(opts.textColor || '#111827').font(opts.bold ? fonts.bold : fonts.regular).fontSize(opts.size || 8)
  doc.text(String(text ?? ''), x + padding, y + padding, {
    width: w - padding * 2,
    height: h - padding * 2,
    align: opts.align || 'left',
    valign: opts.valign || 'top'
  })
  doc.restore()
}

function createInvoicePdf({ entity, invoice, overrides }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28 })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc._invoiceFonts = setupFonts(doc)
    const F = doc._invoiceFonts

    const company = COMPANY[invoice.billing_entity]
    const logo = path.join(__dirname, '../../../public/assets/fyndbridge-official-logo.png')
    if (fs.existsSync(logo)) doc.image(logo, 32, 24, { width: 92 })
    doc.fillColor(NAVY).font(F.bold).fontSize(15).text('TAX INVOICE', 250, 28, { align: 'center', width: 110 })
    doc.save().lineWidth(0.7).strokeColor(BORDER).rect(32, 64, 530, 92).stroke().moveTo(320, 64).lineTo(320, 156).stroke().restore()
    doc.fontSize(11).text(company.name, 40, 70)
    doc.fillColor('#111827').font(F.regular).fontSize(8.5)
    company.address.forEach((line, index) => doc.text(`${index === 0 ? 'Regd Office: ' : ''}${line}`, { continued: false }))
    doc.text('Mobile: 9717773066  |  Tel: 9717773066')
    doc.text('Email: partner@fyndbridge.in  |  www.fyndbridge.in')
    doc.text('State: Delhi   State Code: 07')
    doc.text(company.gst)

    drawCell(doc, 350, 72, 112, 22, 'Invoice No.', { bold: true, fill: NAVY, textColor: WHITE, align: 'center', valign: 'center' })
    drawCell(doc, 462, 72, 80, 22, 'Dated', { bold: true, fill: NAVY, textColor: WHITE, align: 'center', valign: 'center' })
    drawCell(doc, 350, 94, 112, 30, invoice.invoice_number, { size: 7.5, align: 'center', valign: 'center' })
    drawCell(doc, 462, 94, 80, 30, dateDDMMYYYY(invoice.invoice_date), { align: 'center', valign: 'center' })

    let y = 165
    doc.save().lineWidth(0.7).strokeColor(BORDER).rect(32, y - 4, 530, 124).stroke().moveTo(320, y - 4).lineTo(320, y + 120).stroke().restore()
    doc.fillColor(NAVY).font(F.bold).fontSize(9).text('Bill To:', 40, y)
    y += 14
    doc.fillColor('#111827').font(F.bold).fontSize(9).text(entity.legal_entity_name || '-', 40, y, { width: 252 })
    y += 15
    doc.font(F.regular).fontSize(8).text(entity.address || '-', 40, y, { width: 252 })
    const infoX = 330
    const pairs = [['PAN / IT No', entity.pan], ['Place of Supply', entity.place_of_supply], ['State', `${entity.state || '-'}   Code: ${entity.state_code || '-'}`], ['GSTIN', entity.gstin], ['Contact Person', entity.contact_person], ['Email', entity.email]]
    let py = 165
    pairs.forEach(([label, value]) => {
      doc.save().lineWidth(0.5).strokeColor('#c7d2fe').rect(infoX - 8, py - 4, 232, 18).stroke().rect(infoX - 8, py - 4, 96, 18).fillAndStroke('#eef2ff', '#c7d2fe').restore()
      doc.font(F.bold).fontSize(8).text(label, infoX, py, { width: 95 })
      doc.font(F.regular).text(value || '-', infoX + 105, py, { width: 140 })
      py += 18
    })

    y = 288
    const descH = 68
    const header = { bold: true, align: 'center', valign: 'center', fill: NAVY, textColor: WHITE }
    drawCell(doc, 32, y, 42, 24, 'SL.No', header)
    drawCell(doc, 74, y, 255, 24, 'Description of Services', { ...header, align: 'left' })
    drawCell(doc, 329, y, 58, 24, 'SAC', header)
    drawCell(doc, 387, y, 45, 24, 'GST Rate', header)
    drawCell(doc, 432, y, 25, 24, '%', header)
    drawCell(doc, 457, y, 105, 24, 'Amount', { ...header, align: 'right' })
    const desc = `${company.feeLabel}\n${normalizeInvoiceText(overrides.professional_fee_text || entity.professional_fee_text || '')}`
    drawCell(doc, 32, y + 24, 42, descH, '1', { align: 'center', padding: 8 })
    drawCell(doc, 74, y + 24, 255, descH, desc)
    drawCell(doc, 329, y + 24, 58, descH, entity.sac || '998512', { align: 'center' })
    drawCell(doc, 387, y + 24, 45, descH, invoice.gst_component === 'IGST' ? invoice.igst_rate : '', { align: 'center' })
    drawCell(doc, 432, y + 24, 25, descH, invoice.gst_component === 'IGST' ? '%' : '', { align: 'center' })
    drawCell(doc, 457, y + 24, 105, descH, formatRs(invoice.taxable_amount, invoice.rounding_type ? 0 : 0), { align: 'right' })
    y += 24 + descH
    const summaryRow = (label, amount, rate = '', percent = '') => {
      drawCell(doc, 32, y, 42, 20, '')
      drawCell(doc, 74, y, 255, 20, label, { bold: true, padding: 5 })
      drawCell(doc, 329, y, 58, 20, '')
      drawCell(doc, 387, y, 45, 20, rate, { align: 'center', padding: 5 })
      drawCell(doc, 432, y, 25, 20, percent, { align: 'center', padding: 5 })
      drawCell(doc, 457, y, 105, 20, amount, { align: 'right', padding: 5 })
      y += 20
    }
    if (invoice.gst_component === 'IGST') {
      summaryRow('Integrated GST (IGST)', formatRs(invoice.igst_amount, cents(invoice.igst_amount)), invoice.igst_rate, '%')
    } else {
      summaryRow('State GST (SGST)', formatRs(invoice.sgst_amount, cents(invoice.sgst_amount)), invoice.sgst_rate, '%')
      summaryRow('Central GST (CGST)', formatRs(invoice.cgst_amount, cents(invoice.cgst_amount)), invoice.cgst_rate, '%')
    }
    if (invoice.rounding_type) {
      summaryRow('Total before Rounding Off', formatRs(invoice.total_before_rounding, 2))
      summaryRow(`${invoice.rounding_type === 'MORE' ? 'More' : 'Less'} : ROUNDING OFF`, `${invoice.rounding_type === 'MORE' ? '(+)' : '(-)'}${invoice.rounding_amount.toFixed(2)}`)
    }
    ;[[32, 42], [329, 58], [387, 45], [432, 25]].forEach(([x, w]) => drawCell(doc, x, y, w, 22, '', { fill: NAVY }))
    drawCell(doc, 74, y, 255, 22, 'Total', { bold: true, fill: NAVY, textColor: WHITE, padding: 5 })
    drawCell(doc, 457, y, 105, 22, formatRs(invoice.grand_total, invoice.rounding_type ? 2 : 0), { bold: true, align: 'right', fill: NAVY, textColor: WHITE, padding: 5 })
    y += 30

    doc.save().rect(32, y, 530, 30).fillAndStroke(LIGHT, BORDER).restore()
    doc.fillColor(NAVY).font(F.bold).fontSize(7.3).text('Amount Chargeable (in words):', 36, y + 10, { width: 138 })
    doc.fillColor(NAVY).font(F.bold).fontSize(7.3).text(invoice.amount_in_words, 174, y + 10, { width: 378, align: 'right' })
    y += 40
    drawTaxBreakdown(doc, y, invoice, entity.sac || '998512')
    y += invoice.gst_component === 'IGST' ? 74 : 96
    doc.fillColor(NAVY).font(F.bold).fontSize(8).text(`Tax Amount (in words): ${invoice.tax_amount_in_words}`, 32, y, { width: 520 })
    y += 24

    const bottomY = y
    drawCell(doc, 32, bottomY, 300, 84, '', {})
    drawCell(doc, 332, bottomY, 230, 84, '', {})
    doc.fillColor(NAVY).font(F.bold).fontSize(8).text('Description of Services', 40, bottomY + 10)
    doc.fillColor('#111827').font(F.regular).text('Permanent placement services, other than executive\nsearch services', 40, bottomY + 22)
    doc.font(F.bold).text(`Company's PAN: ${company.pan}`, 40, bottomY + 58)
    doc.font(F.regular).text('Tax Payable on reverse charge basis: No', 40, bottomY + 74)
    drawCell(doc, 344, bottomY + 8, 206, 20, "Company's Bank Details", { bold: true, align: 'center', valign: 'center', fill: NAVY, textColor: WHITE, padding: 4 })
    const bankLabels = ['Bank Name', 'A/c No.', 'IFSC Code', 'Branch']
    company.bank.forEach((value, index) => {
      const by = bottomY + 28 + index * 11
      drawCell(doc, 344, by, 70, 11, index <= 3 ? bankLabels[index] : '', { bold: true, size: 6.5, padding: 2 })
      drawCell(doc, 414, by, 136, 11, value, { size: 6.5, padding: 2 })
    })
    const sigY = bottomY + 84
    company.sign.slice(0, -1).forEach((line, index) => doc.fillColor(NAVY).font(F.bold).fontSize(8).text(line, 350, sigY + 10 + index * 12, { width: 190, align: 'center' }))
    doc.moveTo(372, sigY + 50).lineTo(540, sigY + 50).strokeColor(BORDER).stroke()
    doc.fillColor('#111827').font(F.regular).fontSize(8).text(company.sign.at(-1), 350, sigY + 56, { width: 190, align: 'center' })
    doc.end()
  })
}

function drawTaxBreakdown(doc, y, invoice, sac) {
  const header = { bold: true, align: 'center', fill: NAVY, textColor: WHITE }
  const total = { bold: true, align: 'center', fill: LIGHT }
  drawCell(doc, 32, y, 70, 22, 'SAC', header)
  drawCell(doc, 102, y, 115, 22, 'Taxable Value', header)
  if (invoice.gst_component === 'IGST') {
    drawCell(doc, 217, y, 165, 22, 'Integrated GST (IGST) - Rate', header)
    drawCell(doc, 382, y, 110, 22, 'IGST Amount', header)
    drawCell(doc, 32, y + 22, 70, 22, sac, { align: 'center' })
    drawCell(doc, 102, y + 22, 115, 22, formatRs(invoice.taxable_amount, invoice.rounding_type ? 2 : 0), { align: 'right' })
    drawCell(doc, 217, y + 22, 165, 22, `${invoice.igst_rate}%`, { align: 'center' })
    drawCell(doc, 382, y + 22, 110, 22, formatRs(invoice.igst_amount, cents(invoice.igst_amount)), { align: 'right' })
    drawCell(doc, 32, y + 44, 70, 22, 'Total', total)
    drawCell(doc, 102, y + 44, 115, 22, formatRs(invoice.taxable_amount, invoice.rounding_type ? 2 : 0), { ...total, align: 'right' })
    drawCell(doc, 217, y + 44, 165, 22, '', total)
    drawCell(doc, 382, y + 44, 110, 22, formatRs(invoice.igst_amount, cents(invoice.igst_amount)), { ...total, align: 'right' })
  } else {
    drawCell(doc, 217, y, 105, 22, 'GST Component', header)
    drawCell(doc, 322, y, 70, 22, 'Rate', header)
    drawCell(doc, 392, y, 100, 22, 'Amount', header)
    ;['SGST', 'CGST'].forEach((label, index) => {
      const rowY = y + 22 + index * 22
      const amount = label === 'SGST' ? invoice.sgst_amount : invoice.cgst_amount
      const rate = label === 'SGST' ? invoice.sgst_rate : invoice.cgst_rate
      drawCell(doc, 32, rowY, 70, 22, sac, { align: 'center' })
      drawCell(doc, 102, rowY, 115, 22, formatRs(invoice.taxable_amount, invoice.rounding_type ? 2 : 0), { align: 'right' })
      drawCell(doc, 217, rowY, 105, 22, label, { align: 'center' })
      drawCell(doc, 322, rowY, 70, 22, `${rate}%`, { align: 'center' })
      drawCell(doc, 392, rowY, 100, 22, formatRs(amount, cents(amount)), { align: 'right' })
    })
    drawCell(doc, 32, y + 66, 70, 22, 'Total', total)
    drawCell(doc, 102, y + 66, 115, 22, formatRs(invoice.taxable_amount, invoice.rounding_type ? 2 : 0), { ...total, align: 'right' })
    drawCell(doc, 217, y + 66, 175, 22, '', total)
    drawCell(doc, 392, y + 66, 100, 22, formatRs(invoice.total_tax_amount, cents(invoice.total_tax_amount)), { ...total, align: 'right' })
  }
}

function cents(value) {
  return Math.round(n(value) * 100) % 100 ? 2 : 0
}

function dateDDMMYYYY(value) {
  const date = new Date(`${value}T00:00:00`)
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`
}

module.exports = {
  MODELS,
  GST_COMPONENTS,
  BILLING_ENTITIES,
  COMPANY,
  clean,
  financialYear,
  detectGstComponent,
  calculateInvoice,
  amountWords,
  formatRs,
  createInvoicePdf
}
