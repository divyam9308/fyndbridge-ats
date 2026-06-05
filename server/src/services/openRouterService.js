const axios = require('axios')

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function trimPrompt(text, maxChars) {
  return String(text || '').trim().slice(0, maxChars)
}

function withRequiredProperties(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema
  }

  const next = { ...schema }

  if (next.properties && typeof next.properties === 'object') {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, withRequiredProperties(value)])
    )
    next.required = Object.keys(next.properties)
  }

  if (next.items) {
    next.items = withRequiredProperties(next.items)
  }

  return next
}

function extractOpenRouterText(responseData) {
  const content = responseData?.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text || part.content || '')
      .join('')
      .trim()
  }

  return ''
}

async function callOpenRouterJson({ prompt, schema, temperature = 0.1, schemaName = 'ats_json' }) {
  if (!OPENROUTER_API_KEY) {
    const err = new Error('OPENROUTER_API_KEY is not configured')
    err.statusCode = 503
    throw err
  }

  let response
  try {
    response = await axios.post(
      OPENROUTER_ENDPOINT,
      {
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Return valid JSON only. Do not include markdown or explanatory text.'
          },
          {
            role: 'user',
            content: trimPrompt(prompt, 12000)
          }
        ],
        temperature,
        stream: false,
        provider: {
          require_parameters: true
        },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema: withRequiredProperties(schema)
          }
        }
      },
      {
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5173',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'Fyndbridge ATS'
        }
      }
    )
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message
    const apiError = new Error(`OpenRouter request failed: ${detail}`)
    apiError.statusCode = err.response?.status || 502
    throw apiError
  }

  const text = extractOpenRouterText(response.data)
  if (!text) {
    throw new Error('OpenRouter returned an empty response')
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    const parseError = new Error('OpenRouter returned invalid JSON')
    parseError.cause = err
    throw parseError
  }
}

module.exports = {
  callOpenRouterJson,
  OPENROUTER_MODEL
}
