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
    mobile: '9717773066',
    telephone: '9717773066',
    email: 'partner@fyndbridge.in',
    website: 'www.fyndbridge.in',
    state: 'Delhi',
    stateCode: '07',
    gst: 'GSTIN: 07AAJFF1433D1ZV',
    pan: 'AAJFF1433D',
    bank: {
      name: 'ICICI Bank Limited',
      account: '102305501028',
      ifsc: 'ICIC0001023',
      branch: 'D-1, Alaknanda Shopping Complex, New Delhi - 110019'
    },
    reverseCharge: 'Tax Payable on reverse charge basis : No',
    prefix: 'FB',
    feeLabel: 'Professional Fees'
  },
  FCAPL: {
    name: 'FyndBridge Consultants & Advisors Private Limited',
    address: ['Second Floor, House No- A-34, Pocket A-8,', 'Kalkaji Extension, Behind Aggarwal Sweet House,', 'New Delhi, South East Delhi, Delhi - 110019'],
    mobile: '9717773066',
    telephone: '9717773066',
    email: 'partner@fyndbridge.in',
    website: 'www.fyndbridge.in',
    state: 'Delhi',
    stateCode: '07',
    gst: 'GSTIN: 07AAFCF8821L1ZA  |  CIN: U70200DL2024PTC429251',
    pan: 'AAFCF8821L',
    bank: {
      name: 'State Bank of India',
      account: '42926962136',
      ifsc: 'SBIN0000727',
      branch: '233 Okhla Industrial Estate, New Delhi - 110020'
    },
    reverseCharge: 'Our Payments on reverse charge basis: No',
    prefix: 'FCAPL',
    feeLabel: 'Professional Fee'
  }
}

const BLACK = '#000000'
const REGULAR_FONT = 'InvoiceRegular'
const BOLD_FONT = 'InvoiceBold'
const MONEY_SCALE = 100n
const RATE_SCALE = 10000n

const firstExisting = items => items.find(item => fs.existsSync(item))
const FONT_PATHS = {
  regular: firstExisting([
    path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf'),
    'C:/Windows/Fonts/ARIALUNI.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ]),
  bold: firstExisting([
    path.join(__dirname, '../../assets/fonts/NotoSans-Bold.ttf'),
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  ])
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const isBlank = value => value === '' || value === null || value === undefined

function decimalString(value) {
  const stripped = String(value ?? '')
    .replace(/₹|â‚¹|Rs\.?/gi, '')
    .replace(/,/g, '')
    .trim()
  if (!stripped) return '0'
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(stripped)) return stripped
  const numeric = Number(stripped)
  if (!Number.isFinite(numeric)) throw new Error('Amount fields must be numeric')
  return numeric.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

function parseScaledInteger(value, decimalPlaces) {
  const source = decimalString(value)
  const negative = source.startsWith('-')
  const unsigned = source.replace(/^[+-]/, '')
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.')
  const padded = `${fractionPart}${'0'.repeat(decimalPlaces + 1)}`
  let scaled = BigInt(wholePart || '0') * (10n ** BigInt(decimalPlaces)) + BigInt(padded.slice(0, decimalPlaces) || '0')
  if (Number(padded[decimalPlaces] || '0') >= 5) scaled += 1n
  return negative ? -scaled : scaled
}

const moneyToPaise = value => parseScaledInteger(value, 2)
const rateToUnits = value => parseScaledInteger(value, 4)
const paiseToAmount = value => Number(value) / 100
const numberValue = value => Number(decimalString(value))

function roundedDivision(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Invalid calculation denominator')
  if (numerator < 0n) return -roundedDivision(-numerator, denominator)
  return (numerator + denominator / 2n) / denominator
}

function percentageOfPaise(amountPaise, rate) {
  return roundedDivision(amountPaise * rateToUnits(rate), 100n * RATE_SCALE)
}

function financialYear(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`)
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`
}

function normalizeStateCode(value) {
  const match = clean(value).match(/^0*(\d{1,2})$/)
  if (!match) return ''
  const number = Number(match[1])
  return (number >= 1 && number <= 38) || number === 97 || number === 99 ? String(number).padStart(2, '0') : ''
}

function detectGstComponent(stateCode, ...values) {
  const normalizedCode = normalizeStateCode(stateCode)
  if (normalizedCode) return normalizedCode === '07' ? 'CGST_SGST' : 'IGST'
  const text = [stateCode, ...values].map(clean).join(' ').toLowerCase()
  return /\b(new\s+delhi|delhi|south east delhi|north delhi|south delhi|east delhi|west delhi|central delhi)\b/.test(text) ? 'CGST_SGST' : 'IGST'
}

function validateNonNegative(input, fields, message) {
  fields.forEach(field => {
    if (isBlank(input[field])) return
    const value = numberValue(input[field])
    if (!Number.isFinite(value) || value < 0) throw new Error(message)
  })
}

function calculateTaxablePaise(input) {
  const model = MODELS.has(input.model) ? input.model : 'joining_percentage'
  validateNonNegative(input, ['ctc_lpa', 'model_percent', 'model_flat_fee', 'retainer_amount', 'project_amount', 'jra_adjustment_value', 'jra_base_value', 'jra_flat_fee', 'others_amount'], 'Calculation fields must be numeric and non-negative')
  if (model === 'joining_percentage') return percentageOfPaise(moneyToPaise(input.ctc_lpa), input.model_percent)
  if (model === 'joining_flat_fee') return moneyToPaise(input.model_flat_fee)
  if (model === 'retainer') return moneyToPaise(input.retainer_amount)
  if (model === 'project') return moneyToPaise(input.project_amount)
  if (model === 'jra_adjustment_percentage') return percentageOfPaise(moneyToPaise(input.ctc_lpa), input.model_percent) - moneyToPaise(input.jra_adjustment_value)
  if (model === 'jra_adjustment_flat_fee') return moneyToPaise(input.jra_base_value) - moneyToPaise(input.jra_flat_fee)
  return moneyToPaise(input.others_amount)
}

function roundInvoiceTotalPaise(totalPaise) {
  const exact = BigInt(totalPaise)
  const fraction = ((exact % MONEY_SCALE) + MONEY_SCALE) % MONEY_SCALE
  if (fraction === 0n) return { finalPaise: exact, adjustmentPaise: 0n, type: null }
  if (fraction < 50n) return { finalPaise: exact - fraction, adjustmentPaise: fraction, type: 'LESS' }
  const adjustment = MONEY_SCALE - fraction
  return { finalPaise: exact + adjustment, adjustmentPaise: adjustment, type: 'MORE' }
}

function calculateInvoice(input) {
  if (!BILLING_ENTITIES.has(input.billing_entity)) throw new Error('Invalid billing entity')
  validateNonNegative(input, ['igst_rate', 'cgst_rate', 'sgst_rate'], 'GST rates must be numeric and non-negative')
  const gstComponent = detectGstComponent(input.state_code, input.state, input.place_of_supply, input.address)
  const taxablePaise = calculateTaxablePaise(input)
  if (taxablePaise < 0n) throw new Error('Taxable amount cannot be negative')

  const igstRate = isBlank(input.igst_rate) ? 18 : numberValue(input.igst_rate)
  const cgstRate = isBlank(input.cgst_rate) ? 9 : numberValue(input.cgst_rate)
  const sgstRate = isBlank(input.sgst_rate) ? 9 : numberValue(input.sgst_rate)
  const igstPaise = gstComponent === 'IGST' ? percentageOfPaise(taxablePaise, igstRate) : 0n
  const cgstPaise = gstComponent === 'CGST_SGST' ? percentageOfPaise(taxablePaise, cgstRate) : 0n
  const sgstPaise = gstComponent === 'CGST_SGST' ? percentageOfPaise(taxablePaise, sgstRate) : 0n
  const taxPaise = igstPaise + cgstPaise + sgstPaise
  const beforePaise = taxablePaise + taxPaise
  const rounded = roundInvoiceTotalPaise(beforePaise)

  return {
    taxable_amount: paiseToAmount(taxablePaise),
    gst_component: gstComponent,
    igst_rate: gstComponent === 'IGST' ? igstRate : null,
    igst_amount: gstComponent === 'IGST' ? paiseToAmount(igstPaise) : null,
    cgst_rate: gstComponent === 'CGST_SGST' ? cgstRate : null,
    cgst_amount: gstComponent === 'CGST_SGST' ? paiseToAmount(cgstPaise) : null,
    sgst_rate: gstComponent === 'CGST_SGST' ? sgstRate : null,
    sgst_amount: gstComponent === 'CGST_SGST' ? paiseToAmount(sgstPaise) : null,
    total_tax_amount: paiseToAmount(taxPaise),
    total_before_rounding: paiseToAmount(beforePaise),
    rounding_type: rounded.type,
    rounding_amount: paiseToAmount(rounded.adjustmentPaise),
    grand_total: paiseToAmount(rounded.finalPaise),
    amount_in_words: `INR ${amountWordsFromPaise(rounded.finalPaise)} Only`,
    tax_amount_in_words: `${taxWordsFromPaise(taxPaise)} Only`
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
  let value = Number(BigInt(num))
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
function amountWordsFromPaise(paise) {
  const absolute = BigInt(paise) < 0n ? -BigInt(paise) : BigInt(paise)
  const rupees = absolute / MONEY_SCALE
  const remainder = absolute % MONEY_SCALE
  return remainder ? `${rupeeWords(rupees)} and ${rupeeWords(remainder)} Paise` : rupeeWords(rupees)
}
function taxWordsFromPaise(paise) {
  const absolute = BigInt(paise) < 0n ? -BigInt(paise) : BigInt(paise)
  const rupees = absolute / MONEY_SCALE
  const remainder = absolute % MONEY_SCALE
  return `${rupeeWords(rupees)} Rupees${remainder ? ` and ${rupeeWords(remainder)} Paise` : ''}`
}
function amountWords(value) {
  return amountWordsFromPaise(moneyToPaise(value))
}

function formatRs(value) {
  const paise = moneyToPaise(value)
  const negative = paise < 0n
  const absolute = negative ? -paise : paise
  const rupees = absolute / MONEY_SCALE
  const fraction = String(absolute % MONEY_SCALE).padStart(2, '0')
  return `${negative ? '-' : ''}₹${Number(rupees).toLocaleString('en-IN')}.${fraction}`
}

function normalizeInvoiceText(value) {
  return String(value || '')
    .replace(/CTC in LPA/gi, 'CTC')
    .replace(/Â¹|â‚¹|¹|\?{1,3}(?=\d)/g, '₹')
    .replace(/\bRs\.?\s*/gi, '₹')
    .replace(/₹\s+/g, '₹')
    .replace(/₹([\d,]+)(?:\.(\d{1,2}))?/g, (_, amount, decimals = '') => `₹${amount}.${decimals.padEnd(2, '0')}`)
    .trim()
}

function setupFonts(doc) {
  if (FONT_PATHS.regular) doc.registerFont(REGULAR_FONT, FONT_PATHS.regular)
  if (FONT_PATHS.bold) doc.registerFont(BOLD_FONT, FONT_PATHS.bold)
  return {
    regular: FONT_PATHS.regular ? REGULAR_FONT : 'Helvetica',
    bold: FONT_PATHS.bold ? BOLD_FONT : 'Helvetica-Bold'
  }
}

function line(doc, x1, y1, x2, y2, width = 0.84) {
  doc.save().lineWidth(width).strokeColor(BLACK).moveTo(x1, y1).lineTo(x2, y2).stroke().restore()
}

function rectangle(doc, x, y, width, height, lineWidth = 0.84) {
  doc.save().lineWidth(lineWidth).strokeColor(BLACK).rect(x, y, width, height).stroke().restore()
}

function fitFontSize(doc, text, font, width, height, maxSize, minSize, singleLine = false) {
  let size = maxSize
  const content = String(text ?? '')
  doc.font(font)
  while (size > minSize) {
    doc.fontSize(size)
    const tooWide = singleLine && doc.widthOfString(content) > width
    const tooTall = doc.heightOfString(content, { width, lineGap: 0 }) > height
    if (!tooWide && !tooTall) break
    size -= 0.2
  }
  return Math.max(size, minSize)
}

function textBox(doc, text, x, y, width, height, options = {}) {
  const fonts = doc._invoiceFonts
  const paddingX = options.paddingX ?? 2
  const paddingY = options.paddingY ?? 1.5
  const font = options.bold ? fonts.bold : fonts.regular
  const usableWidth = Math.max(1, width - paddingX * 2)
  const usableHeight = Math.max(1, height - paddingY * 2)
  const size = fitFontSize(doc, text, font, usableWidth, usableHeight, options.size || 7.5, options.minSize || 5.2, options.singleLine)
  doc.fillColor(BLACK).font(font).fontSize(size).text(String(text ?? ''), x + paddingX, y + paddingY, {
    width: usableWidth,
    height: usableHeight,
    align: options.align || 'left',
    lineGap: 0,
    lineBreak: options.singleLine ? false : true
  })
  return { size, height: doc.font(font).fontSize(size).heightOfString(String(text ?? ''), { width: usableWidth, lineGap: 0 }) }
}

function normalizedOptionalName(value) {
  const optionalName = clean(value)
  const placeholder = optionalName.toLowerCase().replace(/[.\s]/g, '')
  return !optionalName || new Set(['-', '--', 'na', 'n/a', 'none', 'null', 'nil', 'notavailable', 'notapplicable', 'undefined']).has(placeholder) ? '' : optionalName
}

function drawClientDetails(doc, entity, x, y, width, height) {
  textBox(doc, 'BILL TO:', x + 1, y + 1, width - 2, 13, { bold: true, size: 7.5, singleLine: true })
  const insetX = x + 2
  const contentWidth = width - 5
  let cursor = y + 14
  const legal = clean(entity.legal_entity_name)
  const legalResult = textBox(doc, legal, insetX, cursor, contentWidth, 23, { bold: true, size: 7.2, minSize: 5.4 })
  cursor += Math.min(23, legalResult.height + 1)
  const optionalName = normalizedOptionalName(entity.optional_name)
  if (optionalName) {
    const optionalResult = textBox(doc, optionalName, insetX, cursor, contentWidth, 12, { size: 7, minSize: 5.2 })
    cursor += Math.min(12, optionalResult.height + 1)
  }
  const detailTop = y + 69
  textBox(doc, clean(entity.address), insetX, cursor, contentWidth, Math.max(8, detailTop - cursor - 1), { size: 6.8, minSize: 5.2 })

  const rows = [
    ['PAN / IT No', entity.pan],
    ['Place of Supply', entity.place_of_supply],
    ['State', [clean(entity.state), normalizeStateCode(entity.state_code) ? `Code: ${normalizeStateCode(entity.state_code)}` : clean(entity.state_code)].filter(Boolean).join('   ')],
    ['GSTIN', entity.gstin],
    ['Contact Person', entity.contact_person],
    ['Email', entity.email]
  ]
  const rowHeight = (height - (detailTop - y)) / rows.length
  const labelWidth = 87
  rows.forEach(([label, value], index) => {
    const rowY = detailTop + index * rowHeight
    textBox(doc, label, insetX, rowY, labelWidth, rowHeight, { bold: true, size: 6.7, singleLine: true })
    textBox(doc, clean(value), insetX + labelWidth, rowY, contentWidth - labelWidth, rowHeight, { size: 6.7, minSize: 4.8, singleLine: true })
  })
}

function drawIssuerDetails(doc, company, x, y, width, height) {
  const insetX = x + 3
  const contentWidth = width - 6
  const nameResult = textBox(doc, company.name, insetX, y + 2, contentWidth, 24, { bold: true, size: 7.5, minSize: 5.8 })
  const cursor = y + 4 + Math.min(24, nameResult.height)
  const details = [
    `Regd Office: ${company.address.join(' ')}`,
    `Mobile: ${company.mobile}`,
    `Tel: ${company.telephone}`,
    `Email: ${company.email}`,
    company.website,
    `State: ${company.state}   State Code: ${company.stateCode}`,
    company.gst
  ].join('\n')
  textBox(doc, details, insetX, cursor, contentWidth, y + height - cursor - 2, { size: 6.8, minSize: 5.2 })
}

function drawServiceTable(doc, entity, invoice, overrides, company, y, rounded) {
  const x = 22.5
  const right = 579
  const columns = [22.5, 69, 263.5, 332, 416, 473.5, right]
  const headerBottom = y + 20
  const taxBottom = rounded ? 464 : 489
  const taxRows = invoice.gst_component === 'CGST_SGST' ? 2 : 1
  const taxRowHeight = 15
  const taxTop = taxBottom - taxRows * taxRowHeight

  rectangle(doc, x, y, right - x, taxBottom - y)
  line(doc, x, headerBottom, right, headerBottom, 1.8)
  columns.slice(1, -1).forEach(columnX => line(doc, columnX, y, columnX, taxBottom))
  for (let row = 0; row < taxRows; row += 1) line(doc, x, taxTop + row * taxRowHeight, right, taxTop + row * taxRowHeight)

  const headers = ['SL.No', 'Description of Services', 'SAC', 'GST Rate', '%', 'Amount']
  headers.forEach((label, index) => textBox(doc, label, columns[index], y, columns[index + 1] - columns[index], 20, { bold: true, size: 7.4, align: index === 1 ? 'center' : index === 5 ? 'right' : 'center', singleLine: true }))

  textBox(doc, '1', columns[0], headerBottom, columns[1] - columns[0], 16, { size: 7.2, align: 'center', singleLine: true })
  const feeText = normalizeInvoiceText(overrides.professional_fee_text || entity.professional_fee_text || '')
  textBox(doc, [company.feeLabel, feeText].filter(Boolean).join('\n'), columns[1], headerBottom, columns[2] - columns[1], Math.min(62, taxTop - headerBottom), { size: 7.2, minSize: 5.5 })
  textBox(doc, clean(entity.sac || invoice.sac || '998512'), columns[2], headerBottom, columns[3] - columns[2], 16, { size: 7.2, align: 'center', singleLine: true })
  textBox(doc, formatRs(invoice.taxable_amount), columns[5], headerBottom, columns[6] - columns[5], 16, { size: 7.2, align: 'right', singleLine: true })

  const taxRowsData = invoice.gst_component === 'CGST_SGST'
    ? [['Central Tax (CGST)', invoice.cgst_rate, invoice.cgst_amount], ['State Tax (SGST)', invoice.sgst_rate, invoice.sgst_amount]]
    : [['Integrated GST (IGST)', invoice.igst_rate, invoice.igst_amount]]
  taxRowsData.forEach(([label, rate, amount], index) => {
    const rowY = taxTop + index * taxRowHeight
    textBox(doc, label, columns[1], rowY, columns[2] - columns[1], taxRowHeight, { size: 7.2, singleLine: true })
    textBox(doc, clean(rate), columns[3], rowY, columns[4] - columns[3], taxRowHeight, { size: 7.2, align: 'center', singleLine: true })
    textBox(doc, '%', columns[4], rowY, columns[5] - columns[4], taxRowHeight, { size: 7.2, align: 'center', singleLine: true })
    textBox(doc, formatRs(amount), columns[5], rowY, columns[6] - columns[5], taxRowHeight, { size: 7.2, align: 'right', singleLine: true })
  })
  return taxBottom
}

function drawTotals(doc, invoice, y) {
  const rounded = Boolean(invoice.rounding_type && moneyToPaise(invoice.rounding_amount) > 0n)
  const rowHeight = 15
  if (rounded) {
    rectangle(doc, 22.5, y, 556.5, rowHeight)
    textBox(doc, 'Total before Rounding Off', 22.5, y, 420, rowHeight, { size: 7.2, singleLine: true })
    textBox(doc, formatRs(invoice.total_before_rounding), 473.5, y, 105.5, rowHeight, { size: 7.2, align: 'right', singleLine: true })
    y += rowHeight
    rectangle(doc, 22.5, y, 556.5, rowHeight)
    textBox(doc, 'More: ROUNDING OFF', 22.5, y, 420, rowHeight, { size: 7.2, singleLine: true })
    const sign = invoice.rounding_type === 'MORE' ? '(+)' : '(-)'
    textBox(doc, `${sign}${formatRs(invoice.rounding_amount)}`, 473.5, y, 105.5, rowHeight, { size: 7.2, align: 'right', singleLine: true })
    y += rowHeight
  }
  const finalHeight = rounded ? 15 : 16
  rectangle(doc, 22.5, y, 556.5, finalHeight)
  textBox(doc, 'Total', 22.5, y, 420, finalHeight, { bold: true, size: 7.4, singleLine: true })
  textBox(doc, formatRs(invoice.grand_total), 473.5, y, 105.5, finalHeight, { bold: true, size: 7.4, align: 'right', singleLine: true })
  return y + finalHeight
}

function drawAmountWords(doc, invoice, y) {
  const height = 14
  rectangle(doc, 22.5, y, 556.5, height)
  textBox(doc, `Amount Chargeable (in words): ${invoice.amount_in_words}`, 22.5, y, 556.5, height, { bold: true, size: 7.1, minSize: 5.5, singleLine: true })
  return y + height
}

function drawTaxSummary(doc, invoice, sac, y) {
  const x = 22.5
  const right = 579
  if (invoice.gst_component === 'IGST') {
    const columns = [x, 69, 195.5, 473.5, right]
    const headerHeight = 22
    const rowHeight = 14
    const bottom = y + headerHeight + rowHeight * 2
    rectangle(doc, x, y, right - x, bottom - y)
    columns.slice(1, -1).forEach(columnX => line(doc, columnX, y, columnX, bottom))
    line(doc, x, y + headerHeight, right, y + headerHeight)
    line(doc, x, y + headerHeight + rowHeight, right, y + headerHeight + rowHeight)
    const headers = ['SAC', 'Taxable Value', 'Integrated GST (IGST) – Rate', 'IGST Amount']
    headers.forEach((label, index) => textBox(doc, label, columns[index], y, columns[index + 1] - columns[index], headerHeight, { bold: true, size: 7, align: 'center' }))
    const values = [sac, formatRs(invoice.taxable_amount), `${clean(invoice.igst_rate)}%`, formatRs(invoice.igst_amount)]
    values.forEach((value, index) => textBox(doc, value, columns[index], y + headerHeight, columns[index + 1] - columns[index], rowHeight, { size: 7, align: index === 1 || index === 3 ? 'right' : 'center', singleLine: true }))
    const totals = ['Total', formatRs(invoice.taxable_amount), '', formatRs(invoice.igst_amount)]
    totals.forEach((value, index) => textBox(doc, value, columns[index], y + headerHeight + rowHeight, columns[index + 1] - columns[index], rowHeight, { bold: true, size: 7, align: index === 1 || index === 3 ? 'right' : 'center', singleLine: true }))
    return bottom
  }

  const groupHeight = 13
  const headerHeight = 27
  const rowHeight = 14
  const bottom = y + headerHeight + rowHeight * 2
  rectangle(doc, x, y, right - x, bottom - y)
  ;[69, 195.5, 332, 473.5].forEach(columnX => line(doc, columnX, y, columnX, bottom))
  ;[263.5, 416].forEach(columnX => line(doc, columnX, y + groupHeight, columnX, bottom))
  line(doc, 195.5, y + groupHeight, 473.5, y + groupHeight)
  line(doc, x, y + headerHeight, right, y + headerHeight)
  line(doc, x, y + headerHeight + rowHeight, right, y + headerHeight + rowHeight)
  textBox(doc, 'SAC', x, y, 46.5, headerHeight, { bold: true, size: 7, align: 'center' })
  textBox(doc, 'Taxable Value', 69, y, 126.5, headerHeight, { bold: true, size: 7, align: 'center' })
  textBox(doc, 'Central Tax (CGST)', 195.5, y, 136.5, groupHeight, { bold: true, size: 6.8, align: 'center', singleLine: true })
  textBox(doc, 'State Tax (SGST)', 332, y, 141.5, groupHeight, { bold: true, size: 6.8, align: 'center', singleLine: true })
  textBox(doc, 'Total Tax Amount', 473.5, y, 105.5, headerHeight, { bold: true, size: 6.8, align: 'center' })
  ;[[195.5, 'Rate'], [263.5, 'Amount'], [332, 'Rate'], [416, 'Amount']].forEach(([columnX, label], index) => {
    const nextX = [263.5, 332, 416, 473.5][index]
    textBox(doc, label, columnX, y + groupHeight, nextX - columnX, headerHeight - groupHeight, { bold: true, size: 6.8, align: 'center', singleLine: true })
  })
  const values = [sac, formatRs(invoice.taxable_amount), `${clean(invoice.cgst_rate)}%`, formatRs(invoice.cgst_amount), `${clean(invoice.sgst_rate)}%`, formatRs(invoice.sgst_amount), formatRs(invoice.total_tax_amount)]
  const totalValues = ['Total', formatRs(invoice.taxable_amount), '', formatRs(invoice.cgst_amount), '', formatRs(invoice.sgst_amount), formatRs(invoice.total_tax_amount)]
  const cellStarts = [x, 69, 195.5, 263.5, 332, 416, 473.5]
  const cellEnds = [69, 195.5, 263.5, 332, 416, 473.5, right]
  ;[values, totalValues].forEach((row, rowIndex) => row.forEach((value, index) => textBox(doc, value, cellStarts[index], y + headerHeight + rowHeight * rowIndex, cellEnds[index] - cellStarts[index], rowHeight, { bold: rowIndex === 1, size: 6.8, align: [1, 3, 5, 6].includes(index) ? 'right' : 'center', singleLine: true })))
  return bottom
}

function drawLowerDetails(doc, company, y, bottom) {
  const splitX = 332
  const detailsHeight = 80
  const detailsBottom = Math.min(bottom - 88, y + detailsHeight)
  rectangle(doc, 22.5, y, 556.5, detailsBottom - y)
  line(doc, splitX, y, splitX, detailsBottom, 1.8)

  textBox(doc, 'Description of Services', 23.5, y + 2, splitX - 24.5, 13, { bold: true, size: 7.2, singleLine: true })
  textBox(doc, 'Permanent placement services, other than executive search services', 23.5, y + 15, splitX - 24.5, 25, { size: 6.8, minSize: 5.5 })
  textBox(doc, `Company's PAN: ${company.pan}`, 23.5, detailsBottom - 29, splitX - 24.5, 13, { bold: true, size: 6.8, singleLine: true })
  textBox(doc, company.reverseCharge, 23.5, detailsBottom - 15, splitX - 24.5, 13, { size: 6.5, minSize: 5.2, singleLine: true })

  const bankRows = [
    ['Bank Name', company.bank.name],
    ['IFSC Code', company.bank.ifsc],
    ['A/c No.', String(company.bank.account)],
    ['Branch', company.bank.branch]
  ]
  const rowHeight = (detailsBottom - y) / bankRows.length
  const labelWidth = 66
  bankRows.forEach(([label, value], index) => {
    const rowY = y + index * rowHeight
    textBox(doc, label, splitX + 1, rowY, labelWidth, rowHeight, { bold: true, size: 6.7, singleLine: true })
    textBox(doc, value, splitX + 1 + labelWidth, rowY, 579 - splitX - 2 - labelWidth, rowHeight, { size: 6.7, minSize: 4.9 })
  })

  line(doc, 22.5, detailsBottom, 579, detailsBottom, 1.8)
  textBox(doc, `For ${company.name}`, splitX + 4, detailsBottom + 6, 579 - splitX - 8, 16, { bold: true, size: 7, minSize: 5.5, align: 'right', singleLine: true })
  textBox(doc, 'Authorized Signatory', splitX + 4, bottom - 17, 579 - splitX - 8, 14, { size: 7, align: 'right', singleLine: true })
}

async function createInvoicePdf(data) {
  return (await renderInvoicePdf(data)).buffer
}

function renderInvoicePdf({ entity, invoice, overrides = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: true, compress: true })
    const chunks = []
    let pageCount = 1
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('pageAdded', () => { pageCount += 1 })
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount }))
    doc.on('error', reject)
    doc._invoiceFonts = setupFonts(doc)

    const company = COMPANY[invoice.billing_entity]
    if (!company) return reject(new Error('Invalid billing entity'))
    const outer = { x: 22.5, y: 22, right: 579, bottom: 764 }
    const splitX = 332
    const headerBottom = 67
    const metaBottom = 85
    const detailsBottom = 238
    const logo = path.join(__dirname, '../../../public/assets/fyndbridge-official-logo.png')

    rectangle(doc, outer.x, outer.y, outer.right - outer.x, outer.bottom - outer.y, 1.8)
    line(doc, outer.x, headerBottom, outer.right, headerBottom, 1.8)
    if (fs.existsSync(logo)) doc.image(logo, 28, 29, { width: 190 })
    textBox(doc, 'TAX INVOICE', 443, 31, 132, 25, { bold: true, size: 14, minSize: 11, align: 'right', singleLine: true })

    line(doc, outer.x, metaBottom, outer.right, metaBottom, 1.8)
    line(doc, splitX, headerBottom, splitX, detailsBottom, 1.8)
    textBox(doc, 'Invoice No.:', 23.5, 69, 62, 14, { bold: true, size: 7.4, singleLine: true })
    textBox(doc, invoice.invoice_number, 84, 69, splitX - 87, 14, { size: 7.4, minSize: 5.4, singleLine: true })
    textBox(doc, 'Dated:', splitX + 2, 69, 42, 14, { bold: true, size: 7.4, singleLine: true })
    textBox(doc, dateDDMMYYYY(invoice.invoice_date), splitX + 43, 69, outer.right - splitX - 45, 14, { size: 7.4, singleLine: true })

    line(doc, outer.x, detailsBottom, outer.right, detailsBottom, 1.8)
    drawClientDetails(doc, entity, outer.x, metaBottom, splitX - outer.x, detailsBottom - metaBottom)
    drawIssuerDetails(doc, company, splitX, metaBottom, outer.right - splitX, detailsBottom - metaBottom)

    const rounded = Boolean(invoice.rounding_type && moneyToPaise(invoice.rounding_amount) > 0n)
    let y = drawServiceTable(doc, entity, invoice, overrides, company, detailsBottom, rounded)
    y = drawTotals(doc, invoice, y)
    y = drawAmountWords(doc, invoice, y)
    y = drawTaxSummary(doc, invoice, clean(entity.sac || invoice.sac || '998512'), y)

    const taxWordsHeight = 14
    rectangle(doc, outer.x, y, outer.right - outer.x, taxWordsHeight)
    textBox(doc, `Tax Amount (in words): ${invoice.tax_amount_in_words}`, outer.x, y, outer.right - outer.x, taxWordsHeight, { bold: true, size: 6.9, minSize: 5.2, singleLine: true })
    y += taxWordsHeight
    drawLowerDetails(doc, company, y, outer.bottom)
    doc.end()
  })
}

function dateDDMMYYYY(value) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return clean(value)
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`
}

module.exports = {
  MODELS,
  GST_COMPONENTS,
  BILLING_ENTITIES,
  COMPANY,
  clean,
  financialYear,
  normalizeStateCode,
  detectGstComponent,
  calculateInvoice,
  roundInvoiceTotalPaise,
  normalizedOptionalName,
  amountWords,
  formatRs,
  createInvoicePdf,
  renderInvoicePdf
}
