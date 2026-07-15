const test = require('node:test')
const assert = require('node:assert/strict')
const { compileCandidateAst } = require('./candidateAiFilter')
const { KEYWORD_FIELDS, keywordTokens, buildCandidateKeywordFilter } = require('./candidateKeywordFilter')

test('keyword fallback removes conversational filler and normalizes whitespace', () => {
  assert.deepEqual(keywordTokens('  show   me candidates in Delhi or Gurgaon  '), ['Delhi', 'Gurgaon'])
})

test('keyword fallback uses only approved and permission-visible candidate fields', () => {
  const result = buildCandidateKeywordFilter('senior react', {
    allowedFields: ['candidate_name', 'designation', 'consultant']
  })
  assert.equal(result.root.combinator, 'OR')
  assert.deepEqual(new Set(result.conditions.map(item => item.field)), new Set(['candidate_name', 'designation']))
  assert.ok(result.conditions.every(item => item.operator === 'contains'))
  assert.ok(result.conditions.every(item => ['senior', 'react'].includes(item.value.toLowerCase())))
})

test('keyword fallback never emits arbitrary fields, columns, or PostgREST fragments', () => {
  const result = buildCandidateKeywordFilter('name.ilike.*,drop table candidates', {
    allowedFields: KEYWORD_FIELDS
  })
  assert.ok(result.conditions.length <= 24)
  assert.ok(result.conditions.every(item => KEYWORD_FIELDS.includes(item.field)))
})

test('keyword and hybrid search include permission-visible skills through the typed array operator', () => {
  const result = buildCandidateKeywordFilter('React', {
    allowedFields: ['candidate_name', 'skills']
  })
  assert.deepEqual(new Set(result.conditions.map(item => item.field)), new Set(['candidate_name', 'skills']))
  const skills = result.conditions.find(item => item.field === 'skills')
  assert.equal(skills.operator, 'contains')
  assert.equal(compileCandidateAst(skills), 'skills.cs."{React}"')
})

test('keyword fallback fails safely when permissions hide every searchable field', () => {
  assert.throws(
    () => buildCandidateKeywordFilter('react', { allowedFields: ['consultant'] }),
    error => error.statusCode === 400
  )
})
