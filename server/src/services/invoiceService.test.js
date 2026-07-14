const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANY,
  calculateInvoice,
  createInvoicePdf,
  detectGstComponent,
  formatRs,
  normalizedOptionalName,
  renderInvoicePdf,
  roundInvoiceTotalPaise
} = require('./invoiceService')

const baseInput = {
  model: 'others',
  igst_rate: 18,
  cgst_rate: 9,
  sgst_rate: 9
}

const taxableForSuffix = {
  CGST_SGST: { 0: '800.00', 49: '800.41', 50: '800.42' },
  IGST: { 0: '800.00', 49: '801.26', 50: '800.42' }
}

test('state code deterministically selects Delhi CGST/SGST or outside-Delhi IGST', () => {
  assert.equal(detectGstComponent('07', 'Uttar Pradesh'), 'CGST_SGST')
  assert.equal(detectGstComponent('7', 'Uttar Pradesh'), 'CGST_SGST')
  assert.equal(detectGstComponent('09', 'Delhi'), 'IGST')
  assert.equal(detectGstComponent('', ' delhi '), 'CGST_SGST')
  assert.equal(detectGstComponent('', 'NEW DELHI'), 'CGST_SGST')
  assert.equal(detectGstComponent('', 'Uttar Pradesh'), 'IGST')
})

test('round-off boundaries use exact paise and .50 always rounds upward', () => {
  const cases = [
    [100000n, null, 0n, 100000n],
    [100001n, 'LESS', 1n, 100000n],
    [100049n, 'LESS', 49n, 100000n],
    [100050n, 'MORE', 50n, 100100n],
    [100099n, 'MORE', 1n, 100100n]
  ]
  cases.forEach(([exact, type, adjustment, final]) => {
    assert.deepEqual(roundInvoiceTotalPaise(exact), { type, adjustmentPaise: adjustment, finalPaise: final })
  })
})

for (const billing_entity of ['FCAPL', 'FCS']) {
  for (const [jurisdiction, state_code, gst_component] of [['Delhi', '07', 'CGST_SGST'], ['outside Delhi', '09', 'IGST']]) {
    for (const suffix of [0, 49, 50]) {
      test(`${billing_entity} ${jurisdiction} .${String(suffix).padStart(2, '0')} calculation`, () => {
        const result = calculateInvoice({
          ...baseInput,
          billing_entity,
          state_code,
          state: jurisdiction,
          others_amount: taxableForSuffix[gst_component][suffix]
        })
        assert.equal(result.gst_component, gst_component)
        assert.equal(Math.round(result.total_before_rounding * 100) % 100, suffix)
        if (gst_component === 'CGST_SGST') {
          assert.equal(result.cgst_rate, 9)
          assert.equal(result.sgst_rate, 9)
          assert.equal(result.igst_rate, null)
        } else {
          assert.equal(result.igst_rate, 18)
          assert.equal(result.cgst_rate, null)
          assert.equal(result.sgst_rate, null)
        }
        if (suffix === 0) {
          assert.equal(result.rounding_type, null)
          assert.equal(result.rounding_amount, 0)
          assert.equal(result.grand_total, result.total_before_rounding)
        } else if (suffix === 49) {
          assert.equal(result.rounding_type, 'LESS')
          assert.equal(result.rounding_amount, 0.49)
        } else {
          assert.equal(result.rounding_type, 'MORE')
          assert.equal(result.rounding_amount, 0.5)
        }
      })
    }
  }
}

test('.01 and .99 adjustments do not contain floating-point noise', () => {
  const down = calculateInvoice({ ...baseInput, billing_entity: 'FCS', state_code: '07', others_amount: '800.01' })
  const up = calculateInvoice({ ...baseInput, billing_entity: 'FCS', state_code: '09', others_amount: '800.84' })
  assert.equal(down.total_before_rounding, 944.01)
  assert.equal(down.rounding_type, 'LESS')
  assert.equal(down.rounding_amount, 0.01)
  assert.equal(up.total_before_rounding, 944.99)
  assert.equal(up.rounding_type, 'MORE')
  assert.equal(up.rounding_amount, 0.01)
  assert.equal(formatRs(up.rounding_amount), '₹0.01')
})

test('amount and tax words use final total and exact tax paise', () => {
  const result = calculateInvoice({ ...baseInput, billing_entity: 'FCAPL', state_code: '09', others_amount: '558720' })
  assert.equal(result.amount_in_words, 'INR Six Lakh Fifty Nine Thousand Two Hundred Ninety Only')
  assert.equal(result.tax_amount_in_words, 'One Lakh Five Hundred Sixty Nine Rupees and Sixty Paise Only')
})

test('optional-name placeholders are suppressed without suppressing real names', () => {
  for (const value of ['-', ' ', null, undefined, 'N/A', 'NA', 'n.a.', 'Not Applicable']) assert.equal(normalizedOptionalName(value), '')
  assert.equal(normalizedOptionalName(' (Galgotias University) '), '(Galgotias University)')
})

test('issuer bank accounts remain exact strings', () => {
  assert.equal(COMPANY.FCS.bank.account, '102305501028')
  assert.equal(COMPANY.FCAPL.bank.account, '42926962136')
  assert.doesNotMatch(COMPANY.FCS.bank.account, /e\+/i)
})

test('all eight layout combinations render as one US Letter page with long dynamic text', async () => {
  const entityBase = {
    legal_entity_name: 'A VERY LONG LEGAL ENTITY NAME FOR PDF OVERFLOW VERIFICATION AND ACCOUNTING RECORDS',
    optional_name: '(A genuine and fairly long optional display name)',
    address: 'A long multi-part billing address, Building 10, Business District, Near the Main Commercial Centre, New Delhi, Delhi, India, 110020',
    pan: 'AABTS7575D',
    place_of_supply: 'New Delhi',
    gstin: '07AABTS7575D1Z6',
    contact_person: 'A Long Contact Person Name',
    email: 'a.very.long.billing.email.address@long-client-domain.example.com',
    sac: '998312'
  }
  for (const billing_entity of ['FCAPL', 'FCS']) {
    for (const [state_code, state] of [['07', 'Delhi'], ['09', 'Uttar Pradesh']]) {
      for (const others_amount of ['560000', '558720']) {
        const entity = { ...entityBase, state_code, state }
        const input = { ...baseInput, ...entity, billing_entity, others_amount, professional_fee_text: 'Recruitment fee for the selected candidate under the agreed professional services engagement.' }
        const invoice = {
          ...calculateInvoice(input),
          billing_entity,
          invoice_number: `${billing_entity === 'FCAPL' ? 'FCAPL' : 'FB'}/26-27/001`,
          invoice_date: '2026-07-14',
          sac: entity.sac
        }
        const rendered = await renderInvoicePdf({ entity, invoice, overrides: input })
        assert.equal(rendered.pageCount, 1)
        assert.ok(rendered.buffer.length > 50000)
        assert.match(rendered.buffer.toString('latin1'), /\/MediaBox\s*\[0 0 612 792\]/)
        const publicBuffer = await createInvoicePdf({ entity, invoice, overrides: input })
        assert.ok(publicBuffer.equals(rendered.buffer) || publicBuffer.length > 50000)
      }
    }
  }
})
