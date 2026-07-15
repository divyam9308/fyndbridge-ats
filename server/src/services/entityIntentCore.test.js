const test = require('node:test')
const assert = require('node:assert/strict')
const {
  field,
  createEntityFilter,
  TEXT_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  DATE_OPERATORS
} = require('./entityAiFilterCore')
const {
  INTENT_VERSION,
  MAX_FILTER_DEPTH,
  MAX_FILTERS,
  MAX_SORTS,
  createEntityIntent
} = require('./entityIntentCore')

const FIXED_NOW = new Date('2026-07-15T06:00:00.000Z')

const filter = createEntityFilter({
  label: 'client',
  fields: {
    status: field('enum', ['status'], ['state'], ENUM_OPERATORS, {
      values: ['Active', 'Inactive'],
      description: 'current client relationship status'
    }),
    location: field('text', ['location'], ['city', 'based in'], TEXT_OPERATORS, {
      description: 'client city or region'
    }),
    value: field('money', ['amount'], ['commercial value'], NUMBER_OPERATORS, {
      unit: 'absolute INR rupees'
    }),
    created_at: field('date', ['created_at'], ['created date'], DATE_OPERATORS, { timestamp: true }),
    secret_column: field('text', ['secret_column'], [], TEXT_OPERATORS, { internal: true })
  },
  keywordFields: ['location']
})

const intent = createEntityIntent({
  entityKey: 'client',
  singular: 'client',
  plural: 'Clients',
  filter,
  sortFields: {
    created_at: { description: 'latest or oldest client', aliases: ['created'], permissionField: 'created_at' },
    value: { description: 'highest or lowest value', permissionField: 'value' }
  },
  parseSort(prompt) {
    if (/\blatest\b/i.test(prompt)) return [{ field: 'created_at', direction: 'desc' }]
    if (/\bhighest value\b/i.test(prompt)) return [{ field: 'value', direction: 'desc' }]
    return []
  },
  extraInstructions: ['A client value is an absolute INR amount.'],
  examples: ['clients in Delhi with status Active']
})

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

test('entity schema and prompt expose only visible registry fields and whitelisted sorts', () => {
  const allowed = ['status', 'location', 'created_at']
  const schema = intent.intentSchema(allowed)
  assert.deepEqual(schema.$defs.filter.properties.field.enum, allowed)
  assert.ok(schema.$defs.filter.properties.operator.enum.includes('contains'))
  assert.deepEqual(schema.properties.sort.items.properties.field.enum, ['created_at'])
  assert.equal(schema.properties.sort.maxItems, MAX_SORTS)
  assert.equal(schema.properties.additionalProperties, undefined)

  const prompt = intent.buildIntentPrompt('show active clients in Delhi', allowed, FIXED_NOW)
  const fieldSection = prompt.slice(prompt.indexOf('Allowed client fields:'))
  assert.match(prompt, /JSON only/)
  assert.match(prompt, /mode="structured"/)
  assert.match(prompt, /mode="hybrid"/)
  assert.match(prompt, /mode="keyword"/)
  assert.match(prompt, /Asia\/Kolkata is 2026-07-15/)
  assert.match(prompt, /A client value is an absolute INR amount/)
  assert.match(prompt, /Module example: clients in Delhi with status Active/)
  assert.match(fieldSection, /^Allowed client fields:\nstatus:/m)
  assert.match(fieldSection, /\nlocation:/)
  assert.doesNotMatch(fieldSection, /secret_column/)
  assert.doesNotMatch(fieldSection, /candidate/i)
})

test('AI is attempted exactly once with deterministic, primary-only provider settings', async () => {
  let calls = 0
  let request
  const result = await intent.parseIntent('status is Active', {
    allowedFields: ['status', 'location', 'created_at'],
    now: FIXED_NOW,
    aiCall: async args => {
      calls += 1
      request = args
      return structured([{ field: 'status', operator: 'equals', value: 'active' }])
    }
  })

  assert.equal(calls, 1)
  assert.equal(request.primaryOnly, true)
  assert.equal(request.temperature, 0)
  assert.equal(request.schemaName, 'client_intent_v2')
  assert.equal(result.ai, true)
  assert.equal(result.semantic, true)
  assert.equal(result.filters.version, INTENT_VERSION)
  assert.equal(result.filters.conditions[0].value, 'Active')
})

test('nested and hybrid AI intent is normalized through the entity validator', async () => {
  const result = await intent.parseIntent('strategic clients in Delhi or Gurgaon above 10 lakh', {
    allowedFields: ['location', 'value', 'created_at'],
    now: FIXED_NOW,
    aiCall: async () => ({
      mode: 'hybrid',
      logic: 'and',
      filters: [
        {
          logic: 'or',
          filters: [
            { field: 'location', operator: 'contains', value: 'Delhi' },
            { field: 'location', operator: 'contains', value: 'Gurgaon' }
          ]
        },
        { field: 'value', operator: 'greater_than', value: '10 lakh' }
      ],
      search_text: 'strategic',
      sort: [],
      confidence: 0.92,
      unsupported: false
    })
  })

  assert.equal(result.filters.mode, 'hybrid')
  assert.equal(result.filters.root.children[0].combinator, 'OR')
  assert.equal(result.filters.conditions.find(item => item.field === 'value').value, 1000000)
  assert.equal(result.filters.search_text, 'strategic')
})

test('one repair pass accepts the Candidate-compatible legacy AST shape', () => {
  const repaired = intent.validateIntent({
    root: {
      type: 'group',
      combinator: 'OR',
      children: [
        { type: 'condition', field: 'location', operator: 'contains', value: 'Delhi' },
        { type: 'condition', field: 'location', operator: 'contains', value: 'Gurgaon' }
      ]
    },
    confidence: 0.91,
    unsupported: false
  })
  assert.equal(repaired.logic, 'or')
  assert.equal(repaired.root.combinator, 'OR')
  assert.equal(repaired.filters.length, 2)
})

test('strict validation rejects unknown shapes, disallowed fields and malformed values', () => {
  assert.throws(() => intent.validateIntent({ ...structured([]), sql: 'select *' }), /Unknown client intent property/)
  assert.throws(() => intent.validateIntent(structured([
    { field: 'location', operator: 'contains', value: 'Delhi', column: 'location' }
  ])), /Unknown client filter property/)
  assert.throws(() => intent.validateIntent(structured([
    { field: 'secret_column', operator: 'contains', value: 'x' }
  ])), /Unsupported or unavailable client field/)
  assert.throws(() => intent.validateIntent(structured([
    { field: 'status', operator: 'greater_than', value: 'Active' }
  ])), /not supported/)
  assert.throws(() => intent.validateIntent(structured([
    { field: 'location', operator: 'in', value: Array.from({ length: 21 }, (_, index) => String(index)) }
  ])), /value type/)
  assert.throws(() => intent.validateIntent(structured([], { search_text: 42 })), /search text/)
  assert.throws(() => intent.validateIntent(structured([], { confidence: 1.1 })), /confidence/)
  assert.throws(() => intent.validateIntent(structured([], { sort: 'latest' })), /sort/)
})

test('nesting and total filter limits are enforced before compilation', () => {
  let nested = { field: 'location', operator: 'contains', value: 'Delhi' }
  for (let index = 0; index < MAX_FILTER_DEPTH; index += 1) {
    nested = { logic: 'and', filters: [nested, { field: 'status', operator: 'equals', value: 'Active' }] }
  }
  assert.throws(() => intent.validateIntent(structured([nested])), /deeply nested/)

  const filters = Array.from({ length: MAX_FILTERS + 1 }, () => ({
    field: 'location', operator: 'contains', value: 'Delhi'
  }))
  assert.throws(() => intent.validateIntent(structured(filters)), /Too many client filters/)
})

test('invalid and unsupported sorts are omitted without discarding valid filters', () => {
  const validated = intent.validateIntent(structured([
    { field: 'status', operator: 'equals', value: 'Active' }
  ], {
    sort: [
      { field: 'raw_database_column', direction: 'desc' },
      { field: 'created_at', direction: 'sideways' },
      { field: 'created_at', direction: 'DESC' },
      { field: 'value', direction: 'asc', sql: true }
    ]
  }), { allowedFields: ['status', 'created_at', 'value'] })

  assert.equal(validated.conditions[0].field, 'status')
  assert.deepEqual(validated.sort, [{ field: 'created_at', direction: 'desc' }])
})

test('valid sort-only AI intent and deterministic sort fallback remain executable', async () => {
  const aiResult = await intent.parseIntent('latest clients', {
    allowedFields: ['created_at', 'location'],
    aiCall: async () => structured([], {
      sort: [{ field: 'created_at', direction: 'desc' }]
    })
  })
  assert.equal(aiResult.ai, true)
  assert.equal(aiResult.filters.root, null)
  assert.deepEqual(aiResult.filters.sort, [{ field: 'created_at', direction: 'desc' }])
  assert.equal(intent.executionFilter(aiResult.filters).root, null)

  let calls = 0
  const fallback = await intent.parseIntent('latest clients', {
    allowedFields: ['created_at', 'location'],
    aiCall: async () => { calls += 1; throw new Error('provider unavailable') }
  })
  assert.equal(calls, 1)
  assert.equal(fallback.parser, true)
  assert.equal(fallback.fallback, true)
  assert.deepEqual(fallback.filters.sort, [{ field: 'created_at', direction: 'desc' }])
})

test('low-confidence, unsupported and invalid AI outputs fall back after one request', async () => {
  for (const response of [
    structured([{ field: 'status', operator: 'equals', value: 'Active' }], { confidence: 0.2 }),
    structured([{ field: 'status', operator: 'equals', value: 'Active' }], { unsupported: true }),
    structured([{ field: 'unknown', operator: 'equals', value: 'Active' }])
  ]) {
    let calls = 0
    const result = await intent.parseIntent('status equals Active', {
      allowedFields: ['status', 'location'],
      aiCall: async () => { calls += 1; return response }
    })
    assert.equal(calls, 1)
    assert.equal(result.parser, true)
    assert.equal(result.filters.conditions[0].field, 'status')
  }
})

test('provider or validation failure ends in a bounded keyword fallback when deterministic parsing cannot help', async () => {
  let calls = 0
  const result = await intent.parseIntent('strategic partnership', {
    allowedFields: ['location'],
    aiCall: async () => { calls += 1; throw new Error('invalid JSON') }
  })
  assert.equal(calls, 1)
  assert.equal(result.keyword, true)
  assert.equal(result.fallback, true)
  assert.equal(result.filters.search_text, 'strategic partnership')
  assert.equal(result.filters.confidence, 0)

  const execution = intent.executionFilter(result.filters, { allowedFields: ['location'] })
  assert.ok(execution.root)
  assert.ok(execution.conditions.length <= MAX_FILTERS)
  assert.deepEqual(new Set(execution.conditions.map(item => item.field)), new Set(['location']))
})

test('hybrid execution combines validated filters and keyword search with AND', () => {
  const validated = intent.validateIntent({
    mode: 'hybrid',
    logic: 'and',
    filters: [{ field: 'status', operator: 'equals', value: 'Active' }],
    search_text: 'Delhi partner',
    sort: [],
    confidence: 0.9,
    unsupported: false
  }, { allowedFields: ['status', 'location'] })
  const execution = intent.executionFilter(validated, { allowedFields: ['status', 'location'] })
  assert.equal(execution.root.combinator, 'AND')
  assert.equal(execution.root.children[0].field, 'status')
  assert.deepEqual(new Set(execution.conditions.map(item => item.field)), new Set(['status', 'location']))
})

test('persisted intents ignore untrusted derived AST and recompute it from canonical filters', () => {
  const persisted = {
    version: 2,
    mode: 'structured',
    logic: 'and',
    filters: [{ field: 'status', operator: 'equals', value: 'Active' }],
    root: { type: 'condition', field: 'secret_column', operator: 'equals', value: 'unsafe' },
    conditions: [{ type: 'condition', field: 'secret_column', operator: 'equals', value: 'unsafe' }],
    search_text: null,
    sort: [],
    confidence: 0.95
  }
  assert.throws(() => intent.validateIntent(persisted), /Persisted client intent/)
  const validated = intent.validateIntent(persisted, { requireAiConfidence: false })
  assert.equal(validated.root.field, 'status')
  assert.deepEqual(validated.conditions.map(item => item.field), ['status'])
})

test('unsafe, empty and malformed prompts are rejected before any AI request', async () => {
  for (const prompt of ['', 'delete clients', '((status is Active)']) {
    let calls = 0
    await assert.rejects(
      intent.parseIntent(prompt, { aiCall: async () => { calls += 1; return {} } }),
      error => error.statusCode === 400
    )
    assert.equal(calls, 0)
  }
})
