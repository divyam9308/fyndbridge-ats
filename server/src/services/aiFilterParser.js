const { callAiJson } = require('./aiProvider')
const { aiFilterSchema, buildAiFilterPrompt, validateAiFilters, isSimpleKeywordPrompt } = require('./filterEngine')

async function parseAiFilters(page, prompt) {
  const fallback = validateAiFilters(page, null, prompt)
  try {
    const parsed = await callAiJson({
      prompt: buildAiFilterPrompt(page, prompt),
      schema: aiFilterSchema(),
      schemaName: `${page}_filter`,
      temperature: 0
    })
    if (isSimpleKeywordPrompt(page, prompt)) return { filters: fallback, ai: true }
    const filters = validateAiFilters(page, parsed, prompt)
    return filters ? { filters, ai: true } : { filters: fallback, fallback: true }
  } catch (err) {
    console.warn('AI filter fallback:', { page, message: err.message, code: err.code || err.statusCode })
    return { filters: fallback, fallback: true, error: 'AI filter unavailable, using normal parser.' }
  }
}

module.exports = { parseAiFilters }
