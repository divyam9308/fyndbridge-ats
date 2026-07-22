const test = require('node:test')
const assert = require('node:assert/strict')

const {
  indiaDate,
  publicJobState,
  isPublicJobEligible,
  publicRoleDto,
  publicJobPayload,
  publicJobDetailsChanged,
  validatePublicJobForPublish,
  countEligiblePublicJobs,
  validatePublicApplication,
  publicApplicationPayload,
  parsedResumeDto
} = require('./publicApplications')

const NOW = new Date('2026-07-22T06:30:00.000Z')

function publicJob(overrides = {}) {
  return {
    id: 'private-job-id',
    client_id: 'private-client-id',
    title: 'Internal mandate title',
    consultants: ['Private Consultant'],
    is_public: true,
    public_slug: 'senior-finance-manager-jb100',
    public_name: 'Senior Finance Manager',
    public_location: 'Mumbai, Maharashtra',
    public_experience: '8 - 12 Years',
    public_skills: ['Financial Planning', 'Budgeting'],
    application_deadline: '2026-07-22',
    public_jd: 'Public job description',
    mandate_status: 'Ongoing (P1)',
    status: 'Ongoing (P1)',
    ...overrides
  }
}

function validApplication(overrides = {}) {
  return {
    role_slug: 'senior-finance-manager-jb100',
    full_name: '  Rahul   Sharma  ',
    email: ' RAHUL.SHARMA@Example.com ',
    mobile_number: '+91 98765 43210',
    current_designation: 'Finance Manager',
    current_organisation: 'Example Finance Ltd.',
    experience_years: '9.5',
    location: 'Mumbai, Maharashtra',
    skills: ['Financial Planning', 'Budgeting'],
    notice_period: '30',
    current_salary: '18',
    linkedin_url: 'https://www.linkedin.com/in/rahul-sharma',
    comments: 'Interested in this role.',
    open_to_relocate: 'true',
    ...overrides
  }
}

test('Asia/Kolkata eligibility exposes only complete, current, canonical P1 listings', () => {
  assert.equal(indiaDate(NOW), '2026-07-22')
  assert.equal(publicJobState(publicJob(), NOW), 'Published')
  assert.equal(isPublicJobEligible(publicJob(), NOW), true)
  assert.equal(publicJobState(publicJob({ is_public: false }), NOW), 'Not Public')
  assert.equal(publicJobState(publicJob({ public_jd: '' }), NOW), 'Incomplete')
  assert.equal(publicJobState(publicJob({ mandate_status: 'Delivered (P2)' }), NOW), 'Closed')
  assert.equal(publicJobState(publicJob({ application_deadline: '2026-07-21' }), NOW), 'Expired')
  assert.equal(publicJobState(publicJob({ application_deadline: '2026-07-22' }), NOW), 'Published')
  assert.equal(publicJobState(publicJob({ public_skills: [] }), NOW), 'Published')
})

test('public role DTO is an explicit allowlist and detail adds only the public JD', () => {
  const summary = publicRoleDto(publicJob())
  assert.deepEqual(Object.keys(summary), [
    'slug',
    'public_name',
    'public_location',
    'public_experience',
    'public_skills',
    'application_deadline'
  ])
  assert.equal(summary.slug, 'senior-finance-manager-jb100')
  assert.equal(Object.hasOwn(summary, 'id'), false)
  assert.equal(Object.hasOwn(summary, 'client_id'), false)
  assert.equal(Object.hasOwn(summary, 'consultants'), false)
  assert.equal(Object.hasOwn(summary, 'title'), false)

  const detail = publicRoleDto(publicJob(), { detail: true })
  assert.deepEqual(Object.keys(detail), [...Object.keys(summary), 'public_jd'])
  assert.equal(detail.public_jd, 'Public job description')
})

test('public job input ignores caller-supplied slugs and validates publishing fields without mutating private state', () => {
  const payload = publicJobPayload({
    is_public: 'true',
    public_slug: 'caller-controlled-slug',
    public_name: ' Finance Lead ',
    public_location: ' Mumbai ',
    public_experience: ' 8 - 10 Years ',
    public_skills: 'Budgeting, Forecasting, Budgeting',
    application_deadline: '2026-07-23',
    public_jd: ' Public JD '
  })

  assert.equal(Object.hasOwn(payload, 'public_slug'), false)
  assert.deepEqual(payload.public_skills, ['Budgeting', 'Forecasting'])
  assert.doesNotThrow(() => validatePublicJobForPublish({ ...publicJob(), ...payload }, NOW))

  assert.throws(
    () => validatePublicJobForPublish(publicJob({ mandate_status: 'Completed' }), NOW),
    (error) => error.statusCode === 400 && error.errors.is_public === 'Only Ongoing (P1) mandates can be published'
  )
  assert.throws(
    () => validatePublicJobForPublish(publicJob({ application_deadline: '2026-07-21' }), NOW),
    (error) => error.statusCode === 400 && error.errors.application_deadline === 'Application deadline cannot be in the past'
  )
})

test('unchanged public fields do not block an internal status closure while real listing edits are detected', () => {
  const current = publicJob()
  assert.equal(publicJobDetailsChanged(current, { ...current, mandate_status: 'Completed' }), false)
  assert.equal(publicJobDetailsChanged(current, { ...current, public_skills: [...current.public_skills].reverse() }), false)
  assert.equal(publicJobDetailsChanged(current, { ...current, public_location: 'Pune' }), true)
})

test('public role badge count uses a database-side exact head count', async () => {
  const calls = []
  const builder = {
    select(columns, options) { calls.push(['select', columns, options]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    gte(column, value) { calls.push(['gte', column, value]); return this },
    not(column, operator, value) { calls.push(['not', column, operator, value]); return this },
    then(resolve) { return Promise.resolve({ count: 4, error: null }).then(resolve) }
  }
  const count = await countEligiblePublicJobs({ from: table => { assert.equal(table, 'jobs'); return builder } }, NOW)
  assert.equal(count, 4)
  assert.deepEqual(calls[0], ['select', 'id', { count: 'exact', head: true }])
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'is_public' && call[2] === true))
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'mandate_status' && call[2] === 'Ongoing (P1)'))
})

test('application validation keeps LinkedIn and Comments optional and integer LPA salary values required', () => {
  assert.deepEqual(validatePublicApplication(validApplication()), {})
  assert.deepEqual(validatePublicApplication(validApplication({ open_to_relocate: 'false' })), {})
  assert.deepEqual(validatePublicApplication(validApplication({ open_to_relocate: 'NA' })), {})

  const missing = validatePublicApplication(validApplication({
    full_name: '',
    comments: '',
    linkedin_url: '',
    skills: []
  }))
  assert.equal(missing.full_name, 'full_name is required')
  assert.equal(missing.comments, undefined)
  assert.equal(missing.linkedin_url, undefined)
  assert.equal(missing.skills, 'At least one skill is required')
  assert.equal(validatePublicApplication(validApplication({ linkedin_url: 'not-a-url' })).linkedin_url, 'Enter a valid LinkedIn URL')

  for (const current_salary of ['18.5', '0', '-1', '1000000000']) {
    assert.equal(
      validatePublicApplication(validApplication({ current_salary })).current_salary,
      'CTC must be a positive whole LPA value with at most 9 digits'
    )
  }
  assert.equal(validatePublicApplication(validApplication({ current_salary: '999999999' })).current_salary, undefined)
  assert.equal(validatePublicApplication(validApplication({ notice_period: '30.5' })).notice_period, 'Notice period must be a whole number')
})

test('application payload normalizes identity once while preserving LPA numbers and relocate tri-state', () => {
  const payload = publicApplicationPayload(validApplication({ open_to_relocate: 'NA' }))

  assert.equal(payload.full_name, 'Rahul Sharma')
  assert.equal(payload.email, 'rahul.sharma@example.com')
  assert.equal(payload.email_normalized, 'rahul.sharma@example.com')
  assert.equal(payload.mobile_number, '+919876543210')
  assert.equal(payload.mobile_normalized, '919876543210')
  assert.equal(payload.current_salary, 18)
  assert.equal(Object.hasOwn(payload, 'expected_salary'), false)
  assert.equal(payload.linkedin_url, 'https://www.linkedin.com/in/rahul-sharma')
  assert.equal(payload.comments, 'Interested in this role.')
  assert.equal(payload.open_to_relocate, 'NA')

  const optional = publicApplicationPayload(validApplication({ linkedin_url: '', comments: '' }))
  assert.equal(optional.linkedin_url, null)
  assert.equal(optional.comments, null)
})

test('parsed resume DTO allowlists candidate-safe fields and omits parser internals', () => {
  const result = parsedResumeDto({
    ai_extracted: {
      name: 'Rahul Sharma',
      email: 'rahul@example.com',
      mobile: '+919999999999',
      currentDesignation: 'Manager',
      currentOrganisation: 'Example Ltd.',
      experience: 9,
      city: 'Mumbai',
      state: 'Maharashtra',
      skills: ['Budgeting'],
      salary: 18,
      linkedin: 'https://linkedin.com/in/rahul',
      confidential_model_trace: 'must not escape'
    },
    extracted: {},
    raw_text: 'private resume text',
    confidence: { email: 0.99 },
    storage_path: 'private/path.pdf'
  })

  assert.deepEqual(Object.keys(result), [
    'full_name',
    'email',
    'mobile_number',
    'current_designation',
    'current_organisation',
    'experience_years',
    'location',
    'skills',
    'current_salary',
    'linkedin_url'
  ])
  assert.equal(result.location, 'Mumbai, Maharashtra')
  assert.equal(Object.hasOwn(result, 'raw_text'), false)
  assert.equal(Object.hasOwn(result, 'confidence'), false)
  assert.equal(Object.hasOwn(result, 'storage_path'), false)
})
