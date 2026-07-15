const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseCandidatePrompt,
  validateCandidateFilter,
  normalizeDate,
  normalizeMoney,
  compileCandidateAst,
  evaluateCandidateAst
} = require('./candidateAiFilter')

const NOW = new Date('2026-07-15T06:00:00.000Z')

function validated(field, operator, value) {
  return validateCandidateFilter({
    root: { type: 'condition', field, operator, ...(value !== undefined ? { value } : {}) }
  }, { now: NOW })
}

test('numeric units normalize to stored years, days, and absolute INR', () => {
  assert.equal(validated('experience', 'greater_than', 'more than eight years').root.value, 8)
  assert.equal(validated('experience', 'equals', '18 months').root.value, 1.5)
  assert.equal(validated('notice_period', 'equals', '2 months').root.value, 60)
  assert.equal(normalizeMoney('10 LPA'), 1000000)
  assert.equal(normalizeMoney('1 crore'), 10000000)
  assert.equal(normalizeMoney('₹12,50,000'), 1250000)
})

test('date normalization uses Kolkata request time and rejects impossible dates', () => {
  assert.equal(normalizeDate('1 July', NOW), '2026-07-01')
  assert.equal(normalizeDate('15/07/2026', NOW), '2026-07-15')
  assert.equal(normalizeDate('2026-02-30', NOW), null)
  assert.throws(() => validated('created_date', 'on', '2026-02-30'), /Invalid date filter/)
  assert.deepEqual(parseCandidatePrompt('added this week', { now: NOW }).root.value, ['2026-07-13', '2026-07-19'])
  assert.deepEqual(parseCandidatePrompt('added this financial year', { now: NOW }).root.value, ['2026-04-01', '2027-03-31'])
})

test('timestamp date filters cover complete inclusive Kolkata calendar days', () => {
  assert.equal(
    compileCandidateAst(validated('created_date', 'on', '2026-07-15').root),
    'and(created_at.gte."2026-07-15T00:00:00+05:30",created_at.lt."2026-07-16T00:00:00+05:30")'
  )
  assert.equal(
    compileCandidateAst(validated('created_date', 'between', ['2026-07-01', '2026-07-15']).root),
    'and(created_at.gte."2026-07-01T00:00:00+05:30",created_at.lt."2026-07-16T00:00:00+05:30")'
  )
  assert.equal(
    compileCandidateAst(validated('created_date', 'after', '2026-07-15').root),
    'created_at.gte."2026-07-16T00:00:00+05:30"'
  )
  assert.equal(compileCandidateAst(validated('date_of_joining', 'on', '2026-07-15').root), 'date_of_joining.eq."2026-07-15"')
})

test('Candidates Month aliases normalize to created_date over the complete calendar month', () => {
  const month = validated('month', 'equals', 'July 2026').root
  assert.equal(month.field, 'created_date')
  assert.equal(month.operator, 'between')
  assert.deepEqual(month.value, ['2026-07-01', '2026-07-31'])
  assert.equal(
    compileCandidateAst(month),
    'and(created_at.gte."2026-07-01T00:00:00+05:30",created_at.lt."2026-08-01T00:00:00+05:30")'
  )

  const submissionMonth = validated('submission month', 'contains', 'June 2026').root
  assert.equal(submissionMonth.field, 'created_date')
  assert.deepEqual(submissionMonth.value, ['2026-06-01', '2026-06-30'])
  assert.deepEqual(parseCandidatePrompt('month is July 2026', { now: NOW }).root, month)
})

test('malformed, incomplete, and reversed ranges are rejected', () => {
  assert.throws(() => validated('experience', 'between', [5]), /Invalid filter values/)
  assert.throws(() => validated('experience', 'between', [10, 5]), /Invalid filter range/)
  assert.throws(() => validated('created_date', 'between', ['2026-07-15', '2026-07-01']), /Invalid filter range/)
})

test('boolean fallback distinguishes positive and negative relocation intent', () => {
  assert.equal(parseCandidatePrompt('open to relocate').root.value, true)
  assert.equal(parseCandidatePrompt('not open to relocate').root.value, false)
  assert.equal(parseCandidatePrompt('unwilling to relocate').root.value, false)
})

test('typed numeric/date empties compile to null checks without invalid text comparisons', () => {
  assert.equal(compileCandidateAst(validated('experience', 'is_empty').root), 'experience_years.is.null')
  assert.equal(compileCandidateAst(validated('date_of_joining', 'is_not_empty').root), 'date_of_joining.not.is.null')
  const emailEmpty = compileCandidateAst(validated('email', 'is_empty').root)
  assert.match(emailEmpty, /email\.is\.null/)
  assert.match(emailEmpty, /email\.eq\.-/)
  assert.match(emailEmpty, /email\.match/)
  assert.equal(parseCandidatePrompt('linkedin available').root.operator, 'is_not_empty')
  assert.equal(parseCandidatePrompt('cv not available').root.operator, 'is_empty')
})

test('UUID-backed identifiers use equality rather than text-pattern operators', () => {
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const clause = compileCandidateAst(validated('client_id', 'equals', uuid).root)
  assert.equal(clause, `client_id.eq."${uuid}"`)
  assert.doesNotMatch(clause, /ilike|match/)
  assert.equal(compileCandidateAst(validated('job_id', 'is_empty').root), 'job_id.is.null')
})

test('negative multi-column text conditions require every mapped column not to match', () => {
  const root = validated('organisation', 'not_equals', 'TCS').root
  assert.equal(evaluateCandidateAst(root, { organisation: ['Other', 'TCS'] }), false)
  assert.equal(evaluateCandidateAst(root, { organisation: ['Other', 'Another'] }), true)
})
