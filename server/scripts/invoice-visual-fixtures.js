const { calculateInvoice } = require('../src/services/invoiceService')

const DISPLAY_ENTITY_BASE = Object.freeze({
  legal_entity_name: 'M/S SMT SHAKUNTLA EDUCATIONAL & WELFARE SOCIETY',
  optional_name: '-',
  address: 'PLOT NO. 1, KNOWLEDGE PARK II, GREATER NOIDA, Gautambuddha Nagar, Uttar Pradesh, 201301',
  pan: 'AABTS7575D',
  place_of_supply: 'Greater Noida',
  state: 'Uttar Pradesh',
  state_code: '09',
  gstin: '09AABTS7575D1Z6',
  contact_person: 'Shilpi Chandra',
  email: 'shilpi.chandra@galgotiasuniversity.edu.in',
  sac: '998312'
})

const profile = ({ sourceY, targetX, targetSummaryX = [], targetY, ruleThickness, bodySize, metaSize, titleSize }) => ({
  source_y_points: sourceY,
  target_x_points: [...new Set([...targetX, ...targetSummaryX])].sort((left, right) => left - right),
  target_y_points: targetY,
  rule_thickness_points: ruleThickness,
  body_font_size: bodySize,
  metadata_font_size: metaSize,
  title_font_size: titleSize
})

const CASES = Object.freeze([
  {
    id: 'fcapl-igst-no-rounding',
    entity: 'FCAPL',
    taxType: 'IGST',
    rounding: false,
    taxableAmount: '560000',
    invoiceNumber: 'FCAPL/26-27/001',
    referenceFile: 'FCAPL NOROUNDING (1).pdf',
    a4Profile: profile({
      sourceY: [21.60, 68.42, 87.14, 253.73, 274.25, 455.83, 470.95, 485.35, 508.39, 522.79, 537.19, 551.59, 627.94, 720.34],
      targetX: [21.01, 68.40, 247.61, 324.67, 408.94, 466.86, 572.16],
      targetSummaryX: [179.07],
      targetY: [21.01, 66.55, 84.76, 246.80, 266.76, 490.78, 505.49, 519.50, 541.91, 555.91, 569.92, 583.92, 658.19, 772.19],
      ruleThickness: [0.93, 1.75],
      bodySize: 8.87,
      metaSize: 9.34,
      titleSize: 14.94
    })
  },
  {
    id: 'fcapl-igst-rounding',
    entity: 'FCAPL',
    taxType: 'IGST',
    rounding: true,
    taxableAmount: '558720',
    invoiceNumber: 'FCAPL/26-27/001',
    referenceFile: 'FCAPL WITH ROUNDOFF.pdf',
    a4Profile: profile({
      sourceY: [21.72, 66.98, 85.10, 243.77, 263.45, 473.95, 488.59, 503.23, 517.87, 531.79, 554.11, 568.03, 581.95, 595.87, 668.74, 756.58],
      targetX: [21.13, 67.00, 250.76, 326.89, 408.47, 464.65, 569.48],
      targetSummaryX: [174.17],
      targetY: [21.13, 65.15, 82.77, 237.11, 256.25, 511.47, 525.71, 539.95, 554.19, 567.73, 589.44, 602.98, 616.52, 630.06, 700.94, 807.44],
      ruleThickness: [0.82, 1.75],
      bodySize: 8.64,
      metaSize: 9.10,
      titleSize: 14.47
    })
  },
  {
    id: 'fcapl-cgst-sgst',
    entity: 'FCAPL',
    taxType: 'CGST_SGST',
    rounding: true,
    taxableAmount: '558720',
    invoiceNumber: 'FCAPL/26-27/001',
    referenceFile: 'FyndBridge_Tax_Invoice_CGST_SGST (1).pdf',
    a4Profile: profile({
      sourceY: [21.60, 66.48, 84.48, 236.88, 257.04, 410.40, 425.04, 439.68, 454.32, 468.24, 482.16, 496.08, 510.00, 523.92, 537.84, 603.12, 696.48],
      targetX: [21.24, 67.46, 251.65, 329.39, 411.56, 468.05, 570.76],
      targetSummaryX: [184.89],
      targetY: [21.01, 64.66, 82.17, 230.41, 250.02, 444.56, 458.80, 473.04, 487.28, 500.81, 514.35, 527.89, 541.43, 554.97, 568.51, 632.01, 748.98],
      ruleThickness: [0.93],
      bodySize: 8.87,
      metaSize: 9.34,
      titleSize: 14.94
    })
  },
  {
    id: 'fcs-igst-no-rounding',
    entity: 'FCS',
    taxType: 'IGST',
    rounding: false,
    taxableAmount: '560000',
    invoiceNumber: 'FB/26-27/012',
    referenceFile: 'FCS NoRounding.pdf',
    a4Profile: profile({
      sourceY: [21.12, 68.30, 87.14, 241.13, 262.25, 498.79, 514.03, 528.55, 552.31, 566.83, 580.87, 595.39, 663.70, 766.06],
      targetX: [20.54, 68.87, 254.15, 328.64, 413.73, 472.23, 570.53],
      targetSummaryX: [184.91],
      targetY: [20.54, 66.43, 84.76, 234.54, 255.08, 535.09, 549.91, 564.03, 587.14, 601.27, 614.92, 629.05, 695.49, 816.66],
      ruleThickness: [0.93, 1.87],
      bodySize: 8.99,
      metaSize: 9.45,
      titleSize: 15.06
    })
  },
  {
    id: 'fcs-igst-rounding',
    entity: 'FCS',
    taxType: 'IGST',
    rounding: true,
    taxableAmount: '558720',
    invoiceNumber: 'FB/26-27/012',
    referenceFile: 'FCS with roundoff.pdf',
    a4Profile: profile({
      sourceY: [21.60, 67.22, 85.46, 243.89, 264.29, 476.83, 491.59, 506.35, 521.11, 535.27, 557.83, 571.99, 586.15, 600.34, 674.86, 763.42],
      targetX: [21.01, 67.46, 266.17, 336.92, 419.47, 476.20, 570.06],
      targetSummaryX: [188.41],
      targetY: [21.01, 65.38, 83.12, 237.23, 257.07, 514.29, 528.65, 543.01, 557.36, 571.14, 593.08, 606.85, 620.63, 634.43, 706.91, 814.09],
      ruleThickness: [0.93],
      bodySize: 8.75,
      metaSize: 9.10,
      titleSize: 14.59
    })
  },
  {
    id: 'fcs-cgst-sgst',
    entity: 'FCS',
    taxType: 'CGST_SGST',
    rounding: true,
    taxableAmount: '558720',
    invoiceNumber: 'FB/26-27/012',
    referenceFile: 'FCS_CGST_SGST.pdf',
    a4Profile: profile({
      sourceY: [21.60, 68.78, 87.62, 241.61, 262.73, 421.63, 436.87, 452.11, 467.35, 481.87, 496.39, 510.91, 525.43, 539.95, 554.47, 622.78, 727.66],
      targetX: [21.01, 68.87, 237.81, 322.57, 407.66, 466.16, 572.63],
      targetSummaryX: [168.56],
      targetY: [21.01, 66.90, 85.23, 235.01, 255.55, 453.20, 468.02, 482.85, 497.67, 511.79, 525.92, 540.04, 554.16, 568.29, 582.41, 648.85, 779.31],
      ruleThickness: [0.93],
      bodySize: 8.99,
      metaSize: 9.45,
      titleSize: 15.06
    })
  }
])

function renderPayloadForCase(definition) {
  const displayEntity = {
    ...DISPLAY_ENTITY_BASE,
    ...(definition.taxType === 'CGST_SGST' ? {
      address: '20, OKHLA INDUSTRIAL ESTATE PHASE 3, NEW DELHI, DELHI, 110020',
      place_of_supply: 'New Delhi',
      state: 'Delhi',
      state_code: '07',
      gstin: '07AABTS7575D1Z6'
    } : {}),
    optional_name: '-'
  }

  const input = {
    ...displayEntity,
    billing_entity: definition.entity,
    model: 'others',
    others_amount: definition.taxableAmount,
    professional_fee_text: '',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9
  }
  const calculation = calculateInvoice(input)

  if (calculation.gst_component !== definition.taxType) {
    throw new Error(`${definition.id}: expected ${definition.taxType}, got ${calculation.gst_component}`)
  }
  if (Boolean(calculation.rounding_type) !== definition.rounding) {
    throw new Error(`${definition.id}: rounding fixture no longer produces the expected variant`)
  }

  const invoice = {
    ...calculation,
    billing_entity: definition.entity,
    invoice_number: definition.invoiceNumber,
    invoice_date: '2026-06-24',
    sac: displayEntity.sac
  }
  const taxLabel = definition.taxType === 'IGST'
    ? 'Integrated GST (IGST)'
    : 'Central Tax (CGST)'

  return {
    entity: displayEntity,
    invoice,
    overrides: { professional_fee_text: '' },
    expectedText: [
      definition.invoiceNumber,
      DISPLAY_ENTITY_BASE.legal_entity_name,
      taxLabel,
      calculation.amount_in_words,
      calculation.tax_amount_in_words
    ]
  }
}

module.exports = { CASES, DISPLAY_ENTITY_BASE, renderPayloadForCase }
