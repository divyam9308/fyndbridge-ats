const OPERATORS = ['contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between', 'before', 'after', 'on', 'is_empty', 'is_not_empty', 'in']

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const PRIORITIES = ['P1', 'P2', 'P3', 'Scrap', 'Completed']

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const lower = (value) => clean(value).toLowerCase()
const digits = (value) => clean(value).replace(/[^\d.]/g, '')
const numberValue = (value) => {
  const n = Number(digits(value))
  return Number.isFinite(n) ? n : null
}
const moneyValue = (value) => {
  const text = lower(value)
  const n = numberValue(value)
  if (n === null) return null
  if (n <= 200 || /\b(lpa|lac|lakh|lakhs)\b/.test(text)) return Math.round(n * 100000)
  if (/\b(cr|crore|crores)\b/.test(text)) return Math.round(n * 10000000)
  return Math.round(n)
}
const dateValue = (value) => {
  const date = value instanceof Date ? value : new Date(clean(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function normalizeBudget(value) {
  const text = lower(value).replace(/lpa|lac|lakhs|lakh/g, '').replace(/\s+/g, ' ')
  const gt = text.match(/>\s*(\d+)/)
  if (gt) return BUDGETS.find(item => item.startsWith(`>${gt[1]}`)) || clean(value)
  const range = text.match(/(\d+)\s*(?:-|to)\s*(\d+)/)
  if (!range) return BUDGETS.find(item => lower(item) === lower(value)) || clean(value)
  return BUDGETS.find(item => item.startsWith(`${range[1]}-${range[2]} `)) || `${range[1]}-${range[2]} lac`
}

function normalizePriority(value) {
  const text = lower(value)
  if (text === 'p1') return 'P1'
  if (text === 'p2') return 'P2'
  if (text === 'p3') return 'P3'
  if (['scrap', 'scrapped'].includes(text)) return 'Scrap'
  if (['completed', 'complete', 'closed'].includes(text)) return 'Completed'
  return clean(value)
}

function normalizeBoolean(value) {
  const text = lower(value)
  if (['yes', 'true', 'open', 'relocate', 'willing'].includes(text)) return true
  if (['no', 'false', 'not open', 'not willing'].includes(text)) return false
  return null
}

const normalizers = {
  text: clean,
  id: (value) => clean(value).toUpperCase(),
  number: numberValue,
  money: moneyValue,
  date: dateValue,
  enum: clean,
  boolean: normalizeBoolean,
  budget: normalizeBudget,
  priority: normalizePriority
}

const candidateFields = {
  candidate_id: { aliases: ['candidate id', 'ca id', 'ca'], type: 'id', operators: ['contains', 'equals'] },
  candidate_name: { aliases: ['candidate', 'name', 'candidate name'], type: 'text' },
  consultant: { aliases: ['consultant', 'recruiter'], type: 'text' },
  email: { aliases: ['email', 'email id'], type: 'text' },
  mobile: { aliases: ['phone', 'mobile', 'contact number'], type: 'text' },
  designation: { aliases: ['designation', 'current designation', 'role title'], type: 'text' },
  organisation: { aliases: ['organisation', 'organization', 'company', 'current organisation'], type: 'text' },
  experience: { aliases: ['experience', 'exp', 'years'], type: 'number' },
  client_id: { aliases: ['client id', 'cl id', 'cl'], type: 'id' },
  client_name: { aliases: ['client', 'client name'], type: 'text' },
  role: { aliases: ['role', 'job', 'job role', 'mandate'], type: 'text' },
  date: { aliases: ['date', 'created date', 'added date'], type: 'date' },
  skills: { aliases: ['skill', 'skills', 'technology'], type: 'text' },
  current_ctc: { aliases: ['salary', 'current ctc', 'current salary'], type: 'money' },
  current_location: { aliases: ['location', 'current location', 'city'], type: 'text' },
  notice_period: { aliases: ['notice', 'notice period'], type: 'number' },
  expected_ctc: { aliases: ['expected salary', 'expected ctc'], type: 'money' },
  open_to_relocate: { aliases: ['relocate', 'open to relocate', 'relocation'], type: 'boolean' },
  comments: { aliases: ['comment', 'comments', 'notes'], type: 'text' },
  status: { aliases: ['status', 'stage'], type: 'enum' },
  month: { aliases: ['month'], type: 'text' },
  linkedin: { aliases: ['linkedin'], type: 'text' },
  cv: { aliases: ['cv', 'resume'], type: 'text' }
}

const mandateFields = {
  job_id: { aliases: ['job id', 'mandate id', 'jb id', 'jb'], type: 'id' },
  consultant: { aliases: ['consultant'], type: 'text' },
  team_lead: { aliases: ['team lead', 'tl'], type: 'text' },
  client_name: { aliases: ['client', 'client name'], type: 'text' },
  role: { aliases: ['job role', 'role'], type: 'text' },
  location: { aliases: ['location', 'city'], type: 'text' },
  budget: { aliases: ['budget', 'salary range'], type: 'budget' },
  priority: { aliases: ['priority'], type: 'priority' },
  vertical: { aliases: ['vertical', 'domain'], type: 'text' },
  date_of_allocation: { aliases: ['allocation date', 'date of allocation', 'date'], type: 'date' }
}

const configs = {
  candidates: { fields: candidateFields },
  mandates: { fields: mandateFields }
}

const mandateSearchFields = ['client_name', 'role', 'consultant', 'team_lead', 'location', 'vertical']

Object.values(configs).forEach(config => {
  Object.entries(config.fields).forEach(([field, meta]) => {
    meta.field = field
    meta.operators ||= OPERATORS
    meta.normalizer = normalizers[meta.type] || clean
  })
})

function aliasMap(config) {
  const map = new Map()
  Object.entries(config.fields).forEach(([field, meta]) => {
    ;[field, ...(meta.aliases || [])].forEach(alias => map.set(lower(alias), field))
  })
  return map
}

function normalizeCondition(config, condition) {
  const map = aliasMap(config)
  const field = map.get(lower(condition.field)) || condition.field
  const meta = config.fields[field]
  if (!meta) return null
  const operator = OPERATORS.includes(condition.operator) ? condition.operator : 'contains'
  let value = condition.value
  if (operator === 'between' || operator === 'in') {
    value = (Array.isArray(value) ? value : String(value || '').split(',')).map(item => meta.normalizer(item)).filter(item => item !== null && item !== '')
  } else if (!['is_empty', 'is_not_empty'].includes(operator)) {
    value = meta.normalizer(value)
    if (value === null || value === '') return null
  }
  return { field, operator, value }
}

function aiFilterSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      conditions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            operator: { type: 'string', enum: OPERATORS },
            value: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
                { type: 'null' }
              ]
            }
          },
          required: ['field', 'operator']
        }
      }
    },
    required: ['conditions']
  }
}

function buildAiFilterPrompt(page, prompt) {
  const config = configs[page]
  const fields = Object.entries(config.fields)
    .map(([field, meta]) => `${field}: type=${meta.type}; aliases=${(meta.aliases || []).join(', ')}; operators=${meta.operators.join(', ')}`)
    .join('\n')
  return [
    'Convert this ATS filter request into JSON only.',
    'Return exactly {"conditions":[{"field":"canonical_field","operator":"operator","value":"value"}]}.',
    `Allowed operators: ${OPERATORS.join(', ')}.`,
    'Use canonical field names only. Never invent fields.',
    'Default text searches to contains. Use equals only for explicit exact matches.',
    page === 'mandates' ? 'For plain text with no field, search across client_name, role, consultant, team_lead, location, and vertical using contains.' : '',
    page === 'mandates' ? 'For phrases like "client bluepeak", "client name bluepeak", and "mandates for bluepeak", use client_name contains bluepeak.' : '',
    'Use is_empty for blank/null/empty/- and is_not_empty for not blank.',
    'Detect IDs: CA10 -> candidate_id equals CA10; CL5 -> client_id equals CL5; JB10 -> job_id equals JB10.',
    'Normalize budget examples 20-25, 20 to 25, 20-25 lac, 20 lpa to 25 lpa as 20-25 lac.',
    'Normalize priority: p1/P1, p2/P2, p3/P3, scrapped -> Scrap, completed/closed -> Completed.',
    'Fields:',
    fields,
    `Request: ${clean(prompt)}`
  ].filter(Boolean).join('\n')
}

function isExactPrompt(prompt) {
  return /\b(exact|exactly|equals?|equal to)\b/i.test(clean(prompt))
}

function isPlainMandatePrompt(prompt) {
  const text = lower(prompt)
  if (!text || /\b(JB\d+|P[123])\b/i.test(prompt)) return false
  if (/[<>=]/.test(text) || /\b(before|after|on|between|budget|priority|date|allocation|team lead|tl|consultant|client|client name|role|job role|location|city|vertical|domain)\b/i.test(text)) return false
  return /^[a-z0-9][\w\s&.-]+$/i.test(clean(prompt))
}

function validateAiFilters(page, data, prompt = '') {
  const config = configs[page]
  if (page === 'mandates' && isPlainMandatePrompt(prompt)) {
    const value = clean(prompt).replace(/^mandates?\s+(?:for\s+)?/i, '').replace(/\bmandates?\b/gi, '').trim()
    if (value) return { mode: 'any', conditions: mandateSearchFields.map(field => ({ field, operator: 'contains', value })) }
  }
  const normalized = (Array.isArray(data?.conditions) ? data.conditions : [])
    .map(condition => {
      const next = { ...condition }
      if (page === 'mandates') {
        const field = aliasMap(config).get(lower(next.field)) || next.field
        if (mandateSearchFields.includes(field) && !isExactPrompt(prompt)) next.operator = 'contains'
      }
      return normalizeCondition(config, next)
    })
    .filter(Boolean)
  const seen = new Set()
  const conditions = normalized.filter(condition => {
    const key = JSON.stringify(condition)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!conditions.length && page === 'mandates' && clean(prompt)) return parsePrompt(page, prompt)
  return conditions.length ? { conditions } : null
}

function parsePrompt(page, prompt) {
  const config = configs[page]
  const text = clean(prompt)
  const conditions = []
  const add = (field, operator, value) => {
    const condition = normalizeCondition(config, { field, operator, value })
    if (condition) conditions.push(condition)
  }

  const idMatch = text.match(/\b(CA\d+|CL\d+|JB\d+)\b/i)
  if (idMatch) {
    const id = idMatch[1].toUpperCase()
    if (id.startsWith('CA') && config.fields.candidate_id) add('candidate_id', 'equals', id)
    if (id.startsWith('CL') && config.fields.client_id) add('client_id', 'equals', id)
    if (id.startsWith('JB') && config.fields.job_id) add('job_id', 'equals', id)
  }

  if (config.fields.priority) PRIORITIES.forEach(priority => {
    if (new RegExp(`\\b${priority.toLowerCase()}\\b`).test(lower(text)) || (priority === 'Scrap' && /\bscrapped?\b/i.test(text)) || (priority === 'Completed' && /\b(completed|closed)\b/i.test(text))) add('priority', 'equals', priority)
  })
  if (config.fields.budget) {
    const budget = text.match(/(?:budget|salary range)?\s*(>?\s*\d+\s*(?:-|to)\s*\d+|>\s*\d+)(?:\s*(?:lac|lpa|lakh|lakhs))?/i)
    if (budget) add('budget', 'equals', budget[1])
  }

  const explicit = [
    ['candidate_name', /(?:candidate|candidate name|name)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:client|consultant|role|location|status|email|mobile|phone|experience|salary|date)\b|$)/i],
    ['client_name', /(?:client|client name)\s+(?:is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:p1|p2|p3|mandates?|candidate|consultant|team lead|role|location|budget|priority|vertical|date|in)\b|$)/i],
    ['consultant', /consultant\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:client|team lead|role|location|budget|priority|vertical|date|in|for)\b|$)/i],
    ['team_lead', /(?:team lead|tl)\s+(?:is\s+|equals\s+)?(-|[a-z][\w\s.-]*?)(?=\s+(?:client|consultant|role|location|budget|priority|vertical|date|in|for)\b|$)/i],
    ['role', /(?:role|job role|job)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:client|consultant|team lead|location|budget|priority|vertical|date|in|for)\b|$)/i],
    ['location', /(?:location|city|current location)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:client|consultant|team lead|role|budget|priority|vertical|date|for)\b|$)|\bin\s+([a-z][\w\s.-]*?)(?=\s+(?:for|client|consultant|team lead|role|budget|priority|vertical|date)\b|$)/i],
    ['vertical', /(?:vertical|domain)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:client|consultant|team lead|role|location|budget|priority|date|in|for)\b|$)/i],
    ['designation', /designation\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i],
    ['organisation', /(?:organisation|organization|company)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i],
    ['status', /status\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i]
  ]
  explicit.forEach(([field, regex]) => {
    if (!config.fields[field]) return
    const match = text.match(regex)
    if (match) add(field, /contains/i.test(match[0]) ? 'contains' : 'contains', match[1] || match[2])
  })

  ;[
    ['experience', /experience\s*(>=|>|<=|<|=|below|above)\s*(\d+)/i],
    ['current_ctc', /(?:salary|current ctc|current salary)\s*(>=|>|<=|<|=|below|above)\s*(\d+)/i],
    ['expected_ctc', /(?:expected salary|expected ctc)\s*(>=|>|<=|<|=|below|above)\s*(\d+)/i],
    ['notice_period', /notice\s*(>=|>|<=|<|=|below|above)\s*(\d+)/i]
  ].forEach(([field, regex]) => {
    if (!config.fields[field]) return
    const match = text.match(regex)
    if (!match) return
    const op = match[1]
    add(field, op === '>' || op === 'above' ? 'greater_than' : op === '>=' ? 'greater_than_or_equal' : op === '<' || op === 'below' ? 'less_than' : op === '<=' ? 'less_than_or_equal' : 'equals', match[2])
  })

  const dateMatch = text.match(/(?:date|allocation date|date of allocation)\s+(after|before|on)\s+(.+)$/i)
  if (dateMatch) add(config.fields.date_of_allocation ? 'date_of_allocation' : 'date', dateMatch[1].toLowerCase(), dateMatch[2])

  if (!conditions.length && config.fields.client_name && /^[a-z0-9][\w\s&.-]+$/i.test(text)) add('client_name', 'contains', text.replace(/\b(client|mandates?)\b/gi, '').trim())

  const unique = []
  const seen = new Set()
  conditions.forEach(condition => {
    const key = JSON.stringify(condition)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(condition)
    }
  })
  return unique.length ? { conditions: unique } : null
}

function compareValue(actual, operator, expected, type) {
  const empty = actual === null || actual === undefined || clean(actual) === '' || clean(actual) === '-'
  if (operator === 'is_empty') return empty
  if (operator === 'is_not_empty') return !empty
  if (empty) return false

  if (type === 'number' || type === 'money') {
    const left = type === 'money' ? moneyValue(actual) : numberValue(actual)
    if (left === null) return false
    if (operator === 'between') return left >= Number(expected[0]) && left <= Number(expected[1])
    const right = Number(expected)
    if (operator === 'greater_than') return left > right
    if (operator === 'greater_than_or_equal') return left >= right
    if (operator === 'less_than') return left < right
    if (operator === 'less_than_or_equal') return left <= right
    if (operator === 'not_equals') return left !== right
    return left === right
  }

  if (type === 'date') {
    const left = dateValue(actual)
    const right = dateValue(expected)
    if (!left || !right) return false
    if (operator === 'before' || operator === 'less_than') return left < right
    if (operator === 'after' || operator === 'greater_than') return left > right
    if (operator === 'not_equals') return left !== right
    return left === right
  }

  const haystack = Array.isArray(actual) ? actual.map(lower).join(', ') : lower(actual)
  const needle = lower(expected)
  if (operator === 'in') return expected.map(lower).some(item => haystack === item || haystack.includes(item))
  if (operator === 'equals') return haystack === needle
  if (operator === 'not_equals') return haystack !== needle
  if (operator === 'starts_with') return haystack.startsWith(needle)
  if (operator === 'ends_with') return haystack.endsWith(needle)
  return haystack.includes(needle)
}

function applyFilters(page, rows, filters, valueGetter) {
  const config = configs[page]
  const normalized = (filters?.conditions || []).map(condition => normalizeCondition(config, condition)).filter(Boolean)
  if (!normalized.length) return rows
  const match = (row, condition) => {
    const meta = config.fields[condition.field]
    return compareValue(valueGetter(row, condition.field), condition.operator, condition.value, meta.type)
  }
  return rows.filter(row => filters?.mode === 'any'
    ? normalized.some(condition => match(row, condition))
    : normalized.every(condition => match(row, condition)))
}

module.exports = { configs, parsePrompt, applyFilters, normalizeCondition, buildAiFilterPrompt, validateAiFilters, aiFilterSchema, OPERATORS }
