const OPERATORS = ['contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between', 'before', 'after', 'on', 'is_empty', 'is_not_empty', 'in']

const BUDGETS = ['0-5 lac', '5-10 lac', '10-15 lac', '15-20 lac', '20-25 lac', '25-30 lac', '30-35 lac', '35-40 lac', '40-50 lac', '50-60 lac', '60-70 lac', '70-80 lac', '80-100 lac', '100-150 lac', '>150 lac']
const MANDATE_STATUSES = ['Ongoing', 'Scrapped', 'Completed']

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const lower = (value) => clean(value).toLowerCase()
const normalizeSearch = (value) => lower(value)
  .replace(/\breactjs\b/g, 'react')
  .replace(/\bnodejs\b/g, 'node')
  .replace(/\bjs\b/g, 'javascript')
  .replace(/\bml\b/g, 'machine learning')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
const keywordTerms = (value) => normalizeSearch(value).split(' ').filter(Boolean)
const digits = (value) => clean(value).replace(/[^\d.]/g, '')
const numberValue = (value) => {
  const text = lower(value)
  const n = Number(digits(value))
  if (!Number.isFinite(n)) return null
  if (/\bk\b/.test(text)) return n * 1000
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
  let text = clean(value)
  const now = new Date()
  if (/^\d{1,2}\s+[a-z]+$/i.test(text)) text = `${text} ${now.getFullYear()}`
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  const dmy = text.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i)
  if (dmy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.findIndex(item => dmy[2].toLowerCase().startsWith(item))
    if (month >= 0) return `${dmy[3]}-${String(month + 1).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`
  const date = value instanceof Date ? value : new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}
const todayValue = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).reduce((map, part) => {
    map[part.type] = part.value
    return map
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}
const relativeDate = (days) => {
  const date = new Date(`${todayValue()}T00:00:00`)
  date.setDate(date.getDate() + days)
  return dateValue(date)
}
const weekRange = (offsetDays = 0) => {
  const start = new Date(`${todayValue()}T00:00:00`)
  start.setDate(start.getDate() + offsetDays)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return [dateValue(start), dateValue(end)]
}
const monthRange = (offsetMonths = 0) => {
  const today = new Date(`${todayValue()}T00:00:00`)
  const start = new Date(today.getFullYear(), today.getMonth() + offsetMonths, 1)
  const end = new Date(today.getFullYear(), today.getMonth() + offsetMonths + 1, 0)
  return [dateValue(start), dateValue(end)]
}

function normalizeBudget(value) {
  const text = lower(value).replace(/lpa|lac|lakhs|lakh/g, '').replace(/\s+/g, ' ')
  const gt = text.match(/>\s*(\d+)/)
  if (gt) return BUDGETS.find(item => item.startsWith(`>${gt[1]}`)) || clean(value)
  const range = text.match(/(\d+)\s*(?:-|to)\s*(\d+)/)
  if (!range) return BUDGETS.find(item => lower(item) === lower(value)) || clean(value)
  return BUDGETS.find(item => item.startsWith(`${range[1]}-${range[2]} `)) || `${range[1]}-${range[2]} lac`
}

function budgetNumber(value) {
  const text = lower(value)
  const gt = text.match(/>\s*(\d+(?:\.\d+)?)/)
  if (gt) return Number(gt[1])
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/)
  if (range) return (Number(range[1]) + Number(range[2])) / 2
  return numberValue(value)
}

function normalizeMandateStatus(value) {
  const text = lower(value)
  if (['ongoing', 'open', 'active'].includes(text)) return 'Ongoing'
  if (['scrap', 'scrapped'].includes(text)) return 'Scrapped'
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
  mandate_status: normalizeMandateStatus
}

const EMPTY_RE = /^(?:is\s+)?(?:empty|blank|missing|not provided|not available|null|no value|not filled|not uploaded|not attached|absent)$/i
const NOT_EMPTY_RE = /^(?:is\s+)?(?:not empty|has value|has data|exists|present|filled|filled in|available|provided|uploaded|attached)$/i
const FILLER_RE = /\b(?:column|field|where|show|give|list|find|all|records|rows)\b/gi

function stripFiller(value) {
  return clean(value).replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim()
}

function comparatorOperator(value) {
  const text = lower(value)
  if (/^(?:>=|at least|minimum|min|not less than|greater than or equal(?: to)?)$/.test(text)) return 'greater_than_or_equal'
  if (/^(?:<=|at most|maximum|max|not more than|less than or equal(?: to)?)$/.test(text)) return 'less_than_or_equal'
  if (/^(?:>|greater than|more than|above|over|higher than|exceeding|greater)$/.test(text)) return 'greater_than'
  if (/^(?:<|less than|below|under|lower than|fewer than|less)$/.test(text)) return 'less_than'
  if (/^(?:!=|is not|not equal|not equals|except|excluding|other than)$/.test(text)) return 'not_equals'
  if (/^(?:=|is|equals?|equal to|exactly|same as)$/.test(text)) return 'equals'
  return ''
}

function normalizeFieldValue(meta, value) {
  let next = stripFiller(value)
  if (meta.type === 'boolean') {
    next = next.replace(/\b(?:signed|done|available|present)\b/i, 'yes').replace(/\b(?:not signed|missing|not available|absent)\b/i, 'no')
  }
  return clean(next.replace(/^(?:is|are|equals?|equal to|contains?|include|includes|has|having|with|matching)\s+/i, ''))
}

const candidateFields = {
  candidate_id: { aliases: ['candidate id', 'ca id', 'ca'], type: 'id', operators: ['contains', 'equals'] },
  candidate_name: { aliases: ['candidate', 'name', 'candidate name'], type: 'text' },
  consultant: { aliases: ['consultant', 'consultant name', 'recruiter', 'owner', 'assigned consultant'], type: 'text' },
  email: { aliases: ['email', 'mail', 'email id'], type: 'text' },
  mobile: { aliases: ['phone', 'mobile', 'number', 'contact number'], type: 'text' },
  designation: { aliases: ['designation', 'current designation', 'title', 'role title'], type: 'text' },
  organisation: { aliases: ['organisation', 'organization', 'company', 'company/organisation', 'company/organization', 'current organisation', 'current organization', 'current company'], type: 'text' },
  experience: { aliases: ['experience', 'exp', 'years', 'years experience', 'total experience'], type: 'number' },
  client_id: { aliases: ['client id', 'cl id', 'cl'], type: 'id' },
  client_name: { aliases: ['client', 'client name'], type: 'text' },
  role: { aliases: ['role', 'job', 'job role', 'mandate', 'position', 'applied role'], type: 'text' },
  date: { aliases: ['date', 'created date', 'added date', 'submission date'], type: 'date' },
  skills: { aliases: ['skill', 'skills', 'technology', 'tech stack', 'technologies'], type: 'text' },
  current_ctc: { aliases: ['salary', 'current ctc', 'current salary', 'current package', 'current compensation'], type: 'money' },
  current_location: { aliases: ['location', 'current location', 'city'], type: 'text' },
  notice_period: { aliases: ['notice', 'notice period', 'joining time', 'availability'], type: 'number' },
  expected_ctc: { aliases: ['expected salary', 'expected ctc', 'expected package', 'expected compensation'], type: 'money' },
  open_to_relocate: { aliases: ['relocate', 'open to relocate', 'relocation', 'willing to relocate'], type: 'boolean' },
  comments: { aliases: ['comment', 'comments', 'notes', 'remarks'], type: 'text' },
  status: { aliases: ['status', 'candidate status', 'stage'], type: 'enum' },
  month: { aliases: ['month', 'submission month'], type: 'text' },
  linkedin: { aliases: ['linkedin', 'linkedin url', 'profile'], type: 'text' },
  cv: { aliases: ['cv', 'resume', 'document', 'candidate cv', 'resume file'], type: 'text' },
  education: { aliases: ['education', 'qualification', 'degree', 'academics'], type: 'text' }
}

const mandateFields = {
  job_id: { aliases: ['job id', 'mandate id', 'jb id', 'jb'], type: 'id' },
  consultant: { aliases: ['consultant', 'consultant name', 'consultant names', 'recruiter', 'assigned consultant'], type: 'text' },
  team_lead: { aliases: ['team lead', 'lead', 'tl'], type: 'text' },
  client_id: { aliases: ['client id', 'cl id', 'cl'], type: 'id' },
  client_name: { aliases: ['client', 'client name', 'company'], type: 'text' },
  role: { aliases: ['job role', 'role', 'job', 'position', 'mandate'], type: 'text' },
  location: { aliases: ['location', 'city', 'job location'], type: 'text' },
  budget: { aliases: ['budget', 'salary budget', 'ctc budget', 'compensation', 'package', 'salary range'], type: 'budget' },
  experience: { aliases: ['experience', 'exp', 'years', 'required experience'], type: 'number' },
  mandate_status: { aliases: ['mandate status', 'status', 'job status', 'priority'], type: 'mandate_status' },
  vertical: { aliases: ['vertical', 'domain', 'sector', 'industry'], type: 'text' },
  comments: { aliases: ['comment', 'comments', 'notes', 'remarks'], type: 'text' },
  date_of_allocation: { aliases: ['allocation date', 'date of allocation', 'assigned date', 'date assigned', 'date'], type: 'date' },
  jd: { aliases: ['jd', 'job description', 'jd file', 'jd filename', 'jd path', 'jd document'], type: 'text' }
}

const clientFields = {
  client_id: { aliases: ['client id', 'cl id', 'cl'], type: 'id' },
  client_name: { aliases: ['client', 'client name', 'name', 'company', 'company name', 'organization', 'organisation'], type: 'text' },
  location: { aliases: ['location', 'city', 'client location'], type: 'text' },
  region: { aliases: ['region', 'state', 'zone'], type: 'text' },
  consultant: { aliases: ['consultant', 'consultant name', 'recruiter', 'owner', 'assigned consultant'], type: 'text' },
  contact_person: { aliases: ['contact person', 'contact', 'poc', 'point of contact'], type: 'text' },
  mobile: { aliases: ['mobile', 'phone', 'contact number', 'number'], type: 'text' },
  email: { aliases: ['email', 'mail', 'email id'], type: 'text' },
  linkedin: { aliases: ['linkedin', 'linkedin url', 'profile'], type: 'text' },
  sector: { aliases: ['sector', 'vertical', 'domain', 'industry'], type: 'text' },
  connected_on_date: { aliases: ['connected on date', 'connected date', 'connected on', 'date connected', 'added date'], type: 'date' },
  comments: { aliases: ['comment', 'comments', 'notes', 'remarks'], type: 'text' },
  follow_up_date: { aliases: ['follow up date', 'follow up', 'follow-up', 'followup', 'next follow up', 'due follow up'], type: 'date' },
  status: { aliases: ['status', 'client status'], type: 'enum' },
  terms_signed: { aliases: ['terms signed', 'terms', 'agreement signed'], type: 'text' },
  value: { aliases: ['value', 'client value', 'billing value', 'deal value', 'revenue', 'terms value', 'fee value'], type: 'money' },
  billing_entity: { aliases: ['billing entity'], type: 'text' },
  gstin: { aliases: ['gstin', 'gst', 'gst number', 'gstin number'], type: 'text' },
  pan: { aliases: ['pan', 'pan number'], type: 'text' },
  address_on_invoice: { aliases: ['address on invoice', 'invoice address', 'address', 'billing address'], type: 'text' },
  designation: { aliases: ['designation', 'contact designation', 'title'], type: 'text' },
  contract_signed: { aliases: ['contract signed', 'contract', 'contract status'], type: 'boolean' },
  contract_document: { aliases: ['contract document', 'contract pdf', 'contract file'], type: 'text' }
}

const configs = {
  candidates: { fields: candidateFields },
  mandates: { fields: mandateFields },
  clients: { fields: clientFields }
}

const mandateSearchFields = ['job_id', 'consultant', 'team_lead', 'client_id', 'client_name', 'role', 'location', 'budget', 'experience', 'vertical', 'date_of_allocation', 'mandate_status', 'comments', 'jd']
const candidateSearchFields = ['candidate_id', 'candidate_name', 'consultant', 'email', 'mobile', 'designation', 'organisation', 'experience', 'skills', 'client_id', 'client_name', 'role', 'date', 'current_ctc', 'expected_ctc', 'current_location', 'notice_period', 'open_to_relocate', 'comments', 'status', 'month', 'linkedin']
const clientSearchFields = ['client_id', 'client_name', 'location', 'region', 'consultant', 'contact_person', 'mobile', 'email', 'linkedin', 'sector', 'connected_on_date', 'comments', 'follow_up_date', 'status', 'terms_signed', 'value', 'billing_entity', 'gstin', 'pan', 'address_on_invoice', 'designation', 'contract_signed', 'contract_document']
const candidateContainsFields = new Set(candidateSearchFields)
const clientContainsFields = new Set(clientSearchFields)

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFieldSegment(config, segment) {
  const text = stripFiller(segment).replace(/^any\s+/i, '')
  if (!text) return null
  const map = aliasMap(config)
  const aliases = [...map.keys()].sort((a, b) => b.length - a.length)
  for (const alias of aliases) {
    const match = text.match(new RegExp(`^${escapeRegExp(alias)}\\b\\s*(?:column|field)?\\s*(.+)?$`, 'i'))
    if (!match) continue
    const field = map.get(lower(alias))
    const meta = config.fields[field]
    const rawValue = normalizeFieldValue(meta, match[1] || '')
    if (!meta || !rawValue) continue
    if (NOT_EMPTY_RE.test(rawValue)) return normalizeCondition(config, { field, operator: 'is_not_empty', value: null })
    if (EMPTY_RE.test(rawValue)) return normalizeCondition(config, { field, operator: 'is_empty', value: null })
    if (meta.type === 'date') {
      if (/^(?:is\s+)?today$|^due today$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'on', value: todayValue() })
      if (/^tomorrow$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'on', value: relativeDate(1) })
      if (/^yesterday$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'on', value: relativeDate(-1) })
      if (/^this week$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'between', value: weekRange() })
      if (/^next week$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'between', value: weekRange(7) })
      if (/^this month$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'between', value: monthRange(0) })
      if (/^last month$/i.test(rawValue)) return normalizeCondition(config, { field, operator: 'between', value: monthRange(-1) })
      const dated = rawValue.match(/^(after|before|on)\s+(.+)$/i)
      if (dated) return normalizeCondition(config, { field, operator: lower(dated[1]), value: dated[2] })
    }
    if (['number', 'money', 'budget'].includes(meta.type)) {
      const between = rawValue.match(/(?:between|from|range)?\s*(\d+(?:\.\d+)?)\s*(?:-|to|and)\s*(\d+(?:\.\d+)?)/i)
      if (between) return normalizeCondition(config, { field, operator: 'between', value: [between[1], between[2]] })
      const comparator = rawValue.match(/^(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least|minimum|min|not less than|greater than or equal to|at most|maximum|max|not more than|less than or equal to|higher than|exceeding|lower than|fewer than)\s*(.+)$/i)
      if (comparator) {
        return normalizeCondition(config, { field, operator: comparatorOperator(comparator[1]) || 'equals', value: comparator[2] })
      }
    }
    const notEquals = rawValue.match(/^(is not|not equal|not equals|except|excluding|other than|!=)\s+(.+)$/i)
    if (notEquals) return normalizeCondition(config, { field, operator: 'not_equals', value: notEquals[2] })
    const starts = rawValue.match(/^starts with\s+(.+)$/i)
    if (starts) return normalizeCondition(config, { field, operator: 'starts_with', value: starts[1] })
    const ends = rawValue.match(/^ends with\s+(.+)$/i)
    if (ends) return normalizeCondition(config, { field, operator: 'ends_with', value: ends[1] })
    const operator = ['id', 'enum', 'mandate_status', 'boolean'].includes(meta.type) ? 'equals' : 'contains'
    return normalizeCondition(config, { field, operator, value: rawValue })
  }
  return null
}

function parseLogicalPrompt(page, prompt) {
  const config = configs[page]
  const text = clean(prompt)
  if (!config || !text) return null
  const connector = /\s+or\s+/i.test(text) ? 'or' : (/\s+and\s+/i.test(text) && !/\bbetween\s+\d+(?:\.\d+)?\s+and\s+\d+(?:\.\d+)?\b/i.test(text)) ? 'and' : ''
  const parts = connector ? text.split(new RegExp(`\\s+${connector}\\s+`, 'i')).map(clean).filter(Boolean) : [text]
  const conditions = parts.map(part => parseFieldSegment(config, part))
  if (conditions.some(condition => !condition)) return null
  return { ...(connector === 'or' && conditions.length > 1 ? { mode: 'any' } : {}), conditions }
}

function normalizeCondition(config, condition) {
  const map = aliasMap(config)
  const field = map.get(lower(condition.field)) || condition.field
  const meta = config.fields[field]
  if (!meta) return null
  const operatorText = lower(condition.operator).replace(/\s+/g, '_')
  const operatorAliases = {
    greater: 'greater_than',
    greater_than: 'greater_than',
    more_than: 'greater_than',
    above: 'greater_than',
    over: 'greater_than',
    less: 'less_than',
    less_than: 'less_than',
    below: 'less_than',
    under: 'less_than',
    at_least: 'greater_than_or_equal',
    minimum: 'greater_than_or_equal',
    at_most: 'less_than_or_equal',
    maximum: 'less_than_or_equal',
    equal: 'equals',
    equal_to: 'equals',
    is: 'equals'
  }
  const operator = OPERATORS.includes(operatorText) ? operatorText : operatorAliases[operatorText] || 'contains'
  if (['number', 'money', 'budget'].includes(meta.type) && ['contains', 'starts_with', 'ends_with'].includes(operator)) return null
  if (meta.type === 'boolean' && !['equals', 'not_equals', 'is_empty', 'is_not_empty'].includes(operator)) return null
  if (['enum', 'mandate_status'].includes(meta.type) && ['contains', 'starts_with', 'ends_with'].includes(operator)) return null
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
      mode: { type: 'string' },
      logic: { type: 'string', enum: ['AND', 'OR', 'and', 'or'] },
      fallbackText: { type: 'string' },
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
    'Return exactly {"mode":"structured_filter","logic":"AND","conditions":[{"field":"canonical_field","operator":"operator","value":"value"}],"fallbackText":"original request"}.',
    `Allowed operators: ${OPERATORS.join(', ')}.`,
    'Use canonical field names only. Never invent fields.',
    'Default text searches to contains. Use equals only for explicit exact matches.',
    'For numeric comparisons map greater/more/above/over to greater_than, at least to greater_than_or_equal, less/below/under to less_than.',
    page === 'mandates' ? 'For plain text with no field, search across mandate searchable text fields using contains.' : '',
    page === 'clients' ? 'For plain text with no field, search across all client text fields using contains.' : '',
    page === 'mandates' ? 'For phrases like "client bluepeak", "client name bluepeak", and "mandates for bluepeak", use client_name contains bluepeak.' : '',
    'Use is_empty for blank/null/empty/- and is_not_empty for not blank.',
    'Detect IDs: CA10 -> candidate_id equals CA10; CL5 -> client_id equals CL5; JB10 -> job_id equals JB10.',
    'Normalize budget examples 20-25, 20 to 25, 20-25 lac, 20 lpa to 25 lpa as 20-25 lac.',
    'Normalize mandate_status: ongoing/open/active -> Ongoing, scrapped/scrap -> Scrapped, completed/closed -> Completed.',
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
  if (!text || /\b(JB\d+|CL\d+|P[123])\b/i.test(prompt)) return false
  if (/[<>=]/.test(text) || /\b(before|after|on|between|budget|experience|exp|priority|mandate status|status|date|allocation|team lead|tl|consultant|client|client name|role|job role|location|city|vertical|domain)\b/i.test(text)) return false
  return /^[a-z0-9][\w\s&.-]+$/i.test(clean(prompt))
}

function isPlainCandidatePrompt(prompt) {
  const text = lower(prompt)
  if (!text || /\b(CA\d+|CL\d+|JB\d+)\b/i.test(prompt)) return false
  if (/[<>=]/.test(text) || /\b(before|after|on|between|salary|ctc|experience|notice|date|status|stage|relocate|consultant|client|role|job|designation|location|city|mobile|phone|email|skills?)\b/i.test(text)) return false
  return /^[a-z0-9][\w\s@+&.-]+$/i.test(clean(prompt))
}

function isPlainClientPrompt(prompt) {
  const text = lower(prompt)
  if (!text || /\bCL\d+\b/i.test(prompt)) return false
  if (/[<>=]/.test(text) || /\b(after|before|on|today|this week|between|value|follow up|connected|status|contract signed|terms|gst|gstin|pan|consultant|contact|client|location|region|sector|mobile|phone|email|linkedin)\b/i.test(text)) return false
  return /^[a-z0-9][\w\s@+&.-]+$/i.test(clean(prompt))
}

function isSimpleKeywordPrompt(page, prompt) {
  if (page === 'clients') return isPlainClientPrompt(prompt)
  if (page === 'candidates') return isPlainCandidatePrompt(prompt)
  if (page === 'mandates') return isPlainMandatePrompt(prompt)
  return false
}

function keywordFields(page) {
  if (page === 'clients') return clientSearchFields
  if (page === 'candidates') return candidateSearchFields
  if (page === 'mandates') return mandateSearchFields
  return []
}

function buildKeywordFilters(page, prompt) {
  let value = clean(prompt)
  if (page === 'clients') value = value.replace(/^clients?\s+/i, '').replace(/\s+clients?$/i, '').trim()
  if (page === 'candidates') value = value.replace(/^(candidate|candidates)\s+/i, '').trim()
  if (page === 'mandates') value = value.replace(/^mandates?\s+(?:for\s+)?/i, '').replace(/\bmandates?\b/gi, '').trim()
  const terms = keywordTerms(value)
  return terms.length ? { mode: 'keyword', terms, fields: keywordFields(page) } : null
}

function validateAiFilters(page, data, prompt = '') {
  const config = configs[page]
  const deterministic = clean(prompt) ? parsePrompt(page, prompt) : null
  const normalized = (Array.isArray(data?.conditions) ? data.conditions : [])
    .map(condition => {
      const next = { ...condition }
      if (page === 'mandates') {
        const field = aliasMap(config).get(lower(next.field)) || next.field
        if (mandateSearchFields.includes(field) && !isExactPrompt(prompt)) next.operator = 'contains'
      }
      if (page === 'candidates') {
        const field = aliasMap(config).get(lower(next.field)) || next.field
        if (candidateContainsFields.has(field)) next.operator = 'contains'
      }
      if (page === 'clients') {
        const field = aliasMap(config).get(lower(next.field)) || next.field
        if (clientContainsFields.has(field) && !isExactPrompt(prompt)) next.operator = 'contains'
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
  const forcedFields = new Set((deterministic?.conditions || [])
    .filter(condition => ['greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between', 'before', 'after', 'on', 'starts_with'].includes(condition.operator))
    .map(condition => condition.field))
  const merged = [
    ...conditions.filter(condition => !forcedFields.has(condition.field)),
    ...(deterministic?.conditions || [])
  ]
  const mergedSeen = new Set()
  const unique = merged.filter(condition => {
    const key = JSON.stringify(condition)
    if (mergedSeen.has(key)) return false
    mergedSeen.add(key)
    return true
  })
  if (unique.length) return { ...((deterministic?.mode || lower(data?.logic) === 'or') ? { mode: deterministic?.mode || 'any' } : {}), conditions: unique }
  if (deterministic) return deterministic
  if (isSimpleKeywordPrompt(page, prompt)) return buildKeywordFilters(page, prompt)
  return clean(prompt) ? buildKeywordFilters(page, prompt) : null
}

function parsePrompt(page, prompt) {
  const config = configs[page]
  let text = clean(prompt).replace(/^(?:clients|candidates|mandates|jobs)\s+(?=with|in|from)\b/i, '')
  const logical = parseLogicalPrompt(page, text)
  if (logical) return logical
  const conditions = []
  let mode = ''
  const add = (field, operator, value) => {
    const condition = normalizeCondition(config, { field, operator, value })
    if (condition) conditions.push(condition)
  }
  const addAny = (field, operator, values) => {
    values.forEach(value => add(field, operator, value))
    if (values.length > 1) mode = 'any'
  }
  const addParsedSegment = (segment) => {
    const condition = parseFieldSegment(config, segment)
    if (condition) conditions.push(condition)
  }

  if (page === 'mandates') {
    const contextClient = clean(prompt).match(/\bmandates?\s+for\s+(.+?)(?=\s+(?:with|and|or|plus|in)\b|$)/i)
    if (contextClient) {
      add('client_name', 'contains', contextClient[1])
    }
  }

  const map = aliasMap(config)
  const aliases = [...map.keys()].sort((a, b) => b.length - a.length)
  aliases.forEach(alias => {
    const field = map.get(alias)
    const meta = config.fields[field]
    if (!meta) return
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b\\s*(?:column|field)?\\s*((?:is\\s+not|not\\s+equal|not\\s+equals|not\\s+more\\s+than|not\\s+less\\s+than|less\\s+than\\s+or\\s+equal\\s+to|greater\\s+than\\s+or\\s+equal\\s+to|at\\s+least|at\\s+most|more\\s+than|greater\\s+than|less\\s+than|higher\\s+than|lower\\s+than|fewer\\s+than|same\\s+as|equal\\s+to|starts\\s+with|ends\\s+with|contains|includes|include|having|matching|with|is|are|has|>=|<=|!=|>|<|=)?\\s*[^,]+?)(?=\\s+(?:and|or|with|plus)\\s+\\b(?:${aliases.map(escapeRegExp).join('|')})\\b|$)`, 'i')
    const match = text.match(pattern)
    if (match) addParsedSegment(`${alias} ${match[1]}`)
  })

  const placeMatch = text.match(/\b(?:in|from)\s+([a-z][\w\s.-]*?)(?=\s+(?:with|and|or|plus|for)\b|$)/i)
  if (placeMatch) {
    if (config.fields.current_location) add('current_location', 'contains', placeMatch[1])
    else if (config.fields.location) add('location', 'contains', placeMatch[1])
  }
  if (page === 'mandates') {
    const mandateFor = text.match(/\b(?:mandates?|jobs?)\s+for\s+([a-z0-9][\w\s&.-]*?)(?=\s+(?:with|and|or|plus|in)\b|$)/i)
    if (mandateFor) add('client_name', 'contains', mandateFor[1])
  }

  const idMatch = text.match(/\b(CA\d+|CL\d+|JB\d+)\b/i)
  if (idMatch) {
    const id = idMatch[1].toUpperCase()
    if (id.startsWith('CA') && config.fields.candidate_id) add('candidate_id', 'equals', id)
    if (id.startsWith('CL') && config.fields.client_id) add('client_id', 'equals', id)
    if (id.startsWith('JB') && config.fields.job_id) add('job_id', 'equals', id)
  }

  if (config.fields.mandate_status) MANDATE_STATUSES.forEach(status => {
    if (new RegExp(`\\b${status.toLowerCase()}\\b`).test(lower(text)) || (status === 'Scrapped' && /\bscrapped?\b/i.test(text)) || (status === 'Completed' && /\b(completed|closed)\b/i.test(text)) || (status === 'Ongoing' && /\b(ongoing|open|active)\b/i.test(text))) add('mandate_status', 'equals', status)
  })
  if (config.fields.status) {
    const statusAs = text.match(/\b([a-z][\w\s.-]*?)\s+as\s+status\b/i)
    if (statusAs) add('status', 'equals', statusAs[1].replace(/^(?:the\s+)?(?:client|candidate|mandate|job)\s+(?:has|is|with)?\s*/i, '').trim())
  }
  if (config.fields.budget) {
    const budget = text.match(/(?:budget|salary range)\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least)?\s*(\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(?:lac|lpa|lakh|lakhs))?/i)
    if (budget) {
      const op = budget[1] || '='
      add('budget', op === '>' || op === 'above' || op === 'over' || op === 'more than' || op === 'greater than' ? 'greater_than' : op === '>=' || op === 'at least' ? 'greater_than_or_equal' : op === '<' || op === 'below' || op === 'under' || op === 'less than' ? 'less_than' : op === '<=' ? 'less_than_or_equal' : budget[2].match(/-|to/) ? 'equals' : 'equals', budget[2])
    }
  }
  if (config.fields.value) {
    const valueMatch = text.match(/(?:value|terms value)\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least)?\s*(\d+(?:\.\d+)?)\s*(?:lac|lpa|lakh|lakhs|cr|crore|crores)?/i)
    if (valueMatch) {
      const op = valueMatch[1] || '='
      add('value', op === '>' || op === 'above' || op === 'over' || op === 'more than' || op === 'greater than' ? 'greater_than' : op === '>=' || op === 'at least' ? 'greater_than_or_equal' : op === '<' || op === 'below' || op === 'under' || op === 'less than' ? 'less_than' : op === '<=' ? 'less_than_or_equal' : 'equals', valueMatch[0])
    }
  }

  const explicit = [
    ['candidate_name', /(?:candidate|candidate name|name)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:client|consultant|role|location|status|email|mobile|phone|experience|salary|date)\b|$)/i],
    ['client_name', /(?:client|client name)\s+(?:is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:mandates?|candidate|consultant|team lead|role|location|budget|priority|mandate status|status|vertical|date|in)\b|$)/i],
    ['consultant', /consultant\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:client|team lead|role|location|budget|priority|mandate status|status|vertical|date|in|for)\b|$)/i],
    ['team_lead', /(?:team lead|tl)\s+(?:is\s+|equals\s+)?(-|[a-z][\w\s.-]*?)(?=\s+(?:client|consultant|role|location|budget|priority|mandate status|status|vertical|date|in|for)\b|$)/i],
    ['role', /(?:role|job role|job)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:client|consultant|team lead|location|budget|priority|mandate status|status|vertical|date|in|for)\b|$)/i],
    ['current_location', /(?:location|city|current location)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:with|and|or|plus|client|consultant|team lead|role|budget|priority|mandate status|status|vertical|date|for)\b|$)|\bin\s+([a-z][\w\s.-]*?)(?=\s+(?:with|and|or|plus|for|client|consultant|team lead|role|budget|priority|mandate status|status|vertical|date)\b|$)/i],
    ['location', /(?:location|city|current location)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)(?=\s+(?:with|and|or|plus|client|consultant|team lead|role|budget|priority|mandate status|status|vertical|date|for)\b|$)|\bin\s+([a-z][\w\s.-]*?)(?=\s+(?:with|and|or|plus|for|client|consultant|team lead|role|budget|priority|mandate status|status|vertical|date)\b|$)/i],
    ['vertical', /(?:vertical|domain)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)(?=\s+(?:client|consultant|team lead|role|location|budget|priority|mandate status|status|date|in|for)\b|$)/i],
    ['designation', /designation\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i],
    ['mobile', /(?:mobile|phone|contact number)\s+(?:contains\s+|has\s+|is\s+|equals\s+)?([+\d][\d\s+.-]*?)$/i],
    ['email', /email\s+(?:contains\s+|has\s+|is\s+|equals\s+)?([a-z0-9@._+-]*?)$/i],
    ['skills', /skills?\s+(?:contains\s+|has\s+|is\s+|equals\s+)?([a-z0-9+#.\s-]*?)$/i],
    ['organisation', /(?:organisation|organization|company)\s+(?:contains\s+|is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i],
    ['status', /status\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i]
  ]
  explicit.forEach(([field, regex]) => {
    if (!config.fields[field]) return
    if (field === 'client_name' && /\bas\s+status\b/i.test(text)) return
    const match = text.match(regex)
    if (match) add(field, /contains/i.test(match[0]) ? 'contains' : 'contains', match[1] || match[2])
  })

  ;[
    ['experience', /experience\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least)\s*(\d+)/i],
    ['current_ctc', /(?:salary|current ctc|current salary)\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least)\s*(\d+)/i],
    ['expected_ctc', /(?:expected salary|expected ctc)\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least)\s*(\d+)/i],
    ['notice_period', /notice(?:\s+period)?\s*(>=|>|<=|<|=|below|above|under|over|more than|less than|greater than|at least|less|greater)\s*(\d+)/i]
  ].forEach(([field, regex]) => {
    if (!config.fields[field]) return
    const match = text.match(regex)
    if (!match) return
    const op = match[1]
    add(field, op === '>' || op === 'above' || op === 'over' || op === 'more than' || op === 'greater' || op === 'greater than' ? 'greater_than' : op === '>=' || op === 'at least' ? 'greater_than_or_equal' : op === '<' || op === 'below' || op === 'under' || op === 'less' || op === 'less than' ? 'less_than' : op === '<=' ? 'less_than_or_equal' : 'equals', match[2])
  })
  ;[
    ['experience', /experience\s*(\d+)\s*(?:-|to)\s*(\d+)/i],
    ['current_ctc', /(?:salary|current ctc|current salary)\s*(\d+)\s*(?:-|to)\s*(\d+)/i],
    ['expected_ctc', /(?:expected salary|expected ctc)\s*(\d+)\s*(?:-|to)\s*(\d+)/i],
    ['notice_period', /notice\s*(\d+)\s*(?:-|to)\s*(\d+)/i],
    ['value', /(?:value|terms value)\s*(\d+)\s*(?:-|to)\s*(\d+)/i]
  ].forEach(([field, regex]) => {
    if (!config.fields[field]) return
    const match = text.match(regex)
    if (match) add(field, 'between', [match[1], match[2]])
  })
  if (config.fields.budget) {
    const budgetRange = text.match(/budget\s*(\d+)\s*(?:-|to)\s*(\d+)/i)
    if (budgetRange) add('budget', 'equals', `${budgetRange[1]}-${budgetRange[2]} lac`)
  }

  if (config.fields.contract_signed) {
    const contractMatch = text.match(/contract signed\s+(yes|no|true|false)/i)
    if (contractMatch) add('contract_signed', 'equals', contractMatch[1])
    const contractOr = text.match(/contract signed\s+(yes|no|true|false)\s+or\s+(yes|no|true|false)/i)
    if (contractOr) addAny('contract_signed', 'equals', [contractOr[1], contractOr[2]])
  }
  if (config.fields.gstin) {
    const gstMatch = text.match(/(?:gstin|gst)\s+(?:starts with|starts)\s+([a-z0-9]+)/i)
    if (gstMatch) add('gstin', 'starts_with', gstMatch[1])
  }
  ;[
    ['consultant', /consultant\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i],
    ['contact_person', /(?:contact person|contact)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i],
    ['client_name', /(?:client|client name)\s+(?:is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i],
    ['location', /(?:location|city)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i],
    ['region', /region\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)$/i],
    ['sector', /sector\s+(?:is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)$/i]
  ].forEach(([field, regex]) => {
    if (!config.fields[field]) return
    if (field === 'client_name' && /\bas\s+status\b/i.test(text)) return
    const match = text.match(regex)
    if (match) add(field, 'contains', match[1])
  })
  ;[
    ['consultant', /consultant\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)\s+or\s+([a-z][\w\s.-]*?)$/i],
    ['contact_person', /(?:contact person|contact)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)\s+or\s+([a-z][\w\s.-]*?)$/i],
    ['location', /(?:location|city)\s+(?:is\s+|equals\s+)?([a-z][\w\s.-]*?)\s+or\s+([a-z][\w\s.-]*?)$/i],
    ['sector', /sector\s+(?:is\s+|equals\s+)?([a-z0-9][\w\s&.-]*?)\s+or\s+([a-z0-9][\w\s&.-]*?)$/i]
  ].forEach(([field, regex]) => {
    if (!config.fields[field]) return
    const match = text.match(regex)
    if (match) addAny(field, 'contains', [match[1], match[2]])
  })

  const dateMatch = text.match(/(?:date|allocation date|date of allocation|connected(?: on)?|follow up)\s+(after|before|on)\s+(.+)$/i)
  if (dateMatch) add(config.fields.date_of_allocation ? 'date_of_allocation' : 'date', dateMatch[1].toLowerCase(), dateMatch[2])
  if (config.fields.connected_on_date) {
    const connected = text.match(/connected(?: on)?\s+(after|before|on)\s+(.+)$/i)
    if (connected) add('connected_on_date', connected[1].toLowerCase(), connected[2])
  }
  if (config.fields.follow_up_date) {
    if (/\bfollow up\s+today\b/i.test(text)) add('follow_up_date', 'on', todayValue())
    if (/\bfollow up\s+this week\b/i.test(text)) add('follow_up_date', 'between', weekRange())
    const follow = text.match(/follow up\s+(after|before|on)\s+(.+)$/i)
    if (follow) add('follow_up_date', follow[1].toLowerCase(), follow[2])
  }

  const unique = []
  const seen = new Set()
  conditions.forEach(condition => {
    const key = JSON.stringify(condition)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(condition)
    }
  })
  return unique.length ? { ...(mode ? { mode } : {}), conditions: unique } : null
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

  if (type === 'budget') {
    const left = budgetNumber(actual)
    if (left === null) return false
    if (operator === 'between') return left >= Number(expected[0]) && left <= Number(expected[1])
    const right = budgetNumber(expected)
    if (right === null) return false
    if (operator === 'greater_than') return left > right
    if (operator === 'greater_than_or_equal') return left >= right
    if (operator === 'less_than') return left < right
    if (operator === 'less_than_or_equal') return left <= right
    if (operator === 'not_equals') return left !== right
    return normalizeBudget(actual) === normalizeBudget(expected)
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
  if (filters?.mode === 'keyword') {
    const terms = Array.isArray(filters.terms) ? filters.terms.map(normalizeSearch).filter(Boolean) : []
    const fields = Array.isArray(filters.fields) ? filters.fields : keywordFields(page)
    if (!terms.length) return rows
    return rows.filter(row => {
      const haystack = normalizeSearch(fields.map(field => valueGetter(row, field)).flat().join(' '))
      return terms.every(term => haystack.includes(term))
    })
  }
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

module.exports = { configs, parsePrompt, applyFilters, normalizeCondition, buildAiFilterPrompt, validateAiFilters, aiFilterSchema, OPERATORS, isSimpleKeywordPrompt, buildKeywordFilters }

