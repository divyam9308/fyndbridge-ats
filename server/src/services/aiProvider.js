const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
const GEMINI_API_KEY_PRIMARY = process.env.GEMINI_API_KEY_PRIMARY || ''
const GEMINI_API_KEY_SECONDARY = process.env.GEMINI_API_KEY_SECONDARY || ''
const REQUEST_TIMEOUT_MS = 30000

function createModel(apiKey) {
  if (!apiKey) return null
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: 'Return valid JSON only. Do not include markdown or explanatory text.'
  })
}

const providers = {
  PRIMARY: createModel(GEMINI_API_KEY_PRIMARY),
  SECONDARY: createModel(GEMINI_API_KEY_SECONDARY)
}

function validateAiConfig() {
  const missing = []
  if (!GEMINI_API_KEY_PRIMARY) missing.push('GEMINI_API_KEY_PRIMARY')
  if (!GEMINI_API_KEY_SECONDARY) missing.push('GEMINI_API_KEY_SECONDARY')
  if (!GEMINI_MODEL) missing.push('GEMINI_MODEL')
  if (missing.length) throw new Error(`AI configuration missing: ${missing.join(', ')}`)
}

function getAiStatus() {
  return {
    primary: GEMINI_API_KEY_PRIMARY ? 'healthy' : 'missing',
    secondary: GEMINI_API_KEY_SECONDARY ? 'healthy' : 'missing',
    model: GEMINI_MODEL
  }
}

function trimPrompt(text, maxChars) {
  return String(text || '').trim().slice(0, maxChars)
}

function isQuotaError(err) {
  const status = err.status || err.statusCode || err.response?.status
  const message = String(err.message || err.response?.data?.error?.message || '')
  return status === 429 || /RESOURCE_EXHAUSTED|quota exceeded|rate limit exceeded|rate limit|quota|429/i.test(message)
}

function normalizeGeminiError(err) {
  const message = err.message || 'Gemini request failed'
  const next = new Error(message)
  next.statusCode = /api key|permission|auth/i.test(message) ? 401 : isQuotaError(err) ? 429 : err.statusCode || err.status || 502
  next.code = err.code
  return next
}

function quotaReachedError() {
  const err = new Error('AI quota reached')
  err.statusCode = 429
  err.code = 'AI_QUOTA_REACHED'
  return err
}

function extractJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  if (!cleaned) return ''

  const firstObject = cleaned.indexOf('{')
  const lastObject = cleaned.lastIndexOf('}')
  const firstArray = cleaned.indexOf('[')
  const lastArray = cleaned.lastIndexOf(']')

  if (firstObject !== -1 && lastObject > firstObject) return cleaned.slice(firstObject, lastObject + 1)
  if (firstArray !== -1 && lastArray > firstArray) return cleaned.slice(firstArray, lastArray + 1)
  return cleaned
}

async function withTimeout(promise) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Gemini request timed out')
      err.statusCode = 504
      reject(err)
    }, REQUEST_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function requestProvider(providerName, fullPrompt, temperature, started) {
  console.log(`[Gemini] Provider: ${providerName}`)
  const result = await withTimeout(providers[providerName].generateContent({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json'
    }
  }))

  const text = result.response.text().trim()
  const usage = result.response.usageMetadata
  console.log('aiProvider success:', {
    provider: providerName,
    model: GEMINI_MODEL,
    durationMs: Date.now() - started,
    tokens: usage?.totalTokenCount || null
  })
  if (!text) throw new Error('Gemini returned an empty response')
  return text
}

async function generateAIResponse(prompt, { temperature = 0.1, schema = null, schemaName = 'ats_json' } = {}) {
  validateAiConfig()

  const started = Date.now()
  const fullPrompt = [
    'Return valid JSON only. Do not include markdown or explanatory text.',
    schema ? `JSON schema name: ${schemaName}` : '',
    schema ? `JSON schema: ${JSON.stringify(schema)}` : '',
    trimPrompt(prompt, 12000)
  ].filter(Boolean).join('\n\n')

  try {
    return await requestProvider('PRIMARY', fullPrompt, temperature, started)
  } catch (err) {
    if (!isQuotaError(err)) {
      const normalized = normalizeGeminiError(err)
      console.error('aiProvider failure:', {
        provider: 'PRIMARY',
        model: GEMINI_MODEL,
        durationMs: Date.now() - started,
        statusCode: normalized.statusCode,
        message: normalized.message
      })
      throw normalized
    }

    console.warn('[Gemini] Quota Exceeded on Primary')
    console.warn('[Gemini] Fallback Activated')

    try {
      return await requestProvider('SECONDARY', fullPrompt, temperature, started)
    } catch (secondaryErr) {
      if (isQuotaError(secondaryErr)) {
        console.warn('[Gemini] Quota Exceeded on Secondary')
        console.warn('[Gemini] Provider: PRIMARY')
        try {
          return await requestProvider('PRIMARY', fullPrompt, temperature, started)
        } catch (primaryRetryErr) {
          if (isQuotaError(primaryRetryErr)) {
            throw quotaReachedError()
          }
          const normalizedRetry = normalizeGeminiError(primaryRetryErr)
          console.error('aiProvider failure:', {
            provider: 'PRIMARY',
            model: GEMINI_MODEL,
            durationMs: Date.now() - started,
            statusCode: normalizedRetry.statusCode,
            message: normalizedRetry.message
          })
          throw normalizedRetry
        }
      }
      const normalized = normalizeGeminiError(secondaryErr)
      console.error('aiProvider failure:', {
        provider: 'SECONDARY',
        model: GEMINI_MODEL,
        durationMs: Date.now() - started,
        statusCode: normalized.statusCode,
        message: normalized.message
      })
      throw normalized
    }
  }
}

async function callAiJson({ prompt, schema, temperature = 0.1, schemaName = 'ats_json', returnRaw = false }) {
  const rawText = await generateAIResponse(prompt, { schema, temperature, schemaName })
  const jsonText = extractJsonText(rawText)

  try {
    const parsed = JSON.parse(jsonText)
    return returnRaw ? { parsed, rawText: jsonText } : parsed
  } catch (err) {
    const parseError = new Error('Gemini returned invalid JSON')
    parseError.cause = err
    throw parseError
  }
}

module.exports = {
  callAiJson,
  generateAIResponse,
  getAiStatus,
  validateAiConfig,
  GEMINI_MODEL
}
