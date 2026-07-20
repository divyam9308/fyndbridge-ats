const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMandateIntent } = require('./mandateIntent')
const { mandateAiFilter } = require('./mandateAiFilter')

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
  ['consultant is Cherry', [leaf('consultant', 'contains', 'Cherry')], ['consultant', 'contains', 'Cherry']],
  ['mandates assigned to Cherry', [leaf('consultant', 'contains', 'Cherry')], ['consultant', 'contains', 'Cherry']],
  ["Cherry's mandates", [leaf('consultant', 'contains', 'Cherry')], ['consultant', 'contains', 'Cherry']],
  ['consultant is not Cherry', [leaf('consultant', 'not_contains', 'Cherry')], ['consultant', 'not_contains', 'Cherry']],
  ['consultant is Cherry or Rahul', [leaf('consultant', 'contains_any', ['Cherry', 'Rahul'])], ['consultant', 'contains_any', ['Cherry', 'Rahul']]],
  ['assigned to both Cherry and Rahul', [leaf('consultant', 'contains_all', ['Cherry', 'Rahul'])], ['consultant', 'contains_all', ['Cherry', 'Rahul']]],
  ['no consultant assigned', [leaf('consultant', 'is_empty')], ['consultant', 'is_empty', undefined]],
  ['multiple consultants assigned', [leaf('consultant_count', 'greater_than', 1)], ['consultant_count', 'greater_than', 1]],
  ['team lead is Amit', [leaf('team_lead', 'equals', 'Amit')], ['team_lead', 'equals', 'Amit']],
  ['team lead is not Amit', [leaf('team_lead', 'not_equals', 'Amit')], ['team_lead', 'not_equals', 'Amit']],
  ['no team lead', [leaf('team_lead', 'is_empty')], ['team_lead', 'is_empty', undefined]],
  ['client is ABC', [leaf('client_name', 'equals', 'ABC')], ['client_name', 'equals', 'ABC']],
  ['client is ABC or XYZ', [leaf('client_name', 'in', ['ABC', 'XYZ'])], ['client_name', 'in', ['ABC', 'XYZ']]],
  ['role is HR Manager', [leaf('role', 'equals', 'HR Manager')], ['role', 'equals', 'HR Manager']],
  ['role contains developer', [leaf('role', 'contains', 'developer')], ['role', 'contains', 'developer']],
  ['location is Delhi', [leaf('location', 'equals', 'Delhi')], ['location', 'equals', 'Delhi']],
  ['budget above 20 lpa', [leaf('budget', 'greater_than', '20 lpa')], ['budget', 'greater_than', 20]],
  ['budget below 15 lpa', [leaf('budget', 'less_than', '15 lpa')], ['budget', 'less_than', 15]],
  ['budget between 10 and 20 lpa', [leaf('budget', 'between', ['10 lpa', '20 lpa'])], ['budget', 'between', [10, 20]]],
  ['30+ budget', [leaf('budget', 'greater_than_or_equal', '30 lpa')], ['budget', 'greater_than_or_equal', 30]],
  ['experience above 8 years', [leaf('experience', 'greater_than', '8 years')], ['experience', 'greater_than', 8]],
  ['experience between 5 and 10 years', [leaf('experience', 'between', ['5 years', '10 years'])], ['experience', 'between', [5, 10]]],
  ['fresher roles', [leaf('experience', 'equals', 'fresher')], ['experience', 'equals', 0]],
  ['sector is banking', [leaf('sector', 'equals', 'banking')], ['sector', 'equals', 'Financial Services']],
  ['ongoing mandates', [leaf('status', 'equals', 'ongoing')], ['status', 'equals', 'Ongoing (P1)']],
  ['delivered mandates', [leaf('status', 'equals', 'delivered')], ['status', 'equals', 'Delivered (P2)']],
  ['paused mandates', [leaf('status', 'equals', 'paused')], ['status', 'equals', 'Paused (P3)']],
  ['completed mandates', [leaf('status', 'equals', 'completed')], ['status', 'equals', 'Completed']],
  ['scrapped mandates', [leaf('status', 'equals', 'scrapped')], ['status', 'equals', 'Scrapped']],
  ['status is not completed', [leaf('status', 'not_equals', 'completed')], ['status', 'not_equals', 'Completed']],
  ['allocated this month', [leaf('date_of_allocation', 'on', 'this month')], ['date_of_allocation', 'between', ['2026-07-01', '2026-07-31']]],
  ['allocated before 1 July 2026', [leaf('date_of_allocation', 'before', '1 July 2026')], ['date_of_allocation', 'before', '2026-07-01']],
  ['JD uploaded', [leaf('jd', 'is_not_empty')], ['jd', 'is_not_empty', undefined]],
  ['JD missing', [leaf('jd', 'is_empty')], ['jd', 'is_empty', undefined]],
  ['comments contain urgent', [leaf('comments', 'contains', 'urgent')], ['comments', 'contains', 'urgent']],
  ['ongoing mandates assigned to Cherry', [leaf('status', 'equals', 'ongoing'), leaf('consultant', 'contains', 'Cherry')], ['consultant', 'contains', 'Cherry']],
  ['Delhi OR Gurgaon with budget above 15', [nestedOr(leaf('location', 'contains', 'Delhi'), leaf('location', 'contains', 'Gurgaon')), leaf('budget', 'greater_than', '15 lpa')], ['budget', 'greater_than', 15]],
  ['team lead exists but consultant is empty', [leaf('team_lead', 'is_not_empty'), leaf('consultant', 'is_empty')], ['consultant', 'is_empty', undefined]],
  ['sector is technology or finance', [leaf('sector', 'in', ['technology', 'finance'])], ['sector', 'in', ['Technology', 'Financial Services']]],
  ['remote mandates', [leaf('location', 'contains', 'Remote')], ['location', 'contains', 'Remote']]
]

for (const [prompt, filters, expected] of CASES) {
  test(`Mandate mocked intent: ${prompt}`, async () => {
    let calls = 0
    const result = await parseMandateIntent(prompt, {
      now: NOW,
      aiCall: async () => { calls += 1; return structured(filters) }
    })
    assert.equal(calls, 1)
    const match = result.filters.conditions.find(item => item.field === expected[0] && item.operator === expected[1])
    assert.ok(match, `missing ${expected[0]} ${expected[1]}`)
    assert.deepEqual(match.value, expected[2])
  })
}

for (const [prompt, sort] of [
  ['latest mandates', { field: 'date_of_allocation', direction: 'desc' }],
  ['oldest mandates first', { field: 'date_of_allocation', direction: 'asc' }],
  ['highest budget mandates first', { field: 'budget', direction: 'desc' }],
  ['lowest experience first', { field: 'experience', direction: 'asc' }]
]) {
  test(`Mandate safe sort: ${prompt}`, async () => {
    const result = await parseMandateIntent(prompt, {
      aiCall: async () => structured([], { sort: [sort] })
    })
    assert.deepEqual(result.filters.sort, [sort])
    assert.equal(result.filters.root, null)
  })
}

test('Mandate invalid AI JSON falls back deterministically once', async () => {
  let calls = 0
  const result = await parseMandateIntent('team lead is Amit', {
    aiCall: async () => { calls += 1; throw new Error('invalid JSON') }
  })
  assert.equal(calls, 1)
  assert.equal(result.parser, true)
  assert.deepEqual(result.filters.conditions[0], { type: 'condition', field: 'team_lead', operator: 'equals', value: 'Amit' })
})

for (const [label, response] of [
  ['unsupported field', structured([leaf('sql', 'equals', 'x')])],
  ['unsupported operator', structured([leaf('role', 'drop_table', 'x')])],
  ['malformed numeric range', structured([leaf('budget', 'between', ['20 lpa'])])]
]) {
  test(`Mandate ${label} uses bounded keyword fallback`, async () => {
    const result = await parseMandateIntent('strategic leadership hiring', { aiCall: async () => response })
    assert.equal(result.filters.mode, 'keyword')
    assert.equal(result.keyword, true)
  })
}

test('Mandate array compiler uses exact overlap/containment and negative membership', () => {
  const compile = (operator, value) => mandateAiFilter.compileAst(mandateAiFilter.validateFilter({
    root: { type: 'condition', field: 'consultant', operator, ...(value !== undefined ? { value } : {}) }
  }).root)
  assert.match(compile('contains_any', ['Cherry', 'Rahul']), /\.ov\./)
  assert.match(compile('contains_all', ['Cherry', 'Rahul']), /\.cs\./)
  assert.match(compile('not_contains', 'Cherry'), /\.not\.cs\./)
})

test('Mandate budget and experience ranges compile positive-width semantic overlap, never lexical label comparisons', () => {
  const budget = mandateAiFilter.validateFilter({ root: { type: 'condition', field: 'budget', operator: 'between', value: ['10 lpa', '20 lpa'] } }).root
  const experience = mandateAiFilter.validateFilter({ root: { type: 'condition', field: 'experience', operator: 'between', value: ['5 years', '10 years'] } }).root
  assert.equal(mandateAiFilter.compileAst(budget), 'and(ai_budget_ceiling_lpa.gt."10",ai_budget_min_lpa.lt."20")')
  assert.equal(mandateAiFilter.compileAst(experience), 'and(ai_experience_ceiling_years.gt."5",ai_experience_min_years.lt."10")')
})
