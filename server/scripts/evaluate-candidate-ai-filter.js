const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { callAiJson, GEMINI_MODEL } = require('../src/services/aiProvider')
const {
  FIELD_REGISTRY,
  buildCandidateFilterPrompt,
  candidateFilterSchema,
  validateCandidateFilter
} = require('../src/services/candidateAiFilter')

const cases = [
  ['show me all candidates whose status is -', ['status']],
  ['can you find candidates currently in discussion', ['status']],
  ['I need people handled by Divya who are in discussion', ['consultant', 'status']],
  ['give me Java candidates with more than five years of experience', ['skills', 'experience']],
  ['show candidates from Delhi or Gurgaon who know React', ['current_location', 'skills']],
  ['find anyone whose mobile number is 9876543210', ['mobile']],
  ['I want candidates submitted to the client by Cherry', ['status', 'consultant']],
  ['list people who do not have a status selected', ['status']],
  ['show candidates who can join immediately', ['notice_period']],
  ['get candidates added in the last seven days', ['created_date']],
  ['find candidates with expected salary below 15 lakh', ['expected_ctc']],
  ['show people with Java and Spring but not Hibernate', ['skills']],
  ['give me either interested or in-discussion candidates handled by Divya', ['status', 'consultant']],
  ['find candidates with no mobile or no email', ['mobile', 'email']],
  ['STATUS IS -', ['status']],
  ['status   is   in discussion', ['status']],
  ['Status: In Discussion', ['status']],
  ['status="In Discussion"', ['status']],
  ['status is in discusion', ['status']],
  ['consultant: Divya, status: Client Submission', ['consultant', 'status']],
  ['mobile: +91-98765-43210', ['mobile']],
  ['( status is Interested OR In Discussion ) AND consultant is Divya', ['status', 'consultant']],
  ['candidate name contains Rahul', ['candidate_name']],
  ['email domain is gmail.com', ['email']],
  ['number ending in 3210', ['mobile']],
  ['has both React and TypeScript', ['skills']],
  ['Java or Python or Go', ['skills']],
  ['18 months experience', ['experience']],
  ['current CTC above 10 LPA', ['current_ctc']],
  ['expected CTC between 10 and 15 lakh', ['expected_ctc']],
  ['notice period between 30 and 60 days', ['notice_period']],
  ['created between 1 July 2026 and 10 July 2026', ['created_date']],
  ['updated today', ['updated_date']],
  ['client is Acme and status is Client Submission', ['client_name', 'status']],
  ['mandate is Backend Developer and consultant is Divya', ['role', 'consultant']],
  ['(Java or Python) and experience above 5 years', ['skills', 'experience']],
  ['status is anything except Rejected by Client', ['status']],
  ['candidates without a mobile number', ['mobile']],
  ['no consultant assigned', ['consultant']],
  ['resume is missing', ['cv']]
]

async function evaluate([query, expectedFields]) {
  try {
    const parsed = await callAiJson({
      prompt: buildCandidateFilterPrompt(query, Object.keys(FIELD_REGISTRY)),
      schema: candidateFilterSchema(),
      schemaName: 'candidate_filter_ast_live_evaluation',
      temperature: 0
    })
    const validated = parsed?.unsupported ? null : validateCandidateFilter(parsed)
    const fields = [...new Set((validated?.conditions || []).map(item => item.field).filter(field => !FIELD_REGISTRY[field]?.internal))]
    const passed = expectedFields.every(field => fields.includes(field))
    return { query, passed, fields, error: passed ? '' : `expected ${expectedFields.join(', ')}` }
  } catch (error) {
    return { query, passed: false, fields: [], error: error.message }
  }
}

async function main() {
  const results = []
  for (let index = 0; index < cases.length; index += 4) {
    results.push(...await Promise.all(cases.slice(index, index + 4).map(evaluate)))
  }
  const failed = results.filter(item => !item.passed)
  console.log(JSON.stringify({ model: GEMINI_MODEL, prompts: results.length, passed: results.length - failed.length, failed }, null, 2))
  if (failed.length) process.exitCode = 1
}

main()
