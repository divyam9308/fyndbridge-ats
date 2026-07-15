const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const MODELS = new Set(['joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others'])
const GST_COMPONENTS = new Set(['IGST', 'CGST_SGST'])
const BILLING_ENTITIES = new Set(['FCS', 'FCAPL'])

const COMPANY = {
  FCS: {
    name: 'FyndBridge Consulting Services',
    address: ['Ground Floor, 20, New Delhi,', 'Okhla Industrial Estate Phase 3, New Delhi,', 'South East Delhi,', 'Delhi, 110020'],
    mobile: '9717773066',
    email: 'partner@fyndbridge.in',
    state: 'Delhi',
    stateCode: '07',
    gstin: '07AAJFF1433D1ZV',
    cin: '',
    pan: 'AAJFF1433D',
    bank: {
      name: 'ICICI Bank Limited',
      account: '102305501028',
      ifsc: 'ICIC0001023',
      branch: '233 Okhla Industrial Estate, New Delhi - 110020'
    },
    reverseCharge: 'Our Payments on reverse charge basis: No',
    prefix: 'FB',
    feeLabel: 'Professional Fee'
  },
  FCAPL: {
    name: 'FyndBridge Consultants & Advisors Private Limited',
    address: ['Second Floor, House No- A-34,', 'Pocket A-8, Kalkaji Extension, Behind', 'Aggarwal Sweet House, New Delhi,', 'South East Delhi, Delhi - 110019'],
    mobile: '9717773066',
    email: 'partner@fyndbridge.in',
    state: 'Delhi',
    stateCode: '07',
    gstin: '07AAFCF8821L1ZA',
    cin: 'U70200DL2024PTC429251',
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
const CURRENCY_REGULAR_FONT = 'InvoiceCurrencyRegular'
const CURRENCY_BOLD_FONT = 'InvoiceCurrencyBold'
const MONEY_SCALE = 100n
const RATE_SCALE = 10000n
const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const A4_SCALE = 595.275590551 / 612

const firstExisting = items => items.find(item => fs.existsSync(item))
const FONT_PATHS = {
  regular: firstExisting([
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    path.join(__dirname, '../../node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff'),
    path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf')
  ]),
  bold: firstExisting([
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
    path.join(__dirname, '../../node_modules/@fontsource/arimo/files/arimo-latin-700-normal.woff'),
    path.join(__dirname, '../../assets/fonts/NotoSans-Bold.ttf')
  ]),
  currencyRegular: firstExisting([
    path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf')
  ]),
  currencyBold: firstExisting([
    path.join(__dirname, '../../assets/fonts/NotoSans-Bold.ttf')
  ])
}

const scaled = value => Number((value * A4_SCALE).toFixed(3))

const INVOICE_LAYOUTS = Object.freeze({
  FCAPL_CGST_SGST: {
    id: 'FCAPL_CGST_SGST', reference: 'FCAPL CGST SGST.pdf', tax: 'CGST_SGST', rounded: true,
    rule: scaled(0.84), majorRule: scaled(0.84), bodySize: scaled(8.88), metaSize: scaled(9.36), titleSize: scaled(14.88),
    x: {
      left: 21.13, right: 568.43, split: 328.64, lowerSplit: 328.64,
      service: [21.13, 67.00, 255.32, 328.64, 410.22, 466.40, 568.43],
      summary: [21.13, 67.00, 181.05, 255.32, 328.64, 410.22, 466.40, 568.43]
    },
    y: {
      top: 21.13, header: 65.15, meta: 82.77, details: 231.16, serviceHeader: 250.76, serviceBottom: 444.25,
      totals: [458.51, 472.75, 486.99], amountWords: 500.53, summaryGroup: 514.07, summaryHeader: 527.61,
      summaryData: 541.15, summaryBottom: 554.69, taxWords: 568.23, lowerBottom: 639.10, bottom: 750.71
    },
    logo: { x: scaled(27.30), y: scaled(30.87), width: scaled(174.95), height: scaled(27.83) },
    taxTextY: [390.18, 405.48], splitStartsAtTop: true, descriptionBreak: true,
    branchLines: '233 Okhla Industrial Estate, New Delhi -\n110020'
  },
  FCAPL_IGST_NO_ROUND: {
    id: 'FCAPL_IGST_NO_ROUND', reference: 'FCAPL NOROUNDING (1).pdf', tax: 'IGST', rounded: false,
    rule: scaled(0.96), majorRule: scaled(0.96), serviceHeaderRule: scaled(1.80), bodySize: scaled(9.12), metaSize: scaled(9.60), titleSize: scaled(15.36),
    x: {
      left: 21.01, right: 572.16, split: 324.67, lowerSplit: 324.67,
      service: [21.01, 68.40, 247.61, 324.67, 408.94, 466.86, 572.16],
      summary: [21.01, 179.07, 324.67, 466.86, 572.16]
    },
    y: {
      top: 21.01, header: 66.55, meta: 84.76, details: 246.80, serviceHeader: 266.76, serviceBottom: 490.78,
      totals: [505.49], amountWords: 519.50, summaryHeader: 541.91, summaryData: 555.91,
      summaryBottom: 569.92, taxWords: 583.92, lowerBottom: 658.19, bottom: 772.19
    },
    logo: { x: scaled(27.484), y: scaled(31.171), width: scaled(180.75), height: scaled(28.759) },
    taxTextY: [433.72], descriptionBreak: true,
    branchLines: '233 OKHLA INDUSTRIAL ESTATE\nNew Delhi - 110020'
  },
  FCAPL_IGST_ROUND: {
    id: 'FCAPL_IGST_ROUND', reference: 'FCAPL WITH ROUNDOFF.pdf', tax: 'IGST', rounded: true,
    rule: scaled(0.84), majorRule: scaled(0.84), serviceHeaderRule: scaled(1.80), bodySize: scaled(8.88), metaSize: scaled(9.36), titleSize: scaled(14.88),
    x: {
      left: 21.13, right: 569.48, split: 326.89, lowerSplit: 326.89,
      service: [21.13, 67.00, 250.76, 326.89, 408.47, 464.65, 569.48],
      summary: [21.13, 174.17, 326.89, 464.65, 569.48]
    },
    y: {
      top: 21.13, header: 65.15, meta: 82.77, details: 237.11, serviceHeader: 256.25, serviceBottom: 511.47,
      totals: [525.71, 539.95, 554.19], amountWords: 567.73, summaryHeader: 589.44, summaryData: 602.98,
      summaryBottom: 616.52, taxWords: 630.06, lowerBottom: 700.94, bottom: 807.44
    },
    logo: { x: scaled(27.30), y: scaled(30.87), width: scaled(175.02), height: scaled(27.83) },
    taxTextY: [438.73], lineItemBold: true, taxBold: true, descriptionBreak: true,
    branchLines: '233 Okhla Industrial Estate, New Delhi -\n110020'
  },
  FCS_IGST_NO_ROUND: {
    id: 'FCS_IGST_NO_ROUND', reference: 'FCS NoRounding.pdf', tax: 'IGST', rounded: false,
    rule: scaled(0.96), majorRule: scaled(1.92), bodySize: scaled(9.24), metaSize: scaled(9.72), titleSize: scaled(15.48),
    x: {
      left: 20.54, right: 570.53, split: 328.17, lowerSplit: 328.17,
      service: [20.54, 68.87, 254.15, 328.64, 413.73, 472.23, 570.53],
      summary: [20.54, 184.90, 328.64, 472.23, 570.53]
    },
    y: {
      top: 20.54, header: 66.43, meta: 84.76, details: 234.54, serviceHeader: 255.08, serviceBottom: 535.09,
      totals: [549.91], amountWords: 564.03, summaryHeader: 587.14, summaryData: 601.27,
      summaryBottom: 614.92, taxWords: 629.05, lowerBottom: 695.49, bottom: 816.66
    },
    logo: { x: scaled(27.546), y: scaled(31.271), width: scaled(182.52), height: scaled(28.909) },
    taxTextY: [468.13], taxWordsBold: false,
    branchLines: '233 Okhla Industrial Estate, New Delhi\n- 110020'
  },
  FCS_IGST_ROUND: {
    id: 'FCS_IGST_ROUND', reference: 'FCS with roundoff.pdf', tax: 'IGST', rounded: true,
    rule: scaled(0.96), majorRule: scaled(0.96), bodySize: scaled(9.00), metaSize: scaled(9.36), titleSize: scaled(15.00),
    x: {
      left: 21.01, right: 570.06, split: 336.92, lowerSplit: 336.92,
      service: [21.01, 67.46, 266.17, 336.92, 419.47, 476.20, 570.06],
      summary: [21.01, 188.41, 336.92, 476.20, 570.06]
    },
    y: {
      top: 21.01, header: 65.38, meta: 83.12, details: 237.23, serviceHeader: 257.07, serviceBottom: 514.29,
      totals: [528.65, 543.01, 557.36], amountWords: 571.14, summaryHeader: 593.08, summaryData: 606.85,
      summaryBottom: 620.63, taxWords: 634.43, lowerBottom: 706.91, bottom: 814.09
    },
    logo: { x: scaled(27.362), y: scaled(30.970), width: scaled(177.00), height: scaled(27.98) },
    taxTextY: [452.96], descriptionBreak: true,
    branchLines: '233 Okhla Industrial Estate, New\nDelhi - 110020'
  },
  FCS_CGST_SGST: {
    id: 'FCS_CGST_SGST', reference: 'FCS_CGST_SGST.pdf', tax: 'CGST_SGST', rounded: true,
    rule: scaled(0.96), majorRule: scaled(0.96), bodySize: scaled(9.24), metaSize: scaled(9.72), titleSize: scaled(15.48),
    x: {
      left: 21.01, right: 572.63, split: 322.57, lowerSplit: 322.57,
      service: [21.01, 68.87, 237.81, 322.57, 407.66, 466.16, 572.63],
      summary: [21.01, 68.87, 168.56, 237.81, 322.57, 407.66, 466.16, 572.63]
    },
    y: {
      top: 21.01, header: 66.90, meta: 85.23, details: 235.01, serviceHeader: 255.55, serviceBottom: 453.20,
      totals: [468.02, 482.85, 497.67], amountWords: 511.79, summaryGroup: 525.92, summaryHeader: 540.04,
      summaryData: 554.16, summaryBottom: 568.29, taxWords: 582.41, lowerBottom: 648.85, bottom: 779.31
    },
    logo: { x: scaled(27.546), y: scaled(31.271), width: scaled(182.59), height: scaled(28.909) },
    taxTextY: [395.83, 411.36], reverseBold: false, roundingDivider: true,
    branchLines: '233 Okhla Industrial Estate, New Delhi -\n110020'
  }
})

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

function groupIndianDigits(value) {
  const digits = String(value)
  if (digits.length <= 3) return digits
  const tail = digits.slice(-3)
  const head = digits.slice(0, -3)
  const groups = []
  for (let end = head.length; end > 0; end -= 2) groups.unshift(head.slice(Math.max(0, end - 2), end))
  return `${groups.join(',')},${tail}`
}

function formatMoney(value, includeSymbol = true) {
  const paise = moneyToPaise(value)
  const negative = paise < 0n
  const absolute = negative ? -paise : paise
  const rupees = absolute / MONEY_SCALE
  const fraction = String(absolute % MONEY_SCALE).padStart(2, '0')
  return `${negative ? '-' : ''}${includeSymbol ? '₹' : ''}${groupIndianDigits(rupees)}.${fraction}`
}

function formatRs(value) {
  return formatMoney(value, true)
}

function normalizeInvoiceText(value) {
  return String(value || '')
    .replace(/CTC in LPA/gi, 'CTC')
    .replace(/Â¹|â‚¹|¹|\?{1,3}(?=\d)/g, '₹')
    .replace(/\bRs\.?\s*/gi, '₹')
    .replace(/₹\s+/g, '₹')
    .trim()
}

function setupFonts(doc) {
  if (FONT_PATHS.regular) doc.registerFont(REGULAR_FONT, FONT_PATHS.regular)
  if (FONT_PATHS.bold) doc.registerFont(BOLD_FONT, FONT_PATHS.bold)
  if (FONT_PATHS.currencyRegular) doc.registerFont(CURRENCY_REGULAR_FONT, FONT_PATHS.currencyRegular)
  if (FONT_PATHS.currencyBold) doc.registerFont(CURRENCY_BOLD_FONT, FONT_PATHS.currencyBold)
  return {
    regular: FONT_PATHS.regular ? REGULAR_FONT : 'Helvetica',
    bold: FONT_PATHS.bold ? BOLD_FONT : 'Helvetica-Bold',
    currencyRegular: FONT_PATHS.currencyRegular ? CURRENCY_REGULAR_FONT : (FONT_PATHS.regular ? REGULAR_FONT : 'Helvetica'),
    currencyBold: FONT_PATHS.currencyBold ? CURRENCY_BOLD_FONT : (FONT_PATHS.bold ? BOLD_FONT : 'Helvetica-Bold')
  }
}

function fitFontSize(doc, text, font, width, height, maxSize, minSize, singleLine = false) {
  let size = maxSize
  const content = String(text ?? '')
  doc.font(font)
  while (size > minSize) {
    doc.fontSize(size)
    const tooWide = singleLine && doc.widthOfString(content) > width
    const tooTall = !singleLine && doc.heightOfString(content, { width, lineGap: 0 }) > height
    if (!tooWide && !tooTall) break
    size -= 0.18
  }
  return Math.max(size, minSize)
}

function currencySegments(content) {
  return String(content).split(/(₹)/).filter(Boolean)
}

function mixedCurrencyMetrics(doc, content, textFont, symbolFont, size) {
  let width = 0
  let height = 0
  currencySegments(content).forEach(segment => {
    doc.font(segment === '₹' ? symbolFont : textFont).fontSize(size)
    width += doc.widthOfString(segment)
    height = Math.max(height, doc.currentLineHeight())
  })
  return { width, height }
}

function fitMixedCurrencySize(doc, content, textFont, symbolFont, width, height, maxSize, minSize) {
  let size = maxSize
  while (size > minSize) {
    const measured = mixedCurrencyMetrics(doc, content, textFont, symbolFont, size)
    if (measured.width <= width && measured.height <= height) break
    size -= 0.18
  }
  return Math.max(size, minSize)
}

function textBox(doc, text, x, y, width, height, options = {}) {
  const content = String(text ?? '')
  if (!content) return { size: options.size || 0, height: 0 }
  const fonts = doc._invoiceFonts
  const paddingX = options.paddingX ?? 1.8
  const paddingY = options.paddingY ?? 1.1
  const font = options.bold ? fonts.bold : fonts.regular
  const symbolFont = options.bold ? fonts.currencyBold : fonts.currencyRegular
  const mixedCurrency = content.includes('₹') && options.singleLine
  const usableWidth = Math.max(1, width - paddingX * 2)
  const usableHeight = Math.max(1, height - paddingY * 2)
  const size = mixedCurrency
    ? fitMixedCurrencySize(doc, content, font, symbolFont, usableWidth, usableHeight, options.size || 8.8, options.minSize || 5.4)
    : fitFontSize(doc, content, font, usableWidth, usableHeight, options.size || 8.8, options.minSize || 5.4, options.singleLine)
  doc.font(font).fontSize(size)
  const measuredHeight = mixedCurrency
    ? mixedCurrencyMetrics(doc, content, font, symbolFont, size).height
    : (options.singleLine ? doc.currentLineHeight() : doc.heightOfString(content, { width: usableWidth, lineGap: 0 }))
  let textY = y + paddingY
  if (options.valign === 'center') textY = y + Math.max(paddingY, (height - measuredHeight) / 2 - 0.25)
  if (options.valign === 'bottom') textY = y + Math.max(paddingY, height - measuredHeight - paddingY)
  doc.save().rect(x, y, width, height).clip()
  if (mixedCurrency) {
    const measuredWidth = mixedCurrencyMetrics(doc, content, font, symbolFont, size).width
    let textX = x + paddingX
    if (options.align === 'right') textX += Math.max(0, usableWidth - measuredWidth)
    if (options.align === 'center') textX += Math.max(0, (usableWidth - measuredWidth) / 2)
    currencySegments(content).forEach(segment => {
      const segmentFont = segment === '₹' ? symbolFont : font
      doc.font(segmentFont).fontSize(size).fillColor(BLACK).text(segment, textX, textY, { lineBreak: false })
      textX += doc.widthOfString(segment)
    })
    doc.restore()
    return { size, height: measuredHeight }
  }
  doc.fillColor(BLACK).text(content, x + paddingX, textY, {
    width: usableWidth,
    height: usableHeight,
    align: options.align || 'left',
    lineGap: 0,
    characterSpacing: options.characterSpacing || 0,
    lineBreak: options.singleLine ? false : true
  })
  doc.restore()
  return { size, height: measuredHeight }
}

function normalizedOptionalName(value) {
  const optionalName = clean(value)
  const placeholder = optionalName.toLowerCase().replace(/[.\s]/g, '')
  return !optionalName || new Set(['-', '--', 'na', 'n/a', 'none', 'null', 'nil', 'notavailable', 'notapplicable', 'undefined']).has(placeholder) ? '' : optionalName
}

function hasRounding(invoice) {
  return Boolean(invoice.rounding_type && moneyToPaise(invoice.rounding_amount) > 0n)
}

function selectInvoiceLayout(invoice) {
  const billing = BILLING_ENTITIES.has(invoice.billing_entity) ? invoice.billing_entity : 'FCS'
  if (invoice.gst_component === 'CGST_SGST') return INVOICE_LAYOUTS[`${billing}_CGST_SGST`]
  return INVOICE_LAYOUTS[`${billing}_IGST_${hasRounding(invoice) ? 'ROUND' : 'NO_ROUND'}`]
}

function layoutForInvoice(invoice) {
  const selected = selectInvoiceLayout(invoice)
  if (selected.tax !== 'CGST_SGST' || hasRounding(invoice)) return selected
  const removedHeight = selected.y.totals.at(-1) - selected.y.totals[0]
  const shiftedKeys = ['amountWords', 'summaryGroup', 'summaryHeader', 'summaryData', 'summaryBottom', 'taxWords', 'lowerBottom']
  const y = { ...selected.y, totals: [selected.y.totals[0]] }
  shiftedKeys.forEach(key => { if (typeof y[key] === 'number') y[key] -= removedHeight })
  return { ...selected, id: `${selected.id}_NO_ROUND`, rounded: false, y }
}

function fillRule(doc, x, y, width, height) {
  if (width <= 0 || height <= 0) return
  doc.save().fillColor(BLACK).rect(x, y, width, height).fill().restore()
}

function drawInvoiceRules(doc, layout) {
  const { x, y } = layout
  const rule = layout.rule
  const major = layout.majorRule
  const fullWidth = x.right - x.left + major
  fillRule(doc, x.left, y.top, major, y.bottom - y.top + major)
  fillRule(doc, x.right, y.top, major, y.bottom - y.top + major)
  const fullRules = [y.top, y.header, y.meta, y.details, y.serviceBottom, ...y.totals, y.amountWords, y.summaryHeader, y.summaryData, y.summaryBottom, y.taxWords, y.lowerBottom, y.bottom]
  fullRules.forEach(ruleY => fillRule(doc, x.left, ruleY, fullWidth, major))
  fillRule(doc, x.left, y.serviceHeader, fullWidth, layout.serviceHeaderRule || major)

  const splitTop = layout.splitStartsAtTop ? y.top : y.header + major
  fillRule(doc, x.split, splitTop, major, y.details - splitTop)
  x.service.slice(1, -1).forEach(column => fillRule(doc, column, y.details + major, rule, y.serviceBottom - y.details - major))

  if (layout.tax === 'IGST') {
    x.summary.slice(1, -1).forEach(column => fillRule(doc, column, y.amountWords + major, rule, y.summaryBottom - y.amountWords - major))
  } else {
    ;[1, 2, 4, 6].forEach(index => fillRule(doc, x.summary[index], y.amountWords + major, rule, y.summaryBottom - y.amountWords - major))
    ;[3, 5].forEach(index => fillRule(doc, x.summary[index], y.summaryGroup, rule, y.summaryBottom - y.summaryGroup))
    fillRule(doc, x.summary[2] + rule, y.summaryGroup, x.summary[6] - x.summary[2], rule)
  }
  if (layout.roundingDivider && y.totals.length > 1) {
    fillRule(doc, x.service[5], y.totals[0], rule, y.totals[1] - y.totals[0])
  }
  fillRule(doc, x.lowerSplit, y.taxWords + major, major, y.lowerBottom - y.taxWords - major)
}

let cachedInvoiceLogo
function invoiceLogoBuffer() {
  if (cachedInvoiceLogo) return cachedInvoiceLogo
  const logoPath = path.join(__dirname, '../../assets/invoice-reference-logo.base64')
  if (!fs.existsSync(logoPath)) return null
  cachedInvoiceLogo = Buffer.from(fs.readFileSync(logoPath, 'utf8').trim(), 'base64')
  return cachedInvoiceLogo
}

function drawHeader(doc, layout, entity, invoice, company) {
  const { x, y } = layout
  const logo = invoiceLogoBuffer()
  if (logo) doc.image(logo, layout.logo.x, layout.logo.y, { fit: [layout.logo.width, layout.logo.height], align: 'left', valign: 'center' })
  textBox(doc, 'TAX INVOICE', x.split, y.top, x.right - x.split, y.header - y.top, {
    bold: true, size: layout.titleSize, minSize: layout.titleSize - 1.4, align: 'right', singleLine: true, valign: 'center', paddingX: 2.2
  })
  textBox(doc, `Invoice No.:  ${invoice.invoice_number}`, x.left, y.header, x.split - x.left, y.meta - y.header, {
    bold: true, size: layout.metaSize, minSize: layout.metaSize - 1.5, singleLine: true, valign: 'center'
  })
  textBox(doc, `Dated:  ${dateDDMMYYYY(invoice.invoice_date)}`, x.split, y.header, x.right - x.split, y.meta - y.header, {
    bold: true, size: layout.metaSize, minSize: layout.metaSize - 1.5, singleLine: true, valign: 'center'
  })
  drawClientDetails(doc, layout, entity)
  drawIssuerDetails(doc, layout, company)
}

function drawClientDetails(doc, layout, entity) {
  const { x, y } = layout
  const left = x.left
  const right = x.split
  const width = right - left
  const body = layout.bodySize
  textBox(doc, 'BILL TO:', left, y.meta, width, 14, { bold: true, size: layout.metaSize, singleLine: true, valign: 'center' })
  let cursor = y.meta + 15
  const legalResult = textBox(doc, clean(entity.legal_entity_name), left, cursor, width, 22, { bold: true, size: layout.metaSize, minSize: body - 1.8 })
  cursor += Math.max(13, Math.min(22, legalResult.height + 1.2))
  const optionalName = normalizedOptionalName(entity.optional_name)
  if (optionalName) {
    const optionalResult = textBox(doc, optionalName, left, cursor, width, 15, { size: body, minSize: body - 1.8 })
    cursor += Math.max(11, Math.min(15, optionalResult.height + 1))
  } else {
    cursor += 11.5
  }

  const rows = [
    ['PAN / IT No', entity.pan],
    ['Place of Supply', entity.place_of_supply],
    ['State', [clean(entity.state), normalizeStateCode(entity.state_code) ? `Code: ${normalizeStateCode(entity.state_code)}` : clean(entity.state_code)].filter(Boolean).join('   ')],
    ['GSTIN', entity.gstin],
    ['Contact Person', entity.contact_person],
    ['Email', entity.email]
  ].filter(([, value]) => clean(value))
  const rowHeight = Math.max(11.2, Math.min(13.1, (y.details - y.meta - 68) / Math.max(1, rows.length)))
  const rowsTop = y.details - layout.majorRule - rows.length * rowHeight - 2
  textBox(doc, clean(entity.address), left, cursor, width, Math.max(12, rowsTop - cursor - 1), { size: body, minSize: body - 2.2 })
  const labelWidth = Math.min(158, width * 0.51)
  rows.forEach(([label, value], index) => {
    const rowY = rowsTop + index * rowHeight
    textBox(doc, label, left, rowY, labelWidth, rowHeight, { bold: true, size: body, minSize: body - 1.5, singleLine: true, valign: 'center' })
    textBox(doc, clean(value), left + labelWidth, rowY, width - labelWidth, rowHeight, { size: body, minSize: 5.5, singleLine: true, valign: 'center' })
  })
}

function drawIssuerDetails(doc, layout, company) {
  const { x, y } = layout
  const left = x.split
  const width = x.right - left
  const body = layout.bodySize
  textBox(doc, 'FROM:', left, y.meta, width, 14, { bold: true, size: layout.metaSize, singleLine: true, valign: 'center' })
  textBox(doc, company.name, left, y.meta + 15, width, 17, { bold: true, size: layout.metaSize, minSize: body - 1.2, singleLine: true, valign: 'center' })
  const addressLines = [`Regd Office: ${company.address[0]}`, ...company.address.slice(1)]
  const stateLines = company === COMPANY.FCAPL
    ? [`State Code: ${company.stateCode}`, `State: ${company.state}`]
    : [`State: ${company.state}`, `State Code: ${company.stateCode}`]
  const issuerLines = [
    ...addressLines,
    `Mobile: ${company.mobile}`,
    company.name === COMPANY.FCS.name ? '' : null,
    `Email: ${company.email}`,
    ...stateLines,
    `GSTIN: ${company.gstin}`,
    company.cin ? `CIN: ${company.cin}` : null
  ].filter(value => value !== null)
  textBox(doc, issuerLines.join('\n'), left, y.meta + 31, width, y.details - y.meta - 33, { size: body, minSize: body - 2.1 })
}

function drawServiceTable(doc, layout, entity, invoice, overrides, company) {
  const columns = layout.x.service
  const top = layout.y.details
  const headerBottom = layout.y.serviceHeader
  const body = layout.bodySize
  const headers = ['SL.No', 'Description of Services', 'SAC', 'GST Rate', '%', 'Amount']
  headers.forEach((label, index) => textBox(doc, label, columns[index], top, columns[index + 1] - columns[index], headerBottom - top, {
    bold: true, size: body, minSize: body - 1.5, align: index === 5 ? 'right' : 'center', singleLine: true, valign: 'center'
  }))

  const itemTop = headerBottom + (layout.serviceHeaderRule || layout.majorRule)
  const itemHeight = 17
  textBox(doc, '1', columns[0], itemTop, columns[1] - columns[0], itemHeight, { size: body, align: 'center', singleLine: true, valign: 'center' })
  const feeText = normalizeInvoiceText(overrides.professional_fee_text || entity.professional_fee_text || '')
  textBox(doc, [company.feeLabel, feeText].filter(Boolean).join('\n'), columns[1], itemTop, columns[2] - columns[1], 44, { bold: layout.lineItemBold, size: body, minSize: body - 2 })
  textBox(doc, clean(entity.sac || invoice.sac || '998512'), columns[2], itemTop, columns[3] - columns[2], itemHeight, { size: body, align: 'center', singleLine: true, valign: 'center' })
  textBox(doc, formatMoney(invoice.taxable_amount, false), columns[5], itemTop, columns[6] - columns[5], itemHeight, { size: body, align: 'right', singleLine: true, valign: 'center' })

  const taxRows = invoice.gst_component === 'CGST_SGST'
    ? [['Central Tax (CGST)', invoice.cgst_rate, invoice.cgst_amount], ['State Tax (SGST)', invoice.sgst_rate, invoice.sgst_amount]]
    : [['Integrated GST (IGST)', invoice.igst_rate, invoice.igst_amount]]
  taxRows.forEach(([label, rate, amount], index) => {
    const rowY = layout.taxTextY[index]
    const rowHeight = body + 4.2
    textBox(doc, label, columns[1], rowY, columns[2] - columns[1], rowHeight, { bold: layout.taxBold, size: body, minSize: body - 1.5, align: 'right', singleLine: true, valign: 'center' })
    textBox(doc, clean(rate), columns[3], rowY, columns[4] - columns[3], rowHeight, { size: body, align: 'center', singleLine: true, valign: 'center' })
    textBox(doc, '%', columns[4], rowY, columns[5] - columns[4], rowHeight, { size: body, align: 'center', singleLine: true, valign: 'center' })
    textBox(doc, formatMoney(amount, false), columns[5], rowY, columns[6] - columns[5], rowHeight, { size: body, align: 'right', singleLine: true, valign: 'center' })
  })
}

function drawTotals(doc, layout, invoice) {
  const rounded = hasRounding(invoice)
  const rows = rounded
    ? [
        ['Total before Rounding Off', formatRs(invoice.total_before_rounding)],
        ['More: ROUNDING OFF', `${invoice.rounding_type === 'MORE' ? '(+)' : '(-)'}${formatRs(invoice.rounding_amount)}`],
        ['Total', formatRs(invoice.grand_total)]
      ]
    : [['Total', formatRs(invoice.grand_total)]]
  let top = layout.y.serviceBottom
  const amountX = layout.x.service[5]
  rows.forEach(([label, amount], index) => {
    const bottom = layout.y.totals[index]
    textBox(doc, label, layout.x.left, top, amountX - layout.x.left, bottom - top, { bold: true, size: layout.bodySize, minSize: layout.bodySize - 1.3, singleLine: true, valign: 'center' })
    textBox(doc, amount, amountX, top, layout.x.right - amountX, bottom - top, { bold: index === rows.length - 1, size: layout.bodySize, minSize: layout.bodySize - 1.3, align: 'right', singleLine: true, valign: 'center' })
    top = bottom
  })
}

function drawAmountWords(doc, layout, invoice) {
  const top = layout.y.totals.at(-1)
  textBox(doc, `Amount Chargeable (in words): ${invoice.amount_in_words}`, layout.x.left, top, layout.x.right - layout.x.left, layout.y.amountWords - top, {
    bold: true, size: layout.bodySize, minSize: 6.2, singleLine: true, valign: 'center'
  })
}

function drawTaxSummary(doc, layout, invoice, sac) {
  const columns = layout.x.summary
  const top = layout.y.amountWords
  const body = layout.bodySize
  if (invoice.gst_component === 'IGST') {
    const headers = ['SAC', 'Taxable Value', 'Integrated GST (IGST) - Rate', 'IGST Amount']
    headers.forEach((label, index) => textBox(doc, label, columns[index], top, columns[index + 1] - columns[index], layout.y.summaryHeader - top, { bold: true, size: body, minSize: body - 1.7, align: 'center', singleLine: true, valign: 'center' }))
    const values = [sac, formatRs(invoice.taxable_amount), `${clean(invoice.igst_rate)}%`, formatRs(invoice.igst_amount)]
    const totals = ['Total', formatRs(invoice.taxable_amount), '', formatRs(invoice.igst_amount)]
    ;[values, totals].forEach((row, rowIndex) => {
      const rowTop = rowIndex === 0 ? layout.y.summaryHeader : layout.y.summaryData
      const rowBottom = rowIndex === 0 ? layout.y.summaryData : layout.y.summaryBottom
      row.forEach((value, index) => textBox(doc, value, columns[index], rowTop, columns[index + 1] - columns[index], rowBottom - rowTop, { bold: rowIndex === 1, size: body, minSize: body - 1.7, align: [1, 3].includes(index) ? 'right' : 'center', singleLine: true, valign: 'center' }))
    })
    return
  }

  textBox(doc, 'SAC', columns[0], top, columns[1] - columns[0], layout.y.summaryHeader - top, { bold: true, size: body, align: 'center', singleLine: true, valign: 'center' })
  textBox(doc, 'Taxable Value', columns[1], top, columns[2] - columns[1], layout.y.summaryHeader - top, { bold: true, size: body, minSize: body - 1.3, align: 'center', singleLine: true, valign: 'center' })
  textBox(doc, 'Central Tax (CGST)', columns[2], top, columns[4] - columns[2], layout.y.summaryGroup - top, { bold: true, size: body, minSize: body - 1.5, align: 'center', singleLine: true, valign: 'center' })
  textBox(doc, 'State Tax (SGST)', columns[4], top, columns[6] - columns[4], layout.y.summaryGroup - top, { bold: true, size: body, minSize: body - 1.5, align: 'center', singleLine: true, valign: 'center' })
  textBox(doc, 'Total Tax Amount', columns[6], top, columns[7] - columns[6], layout.y.summaryHeader - top, { bold: true, size: body, minSize: body - 1.5, align: 'center', singleLine: true, valign: 'center' })
  ;[[2, 'Rate'], [3, 'Amount'], [4, 'Rate'], [5, 'Amount']].forEach(([index, label]) => textBox(doc, label, columns[index], layout.y.summaryGroup, columns[index + 1] - columns[index], layout.y.summaryHeader - layout.y.summaryGroup, { bold: true, size: body, minSize: body - 1.4, align: 'center', singleLine: true, valign: 'center' }))
  const values = [sac, formatRs(invoice.taxable_amount), `${clean(invoice.cgst_rate)}%`, formatRs(invoice.cgst_amount), `${clean(invoice.sgst_rate)}%`, formatRs(invoice.sgst_amount), formatRs(invoice.total_tax_amount)]
  const totals = ['Total', formatRs(invoice.taxable_amount), '', formatRs(invoice.cgst_amount), '', formatRs(invoice.sgst_amount), formatRs(invoice.total_tax_amount)]
  ;[values, totals].forEach((row, rowIndex) => {
    const rowTop = rowIndex === 0 ? layout.y.summaryHeader : layout.y.summaryData
    const rowBottom = rowIndex === 0 ? layout.y.summaryData : layout.y.summaryBottom
    row.forEach((value, index) => textBox(doc, value, columns[index], rowTop, columns[index + 1] - columns[index], rowBottom - rowTop, { bold: rowIndex === 1, size: body, minSize: body - 1.8, align: [1, 3, 5, 6].includes(index) ? 'right' : 'center', singleLine: true, valign: 'center' }))
  })
}

function drawLowerDetails(doc, layout, company, taxWords) {
  const { x, y } = layout
  const body = layout.bodySize
  textBox(doc, `Tax Amount (in words): ${taxWords}`, x.left, y.summaryBottom, x.right - x.left, y.taxWords - y.summaryBottom, { bold: layout.taxWordsBold !== false, size: body, minSize: 6.1, singleLine: true, valign: 'center' })
  const lowerTop = y.taxWords
  const leftWidth = x.lowerSplit - x.left
  textBox(doc, 'Description of Services', x.left, lowerTop, leftWidth, 14, { bold: true, size: body, singleLine: true, valign: 'center' })
  const serviceDescription = layout.descriptionBreak
    ? 'Permanent placement services, other\nthan executive search services'
    : 'Permanent placement services, other than executive search services'
  textBox(doc, serviceDescription, x.left, lowerTop + 13, leftWidth, 28, { size: body, minSize: body - 1.8 })
  textBox(doc, `Company's PAN: ${company.pan}`, x.left, y.lowerBottom - 29, leftWidth, 14, { size: body, minSize: body - 1.5, singleLine: true, valign: 'center' })
  textBox(doc, company.reverseCharge, x.left, y.lowerBottom - 15, leftWidth, 14, { bold: layout.reverseBold !== false, size: body, minSize: 5.8, singleLine: true, valign: 'center' })

  const bankRows = [
    ['Bank Name', company.bank.name],
    ['IFSC Code', company.bank.ifsc],
    ['A/c No.', String(company.bank.account)],
    ['Branch', layout.branchLines || company.bank.branch]
  ]
  const bankLeft = x.lowerSplit
  const bankWidth = x.right - bankLeft
  const rowHeight = (y.lowerBottom - lowerTop) / (bankRows.length + 1)
  const labelWidth = Math.min(82, bankWidth * 0.34)
  bankRows.forEach(([label, value], index) => {
    const rowY = lowerTop + index * rowHeight
    const valueHeight = index === bankRows.length - 1 ? rowHeight * 2 : rowHeight
    textBox(doc, label, bankLeft, rowY, labelWidth, valueHeight, { bold: true, size: body, minSize: body - 1.3, singleLine: true, valign: index === bankRows.length - 1 ? 'top' : 'center' })
    textBox(doc, value, bankLeft + labelWidth, rowY, bankWidth - labelWidth, valueHeight, { size: body, minSize: body - 1.9, valign: index === bankRows.length - 1 ? 'top' : 'center' })
  })

  textBox(doc, `For ${company.name}`, x.lowerSplit, y.lowerBottom + layout.majorRule, x.right - x.lowerSplit, 18, { bold: true, size: body, minSize: 6.2, align: 'right', singleLine: true, valign: 'center', paddingX: 0.6 })
  textBox(doc, 'Authorized Signatory', x.lowerSplit, y.bottom - 17, x.right - x.lowerSplit, 15, { bold: true, size: body, minSize: body - 1.3, align: 'right', singleLine: true, valign: 'center', paddingX: 0.6 })
}

async function createInvoicePdf(data) {
  return (await renderInvoicePdf(data)).buffer
}

function renderInvoicePdf({ entity, invoice, overrides = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [A4_WIDTH, A4_HEIGHT], margin: 0, autoFirstPage: true, compress: true,
      info: { Title: `Tax Invoice ${clean(invoice.invoice_number)}`, Author: 'FyndBridge', Creator: 'FyndBridge ATS', Producer: 'PDFKit' }
    })
    const chunks = []
    let pageCount = 1
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('pageAdded', () => { pageCount += 1 })
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount }))
    doc.on('error', reject)
    try {
      doc._invoiceFonts = setupFonts(doc)
      const company = COMPANY[invoice.billing_entity]
      if (!company) throw new Error('Invalid billing entity')
      const layout = layoutForInvoice(invoice)
      if (!layout) throw new Error('Unsupported invoice layout')
      drawInvoiceRules(doc, layout)
      drawHeader(doc, layout, entity, invoice, company)
      drawServiceTable(doc, layout, entity, invoice, overrides, company)
      drawTotals(doc, layout, invoice)
      drawAmountWords(doc, layout, invoice)
      drawTaxSummary(doc, layout, invoice, clean(entity.sac || invoice.sac || '998512'))
      drawLowerDetails(doc, layout, company, invoice.tax_amount_in_words)
      doc.end()
    } catch (error) {
      reject(error)
    }
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
  A4_WIDTH,
  A4_HEIGHT,
  INVOICE_LAYOUTS,
  clean,
  financialYear,
  normalizeStateCode,
  detectGstComponent,
  calculateInvoice,
  roundInvoiceTotalPaise,
  normalizedOptionalName,
  selectInvoiceLayout,
  amountWords,
  formatRs,
  createInvoicePdf,
  renderInvoicePdf
}
