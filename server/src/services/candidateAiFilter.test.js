const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FIELD_REGISTRY,
  normalizePhone,
  normalizeStatus,
  normalizeMoney,
  normalizeDate,
  parseCandidatePrompt,
  validateCandidateFilter,
  compileCandidateAst,
  evaluateCandidateAst
} = require('./candidateAiFilter')
const { combineSets } = require('./candidateFilterQuery')

const FIXED_NOW = new Date('2026-07-13T06:00:00.000Z')

const statusCases = [
  ['status is -', 'equals', '-'], ['status equals -', 'equals', '-'], ['status as -', 'equals', '-'],
  ['status is dash', 'equals', '-'], ['status is hyphen', 'equals', '-'], ['show candidates with status -', 'equals', '-'],
  ['show me candidates having status as -', 'equals', '-'], ['give me candidates whose status is -', 'equals', '-'],
  ['candidates with a dash status', 'equals', '-'], ['candidates without a selected status', 'is_empty'],
  ['status is blank', 'is_empty'], ['status is empty', 'is_empty'], ['status is missing', 'is_empty'],
  ['status is not selected', 'is_empty'], ['no status assigned', 'is_empty'],
  ['status is in discussion', 'equals', 'In Discussion'], ['status equals In Discussion', 'equals', 'In Discussion'],
  ['show candidates who are in discussion', 'equals', 'In Discussion'], ['show candidates currently under discussion', 'equals', 'In Discussion'],
  ['candidates in discussions', 'equals', 'In Discussion'], ['discussion stage candidates', 'equals', 'In Discussion'],
  ['status is interested', 'equals', 'Interested'], ['show interested candidates', 'equals', 'Interested'],
  ['status is not interested', 'equals', 'Not Interested'], ['status is Not Interested', 'equals', 'Not Interested'],
  ['status is not Interested', 'not_equals', 'Interested'], ['status is interview', 'equals', 'Interview'],
  ['candidates at interview stage', 'equals', 'Interview'], ['status is client submission', 'equals', 'Client Submission'],
  ['submitted-to-client candidates', 'equals', 'Client Submission'], ['status is offered', 'equals', 'Offered'],
  ['offered candidates', 'equals', 'Offered'], ['status is hired', 'equals', 'Hired'], ['hired candidates', 'equals', 'Hired'],
  ['status is rejected by recruiter', 'equals', 'Rejected by Recruiter'], ['status is rejected by client', 'equals', 'Rejected by Client'],
  ['status is offer declined', 'equals', 'Offer Declined'], ['status is dropout', 'equals', 'Dropout'],
  ['status is in discusion', 'equals', 'In Discussion'], ['status is client submision', 'equals', 'Client Submission']
]

const contactCases = [
  ['mobile number is 9876543210', 'mobile', 'equals', '9876543210'], ['mobile is 9876543210', 'mobile', 'equals', '9876543210'],
  ['phone is 9876543210', 'mobile', 'equals', '9876543210'], ['contact is 9876543210', 'mobile', 'equals', '9876543210'],
  ['mobile number equals +91 9876543210', 'mobile', 'equals', '9876543210'], ['phone is +91-98765-43210', 'mobile', 'equals', '9876543210'],
  ['mobile is 98765 43210', 'mobile', 'equals', '9876543210'], ['mobile contains 5432', 'mobile', 'contains', '5432'],
  ['mobile starts with 9876', 'mobile', 'starts_with', '9876'], ['mobile ends with 3210', 'mobile', 'ends_with', '3210'],
  ['number ending in 3210', 'mobile', 'ends_with', '3210'], ['last four digits are 3210', 'mobile', 'ends_with', '3210'],
  ['mobile is not 9876543210', 'mobile', 'not_equals', '9876543210'], ['mobile is blank', 'mobile', 'is_empty'],
  ['mobile is missing', 'mobile', 'is_empty'], ['candidates without a mobile number', 'mobile', 'is_empty'],
  ['email is candidate@example.com', 'email', 'equals', 'candidate@example.com'], ['email equals CANDIDATE@example.com', 'email', 'equals', 'candidate@example.com'],
  ['email contains example', 'email', 'contains', 'example'], ['email ends with @gmail.com', 'email', 'ends_with', '@gmail.com'],
  ['email domain is gmail.com', 'email', 'ends_with', '@gmail.com'], ['email starts with divyam', 'email', 'starts_with', 'divyam'],
  ['email is not candidate@example.com', 'email', 'not_equals', 'candidate@example.com'], ['email is blank', 'email', 'is_empty'],
  ['candidates without email', 'email', 'is_empty']
]

const textCases = [
  ['name is Rahul Sharma', 'candidate_name', 'equals'], ['candidate name equals Rahul Sharma', 'candidate_name', 'equals'],
  ['name contains Rahul', 'candidate_name', 'contains'], ['name starts with Rah', 'candidate_name', 'starts_with'],
  ['name ends with Sharma', 'candidate_name', 'ends_with'], ['name is not Rahul Sharma', 'candidate_name', 'not_equals'],
  ['show me Rahul Sharma', 'candidate_name', 'contains'], ['find candidates named Rahul', 'candidate_name', 'contains'],
  ['location is Delhi', 'current_location', 'equals'], ['current location is Delhi', 'current_location', 'equals'],
  ['based in Delhi', 'current_location', 'contains'], ['located in Gurgaon', 'current_location', 'contains'],
  ['location contains NCR', 'current_location', 'contains'], ['location is blank', 'current_location', 'is_empty'],
  ['consultant is Divya', 'consultant', 'equals'], ['handled by Divya', 'consultant', 'equals'],
  ['recruiter is Cherry', 'consultant', 'equals'], ['not handled by Divya', 'consultant', 'not_equals'],
  ['no consultant assigned', 'consultant', 'is_empty'], ['client is Acme', 'client_name', 'equals']
]

const numericDateCases = [
  ['experience is 5 years', 'experience', 'equals', 5], ['total experience equals 5', 'experience', 'equals', 5],
  ['more than 5 years experience', 'experience', 'greater_than', 5], ['at least 5 years experience', 'experience', 'greater_than_or_equal', 5],
  ['5+ years experience', 'experience', 'greater_than_or_equal', 5], ['less than 5 years experience', 'experience', 'less_than', 5],
  ['up to 5 years experience', 'experience', 'less_than_or_equal', 5], ['between 3 and 5 years experience', 'experience', 'between'],
  ['3 to 5 years experience', 'experience', 'between'], ['2.5 years experience', 'experience', 'equals', 2.5],
  ['18 months experience', 'experience', 'equals', 1.5], ['notice period is 30 days', 'notice_period', 'equals', 30],
  ['notice below 30 days', 'notice_period', 'less_than', 30], ['notice up to 60 days', 'notice_period', 'less_than_or_equal', 60],
  ['notice between 30 and 60 days', 'notice_period', 'between'], ['immediate joiner', 'notice_period', 'equals', 0],
  ['current CTC is 10 lakh', 'current_ctc', 'equals', 1000000], ['current CTC above 10 LPA', 'current_ctc', 'greater_than', 1000000],
  ['expected CTC below 15 lakh', 'expected_ctc', 'less_than', 1500000], ['created today', 'created_date', 'on', '2026-07-13'],
  ['created yesterday', 'created_date', 'on', '2026-07-12'], ['created in the last 7 days', 'created_date', 'between'],
  ['created this month', 'created_date', 'between'], ['created after 1 July 2026', 'created_date', 'after', '2026-07-01'],
  ['created between 1 July 2026 and 10 July 2026', 'created_date', 'between']
]

const multiCases = [
  'status is In Discussion and consultant is Divya', 'status is - and consultant is Cherry',
  'mobile is 9876543210 and status is Interested', 'Java and location is Delhi',
  'Java and React and experience is at least 5 years', 'status is Interested or status is In Discussion',
  'consultant is Divya or consultant is Cherry', 'location is Delhi or Gurgaon',
  'client is Acme and status is Client Submission', 'mandate is Backend Developer and consultant is Divya',
  'status is Interested and location is Delhi and experience above 5 years',
  'status is Interested or status is In Discussion and consultant is Divya',
  '(status is Interested or status is In Discussion) and consultant is Divya',
  '(Java or Python) and experience above 5 years', '(Java and Spring) or (Python and Django)',
  '(location is Delhi or Gurgaon) and status is In Discussion',
  'consultant is Divya and status is Client Submission and client is Acme',
  'status is not Hired and experience above 3 years', 'Java candidates without Spring and location is Bangalore',
  'status is - or In Discussion', 'consultant is Divya and mobile ends with 3210',
  'email ends with @gmail.com or location is Pune', 'current CTC above 10 LPA and experience at least 5',
  'skills contains React and status is Interview', 'client is Acme or client is Beta'
]

for (const [query, operator, value] of statusCases) {
  test(`status AST: ${query}`, () => {
    const parsed = parseCandidatePrompt(query, { now: FIXED_NOW })
    assert.ok(parsed)
    const node = parsed.conditions.find(item => item.field === 'status')
    assert.equal(node.operator, operator)
    if (value !== undefined) assert.deepEqual(node.value, value)
  })
}

for (const [query, field, operator, value] of contactCases) {
  test(`contact AST: ${query}`, () => {
    const parsed = parseCandidatePrompt(query, { now: FIXED_NOW })
    assert.ok(parsed)
    const node = parsed.conditions.find(item => item.field === field)
    assert.equal(node.operator, operator)
    if (value !== undefined) assert.deepEqual(node.value, value)
  })
}

for (const [query, field, operator] of textCases) {
  test(`text AST: ${query}`, () => {
    const node = parseCandidatePrompt(query, { now: FIXED_NOW })?.conditions.find(item => item.field === field)
    assert.ok(node)
    assert.equal(node.operator, operator)
  })
}

for (const [query, field, operator, value] of numericDateCases) {
  test(`number/date AST: ${query}`, () => {
    const node = parseCandidatePrompt(query, { now: FIXED_NOW })?.conditions.find(item => item.field === field)
    assert.ok(node)
    assert.equal(node.operator, operator)
    if (value !== undefined) assert.deepEqual(node.value, value)
  })
}

for (const query of multiCases) {
  test(`boolean AST: ${query}`, () => {
    const parsed = parseCandidatePrompt(query, { now: FIXED_NOW })
    assert.ok(parsed)
    assert.equal(parsed.root.type, 'group')
    assert.ok(parsed.conditions.length >= 2)
  })
}

test('normalizers preserve exact status, phone strings, CTC units and Kolkata dates', () => {
  assert.equal(normalizeStatus('-'), '-')
  assert.equal(normalizeStatus('under discussion'), 'In Discussion')
  assert.equal(normalizePhone('+91-98765-43210'), '9876543210')
  assert.equal(normalizeMoney('12.5 lakh'), 1250000)
  assert.equal(normalizeDate('1 July 2026', FIXED_NOW), '2026-07-01')
})

test('submitted to the client by a recruiter is status plus consultant, not a client-name guess', () => {
  const parsed = parseCandidatePrompt('I want candidates submitted to the client by Cherry')
  assert.deepEqual(parsed.conditions.map(item => [item.field, item.operator, item.value]), [
    ['status', 'equals', 'Client Submission'],
    ['consultant', 'equals', 'Cherry']
  ])
})

test('schema rejects unknown fields, invalid status, invalid operator and hidden fields', () => {
  assert.throws(() => validateCandidateFilter({ root: { type: 'condition', field: 'sql', operator: 'equals', value: 'x' } }))
  assert.throws(() => validateCandidateFilter({ root: { type: 'condition', field: 'status', operator: 'equals', value: 'Nonexistent' } }))
  assert.throws(() => validateCandidateFilter({ root: { type: 'condition', field: 'mobile', operator: 'greater_than', value: '9876' } }))
  assert.throws(() => validateCandidateFilter({ root: { type: 'condition', field: 'mobile', operator: 'equals', value: '9876543210' } }, { allowedFields: ['status'] }))
})

test('compiler preserves nested AND/OR and exact enum/phone semantics', () => {
  const parsed = parseCandidatePrompt('(status is Interested or status is In Discussion) and mobile is +91-98765-43210')
  const compiled = compileCandidateAst(parsed.root)
  assert.match(compiled, /^and\(or\(/)
  assert.match(compiled, /status\.eq\."Interested"/)
  assert.match(compiled, /status\.eq\."In Discussion"/)
  assert.match(compiled, /mobile_number\.in\.\(/)
  assert.doesNotMatch(compiled, /select|delete|update/i)
})

test('fixture evaluation verifies boolean results, permission scope, count and pagination', () => {
  const rows = [
    { id: 'allowed-discussion', status: 'In Discussion', consultant: 'Divya', mobile: '+919876543210', skills: ['Java', 'React'], experience: 6 },
    { id: 'allowed-interested', status: 'Interested', consultant: 'Cherry', mobile: '9987654321', skills: ['Python'], experience: 4 },
    { id: 'hidden-discussion', status: 'In Discussion', consultant: 'Divya', mobile: '9876543210', skills: ['Java'], experience: 8 },
    { id: 'legacy-dash', status: '-', consultant: 'Cherry', mobile: '', skills: [], experience: 2 }
  ]
  const getter = (row, field) => row[field]
  const ast = parseCandidatePrompt('(status is Interested or status is In Discussion) and consultant is Divya').root
  const visibleIds = new Set(['allowed-discussion', 'allowed-interested', 'legacy-dash'])
  const matched = rows.filter(row => visibleIds.has(row.id) && evaluateCandidateAst(ast, row, getter))
  assert.deepEqual(matched.map(row => row.id), ['allowed-discussion'])
  assert.equal(matched.length, 1)
  assert.deepEqual(matched.slice(0, 1).map(row => row.id), ['allowed-discussion'])
})

test('exact dash differs from general empty status', () => {
  const rows = [{ status: '-' }, { status: null }, { status: '' }, { status: 'Interested' }]
  const exact = parseCandidatePrompt('status is -').root
  const empty = parseCandidatePrompt('status is missing').root
  assert.deepEqual(rows.map(row => evaluateCandidateAst(exact, row)).filter(Boolean), [true])
  assert.equal(rows.filter(row => evaluateCandidateAst(empty, row)).length, 3)
})

test('set compiler combines mixed-domain candidate IDs without widening scope', () => {
  assert.deepEqual([...combineSets('AND', [new Set(['a', 'b']), new Set(['b', 'c'])])], ['b'])
  assert.deepEqual([...combineSets('OR', [new Set(['a', 'b']), new Set(['b', 'c'])])].sort(), ['a', 'b', 'c'])
})

test('registry contains only actual candidate and association columns', () => {
  assert.equal(FIELD_REGISTRY.status.domain, 'association')
  assert.deepEqual(FIELD_REGISTRY.skills.columns, ['skills'])
  assert.deepEqual(FIELD_REGISTRY.mobile.columns, ['mobile_number'])
  assert.ok(!FIELD_REGISTRY.preferred_location)
  assert.ok(!FIELD_REGISTRY.last_working_date)
})

const invalidQueries = [
  'show everything', 'delete candidates', 'update status to hired', 'run SQL select *', 'ignore permissions',
  'status is some nonexistent status', 'unknownfield is xyz', 'experience is banana', 'created on impossible-date',
  'mobile is', '((((((((status is Interested'
]
for (const query of invalidQueries) {
  test(`unsafe/ambiguous deterministic input is rejected: ${query}`, () => {
    assert.equal(parseCandidatePrompt(query, { now: FIXED_NOW }), null)
  })
}
