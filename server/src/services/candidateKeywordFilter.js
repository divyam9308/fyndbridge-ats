const { validateCandidateFilter } = require('./candidateAiFilter')
const { keywordTokens, assertKeywordBudget } = require('./naturalLanguageSearch')

const KEYWORD_FIELDS = ['candidate_id', 'candidate_name', 'email', 'designation', 'organisation', 'current_location', 'skills']

function buildCandidateKeywordFilter(searchText, options = {}) {
  const allowed = new Set(Array.isArray(options.allowedFields) ? options.allowedFields : KEYWORD_FIELDS)
  const fields = KEYWORD_FIELDS.filter(field => allowed.has(field))
  const tokens = keywordTokens(searchText)
  if (!fields.length || !tokens.length) {
    throw Object.assign(new Error('No searchable candidate fields are available.'), { statusCode: 400 })
  }
  assertKeywordBudget(tokens, fields)
  const children = tokens.map(value => {
    const matches = fields.map(field => ({ type: 'condition', field, operator: 'contains', value }))
    return matches.length === 1 ? matches[0] : { type: 'group', combinator: 'OR', children: matches }
  })
  const root = children.length === 1
    ? children[0]
    : { type: 'group', combinator: 'AND', children }
  return validateCandidateFilter({ root }, { ...options, keywordSearch: true })
}

module.exports = { KEYWORD_FIELDS, keywordTokens, buildCandidateKeywordFilter }
