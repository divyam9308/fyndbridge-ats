const { validateCandidateFilter } = require('./candidateAiFilter')

const KEYWORD_FIELDS = ['candidate_id', 'candidate_name', 'email', 'designation', 'organisation', 'current_location', 'skills']
const MAX_KEYWORD_CONDITIONS = 24
const STOP_WORDS = new Set([
  'a', 'all', 'an', 'and', 'any', 'applicant', 'applicants', 'are', 'candidate', 'candidates',
  'display', 'fetch', 'find', 'for', 'get', 'give', 'in', 'is', 'list', 'me', 'of', 'or',
  'people', 'person', 'please', 'return', 'show', 'that', 'the', 'to', 'where', 'who', 'whose', 'with'
])

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function keywordTokens(searchText) {
  const input = clean(searchText)
  if (!input) return []
  const tokens = input
    .split(/\s+/)
    .map(token => token.replace(/^[^\p{L}\p{N}@+#.-]+|[^\p{L}\p{N}@+#.-]+$/gu, ''))
    .filter(token => token && !STOP_WORDS.has(token.toLowerCase()))
  const unique = [...new Map(tokens.map(token => [token.toLowerCase(), token])).values()]
  return (unique.length ? unique : [input]).slice(0, 4).map(token => token.slice(0, 80))
}

function buildCandidateKeywordFilter(searchText, options = {}) {
  const allowed = new Set(Array.isArray(options.allowedFields) ? options.allowedFields : KEYWORD_FIELDS)
  const fields = KEYWORD_FIELDS.filter(field => allowed.has(field))
  const tokens = keywordTokens(searchText)
  if (!fields.length || !tokens.length) {
    throw Object.assign(new Error('No searchable candidate fields are available.'), { statusCode: 400 })
  }
  const boundedTokens = tokens.slice(0, Math.max(1, Math.floor(MAX_KEYWORD_CONDITIONS / fields.length)))
  const children = boundedTokens.flatMap(value => fields.map(field => ({
    type: 'condition',
    field,
    operator: 'contains',
    value
  })))
  const root = children.length === 1
    ? children[0]
    : { type: 'group', combinator: 'OR', children }
  return validateCandidateFilter({ root }, options)
}

module.exports = { KEYWORD_FIELDS, keywordTokens, buildCandidateKeywordFilter }
