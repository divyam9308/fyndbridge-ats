const fs = require('fs/promises')
const path = require('path')
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')
const { callAiJson } = require('../services/aiProvider')

const VALID_STATUSES = [
  'Interested',
  'Not Interested',
  'Offered',
  'Hired',
  'Rejected by Recruiter',
  'Interview',
  'Client Submission',
  'Rejected by Client'
]

const CANDIDATE_FIELDS = [
  'full_name',
  'email',
  'mobile_number',
  'city',
  'state',
  'location',
  'current_designation',
  'current_company',
  'current_organisation',
  'experience_years',
  'notice_period',
  'open_to_relocate',
  'skills',
  'education',
  'cv_link',
  'linkedin_url',
  'resume_url',
  'source',
  'client_id'
]

const ASSOCIATION_FIELDS = [
  'client_name',
  'job_title',
  'consultant_name',
  'status',
  'current_salary',
  'expected_salary',
  'notes',
  'client_id',
  'job_id'
]

const AI_FILTER_OPERATORS = [
  'contains',
  'eq',
  'gte',
  'lte',
  'gt',
  'lt',
  'isBlank',
  'isNotBlank'
]

const AI_FILTER_FIELD_MAP = {
  candidate_id: { column: 'candidates.candidate_display_id', type: 'text' },
  name: { column: 'candidates.full_name', type: 'text' },
  email: { column: 'candidates.email', type: 'text' },
  mobile: { column: 'candidates.mobile_number', type: 'text', normalize: normalizeMobile },
  city: { column: 'candidates.city', type: 'text' },
  location: { column: 'candidates.location', type: 'text' },
  state: { column: 'candidates.state', type: 'text' },
  designation: { column: 'candidates.current_designation', type: 'text', fuzzy: true },
  organisation: { column: 'candidates.current_organisation', type: 'text' },
  experience: { column: 'candidates.experience_years', type: 'number' },
  notice_period: { column: 'candidates.notice_period', type: 'number' },
  relocation: { column: 'candidates.open_to_relocate', type: 'boolean' },
  current_ctc: { column: 'current_salary', type: 'number', normalize: normalizeMoney },
  expected_ctc: { column: 'expected_salary', type: 'number', normalize: normalizeMoney },
  consultant: { column: 'consultant_name', type: 'text' },
  client: { column: 'client_name', type: 'text' },
  job: { column: 'job_title', type: 'text', fuzzy: true },
  status: { column: 'status', type: 'text' },
  education: { column: 'candidates.education', type: 'text' },
  skills: { column: 'candidates.skills', type: 'array' },
  cv_link: { column: 'candidates.cv_link', type: 'text' },
  linkedin: { column: 'candidates.linkedin_url', type: 'text' },
  notes: { column: 'notes', type: 'text' },
  created_at: { column: 'created_at', type: 'date' }
}

const AI_FILTER_FIELDS = Object.keys(AI_FILTER_FIELD_MAP)

const AI_FILTER_FIELD_ALIASES = {
  full_name: 'name',
  candidate: 'name',
  person: 'name',
  phone: 'mobile',
  contact: 'mobile',
  contact_number: 'mobile',
  number: 'mobile',
  recruiter: 'consultant',
  owner: 'consultant',
  company: 'client',
  submitted_to: 'client',
  current_role: 'designation',
  role: 'job',
  title: 'designation',
  position: 'job',
  opening: 'job',
  stage: 'status',
  technology: 'skills',
  tech_stack: 'skills',
  salary: 'current_ctc',
  ctc: 'current_ctc',
  current_salary: 'current_ctc',
  expected_salary: 'expected_ctc',
  expectedSalary: 'expected_ctc',
  currentDesignation: 'designation',
  job_title: 'job',
  client_name: 'client',
  consultant_name: 'consultant',
  mobile_number: 'mobile',
  email_id: 'email',
  candidate_display_id: 'candidate_id',
  display_id: 'candidate_id',
  comments: 'notes'
}

const AI_FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    logic: { type: 'string', enum: ['AND', 'OR'] },
    filters: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          operator: { type: 'string', enum: AI_FILTER_OPERATORS },
          value: { type: ['string', 'number', 'boolean', 'null'] }
        }
      }
    }
  }
}

function logAndSendInternal(res, routeName, err) {
  console.error(`${routeName}:`, err.message)
  return res.status(500).json({ error: 'Internal server error' })
}

function normalizeNullable(value) {
  return value === '' ? null : value
}

function normalizeMatchValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeMobile(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim()
}

function normalizeMoney(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return null
  const number = Number((text.match(/\d+(?:\.\d+)?/) || [])[0])
  if (!Number.isFinite(number)) return null
  if (/\b(lpa|lac|lakh|lakhs)\b/.test(text)) return Math.round(number * 100000)
  if (/\b(cr|crore|crores)\b/.test(text)) return Math.round(number * 10000000)
  if (number > 0 && number <= 1000) return Math.round(number * 100000)
  return Math.round(number)
}

function normalizeNumber(value) {
  const number = Number((cleanText(value).match(/\d+(?:\.\d+)?/) || [])[0])
  return Number.isFinite(number) ? number : null
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value
  const text = cleanText(value).toLowerCase()
  if (/^(yes|true|y|open|relocate|willing|available)$/i.test(text)) return true
  if (/^(no|false|n|not open|not willing)$/i.test(text)) return false
  return null
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidMobile(value) {
  return /^(\+?\d{1,3}[\s-]?)?[6-9]\d{9}$/.test(String(value || '').trim())
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= 999999999
}

function cleanDuplicateAiConditions(filters) {
  const conditions = filters?.conditions

  if (!Array.isArray(conditions)) return filters

  const rangeOperators = new Set([
    'greaterThanOrEqual',
    'greater_than_or_equal',
    'gte',
    'lessThanOrEqual',
    'less_than_or_equal',
    'lte',
    'greaterThan',
    'greater_than',
    'gt',
    'lessThan',
    'less_than',
    'lt'
  ])

  const equalsOperators = new Set(['equals', 'equal', 'eq'])

  const rangeKeys = new Set(
    conditions
      .filter((condition) => rangeOperators.has(condition.operator))
      .map((condition) => `${condition.field}|${String(condition.value)}`)
  )

  const seen = new Set()

  filters.conditions = conditions.filter((condition) => {
    if (
      equalsOperators.has(condition.operator) &&
      rangeKeys.has(`${condition.field}|${String(condition.value)}`)
    ) {
      return false
    }

    const key = `${condition.field}|${condition.operator}|${String(condition.value)}`
    if (seen.has(key)) return false
    seen.add(key)

    return true
  })

  return filters
}

function cleanParsedAiFilters(data) {
  if (data?.filters && !Array.isArray(data.filters)) {
    console.log('AI filters before cleanup:', JSON.stringify(data.filters))
    data.filters = cleanDuplicateAiConditions(data.filters)
    console.log('AI filters after cleanup:', JSON.stringify(data.filters))
  } else if (Array.isArray(data?.conditions)) {
    console.log('AI filters before cleanup:', JSON.stringify(data))
    cleanDuplicateAiConditions(data)
    console.log('AI filters after cleanup:', JSON.stringify(data))
  }

  return data
}

function normalizeAiFilterOutput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  data = cleanParsedAiFilters(data)

  const inputFilters = Array.isArray(data.filters)
    ? data.filters
    : Array.isArray(data.conditions)
      ? data.conditions
      : Array.isArray(data.filters?.conditions)
        ? data.filters.conditions
        : null

  if (!inputFilters) return null

  const logic = cleanText(data.logic || data.filters?.logic).toUpperCase() === 'OR' ? 'OR' : 'AND'

  const operatorMap = {
    equals: 'eq',
    equal: 'eq',
    '=': 'eq',
    greaterThan: 'gt',
    greaterthan: 'gt',
    greater_than: 'gt',
    greaterThanOrEqual: 'gte',
    greaterthanorequal: 'gte',
    greater_than_or_equal: 'gte',
    lessThan: 'lt',
    lessthan: 'lt',
    less_than: 'lt',
    lessThanOrEqual: 'lte',
    lessthanorequal: 'lte',
    less_than_or_equal: 'lte',
    blank: 'isBlank',
    notBlank: 'isNotBlank',
    notblank: 'isNotBlank',
    contains: 'contains'
  }

  const filters = inputFilters.map((filter) => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new Error('Invalid AI filter object')
    }

    const rawField = cleanText(filter.field)
    const field = AI_FILTER_FIELD_ALIASES[rawField] || rawField
    const info = AI_FILTER_FIELD_MAP[field]

    let operator = cleanText(filter.operator)
    operator = operatorMap[operator] || operatorMap[operator.toLowerCase()] || operator

    if (!info || !AI_FILTER_FIELDS.includes(field)) {
      throw new Error(`Invalid AI filter field: ${rawField}`)
    }

    if (!AI_FILTER_OPERATORS.includes(operator)) {
      throw new Error(`Invalid AI filter operator: ${filter.operator}`)
    }

    if (info.type !== 'number' && operator === 'eq') {
      operator = 'contains'
    }

    let value = filter.value

    if (operator === 'isBlank' || operator === 'isNotBlank') {
      value = null
    } else if (info.type === 'number') {
      if (!['eq', 'gte', 'lte', 'gt', 'lt'].includes(operator)) {
        throw new Error(`Invalid numeric operator for ${field}`)
      }
      value = (info.normalize || normalizeNumber)(value)
    } else if (info.type === 'boolean') {
      value = normalizeBoolean(value)
    } else {
      value = cleanText(value)
    }

    if (!['isBlank', 'isNotBlank'].includes(operator) && (value === null || value === '')) {
      throw new Error(`Missing AI filter value for ${field}`)
    }

    return { field, operator, value }
  })

  return dedupeAiFilters({ logic, filters: filters.slice(0, 12) })
}

function dedupeAiFilters(filters) {
  if (!filters?.filters?.length) return filters

  const rangeOperators = new Set(['gt', 'gte', 'lt', 'lte'])
  const numericRangeKeys = new Set(
    filters.filters
      .filter((filter) => {
        const info = AI_FILTER_FIELD_MAP[filter.field]
        return info?.type === 'number' && rangeOperators.has(filter.operator)
      })
      .map((filter) => `${filter.field}|${filter.value}`)
  )

  const seen = new Set()

  filters.filters = filters.filters.filter((filter) => {
    const info = AI_FILTER_FIELD_MAP[filter.field]
    if (!info) return false

    if (
      info.type === 'number' &&
      filter.operator === 'eq' &&
      numericRangeKeys.has(`${filter.field}|${filter.value}`)
    ) {
      return false
    }

    const key = `${filter.field}|${filter.operator}|${filter.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return filters
}

function correctNumericOperatorsFromPrompt(filters, prompt) {
  if (!filters?.filters?.length) return filters

  const promptText = cleanText(prompt).toLowerCase()

  const wantsGte = /\b(greater than or equal to|greater than equal to|more than or equal to|at least|minimum|min)\b|\d+\s*\+/.test(promptText)
  const wantsLte = /\b(less than or equal to|less than equal to|at most|maximum|max|not more than|up to)\b/.test(promptText)
  const wantsGt = !wantsGte && /\b(greater than|more than|above|over)\b/.test(promptText)
  const wantsLt = !wantsLte && /\b(less than|below|under)\b/.test(promptText)

  filters.filters = filters.filters.map((filter) => {
    const info = AI_FILTER_FIELD_MAP[filter.field]

    if (info?.type !== 'number') return filter

    if (['eq', 'gt', 'gte'].includes(filter.operator) && wantsGte) {
      return { ...filter, operator: 'gte' }
    }

    if (['eq', 'lt', 'lte'].includes(filter.operator) && wantsLte) {
      return { ...filter, operator: 'lte' }
    }

    if (['eq', 'gte'].includes(filter.operator) && wantsGt) {
      return { ...filter, operator: 'gt' }
    }

    if (['eq', 'lte'].includes(filter.operator) && wantsLt) {
      return { ...filter, operator: 'lt' }
    }

    return filter
  })

  return dedupeAiFilters(filters)
}

function safeFilterPrompt(prompt, allowedFields) {
  const fieldList = allowedFields.join(', ')
  const schemaLines = Object.entries(AI_FILTER_FIELD_MAP)
    .map(([field, info]) => `${field} -> ${info.column} (${info.type})`)
    .join('\n')

  return [
    'Convert the recruiting search request into safe JSON filters only. Do not fetch data and do not invent values.',
    `Allowed fields: ${fieldList}.`,
    'Available schema/aliases:',
    schemaLines,
    `Operators: ${AI_FILTER_OPERATORS.join(', ')}.`,
    'Return exactly: {"logic":"AND","filters":[{"field":"fieldName","operator":"operator","value":"value or null"}]}. Use OR only when the user explicitly says OR; otherwise use AND.',
    'AI is the only natural-language parser. Infer field, operator, and value from the full request.',
    'Use contains by default for text fields. Text "is" and "=" usually mean contains, not exact equality.',
    'Treat mobile/phone/email as text. For "mobile is 3" return field mobile, operator contains, value "3".',
    'Numeric fields are experience, notice_period, current_ctc, expected_ctc.',
    'Use numeric operators only for numeric fields.',
    'For numeric phrases: greater than/more than/above -> gt; greater than or equal/at least/minimum/+ -> gte; less than/below/under -> lt; less than or equal/at most/maximum/up to -> lte; equals/= -> eq.',
    'Do not return both eq and a range operator for the same numeric field/value.',
    'For "experience is greater than 8" return operator gt and value 8.',
    'For "experience is greater than or equal to 8" return operator gte and value 8.',
    'For "experience 8+" return operator gte and value 8.',
    'For "consultant is rajneesh", return operator contains and value "rajneesh".',
    'Use isBlank for blank/empty/missing/null and isNotBlank for not blank/filled.',
    'Map mobile/phone/contact/contact number/number to mobile; consultant/recruiter/handled by/assigned by/owner to consultant; candidate/person/name to name; city/location/current location/from/located in to city or location; designation/current role/title to designation; salary/ctc/current ctc to current_ctc; expected salary/expected ctc to expected_ctc; client/company/submitted to/working with to client; job/position/opening/role to job; status/stage to status; skill/technology/tech stack to skills.',
    'Do not include SQL, code, markdown, explanations, or fields not listed.',
    `Request: ${cleanText(prompt).slice(0, 1000)}`
  ].join('\n\n')
}

function validateCandidatePayload(body, { partial = false } = {}) {
  const errors = {}

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim()) {
      errors.full_name = 'full_name is required'
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'mobile_number')) {
    const mobile = normalizeMobile(body.mobile_number)
    if (!mobile) {
      errors.mobile_number = 'mobile_number is required'
    } else if (!isValidMobile(mobile)) {
      errors.mobile_number = 'mobile_number must be a valid Indian mobile number'
    }
  }

  if (body.email !== undefined && body.email !== null && body.email !== '' && !isValidEmail(body.email)) {
    errors.email = 'email must be a valid email address'
  }

  if (body.experience_years !== undefined && body.experience_years !== null && body.experience_years !== '') {
    const value = Number(body.experience_years)
    if (!Number.isFinite(value) || value < 0) {
      errors.experience_years = 'experience_years must be greater than or equal to 0'
    }
  }

  if (body.notice_period !== undefined && body.notice_period !== null && body.notice_period !== '') {
    const value = Number(body.notice_period)
    if (!Number.isInteger(value) || value < 0) {
      errors.notice_period = 'notice_period must be a whole number greater than or equal to 0'
    }
  }

  if (
    body.open_to_relocate !== undefined &&
    body.open_to_relocate !== null &&
    typeof body.open_to_relocate !== 'boolean'
  ) {
    errors.open_to_relocate = 'open_to_relocate must be true or false'
  }

  for (const field of ['current_salary', 'expected_salary']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
      const value = Number(body[field])
      if (!isPositiveInteger(value)) {
        errors[field] = `${field} must be a positive integer with at most 9 digits`
      }
    }
  }

  if (body.status !== undefined && body.status !== null && body.status !== '' && !VALID_STATUSES.includes(body.status)) {
    errors.status = `status must be one of: ${VALID_STATUSES.join(', ')}`
  }

  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || body.skills.some((skill) => typeof skill !== 'string')) {
      errors.skills = 'skills must be an array of strings'
    }
  }

  return errors
}

function pickPayload(body, fields) {
  const payload = {}

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeNullable(body[field])
    }
  }

  if (payload.full_name) payload.full_name = normalizeMatchValue(payload.full_name)
  if (payload.mobile_number) payload.mobile_number = normalizeMobile(payload.mobile_number)

  for (const field of ['experience_years', 'notice_period', 'current_salary', 'expected_salary']) {
    if (payload[field] !== undefined && payload[field] !== null) payload[field] = Number(payload[field])
  }

  return payload
}

async function findCandidateByNameAndMobile(fullName, mobileNumber) {
  const name = normalizeMatchValue(fullName)
  const mobile = normalizeMobile(mobileNumber)

  if (!name || !mobile) return null

  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .ilike('full_name', name)
    .eq('mobile_number', mobile)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

function normalizeDuplicateText(value) {
  return cleanText(value).toLowerCase()
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

const SORT_FIELDS = new Set(['candidate_id', 'candidate_name', 'consultant'])
const SORT_DIRECTIONS = new Set(['asc', 'desc'])

function normalizeSort(query) {
  const field = cleanText(query.sortField)
  const direction = cleanText(query.sortDirection).toLowerCase()
  if (!SORT_FIELDS.has(field)) return { field: '', direction: 'asc' }
  return {
    field,
    direction: field === 'consultant' ? 'asc' : SORT_DIRECTIONS.has(direction) ? direction : 'asc'
  }
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
}

function sortCandidateRows(rows, sort) {
  if (!sort.field) return rows

  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (sort.field === 'candidate_id') {
      return (displayIdNumber(a.candidate_display_id, 'CA') - displayIdNumber(b.candidate_display_id, 'CA')) * direction
    }
    if (sort.field === 'candidate_name') {
      return compareText(a.full_name, b.full_name) * direction
    }
    if (sort.field === 'consultant') {
      return compareText(a.consultant_name, b.consultant_name)
    }
    return ((a._serial_no || 0) - (b._serial_no || 0)) * direction
  })
}

async function ensureCandidateDisplayIds() {
  const { data, error } = await supabase
    .from('candidate_associations')
    .select('candidate_id, created_at, candidates(id, candidate_display_id)')
    .order('candidate_id', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(10000)

  if (error) throw error

  const candidates = []
  const seen = new Set()
  for (const row of data || []) {
    const candidate = row.candidates
    if (!candidate?.id || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    candidates.push(candidate)
  }

  if (!candidates.some((candidate) => !cleanText(candidate.candidate_display_id))) return

  let next = Math.max(0, ...candidates.map((candidate) => displayIdNumber(candidate.candidate_display_id, 'CA')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1
  for (const candidate of candidates.filter((item) => !cleanText(item.candidate_display_id))) {
    const { error: updateError } = await supabase
      .from('candidates')
      .update({ candidate_display_id: `CA${next++}` })
      .eq('id', candidate.id)
    if (updateError) throw updateError
  }
}

async function nextCandidateDisplayId() {
  await ensureCandidateDisplayIds()
  const { data, error } = await supabase.from('candidates').select('candidate_display_id')
  if (error) throw error
  const next = Math.max(0, ...(data || []).map((candidate) => displayIdNumber(candidate.candidate_display_id, 'CA')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1
  return `CA${next}`
}

async function getNextCandidateDisplayId(req, res) {
  try {
    return res.json({ candidate_display_id: await nextCandidateDisplayId() })
  } catch (err) {
    return logAndSendInternal(res, 'getNextCandidateDisplayId', err)
  }
}

async function findCandidateDuplicate(fullName, email) {
  const name = normalizeDuplicateText(fullName)
  const normalizedEmail = normalizeDuplicateText(email)

  if (!name || !normalizedEmail) return null

  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .ilike('email', normalizedEmail)

  if (error) throw error

  return (data || []).find((candidate) => normalizeDuplicateText(candidate.full_name) === name) || null
}

async function checkCandidateDuplicate(req, res) {
  try {
    const existing = await findCandidateDuplicate(req.query.name, req.query.email)
    return res.json({ duplicate: Boolean(existing), existing })
  } catch (err) {
    return logAndSendInternal(res, 'checkCandidateDuplicate', err)
  }
}

function flattenAssociation(row) {
  const candidate = row.candidates || {}

  return {
    id: row.id,
    association_id: row.id,
    candidate_id: row.candidate_id,
    candidate_display_id: candidate.candidate_display_id || null,
    full_name: candidate.full_name || null,
    email: candidate.email || null,
    mobile_number: candidate.mobile_number || null,
    city: candidate.city || null,
    state: candidate.state || null,
    location: candidate.location || null,
    current_designation: candidate.current_designation || null,
    current_company: candidate.current_company || null,
    current_organisation: candidate.current_organisation || candidate.current_company || null,
    experience_years: candidate.experience_years || null,
    notice_period: candidate.notice_period || null,
    open_to_relocate: candidate.open_to_relocate === null || candidate.open_to_relocate === undefined ? null : Boolean(candidate.open_to_relocate),
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: row.client_id || candidate.client_id || null,
    client_name: row.client_name || null,
    job_title: row.job_title || null,
    consultant_name: row.consultant_name || null,
    status: row.status || '',
    current_salary: row.current_salary || null,
    expected_salary: row.expected_salary || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function isMissingAssociationConsultantColumn(error) {
  return error?.code === 'PGRST204' && /consultant_name.*candidate_associations/i.test(error.message || '')
}

function withoutConsultantName(payload) {
  const next = { ...payload }
  delete next.consultant_name
  return next
}

function parseJsonFilter(value) {
  if (!value) return null

  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    throw new Error('Invalid AI filter JSON')
  }
}

function splitFilterColumn(column) {
  if (column.startsWith('candidates.')) {
    return { column: column.slice('candidates.'.length), foreignTable: 'candidates' }
  }

  return { column, foreignTable: null }
}

function applyBlankFilter(query, column, notBlank = false) {
  const { column: name, foreignTable } = splitFilterColumn(column)

  if (foreignTable) {
    return notBlank
      ? query.not(column, 'is', null).neq(column, '')
      : query.or(`${name}.is.null,${name}.eq.`, { foreignTable })
  }

  return notBlank
    ? query.not(column, 'is', null).neq(column, '')
    : query.or(`${column}.is.null,${column}.eq.`)
}

function applyAiCondition(query, condition) {
  const info = AI_FILTER_FIELD_MAP[condition.field]
  if (!info || !AI_FILTER_OPERATORS.includes(condition.operator)) return query

  const column = info.column
  const operator = condition.operator
  let value = condition.value

  if (operator === 'isBlank') return applyBlankFilter(query, column)
  if (operator === 'isNotBlank') return applyBlankFilter(query, column, true)

  if (info.type === 'number') {
    value = (info.normalize || normalizeNumber)(value)
    if (value === null) return query
    if (operator === 'gt') return query.gt(column, value)
    if (operator === 'lt') return query.lt(column, value)
    if (operator === 'gte') return query.gte(column, value)
    if (operator === 'lte') return query.lte(column, value)
    return operator === 'eq' ? query.eq(column, value) : query
  }

  if (info.type === 'boolean') {
    value = normalizeBoolean(value)
    return value === null || operator !== 'eq' ? query : query.eq(column, value)
  }

  if (info.type === 'date' || info.type === 'month') {
    value = cleanText(value)
    if (!value) return query
    if (operator === 'gt') return query.gt(column, value)
    if (operator === 'lt') return query.lt(column, value)
    if (operator === 'gte') return query.gte(column, value)
    if (operator === 'lte') return query.lte(column, value)
    return query.ilike(column, `${value}%`)
  }

  if (info.type === 'array') {
    const text = cleanText(value)
    return text ? query.contains(column, [text]) : query
  }

  value = info.normalize ? info.normalize(value) : cleanText(value)
  if (!value) return query
  if (operator === 'eq') return query.ilike(column, info.fuzzy ? `%${value}%` : value)
  return query.ilike(column, `%${value}%`)
}

function applyAiQueryFilters(query, filters) {
  if (!filters) return query
  if (Array.isArray(filters.filters)) {
    if (filters.logic === 'OR') return query
    return filters.filters.reduce((nextQuery, filter) => applyAiCondition(nextQuery, filter), query)
  }

  return query
}

async function resolveAiOrAssociationIds(filters) {
  if (!filters || filters.logic !== 'OR' || !Array.isArray(filters.filters) || !filters.filters.length) return null

  const ids = new Set()

  for (const filter of filters.filters) {
    const { data, error } = await applyAiCondition(
      supabase.from('candidate_associations').select('id, candidates!inner(id)'),
      filter
    ).limit(10000)

    if (error) throw error
    ;(data || []).forEach((row) => ids.add(row.id))
  }

  return [...ids]
}

async function insertAssociation(payload) {
  let result = await supabase
    .from('candidate_associations')
    .insert(payload)
    .select('*, candidates(*)')
    .single()

  if (isMissingAssociationConsultantColumn(result.error)) {
    result = await supabase
      .from('candidate_associations')
      .insert(withoutConsultantName(payload))
      .select('*, candidates(*)')
      .single()
  }

  return result
}

async function updateAssociation(associationId, payload) {
  let result = await supabase
    .from('candidate_associations')
    .update(payload)
    .eq('id', associationId)

  if (isMissingAssociationConsultantColumn(result.error)) {
    result = await supabase
      .from('candidate_associations')
      .update(withoutConsultantName(payload))
      .eq('id', associationId)
  }

  return result
}

async function listCandidates(req, res) {
  try {
    await ensureCandidateDisplayIds()

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const sort = normalizeSort(req.query)

    let query = supabase
      .from('candidate_associations')
      .select('*, candidates!inner(*)', { count: 'exact' })
      .order('candidate_id', { ascending: true })
      .order('created_at', { ascending: false })

    if (req.query.job_title) query = query.ilike('job_title', `%${cleanText(req.query.job_title)}%`)
    if (req.query.client_id) query = query.eq('client_id', req.query.client_id)
    if (req.query.client_name) query = query.ilike('client_name', `%${cleanText(req.query.client_name)}%`)

    if (req.query.status) {
      query = query.in(
        'status',
        String(req.query.status)
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      )
    }

    if (req.query.salary_min) query = query.gte('current_salary', Number(req.query.salary_min))
    if (req.query.salary_max) query = query.lte('current_salary', Number(req.query.salary_max))
    if (req.query.experience_min) query = query.gte('candidates.experience_years', Number(req.query.experience_min))
    if (req.query.experience_max) query = query.lte('candidates.experience_years', Number(req.query.experience_max))
    if (req.query.city) query = query.ilike('candidates.city', `%${cleanText(req.query.city)}%`)
    if (req.query.state) query = query.ilike('candidates.state', `%${cleanText(req.query.state)}%`)

    if (req.query.search) {
      const search = cleanText(req.query.search)
      const mobile = normalizeMobile(search)

      query = query.or(
        [
          `full_name.ilike.%${search}%`,
          `candidate_display_id.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `mobile_number.ilike.%${mobile || search}%`,
          `city.ilike.%${search}%`,
          `state.ilike.%${search}%`,
          `current_designation.ilike.%${search}%`,
          `current_organisation.ilike.%${search}%`
        ].join(','),
        { foreignTable: 'candidates' }
      )
    }

    let appliedFilters = null

    if (req.query.ai_filters) {
      appliedFilters = normalizeAiFilterOutput(parseJsonFilter(req.query.ai_filters))
      appliedFilters = correctNumericOperatorsFromPrompt(appliedFilters, req.query.ai_prompt || req.query.prompt || '')

      if (!appliedFilters?.filters?.length) {
        return res.status(400).json({ error: 'AI filter output was invalid' })
      }

      if (appliedFilters.logic === 'OR') {
        const ids = await resolveAiOrAssociationIds(appliedFilters)
        query = ids.length ? query.in('id', ids) : query.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        query = applyAiQueryFilters(query, appliedFilters)
      }

      console.log('candidateAiFilter appliedFilters:', JSON.stringify(appliedFilters))
    }

    const { data, error, count } = sort.field ? await query.limit(10000) : await query.range(from, to)

    if (error) throw error
    const rows = (data || []).map(flattenAssociation).map((row, index) => ({ ...row, _serial_no: index + 1 }))
    const sortedRows = sortCandidateRows(rows, sort)

    return res.json({
      data: sort.field ? sortedRows.slice(from, to + 1) : rows,
      total: count || 0,
      page,
      limit
    })
  } catch (err) {
    if (/Invalid AI|Missing AI/.test(err.message)) {
      return res.status(400).json({ error: err.message })
    }

    return logAndSendInternal(res, 'listCandidates', err)
  }
}

async function listCandidateAssociations(req, res) {
  try {
    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('candidate_id', req.params.candidateId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return res.json({ data: (data || []).map(flattenAssociation) })
  } catch (err) {
    return logAndSendInternal(res, 'listCandidateAssociations', err)
  }
}

async function getCandidate(req, res) {
  try {
    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Candidate association not found' })

    return res.json(flattenAssociation(data))
  } catch (err) {
    return logAndSendInternal(res, 'getCandidate', err)
  }
}

async function createCandidate(req, res) {
  try {
    const body = {
      ...req.body,
      status: req.body.status || '',
      source: req.body.source || 'manual'
    }

    const errors = validateCandidatePayload(body)

    if (Object.keys(errors).length) return res.status(400).json({ errors })

    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)
    const duplicateAction = req.body.duplicate_action
    const duplicate = await findCandidateDuplicate(candidatePayload.full_name, candidatePayload.email)

    if (duplicate && !['update_current', 'update_existing', 'add_duplicate'].includes(duplicateAction)) {
      return res.status(409).json({
        error: 'A candidate with the same name and email already exists.',
        duplicate: true,
        existing: duplicate
      })
    }

    const existingToUpdate = duplicateAction === 'update_existing' && req.body.existing_id
      ? { id: req.body.existing_id }
      : duplicate

    if (existingToUpdate && ['update_current', 'update_existing'].includes(duplicateAction)) {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) updatePayload.updated_by = req.user.id

      const { error } = await supabase
        .from('candidates')
        .update(updatePayload)
        .eq('id', existingToUpdate.id)

      if (error) throw error

      const { data: existingAssociation, error: assocLookupError } = await supabase
        .from('candidate_associations')
        .select('id')
        .eq('candidate_id', existingToUpdate.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (assocLookupError) throw assocLookupError

      if (existingAssociation?.id && Object.keys(associationPayload).length) {
        const { error: assocUpdateError } = await updateAssociation(existingAssociation.id, {
          ...associationPayload,
          updated_at: new Date().toISOString()
        })

        if (assocUpdateError) throw assocUpdateError
      }

      const { data, error: fetchError } = await supabase
        .from('candidate_associations')
        .select('*, candidates(*)')
        .eq('candidate_id', existingToUpdate.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (fetchError) throw fetchError
      if (data) return res.status(200).json(flattenAssociation(data))

      const { data: association, error: associationError } = await insertAssociation({
        ...associationPayload,
        candidate_id: existingToUpdate.id
      })

      if (associationError) throw associationError
      return res.status(200).json(flattenAssociation(association))
    }

    let candidate = duplicateAction === 'add_duplicate'
      ? null
      : await findCandidateByNameAndMobile(candidatePayload.full_name, candidatePayload.mobile_number)

    if (!candidate) {
      const insertPayload = { ...candidatePayload }

      if (req.user?.id) insertPayload.created_by = req.user.id

      const { data, error } = await supabase
        .from('candidates')
        .insert(insertPayload)
        .select('id')
        .single()

      if (error) throw error
      candidate = data
    }

    const assocInsert = {
      ...associationPayload,
      candidate_id: candidate.id
    }

    if (req.user?.id) assocInsert.created_by = req.user.id

    const { data: association, error: associationError } = await insertAssociation(assocInsert)

    if (associationError) throw associationError

    return res.status(201).json(flattenAssociation(association))
  } catch (err) {
    return logAndSendInternal(res, 'createCandidate', err)
  }
}

async function updateCandidate(req, res) {
  try {
    const errors = validateCandidatePayload(req.body, { partial: true })

    if (Object.keys(errors).length) return res.status(400).json({ errors })

    const associationId = req.body.association_id || req.params.id
    const candidatePayload = pickPayload(req.body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(req.body, ASSOCIATION_FIELDS)

    const { data: existing, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!existing) return res.status(404).json({ error: 'Candidate association not found' })

    if (Object.keys(candidatePayload).length) {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) updatePayload.updated_by = req.user.id

      const { error } = await supabase
        .from('candidates')
        .update(updatePayload)
        .eq('id', existing.candidate_id)

      if (error) throw error
    }

    if (Object.keys(associationPayload).length) {
      const assocUpdate = {
        ...associationPayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) assocUpdate.updated_by = req.user.id

      const { error } = await updateAssociation(associationId, assocUpdate)

      if (error) throw error
    }

    const { data, error } = await supabase
      .from('candidate_associations')
      .select('*, candidates(*)')
      .eq('id', associationId)
      .single()

    if (error) throw error

    return res.json(flattenAssociation(data))
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidate', err)
  }
}

async function updateCandidateStatus(req, res) {
  try {
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        errors: {
          status: `status must be one of: ${VALID_STATUSES.join(', ')}`
        }
      })
    }

    const updatePayload = {
      status: req.body.status || null,
      updated_at: new Date().toISOString()
    }

    if (req.user?.id) updatePayload.updated_by = req.user.id

    const { data, error } = await supabase
      .from('candidate_associations')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('id, status, updated_at')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Candidate association not found' })

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidateStatus', err)
  }
}

async function buildAiCandidateFilters(req, res) {
  try {
    const prompt = cleanText(req.body.prompt)
    if (!prompt) return res.status(400).json({ error: 'prompt is required' })

    const allowedFields = AI_FILTER_FIELDS
    console.log('candidateAiFilter userQuery:', prompt)
    console.log('candidateAiFilter allowedFields:', allowedFields)

    let parsed
    let aiRawResponse = ''

    try {
      const aiResult = await callAiJson({
        prompt: safeFilterPrompt(prompt, allowedFields.length ? allowedFields : AI_FILTER_FIELDS),
        schema: AI_FILTER_SCHEMA,
        temperature: 0,
        schemaName: 'candidate_filters',
        returnRaw: true
      })

      parsed = aiResult.parsed
      aiRawResponse = aiResult.rawText
    } catch (err) {
      if (/invalid json/i.test(err.message)) {
        return res.status(400).json({ error: 'AI returned invalid JSON. No filter was applied.' })
      }

      return res.status(err.statusCode || 502).json({ error: err.message })
    }

    console.log('candidateAiFilter aiRawResponse:', aiRawResponse)
    console.log('candidateAiFilter parsedFilters:', JSON.stringify(parsed))

    let filters = normalizeAiFilterOutput(parsed)
    filters = correctNumericOperatorsFromPrompt(filters, prompt)

    if (!filters?.filters?.length) {
      return res.status(400).json({ error: 'AI filter output was invalid' })
    }

    console.log('candidateAiFilter appliedFilters:', JSON.stringify(filters))

    let count = 0
    let error = null

    if (filters.logic === 'OR') {
      const ids = await resolveAiOrAssociationIds(filters)
      count = ids.length
    } else {
      const result = await applyAiQueryFilters(
        supabase
          .from('candidate_associations')
          .select('id, candidates!inner(id)', { count: 'exact', head: true }),
        filters
      )

      count = result.count
      error = result.error
    }

    if (error) throw error

    return res.json({ filters, matchedCount: count || 0 })
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    return logAndSendInternal(res, 'buildAiCandidateFilters', err)
  }
}

function storagePathFromResumeUrl(resumeUrl) {
  if (!resumeUrl) return null

  try {
    const parsed = new URL(resumeUrl)
    const marker = '/storage/v1/object/'
    const markerIndex = parsed.pathname.indexOf(marker)

    if (markerIndex === -1) return resumeUrl

    const objectPath = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length))
    return objectPath.replace(/^sign\/|^public\//, '')
  } catch {
    return resumeUrl
  }
}

async function deleteResumeFromStorage(resumeUrl) {
  const objectPath = storagePathFromResumeUrl(resumeUrl)
  if (!objectPath) return

  const [bucket, ...segments] = objectPath.split('/')

  if (!bucket || !segments.length) return

  const { error } = await supabase.storage.from(bucket).remove([segments.join('/')])

  if (error) console.error('deleteResumeFromStorage:', error.message)
}

async function deleteCandidate(req, res) {
  try {
    const { data: existing, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id, candidates(resume_url)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!existing) return res.status(404).json({ error: 'Candidate association not found' })

    const { error } = await supabase.from('candidate_associations').delete().eq('id', req.params.id)

    if (error) throw error

    const { count, error: countError } = await supabase
      .from('candidate_associations')
      .select('id', { count: 'exact', head: true })
      .eq('candidate_id', existing.candidate_id)

    if (countError) throw countError

    if (!count) {
      await supabase.from('candidates').delete().eq('id', existing.candidate_id)
      await deleteResumeFromStorage(existing.candidates?.resume_url)
    }

    return res.json({ message: 'Candidate association deleted' })
  } catch (err) {
    return logAndSendInternal(res, 'deleteCandidate', err)
  }
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function downloadPdfToTmp(resumeUrl) {
  const response = await axios.get(resumeUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  })

  const contentType = response.headers['content-type'] || ''
  const buffer = Buffer.from(response.data)
  const isPdf = contentType.toLowerCase().includes('application/pdf') || buffer.subarray(0, 4).toString() === '%PDF'

  if (!isPdf) {
    const error = new Error('URL does not point to a PDF')
    error.statusCode = 400
    throw error
  }

  const filePath = path.join('/tmp', `${uuidv4()}.pdf`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function parseResumeRoute(req, res) {
  let tmpFilePath = req.file?.path || null

  try {
    if (!tmpFilePath) {
      const resumeUrl = req.body.resume_url

      if (!resumeUrl || !isValidUrl(resumeUrl)) {
        return res.status(400).json({ error: 'A valid resume_url is required when no PDF file is uploaded' })
      }

      try {
        tmpFilePath = await downloadPdfToTmp(resumeUrl)
      } catch (err) {
        if (err.code === 'ECONNABORTED') return res.status(408).json({ error: 'URL fetch timed out' })
        if (err.statusCode === 400) return res.status(400).json({ error: err.message })
        throw err
      }
    }

    const parsed = await parseResume(tmpFilePath)
    return res.json(parsed)
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    console.error('parseResumeRoute:', err.message)
    return res.status(500).json({ error: 'Parsing failed', detail: err.message })
  } finally {
    if (tmpFilePath) {
      try {
        await fs.unlink(tmpFilePath)
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('parseResumeRoute cleanup:', err.message)
      }
    }
  }
}

module.exports = {
  VALID_STATUSES,
  checkCandidateDuplicate,
  getNextCandidateDisplayId,
  listCandidates,
  listCandidateAssociations,
  getCandidate,
  createCandidate,
  updateCandidate,
  updateCandidateStatus,
  buildAiCandidateFilters,
  deleteCandidate,
  parseResumeRoute
}
