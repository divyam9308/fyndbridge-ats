const { callAiJson } = require('./aiProvider')
const {
  buildSemanticAiFilterPrompt,
  parsePrompt,
  semanticAiFilterSchema,
  validateAiFilters,
  withSemanticMetadata
} = require('./filterEngine')

async function parseAiFilters(page, prompt) {
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

module.exports = { parseAiFilters }
