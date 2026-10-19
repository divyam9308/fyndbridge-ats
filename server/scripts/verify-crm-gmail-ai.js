// Explicit opt-in live provider check. Uses synthetic text only, never Gmail.
const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true })
const { callAiJson } = require('../src/services/aiProvider')
const { SCHEMA, validateAnalysis, analysisPrompt } = require('../src/services/crmGmailContent')
const { CRM_MODEL } = require('../src/services/crmGmail')
const cases = [
  { name: 'proposed', direction: 'incoming', body: 'Could we meet Friday at 2 PM to discuss a recruitment partnership? We are interested in learning about your services.', meeting: 'proposed', sentiment: 'positive', negative: null },
  { name: 'confirmed', direction: 'incoming', body: 'Our recruitment discussion is confirmed for Friday at 2 PM. We look forward to working with your team.', meeting: 'confirmed', sentiment: 'positive', negative: null },
  { name: 'temporary_no_requirements', direction: 'incoming', body: 'We have no recruitment requirements this quarter. Please check with us next quarter. We are not arranging any meeting at present.', meeting: null, negative: 'no_requirements' },
  { name: 'outgoing_unknown', direction: 'outgoing', body: 'Hello, I am introducing our recruitment services. Please let us know if you would like more information. Regards, Your consultant.', meeting: null, negative: null, sentiment: 'unknown' }
]
async function main() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to opt in to synthetic provider requests.')
  const results = []
  for (const item of cases) {
    const started = Date.now()
    try {
      const raw = await callAiJson({ prompt: analysisPrompt(item.body, item.direction, 'Synthetic CRM integration verification'), schema: SCHEMA, schemaName: 'crm_email_analysis', model: CRM_MODEL, timeoutMs: 5500, safeErrors: true })
      const value = validateAnalysis(raw, item.body, item.direction)
      const meeting = value.meeting?.status || null, negative = value.negative_response?.category || null, sentiment = value.sentiment.label
      const passed = meeting === item.meeting && negative === item.negative && (!item.sentiment || sentiment === item.sentiment)
      results.push({ name: item.name, passed, duration_ms: Date.now() - started, meeting, negative, sentiment })
    } catch (error) { results.push({ name: item.name, passed: false, duration_ms: Date.now() - started, error: error.code || 'AI_CHECK_FAILED', status: error.statusCode }) }
  }
  console.log(JSON.stringify({ model: CRM_MODEL, synthetic_only: true, results }, null, 2))
  if (results.some(result => !result.passed)) process.exitCode = 1
}
main().catch(() => { console.error('Synthetic Gmail AI verification could not start.'); process.exitCode = 1 })
