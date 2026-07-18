const test = require('node:test')
const assert = require('node:assert/strict')
const { extractCurrentCompany, extractFields } = require('./extractorUtils')
const {
  normalizeResumeAiOutput,
  parseResumeText,
  RESUME_AI_SCHEMA
} = require('./resumeParser')

const organisationCases = [
  {
    name: 'role followed by organisation',
    text: [
      'PROFESSIONAL EXPERIENCE',
      'Senior Manager, 2022 - Present',
      'Acme Corporation',
      'Led a multi-disciplinary team.'
    ].join('\n')
  },
  {
    name: 'organisation followed by role and dates',
    text: [
      'WORK EXPERIENCE',
      'Acme Corporation',
      'Senior Manager | January 2022 - Present',
      'Led a multi-disciplinary team.'
    ].join('\n')
  },
  {
    name: 'role, organisation, and dates on separate lines',
    text: [
      'EMPLOYMENT HISTORY',
      'Senior Manager',
      'Acme Corporation',
      'January 2022 - Present',
      'Led a multi-disciplinary team.'
    ].join('\n')
  },
  {
    name: 'organisation and dates on one line',
    text: [
      'EXPERIENCE',
      'Acme Corporation | January 2022 - Present',
      'Senior Manager',
      'Led a multi-disciplinary team.'
    ].join('\n')
  },
  {
    name: 'explicit current organisation label',
    text: [
      'Current Organisation: Acme Corporation',
      'Current Designation: Senior Manager'
    ].join('\n')
  },
  {
    name: 'brand-only organisation before a dated role',
    text: [
      'WORK HISTORY',
      'Deloitte',
      'Senior Manager | January 2022 - Present',
      'Led a multi-disciplinary team.'
    ].join('\n'),
    expected: 'Deloitte'
  }
]

for (const fixture of organisationCases) {
  test(`extracts current organisation when resume uses ${fixture.name}`, () => {
    const expected = fixture.expected || 'Acme Corporation'
    assert.equal(extractCurrentCompany(fixture.text), expected)
    assert.equal(extractFields(fixture.text).current_company.value, expected)
  })
}

test('does not treat an unstructured profile summary as a current organisation', () => {
  const text = 'PROFILE\nExperienced sales leader who managed regional teams and delivered revenue growth.'
  assert.equal(extractCurrentCompany(text), null)
})

test('AI schema and normalization preserve current organisation', () => {
  assert.deepEqual(RESUME_AI_SCHEMA.properties.currentOrganisation, { type: ['string', 'null'] })
  const normalized = normalizeResumeAiOutput({
    currentOrganisation: '  Acme Corporation  ',
    skills: []
  })
  assert.equal(normalized.currentOrganisation, 'Acme Corporation')
})

test('heuristic current company fills a missing AI current organisation', async () => {
  const text = [
    'WORK EXPERIENCE',
    'Acme Corporation',
    'Senior Manager | January 2022 - Present'
  ].join('\n')

  const parsed = await parseResumeText(text, {
    parseResumeWithAiImpl: async () => ({
      currentOrganisation: null,
      location: null,
      skills: []
    })
  })

  assert.equal(parsed.extracted.current_company.value, 'Acme Corporation')
  assert.equal(parsed.ai_extracted.currentOrganisation, 'Acme Corporation')
})

test('AI current organisation takes priority over the heuristic fallback', async () => {
  const text = [
    'WORK EXPERIENCE',
    'Previous Employer Ltd',
    'Senior Manager | January 2022 - Present'
  ].join('\n')

  const parsed = await parseResumeText(text, {
    parseResumeWithAiImpl: async () => ({
      currentOrganisation: 'Current Employer Ltd',
      location: null,
      skills: []
    })
  })

  assert.equal(parsed.ai_extracted.currentOrganisation, 'Current Employer Ltd')
})
