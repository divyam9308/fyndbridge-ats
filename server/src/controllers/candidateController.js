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
  'equals',
  'contains',
  'startsWith',
  'endsWith',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'blank',
  'notBlank'
]

const AI_FILTER_FIELD_MAP = {
  candidate_id: { column: 'candidates.candidate_display_id', type: 'text' },
  candidateDisplayId: { column: 'candidates.candidate_display_id', type: 'text' },
  name: { column: 'candidates.full_name', type: 'text' },
  full_name: { column: 'candidates.full_name', type: 'text' },
  candidate: { column: 'candidates.full_name', type: 'text' },
  email: { column: 'candidates.email', type: 'text' },
  mobile: { column: 'candidates.mobile_number', type: 'text', normalize: normalizeMobile },
  phone: { column: 'candidates.mobile_number', type: 'text', normalize: normalizeMobile },
  contact_number: { column: 'candidates.mobile_number', type: 'text', normalize: normalizeMobile },
  city: { column: 'candidates.city', type: 'text' },
  location: { column: 'candidates.location', type: 'text' },
  state: { column: 'candidates.state', type: 'text' },
  designation: { column: 'candidates.current_designation', type: 'text', fuzzy: true },
  currentDesignation: { column: 'candidates.current_designation', type: 'text', fuzzy: true },
  current_designation: { column: 'candidates.current_designation', type: 'text', fuzzy: true },
  current_role: { column: 'candidates.current_designation', type: 'text', fuzzy: true },
  company: { column: 'candidates.current_organisation', type: 'text' },
  organisation: { column: 'candidates.current_organisation', type: 'text' },
  organization: { column: 'candidates.current_organisation', type: 'text' },
  current_organisation: { column: 'candidates.current_organisation', type: 'text' },
  current_organization: { column: 'candidates.current_organisation', type: 'text' },
  experience: { column: 'candidates.experience_years', type: 'number' },
  years: { column: 'candidates.experience_years', type: 'number' },
  notice: { column: 'candidates.notice_period', type: 'number' },
  notice_period: { column: 'candidates.notice_period', type: 'number' },
  noticePeriod: { column: 'candidates.notice_period', type: 'number' },
  relocation: { column: 'candidates.open_to_relocate', type: 'boolean' },
  relocate: { column: 'candidates.open_to_relocate', type: 'boolean' },
  open_to_relocate: { column: 'candidates.open_to_relocate', type: 'boolean' },
  openToRelocate: { column: 'candidates.open_to_relocate', type: 'boolean' },
  salary: { column: 'current_salary', type: 'number', normalize: normalizeMoney },
  ctc: { column: 'current_salary', type: 'number', normalize: normalizeMoney },
  current_salary: { column: 'current_salary', type: 'number', normalize: normalizeMoney },
  expected_salary: { column: 'expected_salary', type: 'number', normalize: normalizeMoney },
  expectedSalary: { column: 'expected_salary', type: 'number', normalize: normalizeMoney },
  consultant: { column: 'consultant_name', type: 'text' },
  consultant_name: { column: 'consultant_name', type: 'text' },
  recruiter: { column: 'consultant_name', type: 'text' },
  client: { column: 'client_name', type: 'text' },
  client_name: { column: 'client_name', type: 'text' },
  job: { column: 'job_title', type: 'text', fuzzy: true },
  role: { column: 'job_title', type: 'text', fuzzy: true },
  position: { column: 'job_title', type: 'text', fuzzy: true },
  job_title: { column: 'job_title', type: 'text', fuzzy: true },
  status: { column: 'status', type: 'text' },
  stage: { column: 'status', type: 'text' },
  education: { column: 'candidates.education', type: 'text' },
  skills: { column: 'candidates.skills', type: 'array' },
  technology: { column: 'candidates.skills', type: 'array' },
  cv_link: { column: 'candidates.cv_link', type: 'text' },
  linkedin: { column: 'candidates.linkedin_url', type: 'text' },
  notes: { column: 'notes', type: 'text' },
  comments: { column: 'notes', type: 'text' },
  date: { column: 'created_at', type: 'date' },
  month: { column: 'created_at', type: 'month' }
}

const AI_FILTER_FIELDS = Object.keys(AI_FILTER_FIELD_MAP)

const AI_FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conditions: {
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

function normalizeDuplicateText(value) {
  return cleanText(value).toLowerCase()
}

function displayIdNumber(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

async function ensureCandidateDisplayIds() {
  // Query ALL candidates directly (not just those with associations)
  // so every candidate gets a display ID, not just ones with associations.
  const { data, error } = await supabase
    .from('candidates')
    .select('id, candidate_display_id')
    .order('created_at', { ascending: true })
    .limit(10000)

  if (error) throw error

  const candidates = data || []

  if (!candidates.some((candidate) => !cleanText(candidate.candidate_display_id))) return

  // Find the highest existing numeric ID so we don't collide
  const existingIds = new Set(
    candidates
      .map((candidate) => candidate.candidate_display_id)
      .filter(Boolean)
  )

  let next = Math.max(0, ...candidates.map((candidate) => displayIdNumber(candidate.candidate_display_id, 'CA')).filter((number) => number < Number.MAX_SAFE_INTEGER)) + 1

  for (const candidate of candidates.filter((item) => !cleanText(item.candidate_display_id))) {
    // Find the next truly unused ID (skip any that are already taken)
    while (existingIds.has(`CA${next}`)) {
      next++
    }
    const displayId = `CA${next}`
    existingIds.add(displayId)
    next++
    const { error: updateError } = await supabase
      .from('candidates')
      .update({ candidate_display_id: displayId })
      .eq('id', candidate.id)
    if (updateError) throw updateError
  }
}

async function nextCandidateDisplayId() {
  await ensureCandidateDisplayIds()
  const { data, error } = await supabase.from('candidates').select('candidate_display_id')
  if (error) throw error
  
  const existingIds = new Set(
    (data || [])
      .map((candidate) => candidate.candidate_display_id)
      .filter(Boolean)
  )

  let nextNum = 1
  while (existingIds.has(`CA${nextNum}`)) {
    nextNum++
  }
  return `CA${nextNum}`
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

function normalizeAiField(value) {
  const text = cleanText(value)
  return text ? text : null
}

function normalizeAiRange(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const min = value.min === null || value.min === undefined || value.min === '' ? null : Number(value.min)
  const max = value.max === null || value.max === undefined || value.max === '' ? null : Number(value.max)

  if (min !== null && !Number.isFinite(min)) {
    return null
  }

  if (max !== null && !Number.isFinite(max)) {
    return null
  }

  return {
    min: min === null ? null : min,
    max: max === null ? null : max
  }
}

function normalizeAiFilterOutput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }

  if (Array.isArray(data.conditions)) {
    const conditions = data.conditions
      .map((condition) => {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null
        const field = cleanText(condition.field)
        const mapped = AI_FILTER_FIELD_MAP[field]
        const operator = cleanText(condition.operator)
        if (!mapped || !AI_FILTER_OPERATORS.includes(operator)) return null
        let value = condition.value
        if (operator === 'blank' || operator === 'notBlank') value = null
        else if (mapped.type === 'number') value = (mapped.normalize || normalizeNumber)(value)
        else if (mapped.type === 'boolean') value = normalizeBoolean(value)
        else value = cleanText(value)
        if (!['blank', 'notBlank'].includes(operator) && (value === null || value === '')) return null
        return { field, operator, value }
      })
      .filter(Boolean)
    const seen = new Set()
    const unique = conditions.filter((condition) => {
      const key = `${AI_FILTER_FIELD_MAP[condition.field].column}|${condition.operator}|${condition.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 12)

    return { conditions: unique }
  }

  const skills = Array.isArray(data.skills)
    ? [...new Set(data.skills.map((skill) => cleanText(skill)).filter(Boolean))].slice(0, 12)
    : []

  return {
    name: normalizeAiField(data.name),
    city: normalizeAiField(data.city),
    state: normalizeAiField(data.state),
    currentDesignation: normalizeAiField(data.currentDesignation),
    email: normalizeAiField(data.email),
    mobile: normalizeAiField(data.mobile),
    experience: normalizeAiRange(data.experience),
    salary: normalizeAiRange(data.salary),
    consultant: normalizeAiField(data.consultant),
    client: normalizeAiField(data.client),
    job: normalizeAiField(data.job),
    clientMobile: normalizeAiField(data.clientMobile),
    status: normalizeAiField(data.status),
    skills,
    education: normalizeAiField(data.education)
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function explicitAiFiltersFromPrompt(prompt) {
  const text = cleanText(prompt)
  const aliases = {
    candidate_id: ['candidate id', 'id', 'display id', 'candidate_id', 'candidateDisplayId'],
    name: ['name', 'candidate', 'candidate name'],
    city: ['city', 'location'],
    state: ['state'],
    currentDesignation: ['designation', 'current designation', 'profile'],
    email: ['email', 'email id'],
    mobile: ['mobile', 'phone', 'mobile number'],
    consultant: ['consultant', 'consultant name', 'recruiter'],
    client: ['client', 'client name'],
    job: ['job', 'role', 'position'],
    clientMobile: ['client mobile', 'client phone'],
    status: ['status'],
    education: ['education']
  }

  return Object.entries(aliases).reduce((filters, [field, names]) => {
    const match = names
      .map((name) => text.match(new RegExp(`(?:^|\\b)${escapeRegExp(name)}\\s*(?:=|:|is|contains)\\s*([^,;]+)`, 'i')))
      .find(Boolean)
    const value = match ? cleanText(match[1]).replace(/^['"]|['"]$/g, '') : null
    if (value) filters[field] = value
    return filters
  }, {})
}

function explicitAiConditionsFromPrompt(prompt) {
  const text = cleanText(prompt)
  const normalized = normalizeSearchText(prompt)
  const conditions = []
  const aliases = Object.entries(AI_FILTER_FIELD_MAP)
    .filter(([field]) => !field.includes('_') || ['full_name', 'current_designation', 'current_organisation', 'current_salary', 'expected_salary', 'consultant_name', 'client_name', 'job_title'].includes(field))
    .map(([field]) => field)

  const idMatch = text.match(/\b(CA\d+)\b/i)
  if (idMatch) {
    conditions.push({ field: 'candidate_id', operator: 'equals', value: idMatch[1].toUpperCase() })
  }

  text.split(/\s*,\s*|\s+and\s+/i).forEach((part) => {
    for (const field of aliases) {
      const label = field.replace(/_/g, ' ')
      const match = part.match(new RegExp(`(?:^|\\b)${escapeRegExp(label)}\\s*(=|:|is|contains|starts with|ends with|above|over|more than|greater than|below|under|less than)\\s*(.+)$`, 'i'))
      if (!match) continue
      const rawOperator = match[1].toLowerCase()
      const rawValue = cleanText(match[2]).replace(/^['"]|['"]$/g, '')
      const operator = rawOperator === '=' || rawOperator === ':' || rawOperator === 'is'
        ? (/^(blank|null|empty)$/i.test(rawValue) ? 'blank' : (AI_FILTER_FIELD_MAP[field]?.fuzzy ? 'contains' : 'equals'))
        : rawOperator === 'contains'
          ? 'contains'
          : rawOperator === 'starts with'
            ? 'startsWith'
            : rawOperator === 'ends with'
              ? 'endsWith'
              : /above|over|more than|greater than/.test(rawOperator)
                ? 'greaterThanOrEqual'
                : 'lessThanOrEqual'
      conditions.push({ field, operator, value: operator === 'blank' ? null : rawValue })
      break
    }
  })

  if (/\bclient\s+(?:is\s+)?(?:blank|null|empty)\b/i.test(text)) {
    conditions.push({ field: 'client', operator: 'blank', value: null })
  }
  if (/\bnot\s+blank\b/i.test(text)) {
    const field = aliases.find((item) => new RegExp(`\\b${escapeRegExp(item.replace(/_/g, ' '))}\\b`, 'i').test(text))
    if (field) conditions.push({ field, operator: 'notBlank', value: null })
  }
  if (/\b(open to relocate|relocation\s+(?:yes|true)|relocate\s+(?:yes|true)|willing to relocate)\b/i.test(text)) {
    conditions.push({ field: 'relocation', operator: 'equals', value: true })
  }
  if (/\b(not open to relocate|relocation\s+(?:no|false)|relocate\s+(?:no|false)|not willing to relocate)\b/i.test(text)) {
    conditions.push({ field: 'relocation', operator: 'equals', value: false })
  }
  if (/\b(?:experience|years?|yrs?)\b/i.test(text) && /\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i.test(text)) {
    const value = Number(text.match(/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i)[1])
    const operator = /\b(below|under|less than|max|maximum)\b/i.test(text)
      ? 'lessThanOrEqual'
      : /\+|\b(more than|above|over|greater than|min|minimum)\b/i.test(text)
        ? 'greaterThanOrEqual'
        : 'equals'
    conditions.push({ field: 'experience', operator, value })
  }
  if (/\bsalary|ctc|lpa|lakhs?\b/i.test(text) && /\b(below|under|less than|max|maximum|above|over|more than|greater than|min|minimum)\b/i.test(text)) {
    const value = cleanText((text.match(/\d+(?:\.\d+)?\s*(?:lpa|lac|lakh|lakhs|cr|crore|crores)?|[1-9]\d{4,}/i) || [])[0])
    if (value) {
      conditions.push({
        field: 'salary',
        operator: /\b(below|under|less than|max|maximum)\b/i.test(text) ? 'lessThanOrEqual' : 'greaterThanOrEqual',
        value
      })
    }
  }
  const city = [
    'bengaluru',
    'bangalore',
    'mumbai',
    'delhi',
    'hyderabad',
    'chennai',
    'pune',
    'kolkata',
    'kochi',
    'noida',
    'gurgaon',
    'gurugram'
  ].find((item) => new RegExp(`\\b${escapeRegExp(item)}\\b`, 'i').test(normalized))
  if (city && !conditions.some((condition) => ['city', 'location'].includes(condition.field))) {
    conditions.push({ field: 'city', operator: 'contains', value: city === 'bangalore' ? 'Bengaluru' : city })
  }
  const technology = ['react', 'angular', 'vue', 'node', 'java', 'python', 'sql', 'excel', 'salesforce', 'aws', 'azure'].find((item) => new RegExp(`\\b${escapeRegExp(item)}\\b`, 'i').test(normalized))
  if (technology && !conditions.some((condition) => condition.field === 'skills')) {
    conditions.push({ field: 'skills', operator: 'contains', value: technology })
  }
  if (/\bsales\b/i.test(normalized) && !conditions.some((condition) => ['designation', 'job', 'role'].includes(condition.field))) {
    conditions.push({ field: 'designation', operator: 'contains', value: 'sales' })
  }
  const status = VALID_STATUSES.find((item) => new RegExp(`\\b${escapeRegExp(item)}\\b`, 'i').test(text))
  if (status) conditions.push({ field: 'status', operator: 'equals', value: status })

  return normalizeAiFilterOutput({ conditions })?.conditions || []
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
    'Return exactly: {"conditions":[{"field":"fieldName","operator":"operator","value":"value or null"}]}.',
    'Use greaterThanOrEqual for phrases like 3+ years. Convert salary like 8 LPA to 800000. Use blank for blank/null/empty.',
    'For technology words like React, Java, Python, use field skills with contains.',
    'For interested/interview/hired/client submission phrases, use field status.',
    'Do not include SQL, code, markdown, explanations, or fields not listed.',
    `Request: ${cleanText(prompt).slice(0, 1000)}`
  ].join('\n\n')
}

function localAiFilterFallback(prompt) {
  const normalized = normalizeSearchText(prompt)
  const filters = normalizeAiFilterOutput(explicitAiFiltersFromPrompt(prompt))
  const roleIntent = /\b(role|designation|job|profile|position|engineer|developer|manager|analyst)\b/.test(normalized)

  const idMatch = normalized.match(/\b(ca\d+)\b/i)
  if (idMatch) {
    filters.candidate_id = idMatch[1].toUpperCase()
  }

  if (/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/.test(normalized)) {
    const value = Number(normalized.match(/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/)[1])
    filters.experience = /less than|below|under|max|maximum/.test(normalized)
      ? { min: null, max: value }
      : { min: value, max: null }
  }

  if (/\b(back ?end|bakend|backend)\b/.test(normalized)) {
    if (!filters.currentDesignation) filters.currentDesignation = 'backend engineer'
  } else if (/\b(front ?end|fronend|frntend|react|angular|vue)\b/.test(normalized)) {
    if (!filters.currentDesignation) filters.currentDesignation = 'frontend engineer'
  } else if (/\b(software|sftware|softwar)\b/.test(normalized)) {
    if (!filters.currentDesignation) filters.currentDesignation = 'software engineer'
  } else if (/\b(database|data ?base|dba|postgres|mysql|mongodb)\b/.test(normalized)) {
    if (!filters.currentDesignation) filters.currentDesignation = 'database engineer'
  } else if (/\b(data analyst|data engineer|analytics)\b/.test(normalized) || (roleIntent && /\bdata\b/.test(normalized))) {
    if (!filters.currentDesignation) filters.currentDesignation = 'data'
  } else if (/\b(devops|dev ops|kubernetes|docker|cloud)\b/.test(normalized)) {
    if (!filters.currentDesignation) filters.currentDesignation = 'devops engineer'
  } else if (/\b(product manager|product owner|pm)\b/.test(normalized) || (roleIntent && /\bproduct\b/.test(normalized))) {
    if (!filters.currentDesignation) filters.currentDesignation = 'product'
  }

  const city = [
    'bengaluru',
    'bangalore',
    'mumbai',
    'delhi',
    'hyderabad',
    'chennai',
    'pune',
    'kolkata',
    'kochi'
  ].find((item) => normalized.includes(item))

  if (city) {
    if (!filters.city) filters.city = city === 'bangalore' ? 'Bengaluru' : city
  }

  const status = VALID_STATUSES.find((item) => normalized.includes(item.toLowerCase()))
  if (status) {
    if (!filters.status) filters.status = status
  }

  return filters
}

function includesText(source, needle) {
  const haystack = cleanText(source).toLowerCase()
  const query = cleanText(needle).toLowerCase()
  if (!query) {
    return true
  }

  return haystack.includes(query)
}

const ROLE_KEYWORD_GROUPS = {
  software: [
    'software engineer',
    'software developer',
    'backend engineer',
    'backend developer',
    'frontend engineer',
    'frontend developer',
    'full stack',
    'devops',
    'database',
    'data engineer',
    'programmer',
    'react',
    'node',
    'java',
    'sql'
  ],
  backend: ['backend', 'back end', 'server', 'api', 'node', 'node.js', 'express', 'django'],
  frontend: ['frontend', 'front end', 'react', 'angular', 'vue', 'ui developer', 'web developer', 'javascript'],
  database: ['database', 'sql', 'postgres', 'mysql', 'mongodb', 'dba', 'data engineer'],
  data: ['data analyst', 'data engineer', 'analytics', 'python', 'sql', 'statistics'],
  devops: ['devops', 'cloud', 'aws', 'azure', 'kubernetes', 'docker', 'ci/cd'],
  product: ['product manager', 'product owner', 'pm']
}

const GENERIC_ROLE_WORDS = new Set(['engineer', 'developer', 'manager', 'lead', 'senior', 'junior', 'software'])

function normalizeSearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function searchTermsForQuery(query) {
  const normalized = normalizeSearchText(query)
  if (!normalized) {
    return []
  }

  const terms = new Set([normalized])
  Object.entries(ROLE_KEYWORD_GROUPS).forEach(([key, values]) => {
    const groupHit = key === 'software'
      ? /\b(software|sftware|softwar|programmer|developers?)\b/.test(normalized)
      : normalized.includes(key) || values.some((value) => normalized.includes(normalizeSearchText(value)))
    if (groupHit) {
      values.forEach((value) => terms.add(normalizeSearchText(value)))
    }
  })

  normalized
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !GENERIC_ROLE_WORDS.has(word))
    .forEach((word) => terms.add(word))

  return [...terms].filter(Boolean)
}

function roleTermMatches(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryPattern = escaped.replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${boundaryPattern}([^a-z0-9]|$)`, 'i').test(haystack)
}

function matchesRoleText(candidate, query) {
  const haystack = normalizeSearchText([
    candidate.current_designation,
    candidate.job_title,
    Array.isArray(candidate.skills) ? candidate.skills.join(' ') : ''
  ].filter(Boolean).join(' '))
  const terms = searchTermsForQuery(query)

  if (!terms.length) {
    return true
  }

  return terms.some((term) => roleTermMatches(haystack, term))
}

function matchesAiFilters(candidate, filters) {
  if (!filters) {
    return true
  }

  if (filters.name && !includesText(candidate.full_name, filters.name)) return false
  if (filters.city && !includesText(candidate.city, filters.city)) return false
  if (filters.state && !includesText(candidate.state, filters.state)) return false
  if (filters.currentDesignation && !matchesRoleText(candidate, filters.currentDesignation)) return false
  if (filters.email && !includesText(candidate.email, filters.email)) return false
  if (filters.mobile && !includesText(candidate.mobile_number, filters.mobile)) return false
  if (filters.consultant && !includesText(candidate.consultant_name, filters.consultant)) return false
  if (filters.client && !includesText(candidate.client_name, filters.client)) return false
  if (filters.job && !matchesRoleText(candidate, filters.job)) return false
  if (filters.clientMobile && !includesText(candidate.client_phone_number, filters.clientMobile)) return false
  if (filters.status && !includesText(candidate.status, filters.status)) return false
  if (filters.education && !includesText(candidate.education, filters.education)) return false

  if (filters.skills.length) {
    const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills.map((skill) => cleanText(skill).toLowerCase()) : []
    const matches = filters.skills.every((skill) => candidateSkills.some((candidateSkill) => candidateSkill.includes(cleanText(skill).toLowerCase())))
    if (!matches) return false
  }

  if (filters.experience) {
    const exp = candidate.experience_years === null || candidate.experience_years === undefined ? null : Number(candidate.experience_years)
    if (filters.experience.min !== null && (exp === null || exp < filters.experience.min)) return false
    if (filters.experience.max !== null && (exp === null || exp > filters.experience.max)) return false
  }

  if (filters.salary) {
    const salary = candidate.current_salary === null || candidate.current_salary === undefined ? null : Number(candidate.current_salary)
    if (filters.salary.min !== null && (salary === null || salary < filters.salary.min)) return false
    if (filters.salary.max !== null && (salary === null || salary > filters.salary.max)) return false
  }

  return true
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

  // Allow '-' as a sentinel meaning "no status selected yet" (not just '' and null)
  if (body.status !== undefined && body.status !== null && body.status !== '' && body.status !== '-' && !VALID_STATUSES.includes(body.status)) {
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

  if (payload.full_name) {
    payload.full_name = normalizeMatchValue(payload.full_name)
  }

  if (payload.mobile_number) {
    payload.mobile_number = normalizeMobile(payload.mobile_number)
  }

  for (const field of ['experience_years', 'notice_period', 'current_salary', 'expected_salary']) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = Number(payload[field])
    }
  }

  return payload
}

async function findCandidateByNameAndMobile(fullName, mobileNumber) {
  const name = normalizeMatchValue(fullName)
  const mobile = normalizeMobile(mobileNumber)

  if (!name || !mobile) {
    return null
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .ilike('full_name', name)
    .eq('mobile_number', mobile)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
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
    open_to_relocate: Boolean(candidate.open_to_relocate),
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: row.client_id || candidate.client_id || null,
    client_name: row.client_name || null,
    job_title: row.job_title || null,
    consultant_name: row.consultant_name || null,
    status: row.status || '-',
    current_salary: row.current_salary || null,
    expected_salary: row.expected_salary || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function flattenCandidateOnly(candidate) {
  return {
    id: candidate.id,
    association_id: null,
    candidate_id: candidate.id,
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
    open_to_relocate: Boolean(candidate.open_to_relocate),
    skills: candidate.skills || [],
    education: candidate.education || null,
    cv_link: candidate.cv_link || candidate.resume_url || null,
    linkedin_url: candidate.linkedin_url || null,
    resume_url: candidate.resume_url || null,
    client_id: candidate.client_id || null,
    client_name: null,
    job_title: null,
    consultant_name: null,
    status: '-',
    current_salary: null,
    expected_salary: null,
    notes: null,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at
  }
}

function adjustColumnForPrimaryCandidates(column) {
  if (column.startsWith('candidates.')) {
    return column.slice('candidates.'.length)
  }
  if (column === 'created_at' || column === 'updated_at') {
    return column
  }
  return `candidate_associations.${column}`
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
  if (!value) {
    return null
  }

  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return null
  }
}

function splitFilterColumn(column) {
  if (column.startsWith('candidate_associations.')) {
    return { column: column.slice('candidate_associations.'.length), foreignTable: 'candidate_associations' }
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

  const column = adjustColumnForPrimaryCandidates(info.column)
  const operator = condition.operator
  let value = condition.value

  if (operator === 'blank') return applyBlankFilter(query, column)
  if (operator === 'notBlank') return applyBlankFilter(query, column, true)

  if (info.type === 'number') {
    value = (info.normalize || normalizeNumber)(value)
    if (value === null) return query
    if (operator === 'greaterThan') return query.gt(column, value)
    if (operator === 'lessThan') return query.lt(column, value)
    if (operator === 'greaterThanOrEqual') return query.gte(column, value)
    if (operator === 'lessThanOrEqual') return query.lte(column, value)
    return query.eq(column, value)
  }

  if (info.type === 'boolean') {
    value = normalizeBoolean(value)
    return value === null ? query : query.eq(column, value)
  }

  if (info.type === 'date' || info.type === 'month') {
    value = cleanText(value)
    if (!value) return query
    if (info.type === 'month') {
      const month = new Date(`${value} 1, 2026`).getMonth()
      if (!Number.isFinite(month) || month < 0) return query
      const year = new Date().getFullYear()
      const start = new Date(Date.UTC(year, month, 1)).toISOString()
      const end = new Date(Date.UTC(year, month + 1, 1)).toISOString()
      return query.gte(column, start).lt(column, end)
    }
    if (operator === 'greaterThan') return query.gt(column, value)
    if (operator === 'lessThan') return query.lt(column, value)
    if (operator === 'greaterThanOrEqual') return query.gte(column, value)
    if (operator === 'lessThanOrEqual') return query.lte(column, value)
    return query.ilike(column, `${value}%`)
  }

  if (info.type === 'array') {
    const text = cleanText(value)
    return text ? query.contains(column, [text]) : query
  }

  value = info.normalize ? info.normalize(value) : cleanText(value)
  if (!value) return query
  if (operator === 'equals') return query.ilike(column, info.fuzzy ? `%${value}%` : value)
  if (operator === 'startsWith') return query.ilike(column, `${value}%`)
  if (operator === 'endsWith') return query.ilike(column, `%${value}`)
  return query.ilike(column, `%${value}%`)
}

function applyAiQueryFilters(query, filters) {
  if (!filters) {
    return query
  }

  if (Array.isArray(filters.conditions)) {
    return filters.conditions.reduce((nextQuery, condition) => applyAiCondition(nextQuery, condition), query)
  }

  if (filters.candidate_id) query = query.ilike('candidate_display_id', `%${cleanText(filters.candidate_id)}%`)
  if (filters.name) query = query.ilike('full_name', `%${cleanText(filters.name)}%`)
  if (filters.city) query = query.ilike('city', `%${cleanText(filters.city)}%`)
  if (filters.state) query = query.ilike('state', `%${cleanText(filters.state)}%`)
  if (filters.currentDesignation) query = query.ilike('current_designation', `%${cleanText(filters.currentDesignation)}%`)
  if (filters.email) query = query.ilike('email', `%${cleanText(filters.email)}%`)
  if (filters.mobile) query = query.ilike('mobile_number', `%${normalizeMobile(filters.mobile)}%`)
  if (filters.consultant) query = query.ilike('candidate_associations.consultant_name', `%${cleanText(filters.consultant)}%`)
  if (filters.client) query = query.ilike('candidate_associations.client_name', `%${cleanText(filters.client)}%`)
  if (filters.job) query = query.ilike('candidate_associations.job_title', `%${cleanText(filters.job)}%`)
  if (filters.status) query = query.ilike('candidate_associations.status', `%${cleanText(filters.status)}%`)
  if (filters.education) query = query.ilike('education', `%${cleanText(filters.education)}%`)
  if (Array.isArray(filters.skills) && filters.skills.length) {
    query = query.contains('skills', filters.skills.map(cleanText).filter(Boolean))
  }

  if (filters.experience) {
    if (filters.experience.min !== null && filters.experience.min !== undefined) {
      query = query.gte('experience_years', Number(filters.experience.min))
    }
    if (filters.experience.max !== null && filters.experience.max !== undefined) {
      query = query.lte('experience_years', Number(filters.experience.max))
    }
  }

  if (filters.salary) {
    if (filters.salary.min !== null && filters.salary.min !== undefined) {
      query = query.gte('candidate_associations.current_salary', Number(filters.salary.min))
    }
    if (filters.salary.max !== null && filters.salary.max !== undefined) {
      query = query.lte('candidate_associations.current_salary', Number(filters.salary.max))
    }
  }

  return query
}

async function insertAssociation(payload) {
  const nextPayload = { ...payload }
  nextPayload.status =
    typeof nextPayload.status === 'string' && nextPayload.status.trim()
      ? nextPayload.status.trim()
      : '-';

  console.log('[insertAssociation] Final payload before insert:', JSON.stringify(nextPayload))

  let result = await supabase
    .from('candidate_associations')
    .insert(nextPayload)
    .select('*, candidates(*)')
    .single()

  if (isMissingAssociationConsultantColumn(result.error)) {
    result = await supabase
      .from('candidate_associations')
      .insert(withoutConsultantName(nextPayload))
      .select('*, candidates(*)')
      .single()
  }

  return result
}

async function updateAssociation(associationId, payload) {
  const nextPayload = { ...payload }
  if (Object.prototype.hasOwnProperty.call(nextPayload, 'status')) {
    nextPayload.status =
      typeof nextPayload.status === 'string' && nextPayload.status.trim()
        ? nextPayload.status.trim()
        : '-';
  }

  console.log('[updateAssociation] Final payload before update:', JSON.stringify(nextPayload))

  let result = await supabase
    .from('candidate_associations')
    .update(nextPayload)
    .eq('id', associationId)

  if (isMissingAssociationConsultantColumn(result.error)) {
    result = await supabase
      .from('candidate_associations')
      .update(withoutConsultantName(nextPayload))
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

    const hasAssocFilters = req.query.job_title || 
                            req.query.client_name || 
                            req.query.status || 
                            req.query.salary_min || 
                            req.query.salary_max || 
                            (req.query.ai_filters && (
                              req.query.ai_filters.includes('job') ||
                              req.query.ai_filters.includes('client') ||
                              req.query.ai_filters.includes('status') ||
                              req.query.ai_filters.includes('salary') ||
                              req.query.ai_filters.includes('consultant')
                            ));

    let relationSelect = 'candidate_associations(*)'
    if (hasAssocFilters) {
      relationSelect = 'candidate_associations!inner(*)'
    }

    let query = supabase
      .from('candidates')
      .select(`*, ${relationSelect}`, { count: 'exact' })

    if (req.query.sortField === 'candidate_id') {
      query = query.order('candidate_display_id', { ascending: req.query.sortDirection !== 'desc' })
    } else if (req.query.sortField === 'candidate_name') {
      query = query.order('full_name', { ascending: req.query.sortDirection !== 'desc' })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (req.query.job_title) {
      query = query.ilike('candidate_associations.job_title', `%${cleanText(req.query.job_title)}%`)
    }

    if (req.query.client_name) {
      query = query.ilike('candidate_associations.client_name', `%${cleanText(req.query.client_name)}%`)
    }

    if (req.query.status) {
      query = query.in(
        'candidate_associations.status',
        String(req.query.status)
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      )
    }

    if (req.query.salary_min) {
      query = query.gte('candidate_associations.current_salary', Number(req.query.salary_min))
    }

    if (req.query.salary_max) {
      query = query.lte('candidate_associations.current_salary', Number(req.query.salary_max))
    }

    if (req.query.experience_min) {
      query = query.gte('experience_years', Number(req.query.experience_min))
    }

    if (req.query.experience_max) {
      query = query.lte('experience_years', Number(req.query.experience_max))
    }

    if (req.query.city) {
      query = query.ilike('city', `%${cleanText(req.query.city)}%`)
    }

    if (req.query.state) {
      query = query.ilike('state', `%${cleanText(req.query.state)}%`)
    }

    if (req.query.search) {
      const search = cleanText(req.query.search)
      const mobile = normalizeMobile(search)
      query = query.or(
        [
          `full_name.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `mobile_number.ilike.%${mobile || search}%`,
          `city.ilike.%${search}%`,
          `state.ilike.%${search}%`,
          `current_designation.ilike.%${search}%`,
          `current_organisation.ilike.%${search}%`
        ].join(',')
      )
    }

    query = applyAiQueryFilters(query, parseJsonFilter(req.query.ai_filters))

    const { data, error, count } = await query.range(from, to)

    if (error) {
      throw error
    }

    const flattened = []
    for (const candidate of data || []) {
      const associations = candidate.candidate_associations || []
      if (associations.length === 0) {
        flattened.push(flattenCandidateOnly(candidate))
      } else {
        for (const assoc of associations) {
          flattened.push(flattenAssociation({
            ...assoc,
            candidates: candidate
          }))
        }
      }
    }

    return res.json({
      data: flattened,
      total: count || 0,
      page,
      limit
    })
  } catch (err) {
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

    if (error) {
      throw error
    }

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

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    return res.json(flattenAssociation(data))
  } catch (err) {
    return logAndSendInternal(res, 'getCandidate', err)
  }
}

async function createCandidate(req, res) {
  try {
    const incomingStatus = req.body.status || req.body.candidateStatus || req.body.application_status || req.body.association_status;
    const body = {
      ...req.body,
      status: incomingStatus !== undefined ? incomingStatus : '',
      source: req.body.source || 'manual'
    }
    const errors = validateCandidatePayload(body)

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)

    associationPayload.status =
      typeof associationPayload.status === "string" && associationPayload.status.trim()
        ? associationPayload.status.trim()
        : "-";

    let candidate = await findCandidateByNameAndMobile(candidatePayload.full_name, candidatePayload.mobile_number)

    if (!candidate) {
      const insertPayload = {
        ...candidatePayload
      }

      if (req.user?.id) {
        insertPayload.created_by = req.user.id
      }

      const { data, error } = await supabase
        .from('candidates')
        .insert(insertPayload)
        .select('*')
        .single()

      if (error) {
        throw error
      }

      candidate = data

      const correctDisplayId = await nextCandidateDisplayId()
      const { error: updateError } = await supabase
        .from('candidates')
        .update({ candidate_display_id: correctDisplayId })
        .eq('id', candidate.id)

      if (updateError) {
        throw updateError
      }
      candidate.candidate_display_id = correctDisplayId
    } else {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', candidate.id)
        .single()

      if (error) {
        throw error
      }

      candidate = data
    }

    const hasClient = (associationPayload.client_name && associationPayload.client_name !== '-') || associationPayload.client_id;
    const hasJob = (associationPayload.job_title && associationPayload.job_title !== '-') || associationPayload.job_id;
    const hasAssociation = hasClient || hasJob;

    if (!hasAssociation) {
      return res.status(201).json(flattenCandidateOnly(candidate))
    }

    const assocInsert = {
      ...associationPayload,
      candidate_id: candidate.id
    }

    if (req.user?.id) {
      assocInsert.created_by = req.user.id
    }

    console.log('[createCandidate] Final candidate_associations insert payload:', JSON.stringify(assocInsert))

    const { data: association, error: associationError } = await insertAssociation(assocInsert)

    if (associationError) {
      throw associationError
    }

    return res.status(201).json(flattenAssociation(association))
  } catch (err) {
    return logAndSendInternal(res, 'createCandidate', err)
  }
}

async function updateCandidate(req, res) {
  try {
    const incomingStatus = req.body.status || req.body.candidateStatus || req.body.application_status || req.body.association_status;
    const body = {
      ...req.body
    }
    if (incomingStatus !== undefined) {
      body.status = incomingStatus;
    }

    const errors = validateCandidatePayload(body, { partial: true })

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors })
    }

    const associationId = body.association_id || req.params.id
    const candidatePayload = pickPayload(body, CANDIDATE_FIELDS)
    const associationPayload = pickPayload(body, ASSOCIATION_FIELDS)

    if (Object.prototype.hasOwnProperty.call(associationPayload, 'status')) {
      associationPayload.status =
        typeof associationPayload.status === 'string' && associationPayload.status.trim()
          ? associationPayload.status.trim()
          : '-';
    }

    let existingCandidateId = null
    let existingAssociation = null

    const { data: existingAssoc, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (existingAssoc) {
      existingAssociation = existingAssoc
      existingCandidateId = existingAssoc.candidate_id
    } else {
      const { data: existingCand, error: candLookupError } = await supabase
        .from('candidates')
        .select('id')
        .eq('id', associationId)
        .maybeSingle()

      if (candLookupError) {
        throw candLookupError
      }
      if (existingCand) {
        existingCandidateId = existingCand.id
      }
    }

    if (!existingCandidateId) {
      return res.status(404).json({ error: 'Candidate or association not found' })
    }

    if (Object.keys(candidatePayload).length) {
      const updatePayload = {
        ...candidatePayload,
        updated_at: new Date().toISOString()
      }

      if (req.user?.id) {
        updatePayload.updated_by = req.user.id
      }

      const { error } = await supabase
        .from('candidates')
        .update(updatePayload)
        .eq('id', existingCandidateId)

      if (error) {
        throw error
      }
    }

    const hasClient = (associationPayload.client_name && associationPayload.client_name !== '-') || associationPayload.client_id;
    const hasJob = (associationPayload.job_title && associationPayload.job_title !== '-') || associationPayload.job_id;
    const hasAssociation = hasClient || hasJob;

    let newAssociation = null

    if (existingAssociation) {
      if (Object.keys(associationPayload).length) {
        const assocUpdate = {
          ...associationPayload,
          updated_at: new Date().toISOString()
        }

        if (req.user?.id) {
          assocUpdate.updated_by = req.user.id
        }

        console.log('[updateCandidate] Final candidate_associations update payload:', JSON.stringify(assocUpdate))

        const { error } = await updateAssociation(existingAssociation.id, assocUpdate)

        if (error) {
          throw error
        }
      }
    } else if (hasAssociation) {
      const assocInsert = {
        ...associationPayload,
        candidate_id: existingCandidateId
      }

      if (req.user?.id) {
        assocInsert.created_by = req.user.id
      }

      console.log('[updateCandidate] Creating new candidate_associations row:', JSON.stringify(assocInsert))

      const { data: inserted, error: insertError } = await insertAssociation(assocInsert)

      if (insertError) {
        throw insertError
      }

      newAssociation = inserted
    }

    if (existingAssociation || newAssociation) {
      const assocId = existingAssociation ? existingAssociation.id : newAssociation.id
      const { data, error } = await supabase
        .from('candidate_associations')
        .select('*, candidates(*)')
        .eq('id', assocId)
        .single()

      if (error) {
        throw error
      }

      return res.json(flattenAssociation(data))
    } else {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', existingCandidateId)
        .single()

      if (error) {
        throw error
      }

      return res.json(flattenCandidateOnly(data))
    }
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidate', err)
  }
}

async function updateCandidateStatus(req, res) {
  try {
    if (!VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        errors: {
          status: `status must be one of: ${VALID_STATUSES.join(', ')}`
        }
      })
    }

    const updatePayload = {
      status: req.body.status,
      updated_at: new Date().toISOString()
    }

    if (req.user?.id) {
      updatePayload.updated_by = req.user.id
    }

    const { data, error } = await supabase
      .from('candidate_associations')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('id, status, updated_at')
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(404).json({ error: 'Candidate association not found' })
    }

    return res.json(data)
  } catch (err) {
    return logAndSendInternal(res, 'updateCandidateStatus', err)
  }
}

async function buildAiCandidateFilters(req, res) {
  try {
    const prompt = cleanText(req.body.prompt)
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' })
    }

    const allowedFields = AI_FILTER_FIELDS

    let parsed
    let usedFallback = false

    try {
      parsed = await callAiJson({
        prompt: safeFilterPrompt(prompt, allowedFields.length ? allowedFields : AI_FILTER_FIELDS),
        schema: AI_FILTER_SCHEMA,
        temperature: 0,
        schemaName: 'candidate_filters'
      })
    } catch (err) {
      if (/invalid json/i.test(err.message)) {
        return res.status(400).json({ error: 'AI returned invalid JSON. No filter was applied.' })
      }
      console.warn('buildAiCandidateFilters AI fallback:', err.message)
      parsed = { conditions: explicitAiConditionsFromPrompt(prompt) }
      usedFallback = true
    }

    const explicitConditions = explicitAiConditionsFromPrompt(prompt)
    const parsedConditions = Array.isArray(parsed?.conditions) ? parsed.conditions : []
    const filters = normalizeAiFilterOutput({
      ...parsed,
      conditions: [...parsedConditions, ...explicitConditions]
    }) || normalizeAiFilterOutput(localAiFilterFallback(prompt))
    if (!filters) {
      return res.status(400).json({ error: 'AI filter output was invalid' })
    }

    const { count, error } = await applyAiQueryFilters(
      supabase
        .from('candidates')
        .select('id, candidate_associations(*)', { count: 'exact', head: true }),
      filters
    )

    if (error) {
      throw error
    }

    return res.json({ filters, matchedCount: count || 0, fallback: usedFallback })
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message })
    }

    return logAndSendInternal(res, 'buildAiCandidateFilters', err)
  }
}

function storagePathFromResumeUrl(resumeUrl) {
  if (!resumeUrl) {
    return null
  }

  try {
    const parsed = new URL(resumeUrl)
    const marker = '/storage/v1/object/'
    const markerIndex = parsed.pathname.indexOf(marker)
    if (markerIndex === -1) {
      return resumeUrl
    }

    const objectPath = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length))
    return objectPath.replace(/^sign\/|^public\//, '')
  } catch {
    return resumeUrl
  }
}

async function deleteResumeFromStorage(resumeUrl) {
  const objectPath = storagePathFromResumeUrl(resumeUrl)
  if (!objectPath) {
    return
  }

  const [bucket, ...segments] = objectPath.split('/')
  if (!bucket || !segments.length) {
    return
  }

  const { error } = await supabase.storage.from(bucket).remove([segments.join('/')])
  if (error) {
    console.error('deleteResumeFromStorage:', error.message)
  }
}

async function deleteCandidate(req, res) {
  try {
    const associationId = req.params.id

    const { data: existingAssoc, error: lookupError } = await supabase
      .from('candidate_associations')
      .select('id, candidate_id, candidates(resume_url)')
      .eq('id', associationId)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (existingAssoc) {
      const { error } = await supabase.from('candidate_associations').delete().eq('id', associationId)

      if (error) {
        throw error
      }

      const { count, error: countError } = await supabase
        .from('candidate_associations')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', existingAssoc.candidate_id)

      if (countError) {
        throw countError
      }

      if (!count) {
        await supabase.from('candidates').delete().eq('id', existingAssoc.candidate_id)
        await deleteResumeFromStorage(existingAssoc.candidates?.resume_url)
      }

      return res.json({ message: 'Candidate association deleted' })
    } else {
      const { data: existingCand, error: candLookupError } = await supabase
        .from('candidates')
        .select('id, resume_url')
        .eq('id', associationId)
        .maybeSingle()

      if (candLookupError) {
        throw candLookupError
      }

      if (!existingCand) {
        return res.status(404).json({ error: 'Candidate or association not found' })
      }

      await supabase.from('candidates').delete().eq('id', existingCand.id)
      await deleteResumeFromStorage(existingCand.resume_url)

      return res.json({ message: 'Candidate deleted' })
    }
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
  if (!contentType.toLowerCase().includes('application/pdf')) {
    const error = new Error('URL does not point to a PDF')
    error.statusCode = 400
    throw error
  }

  const filePath = path.join('/tmp', `${uuidv4()}.pdf`)
  await fs.writeFile(filePath, Buffer.from(response.data))
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
        if (err.code === 'ECONNABORTED') {
          return res.status(408).json({ error: 'URL fetch timed out' })
        }

        if (err.statusCode === 400) {
          return res.status(400).json({ error: err.message })
        }

        throw err
      }
    }

    const parsed = await parseResume(tmpFilePath)
    return res.json(parsed)
  } catch (err) {
    console.error('parseResumeRoute:', err.message)
    return res.status(500).json({ error: 'Parsing failed', detail: err.message })
  } finally {
    if (tmpFilePath) {
      try {
        await fs.unlink(tmpFilePath)
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('parseResumeRoute cleanup:', err.message)
        }
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
