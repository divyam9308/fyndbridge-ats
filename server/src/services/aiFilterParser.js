const { callAiJson } = require('./aiProvider')
const {
  buildSemanticAiFilterPrompt,
  parsePrompt,
  semanticAiFilterSchema,
  validateAiFilters,
  withSemanticMetadata
} = require('./filterEngine')
const {
  parseCandidatePrompt,
  candidatePromptIssue,
  validateCandidateFilter,
  buildCandidateFilterPrompt,
  candidateFilterSchema
} = require('./candidateAiFilter')

async function parseAiFilters(page, prompt, options = {}) {
  if (page === 'candidates') return parseCandidateAiFilters(prompt, options)
  const fallback = validateAiFilters(page, null, prompt)
  const parsedByRule = parsePrompt(page, prompt)
  if (parsedByRule?.conditions?.length) return { filters: parsedByRule, parser: true }

  try {
    const parsed = await callAiJson({
      prompt: buildSemanticAiFilterPrompt(page, prompt),
      schema: semanticAiFilterSchema(),
      schemaName: `${page}_semantic_filter`,
      temperature: 0.1
    })
    const filters = Array.isArray(parsed?.conditions) && parsed.conditions.length
      ? validateAiFilters(page, parsed, prompt)
      : { conditions: [] }
    return filters ? { filters: withSemanticMetadata(filters, parsed, prompt), ai: true, semantic: true } : { filters: fallback, fallback: true }
  } catch (err) {
    console.warn('AI filter fallback:', { page, message: err.message, code: err.code || err.statusCode })
    return { filters: fallback, fallback: true, error: 'AI filter unavailable, using normal parser.' }
  }
}

async function parseCandidateAiFilters(prompt, options = {}) {
  const promptIssue = candidatePromptIssue(prompt)
  if (promptIssue) throw Object.assign(new Error(promptIssue), { statusCode: 400 })
  const deterministic = parseCandidatePrompt(prompt, options)
  if (deterministic) return { filters: deterministic, parser: true }
  try {
    const parsed = await callAiJson({
      prompt: buildCandidateFilterPrompt(prompt, options.allowedFields),
      schema: candidateFilterSchema(),
      schemaName: 'candidate_filter_ast',
      temperature: 0
    })
    if (parsed?.unsupported || Number(parsed?.confidence) < 0.55) {
      throw Object.assign(new Error("I couldn't confidently understand this filter. Try specifying a candidate field, condition, and value."), { statusCode: 400 })
    }
    return { filters: validateCandidateFilter(parsed, options), ai: true }
  } catch (error) {
    if (error?.statusCode === 400) throw error
    const safe = new Error("I couldn't confidently understand this filter. Try specifying a candidate field, condition, and value.")
    safe.statusCode = 400
    throw safe
  }
}

module.exports = { parseAiFilters }
