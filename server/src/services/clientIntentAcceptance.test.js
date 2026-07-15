const test = require('node:test')
const assert = require('node:assert/strict')
const { parseClientIntent } = require('./clientIntent')

const NOW = new Date('2026-07-15T06:00:00.000Z')

function structured(filters, overrides = {}) {
  return {
    mode: 'structured', logic: 'and', filters, search_text: null,
    sort: [], confidence: 0.96, unsupported: false, ...overrides
  }
}

const leaf = (field, operator, value) => ({ field, operator, ...(value !== undefined ? { value } : {}) })
const nestedOr = (...filters) => ({ logic: 'or', filters })

const CASES = [
  ['consultant is Cherry', [leaf('consultant', 'equals', 'Cherry')], ['consultant', 'equals', 'Cherry']],
  ['clients handled by Cherry', [leaf('consultant', 'equals', 'Cherry')], ['consultant', 'equals', 'Cherry']],
  ["Cherry's clients", [leaf('consultant', 'equals', 'Cherry')], ['consultant', 'equals', 'Cherry']],
  ['consultant is not Cherry', [leaf('consultant', 'not_equals', 'Cherry')], ['consultant', 'not_equals', 'Cherry']],
  ['consultant is Cherry or Rahul', [leaf('consultant', 'in', ['Cherry', 'Rahul'])], ['consultant', 'in', ['Cherry', 'Rahul']]],
  ['clients in Delhi', [leaf('location', 'contains', 'Delhi')], ['location', 'contains', 'Delhi']],
  ['clients in Delhi or Gurgaon', [nestedOr(leaf('location', 'contains', 'Delhi'), leaf('location', 'contains', 'Gurgaon'))], ['location', 'contains', 'Delhi']],
  ['region is north', [leaf('region', 'equals', 'north')], ['region', 'equals', 'North']],
  ['fintech clients', [leaf('sector', 'equals', 'fintech')], ['sector', 'equals', 'Financial Services']],
  ['sector is banking or insurance', [leaf('sector', 'in', ['banking', 'insurance'])], ['sector', 'in', ['Financial Services', 'Financial Services']]],
  ['GSTIN empty', [leaf('gstin', 'is_empty')], ['gstin', 'is_empty', undefined]],
  ['GSTIN not empty', [leaf('gstin', 'is_not_empty')], ['gstin', 'is_not_empty', undefined]],
  ['PAN missing', [leaf('pan', 'is_empty')], ['pan', 'is_empty', undefined]],
  ['email available', [leaf('email', 'is_not_empty')], ['email', 'is_not_empty', undefined]],
  ['linkedin unavailable', [leaf('linkedin', 'is_empty')], ['linkedin', 'is_empty', undefined]],
  ['terms signed', [leaf('terms_signed', 'equals', true)], ['terms_signed', 'equals', true]],
  ['terms not signed', [leaf('terms_signed', 'equals', false)], ['terms_signed', 'equals', false]],
  ['contract signed', [leaf('contract_signed', 'equals', true)], ['contract_signed', 'equals', true]],
  ['contract not signed', [leaf('contract_signed', 'equals', false)], ['contract_signed', 'equals', false]],
  ['contract document missing', [leaf('contract_document', 'is_empty')], ['contract_document', 'is_empty', undefined]],
  ['follow up today', [leaf('follow_up_date', 'on', 'today')], ['follow_up_date', 'on', '2026-07-15']],
  ['follow up tomorrow', [leaf('follow_up_date', 'on', 'tomorrow')], ['follow_up_date', 'on', '2026-07-16']],
  ['follow up this week', [leaf('follow_up_date', 'on', 'this week')], ['follow_up_date', 'between', ['2026-07-13', '2026-07-19']]],
  ['follow up overdue', [leaf('follow_up_overdue', 'equals', true)], ['follow_up_overdue', 'equals', true]],
  ['no follow up scheduled', [leaf('follow_up_date', 'is_empty')], ['follow_up_date', 'is_empty', undefined]],
  ['follow up before 20 July 2026', [leaf('follow_up_date', 'before', '20 July 2026')], ['follow_up_date', 'before', '2026-07-20']],
  ['connected last month', [leaf('connected_on', 'on', 'last month')], ['connected_on', 'between', ['2026-06-01', '2026-06-30']]],
  ['value above 10 lakh', [leaf('value', 'greater_than', '10 lakh')], ['value', 'greater_than', 1000000]],
  ['value between 5 and 20 lakh', [leaf('value', 'between', ['5 lakh', '20 lakh'])], ['value', 'between', [500000, 2000000]]],
  ['contact person is Shilpi', [leaf('contact_person', 'equals', 'Shilpi')], ['contact_person', 'equals', 'Shilpi']],
  ['client name starts with Tech', [leaf('client_name', 'starts_with', 'Tech')], ['client_name', 'starts_with', 'Tech']],
  ['comments contain payment', [leaf('comments', 'contains', 'payment')], ['comments', 'contains', 'payment']],
  ['consultant is Cherry and sector is fintech', [leaf('consultant', 'equals', 'Cherry'), leaf('sector', 'equals', 'fintech')], ['sector', 'equals', 'Financial Services']],
  ['Delhi OR Gurgaon plus signed terms', [nestedOr(leaf('location', 'contains', 'Delhi'), leaf('location', 'contains', 'Gurgaon')), leaf('terms_signed', 'equals', true)], ['terms_signed', 'equals', true]]
]

for (const [prompt, filters, expected] of CASES) {
  test(`Client mocked intent: ${prompt}`, async () => {
    let calls = 0
    const result = await parseClientIntent(prompt, {
      now: NOW,
      aiCall: async () => { calls += 1; return structured(filters) }
    })
    assert.equal(calls, 1)
    const match = result.filters.conditions.find(item => item.field === expected[0] && item.operator === expected[1])
    assert.ok(match, `missing ${expected[0]} ${expected[1]}`)
    assert.deepEqual(match.value, expected[2])
  })
}

test('Client invalid AI JSON falls back deterministically after exactly one request', async () => {
  let calls = 0
  const result = await parseClientIntent('consultant is Cherry', {
    aiCall: async () => { calls += 1; throw new Error('invalid JSON') }
  })
  assert.equal(calls, 1)
  assert.equal(result.parser, true)
  assert.deepEqual(result.filters.conditions[0], { type: 'condition', field: 'consultant', operator: 'equals', value: 'Cherry' })
})

for (const [label, response] of [
  ['unsupported field', structured([leaf('credit_card', 'equals', 'x')])],
  ['unsupported operator', structured([leaf('client_name', 'execute_sql', 'x')])]
]) {
  test(`Client ${label} uses bounded keyword fallback`, async () => {
    const result = await parseClientIntent('strategic partnership maturity', { aiCall: async () => response })
    assert.equal(result.keyword, true)
    assert.equal(result.filters.mode, 'keyword')
    assert.equal(result.filters.search_text, 'strategic partnership maturity')
  })
}
