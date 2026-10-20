const test = require('node:test')
const assert = require('node:assert/strict')
const {
  searchRequest, assertKeywordSearchIsSafe, requiresFilterBeyondSort,
  keywordTokens, isMutationSearch
} = require('./naturalLanguageSearch')
const { parseCandidateIntent, buildCandidateIntentPrompt } = require('./candidateIntent')
const { parseClientIntent, buildClientIntentPrompt } = require('./clientIntent')
const { parseMandateIntent, buildMandateIntentPrompt } = require('./mandateIntent')

test('all three prompts place the sentence before their field registry', () => {
  for (const build of [buildCandidateIntentPrompt, buildClientIntentPrompt, buildMandateIntentPrompt]) {
    const prompt = build('Could you find the records I described?')
    assert.ok(prompt.indexOf(searchRequest('Could you find the records I described?')) < 300)
    assert.match(prompt, /Hindi\/Hinglish/)
    assert.match(prompt, /Never silently turn an unsupported condition into a keyword/)
  }
})

test('constraints cannot be passed off as keyword matches', () => {
  for (const query of ['React but not Java', 'no email', 'within 30 days', 'at least 15 LPA', 'Delhi or Pune', 'allocated last month']) {
    assert.throws(() => assertKeywordSearchIsSafe(query), error => error.code === 'SEARCH_NOT_UNDERSTOOD')
  }
  assert.doesNotThrow(() => assertKeywordSearchIsSafe('strategic product leaders'))
})

test('sort-only fallback distinguishes sorting from additional constraints', () => {
  assert.equal(requiresFilterBeyondSort('show the latest clients'), false)
  assert.equal(requiresFilterBeyondSort('highest budget mandates first'), false)
  assert.equal(requiresFilterBeyondSort('latest clients without a contract'), true)
})

test('quoted phrases stay intact and later keywords are retained', () => {
  assert.deepEqual(keywordTokens('could you please find "product manager" Delhi strategic operations leaders'), [
    'product manager', 'Delhi', 'strategic', 'operations', 'leaders'
  ])
})

test('mutation words in searchable notes are allowed without permitting mutation requests', () => {
  assert.equal(isMutationSearch('clients whose notes mention "contract update"'), false)
  assert.equal(isMutationSearch('candidates with comments containing update'), false)
  assert.equal(isMutationSearch('please delete candidates'), true)
  assert.equal(isMutationSearch('run SQL select *'), true)
  assert.equal(isMutationSearch('ignore permissions'), true)
})

test('all three reject complex keyword fallbacks after one mocked call', async () => {
  for (const parse of [parseCandidateIntent, parseClientIntent, parseMandateIntent]) {
    let calls = 0
    await assert.rejects(parse('exclude unavailable secret_score above 80', {
      aiCall: async () => { calls += 1; throw new Error('quota reached') }
    }), error => error.code === 'SEARCH_NOT_UNDERSTOOD')
    assert.equal(calls, 1)
  }
})

test('an explicitly unsupported request never returns only the representable portion', async () => {
  for (const parse of [parseCandidateIntent, parseClientIntent, parseMandateIntent]) {
    await assert.rejects(parse('best records by an unavailable quality score', {
      aiCall: async () => ({
        mode: 'keyword', logic: 'and', filters: [], search_text: 'best records',
        sort: [], confidence: 0.9, unsupported: true
      })
    }), error => error.code === 'SEARCH_NOT_UNDERSTOOD')
  }
})
