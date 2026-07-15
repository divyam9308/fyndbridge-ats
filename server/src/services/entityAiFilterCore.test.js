const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_CONDITIONS,
  MAX_LIST_VALUES,
  TEXT_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  DATE_OPERATORS,
  BOOLEAN_OPERATORS,
  ARRAY_OPERATORS,
  IDENTIFIER_OPERATORS,
  field,
  relativeDateRange,
  createEntityFilter
} = require('./entityAiFilterCore')

const NOW = new Date('2026-07-15T18:30:00.000Z') // 16 July in Kolkata

const fields = {
  name: field('text', ['name', 'legacy_name'], ['account name'], TEXT_OPERATORS),
  consultant: field('text', ['consultant_name'], ['owner'], TEXT_OPERATORS, { reference: 'profile' }),
  status: field('enum', ['status'], ['state'], ENUM_OPERATORS, {
    values: ['Active', 'Closed'],
    valueAliases: { open: 'Active', completed: 'Closed' }
  }),
  score: field('number', ['score'], ['rating'], NUMBER_OPERATORS, { minimum: 0, maximum: 100 }),
  amount: field('money', ['amount'], ['value'], NUMBER_OPERATORS),
  active: field('boolean', ['active'], ['enabled'], BOOLEAN_OPERATORS),
  document: field('availability', ['document_url', 'document_path'], ['attachment'], BOOLEAN_OPERATORS),
  due_date: field('date', ['due_date'], ['due'], DATE_OPERATORS),
  created_at: field('date', ['created_at'], ['created'], DATE_OPERATORS, { timestamp: true }),
  consultants: field('array', ['consultants'], ['assignees'], ARRAY_OPERATORS, { elementType: 'profile_name' }),
  budget: field('numeric_range', ['budget_label'], ['salary'], NUMBER_OPERATORS, {
    unit: 'LPA',
    rangeColumns: { minimum: 'budget_min', maximum: 'budget_max', ceiling: 'budget_ceiling' }
  }),
  experience: field('numeric_range', ['experience_label'], ['experience'], NUMBER_OPERATORS, {
    unit: 'years',
    rangeColumns: { minimum: 'experience_min', maximum: 'experience_max', ceiling: 'experience_ceiling' }
  }),
  private_id: field('identifier', ['private_id'], [], IDENTIFIER_OPERATORS, { internal: true, format: 'uuid' })
}

const filter = createEntityFilter({
  key: 'fixtures',
  label: 'Fixture',
  fields,
  keywordFields: ['name', 'consultant', 'consultants'],
  examples: ['active accounts'],
  guidance: ['Use only fixture fields.'],
  parseSort: () => [{ field: 'created_at', direction: 'desc' }]
})

function validated(fieldName, operator, value, options = {}) {
  return filter.validateFilter({
    root: {
      type: 'condition',
      field: fieldName,
      operator,
      ...(value !== undefined ? { value } : {})
    }
  }, { now: NOW, ...options })
}

test('factory exposes schema prompt metadata without changing the source config', () => {
  assert.equal(filter.key, 'fixtures')
  assert.equal(filter.label, 'Fixture')
  assert.deepEqual(filter.examples, ['active accounts'])
  assert.deepEqual(filter.guidance, ['Use only fixture fields.'])
  assert.equal(typeof filter.parseSort, 'function')
  assert.equal(filter.config.fields, fields)
})

test('strict AST validation rejects extra keys, missing values and unavailable fields', () => {
  assert.throws(() => filter.validateFilter({ root: { type: 'condition', field: 'name', operator: 'equals', value: 'Acme', sql: 'x' } }), /condition keys/i)
  assert.throws(() => filter.validateFilter({ root: { type: 'group', combinator: 'AND', children: [], extra: true } }), /group keys/i)
  assert.throws(() => filter.validateFilter({ root: { type: 'condition', field: 'name', operator: 'equals' } }), /value is required/i)
  assert.throws(() => filter.validateFilter({ root: { type: 'condition', field: 'name', operator: 'is_empty', value: 'Acme' } }), /cannot include/i)
  assert.throws(() => validated('private_id', 'equals', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), /unavailable/i)
  assert.throws(() => validated('name', 'equals', 'Acme', { allowedFields: ['status'] }), /unavailable/i)
  assert.throws(() => validated('status', 'equals', 'Invented'), /Unknown status/i)
  assert.throws(() => validated('name', 'greater_than', 2), /not supported/i)
})

test('validation enforces nesting, leaf, list and text bounds', () => {
  const leaves = Array.from({ length: MAX_CONDITIONS + 1 }, (_, index) => ({
    type: 'condition', field: 'name', operator: 'equals', value: `name-${index}`
  }))
  assert.throws(() => filter.validateFilter({ root: { type: 'group', combinator: 'OR', children: leaves } }), /group|Too many/i)

  let deep = { type: 'condition', field: 'name', operator: 'equals', value: 'Acme' }
  for (let index = 0; index < 5; index += 1) {
    deep = { type: 'group', combinator: 'AND', children: [deep, { type: 'condition', field: 'status', operator: 'equals', value: 'Active' }] }
  }
  assert.throws(() => filter.validateFilter({ root: deep }), /deeply nested/i)
  assert.throws(() => validated('consultants', 'contains_any', Array.from({ length: MAX_LIST_VALUES + 1 }, (_, index) => `Person ${index}`)), /filter values/i)
  assert.throws(() => validated('name', 'contains', 'x'.repeat(181)), /text/i)
})

test('normalization is type-aware for enums, numbers, money, booleans and ranges', () => {
  assert.equal(validated('status', 'equals', 'open').root.value, 'Active')
  assert.equal(validated('score', 'equals', 'ninety').root.value, 90)
  assert.equal(validated('amount', 'greater_than', '12.5 lakh').root.value, 1250000)
  assert.equal(validated('active', 'equals', 'yes').root.value, true)
  assert.equal(validated('budget', 'equals', '1 crore').root.value, 100)
  assert.deepEqual(validated('budget', 'between', ['10 lakh', '25 lakh']).root.value, [10, 25])
  assert.equal(validated('experience', 'equals', '18 months').root.value, 1.5)
  assert.equal(validated('experience', 'equals', 'fresher').root.value, 0)
  assert.throws(() => validated('score', 'equals', 101), /maximum/i)
  assert.throws(() => validated('experience', 'between', [5, 3]), /range/i)
})

test('availability booleans become empty checks and compile with correct multi-column polarity', () => {
  const present = validated('document', 'equals', true).root
  const missing = validated('document', 'equals', false).root
  assert.equal(present.operator, 'is_not_empty')
  assert.equal(missing.operator, 'is_empty')
  assert.match(filter.compileAst(present), /^or\(and\(document_url\.not\.is\.null/)
  assert.match(filter.compileAst(missing), /^and\(or\(document_url\.is\.null/)
})

test('dates use Kolkata calendar periods, validate real dates and compile full timestamp days', () => {
  assert.deepEqual(relativeDateRange('this week', NOW), ['2026-07-13', '2026-07-19'])
  assert.deepEqual(relativeDateRange('this month', NOW), ['2026-07-01', '2026-07-31'])
  assert.deepEqual(relativeDateRange('this financial year', NOW), ['2026-04-01', '2027-03-31'])
  assert.deepEqual(validated('due_date', 'equals', 'this month').root.value, ['2026-07-01', '2026-07-31'])
  assert.equal(validated('due_date', 'after', 'this month').root.value, '2026-07-31')
  assert.throws(() => validated('due_date', 'on', '2026-02-30'), /date/i)
  assert.equal(
    filter.compileAst(validated('created_at', 'on', 'today').root),
    'and(created_at.gte."2026-07-16T00:00:00+05:30",created_at.lt."2026-07-17T00:00:00+05:30")'
  )
})

test('deterministic fallback preserves nested AND/OR, range AND and bare is operators', () => {
  const parsed = filter.parsePrompt('(status is open or status is completed) and score between 10 and 20 and name contains Acme', { now: NOW })
  assert.ok(parsed)
  assert.equal(parsed.root.type, 'group')
  assert.equal(parsed.root.combinator, 'AND')
  assert.equal(parsed.conditions.length, 4)
  assert.deepEqual(parsed.conditions.map(node => [node.field, node.operator, node.value]), [
    ['status', 'equals', 'Active'],
    ['status', 'equals', 'Closed'],
    ['score', 'between', [10, 20]],
    ['name', 'contains', 'Acme']
  ])
  assert.deepEqual(filter.parsePrompt('consultant is Cherry').root, {
    type: 'condition', field: 'consultant', operator: 'equals', value: 'Cherry'
  })
  assert.deepEqual(filter.parsePrompt('consultants is not Cherry').root, {
    type: 'condition', field: 'consultants', operator: 'not_contains', value: 'Cherry'
  })
  assert.equal(filter.parsePrompt('more than 20 score').root.operator, 'greater_than')
})

test('compiler preserves multi-column negative and empty polarity', () => {
  assert.match(filter.compileAst(validated('name', 'not_contains', 'Acme').root), /^and\(/)
  assert.match(filter.compileAst(validated('name', 'is_empty').root), /^and\(or\(/)
  assert.match(filter.compileAst(validated('name', 'is_not_empty').root), /^or\(and\(/)
  const nested = filter.validateFilter({
    root: {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'condition', field: 'status', operator: 'equals', value: 'Active' },
        {
          type: 'group', combinator: 'OR', children: [
            { type: 'condition', field: 'name', operator: 'contains', value: 'Acme' },
            { type: 'condition', field: 'name', operator: 'contains', value: 'Beta' }
          ]
        }
      ]
    }
  }).root
  assert.match(filter.compileAst(nested), /^and\(status\.eq\."Active",or\(/)
})

test('array operators compile exact safe literals for any, all and negative membership', () => {
  const any = filter.compileAst(validated('consultants', 'contains_any', ['Cherry', 'Rahul']).root)
  const all = filter.compileAst(validated('consultants', 'contains_all', ['Cherry', 'Rahul']).root)
  const none = filter.compileAst(validated('consultants', 'not_in', ['Cherry', 'Rahul']).root)
  assert.equal(any, 'consultants.ov."{\\"Cherry\\",\\"Rahul\\"}"')
  assert.equal(all, 'consultants.cs."{\\"Cherry\\",\\"Rahul\\"}"')
  assert.equal(none, 'consultants.not.ov."{\\"Cherry\\",\\"Rahul\\"}"')

  const escaped = filter.compileAst(validated('consultants', 'contains', 'A,lice") or (status.eq.Active').root)
  assert.match(escaped, /^consultants\.cs\."/)
  assert.doesNotMatch(escaped, /\),or\(status/)
})

test('text compiler quotes structural characters and escapes LIKE wildcards', () => {
  const clause = filter.compileAst(validated('name', 'contains', 'A*,_100%") or (status.eq.Active').root)
  assert.match(clause, /^or\(name\.ilike\."\*/)
  assert.doesNotMatch(clause, /\),or\(status/)
  assert.match(clause, /\\\\\*/)
  assert.match(clause, /\\\\%/)
})

test('keyword mode is permission-aware and remains bounded to 24 leaves', () => {
  const keyword = filter.buildKeywordFilter('show Alpha Beta Gamma Delta', {
    allowedFields: ['name', 'consultant', 'consultants']
  })
  assert.ok(keyword.conditions.length <= MAX_CONDITIONS)
  assert.deepEqual(new Set(keyword.conditions.map(node => node.field)), new Set(['name', 'consultant', 'consultants']))
  assert.throws(() => filter.buildKeywordFilter('Alpha', { allowedFields: ['status'] }), /No searchable/i)
  assert.throws(() => filter.buildKeywordFilter('x'.repeat(601)), /too long/i)
})
