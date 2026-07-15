const test = require('node:test')
const assert = require('node:assert/strict')
const {
  INTENT_VERSION,
  candidateIntentSchema,
  buildCandidateIntentPrompt,
  repairCandidateIntent,
  validateCandidateIntent,
  parseCandidateIntent
} = require('./candidateIntent')

const FIXED_NOW = new Date('2026-07-15T06:00:00.000Z')

function structured(filters, overrides = {}) {
  return {
    mode: 'structured',
    logic: 'and',
    filters,
    search_text: null,
    sort: [],
    confidence: 0.95,
    unsupported: false,
    ...overrides
  }
}

test('prompt is permission-aware and documents modes, units, dates, booleans and empty values', () => {
  const prompt = buildCandidateIntentPrompt('show experienced candidates', ['consultant', 'experience', 'current_ctc', 'notice_period', 'open_to_relocate', 'created_date'], FIXED_NOW)
  const fields = prompt.slice(prompt.indexOf('Allowed candidate fields:'))
  assert.match(prompt, /mode="structured"/)
  assert.match(prompt, /mode="hybrid"/)
  assert.match(prompt, /mode="keyword"/)
  assert.match(prompt, /absolute INR rupees/)
  assert.match(prompt, /notice period to days/i)
  assert.match(prompt, /Asia\/Kolkata is 2026-07-15/)
  assert.match(prompt, /current financial year is 2026-04-01 through 2027-03-31/)
  assert.match(prompt, /not open\/unwilling\/cannot relocate to boolean false/)
  assert.match(prompt, /whitespace, null, dash, and an empty array mean is_empty/)
  assert.match(prompt, /Candidates Month concept is the candidate created month/)
  assert.match(fields, /created_date:[^\n]+aliases=[^\n]*submission month/)
  assert.match(fields, /consultant:/)
  assert.doesNotMatch(fields, /email:/)
})

test('provider schema enumerates only permission-approved public fields', () => {
  const schema = candidateIntentSchema(['consultant', 'email', 'created_date', 'consultant_user_id'])
  assert.deepEqual(schema.$defs.filter.properties.field.enum, ['email', 'created_date', 'consultant'])
  assert.ok(!schema.$defs.filter.properties.field.enum.includes('month'))
  assert.equal(schema.properties.sort.maxItems, 0)
})

test('AI is attempted first exactly once and candidate calls request primary-only provider behavior', async () => {
  let calls = 0
  let request
  const result = await parseCandidateIntent('consultant is Cherry', {
    allowedFields: ['consultant'],
    now: FIXED_NOW,
    aiCall: async args => {
      calls += 1
      request = args
      return structured([{ field: 'consultant', operator: 'equals', value: 'Cherry' }])
    }
  })

  assert.equal(calls, 1)
  assert.equal(request.primaryOnly, true)
  assert.equal(request.temperature, 0)
  assert.equal(request.schemaName, 'candidate_intent_v2')
  assert.equal(result.ai, true)
  assert.equal(result.filters.version, INTENT_VERSION)
  assert.equal(result.filters.mode, 'structured')
  assert.deepEqual(result.filters.conditions.map(item => [item.field, item.operator, item.value]), [['consultant', 'equals', 'Cherry']])
})

test('valid hybrid AI output preserves recursive logical groups and normalizes values through the existing validator', async () => {
  const result = await parseCandidateIntent('senior react candidates in Delhi or Gurgaon with CTC above 10 LPA', {
    allowedFields: ['current_location', 'current_ctc'],
    now: FIXED_NOW,
    aiCall: async () => ({
      mode: 'hybrid',
      logic: 'and',
      filters: [
        {
          logic: 'or',
          filters: [
            { field: 'current_location', operator: 'contains', value: 'Delhi' },
            { field: 'current_location', operator: 'contains', value: 'Gurgaon' }
          ]
        },
        { field: 'current_ctc', operator: 'greater_than', value: '10 LPA' }
      ],
      search_text: 'senior react',
      sort: [],
      confidence: 0.91,
      unsupported: false
    })
  })

  assert.equal(result.filters.mode, 'hybrid')
  assert.equal(result.filters.search_text, 'senior react')
  assert.equal(result.filters.root.type, 'group')
  assert.equal(result.filters.root.children[0].combinator, 'OR')
  assert.equal(result.filters.conditions.find(item => item.field === 'current_ctc').value, 1000000)
})

test('valid keyword AI output uses approved contract without inventing a root', async () => {
  const result = await parseCandidateIntent('strong stakeholder management profiles', {
    aiCall: async () => ({
      mode: 'keyword', logic: 'and', filters: [], search_text: 'strong stakeholder management', sort: [], confidence: 0.82, unsupported: false
    })
  })
  assert.equal(result.filters.mode, 'keyword')
  assert.equal(result.filters.root, null)
  assert.deepEqual(result.filters.conditions, [])
  assert.equal(result.filters.search_text, 'strong stakeholder management')
})

test('legacy Month wording repairs to the canonical created_date month range', () => {
  const result = validateCandidateIntent(structured([
    { field: 'month', operator: 'equals', value: 'July 2026' }
  ]), { allowedFields: ['created_date'], now: FIXED_NOW })
  assert.deepEqual(result.conditions, [{
    type: 'condition',
    field: 'created_date',
    operator: 'between',
    value: ['2026-07-01', '2026-07-31']
  }])
  assert.equal(result.filters[0].field, 'created_date')
})

test('one local repair maps legacy root and conditions shapes but keeps canonical output', () => {
  const root = validateCandidateIntent({
    root: { type: 'condition', field: 'consultant', operator: 'equals', value: 'Cherry' },
    confidence: 0.9,
    unsupported: false
  })
  assert.equal(root.version, 2)
  assert.equal(root.filters[0].field, 'consultant')

  const conditions = validateCandidateIntent({
    logic: 'OR',
    conditions: [
      { field: 'current_location', operator: 'contains', value: 'Delhi' },
      { field: 'current_location', operator: 'contains', value: 'Gurgaon' }
    ],
    confidence: 0.9,
    unsupported: false
  })
  assert.equal(conditions.logic, 'or')
  assert.equal(conditions.root.combinator, 'OR')
})

test('repair and validation reject unknown top-level and nested properties', () => {
  assert.throws(() => repairCandidateIntent({ ...structured([]), sql: 'select *' }), /Unknown candidate intent property/)
  assert.throws(() => validateCandidateIntent(structured([{ field: 'email', operator: 'equals', value: 'x@example.com', column: 'email' }])), /Unknown candidate filter property/)
  assert.throws(() => validateCandidateIntent(structured([{ logic: 'and', filters: [], extra: true }])), /Unknown candidate group property/)
  assert.throws(() => validateCandidateIntent(structured([{ field: 'email', operator: 'equals', value: { sql: 'x' } }])), /value type/)
  assert.throws(() => validateCandidateIntent(structured([], { confidence: '0.9' })), /confidence/)
  assert.throws(() => validateCandidateIntent(structured([], { search_text: 42 })), /search text/)
})

test('invalid JSON/provider failure falls back deterministically after one attempt', async () => {
  let calls = 0
  const result = await parseCandidateIntent('consultant is Cherry', {
    aiCall: async () => {
      calls += 1
      throw new Error('Gemini returned invalid JSON')
    }
  })
  assert.equal(calls, 1)
  assert.equal(result.parser, true)
  assert.equal(result.fallback, true)
  assert.equal(result.filters.mode, 'structured')
  assert.equal(result.filters.conditions[0].field, 'consultant')
})

test('low-confidence and unsupported AI output use deterministic fallback', async () => {
  for (const response of [
    structured([{ field: 'experience', operator: 'greater_than', value: 8 }], { confidence: 0.2 }),
    structured([{ field: 'experience', operator: 'greater_than', value: 8 }], { unsupported: true })
  ]) {
    let calls = 0
    const result = await parseCandidateIntent('experience greater than 8', {
      aiCall: async () => { calls += 1; return response }
    })
    assert.equal(calls, 1)
    assert.equal(result.parser, true)
    assert.equal(result.filters.conditions[0].operator, 'greater_than')
  }
})

test('invalid AI field, operator, range and extra properties never reach the returned AST', async () => {
  const responses = [
    structured([{ field: 'sql', operator: 'equals', value: 'x' }]),
    structured([{ field: 'email', operator: 'greater_than', value: 'x' }]),
    structured([{ field: 'experience', operator: 'between', value: [10] }]),
    { ...structured([{ field: 'email', operator: 'equals', value: 'x@example.com' }]), explanation: 'extra' }
  ]
  for (const response of responses) {
    const result = await parseCandidateIntent('ideal profiles with broad leadership exposure', { aiCall: async () => response })
    assert.equal(result.filters.mode, 'keyword')
    assert.equal(result.filters.root, null)
    assert.equal(result.filters.search_text, 'ideal profiles with broad leadership exposure')
  }
})

test('permission-disallowed AI and deterministic fields fall through to safe keyword mode', async () => {
  const result = await parseCandidateIntent('email is empty', {
    allowedFields: ['consultant'],
    aiCall: async () => structured([{ field: 'email', operator: 'is_empty' }])
  })
  assert.equal(result.filters.mode, 'keyword')
  assert.equal(result.filters.search_text, 'email is empty')
})

test('unstructured queries preserve the original request in keyword fallback', async () => {
  let calls = 0
  const result = await parseCandidateIntent('  strategic   product leaders  ', {
    aiCall: async () => { calls += 1; throw new Error('provider unavailable') }
  })
  assert.equal(calls, 1)
  assert.equal(result.keyword, true)
  assert.equal(result.filters.search_text, 'strategic product leaders')
  assert.equal(result.filters.confidence, 0)
})

test('unsafe, empty and malformed input is rejected before any AI call', async () => {
  for (const prompt of ['', 'delete candidates', '((consultant is Cherry)']) {
    let calls = 0
    await assert.rejects(
      parseCandidateIntent(prompt, { aiCall: async () => { calls += 1; return {} } }),
      error => error.statusCode === 400
    )
    assert.equal(calls, 0)
  }
})

test('persisted keyword contract with confidence zero validates and round-trips safely', () => {
  const persisted = {
    version: 2,
    mode: 'keyword',
    logic: 'and',
    filters: [],
    root: null,
    conditions: [],
    search_text: 'strategic product leaders',
    sort: [],
    confidence: 0
  }
  assert.throws(() => validateCandidateIntent(persisted), /Persisted candidate intent/)
  assert.deepEqual(validateCandidateIntent(persisted, { requireAiConfidence: false }), persisted)
})

test('persisted structured contracts recompute derived AST and conditions before execution', () => {
  const persisted = {
    version: 2,
    mode: 'structured',
    logic: 'and',
    filters: [{ field: 'consultant', operator: 'equals', value: 'Cherry' }],
    root: { type: 'condition', field: 'sql', operator: 'equals', value: 'unsafe' },
    conditions: [{ type: 'condition', field: 'sql', operator: 'equals', value: 'unsafe' }],
    search_text: null,
    sort: [],
    confidence: 0.95
  }
  const validated = validateCandidateIntent(persisted, { requireAiConfidence: false })
  assert.equal(validated.root.field, 'consultant')
  assert.deepEqual(validated.conditions.map(item => item.field), ['consultant'])
})
