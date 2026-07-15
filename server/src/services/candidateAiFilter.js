const { CANDIDATE_STATUSES } = require('./candidateStatuses')

const MAX_QUERY_LENGTH = 600
const MAX_DEPTH = 5
const MAX_CONDITIONS = 24
const MAX_IN_VALUES = 20
const EMPTY_WORDS = /^(?:blank|empty|missing|null|not selected|unselected|not assigned|not provided|not filled|not available|unavailable|not applicable|n\/?a|unknown)$/i

const TEXT_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const ENUM_OPERATORS = ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const NUMBER_OPERATORS = ['equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const DATE_OPERATORS = ['equals', 'not_equals', 'before', 'after', 'on', 'on_or_before', 'on_or_after', 'between', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const BOOLEAN_OPERATORS = ['equals', 'not_equals', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const SKILL_OPERATORS = ['contains', 'not_contains', 'contains_all', 'contains_any', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']
const IDENTIFIER_OPERATORS = ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null']

const FIELD_REGISTRY = {
  candidate_id: field('base', 'text', ['candidate_display_id'], ['candidate id', 'candidate number', 'ca id', 'ca'], TEXT_OPERATORS),
  candidate_name: field('base', 'text', ['full_name'], ['candidate name', 'full name', 'name', 'applicant name', 'applicant', 'person'], TEXT_OPERATORS),
  email: field('base', 'email', ['email'], ['email address', 'mail address', 'email', 'mail'], TEXT_OPERATORS),
  mobile: field('base', 'phone', ['mobile_number'], ['mobile number', 'phone number', 'contact number', 'whatsapp number', 'cell number', 'telephone', 'mobile', 'phone', 'contact', 'cell'], TEXT_OPERATORS),
  designation: field('base', 'text', ['current_designation'], ['current designation', 'designation', 'job title'], TEXT_OPERATORS),
  organisation: field('base', 'text', ['current_organisation', 'current_company'], ['current organisation', 'current organization', 'current company', 'present company', 'organisation', 'organization', 'employer', 'works at', 'working at', 'employed at', 'company'], TEXT_OPERATORS),
  experience: field('base', 'number', ['experience_years'], ['total experience', 'overall experience', 'years of experience', 'work experience', 'total exp', 'experience', 'exp'], NUMBER_OPERATORS),
  current_location: field('base', 'text', ['location', 'city', 'state'], ['current location', 'current city', 'based in', 'living in', 'located in', 'location', 'city'], TEXT_OPERATORS),
  notice_period: field('base', 'number', ['notice_period'], ['notice period', 'joining time', 'days to join', 'available in', 'notice'], NUMBER_OPERATORS),
  open_to_relocate: { ...field('base', 'boolean', ['open_to_relocate'], ['not open to relocate', 'unwilling to relocate', 'cannot relocate', 'open to relocate', 'willing to relocate', 'can relocate', 'relocation'], BOOLEAN_OPERATORS), emptyValues: ['NA'] },
  skills: field('base', 'skills', ['skills'], ['technology', 'technologies', 'tech stack', 'stack', 'expertise', 'proficient in', 'worked with', 'skills', 'skill', 'knows'], SKILL_OPERATORS),
  education: field('base', 'text', ['education'], ['qualification', 'degree', 'academics', 'education'], TEXT_OPERATORS),
  linkedin: field('base', 'text', ['linkedin_url'], ['linkedin url', 'linkedin', 'profile url'], TEXT_OPERATORS),
  cv: field('base', 'text', ['cv_link', 'resume_url'], ['resume file', 'resume availability', 'candidate cv', 'resume', 'cv'], TEXT_OPERATORS),
  source: field('base', 'text', ['source'], ['candidate source', 'sourced from', 'source'], TEXT_OPERATORS),
  created_date: { ...field('base', 'date', ['created_at'], ['created date', 'added date', 'submission date', 'candidate date', 'month', 'submission month', 'candidate month', 'created month', 'added month', 'month added', 'created', 'added', 'uploaded', 'registered'], DATE_OPERATORS), timestamp: true },
  updated_date: { ...field('base', 'date', ['updated_at'], ['updated date', 'modified date', 'updated', 'modified'], DATE_OPERATORS), timestamp: true },
  consultant: field('association', 'text', ['consultant_name'], ['consultant name', 'assigned consultant', 'candidate owner', 'handled by', 'managed by', 'assigned to', 'working with', 'consultant', 'recruiter', 'owner'], TEXT_OPERATORS),
  consultant_user_id: { ...field('association', 'identifier', ['consultant_user_id'], [], IDENTIFIER_OPERATORS), internal: true },
  client_id: field('association', 'identifier', ['client_id'], ['client id', 'cl id'], IDENTIFIER_OPERATORS),
  client_name: field('association', 'text', ['client_name'], ['client name', 'company hiring', 'hiring client', 'for client', 'submitted to', 'client'], TEXT_OPERATORS),
  job_id: field('association', 'identifier', ['job_id'], ['mandate id', 'job id', 'jb id'], IDENTIFIER_OPERATORS),
  role: field('association', 'text', ['job_title'], ['mandate title', 'applied role', 'job role', 'opening', 'mandate', 'position', 'role'], TEXT_OPERATORS),
  status: { ...field('association', 'enum', ['status'], ['candidate status', 'pipeline status', 'current status', 'candidate stage', 'status', 'stage'], ENUM_OPERATORS), values: ['-', ...CANDIDATE_STATUSES] },
  current_ctc: field('association', 'money', ['current_salary'], ['present salary', 'present package', 'present ctc', 'current salary', 'current package', 'current ctc'], NUMBER_OPERATORS),
  expected_ctc: field('association', 'money', ['expected_salary'], ['desired salary', 'desired package', 'salary expectation', 'expected salary', 'expected package', 'expected ctc'], NUMBER_OPERATORS),
  offered_ctc: field('association', 'money', ['offered_ctc'], ['offered salary', 'offered package', 'offered ctc'], NUMBER_OPERATORS),
  date_of_joining: field('association', 'date', ['date_of_joining'], ['joining date', 'date of joining', 'doj'], DATE_OPERATORS),
  comments: field('association', 'text', ['notes'], ['remarks', 'comments', 'comment', 'notes'], TEXT_OPERATORS)
}

function field(domain, type, columns, aliases, operators) {
  return { domain, type, columns, aliases, operators }
}

const aliasToField = new Map()
for (const [name, meta] of Object.entries(FIELD_REGISTRY)) {
  for (const alias of [name, ...meta.aliases]) aliasToField.set(normalizeWords(alias), name)
}
const sortedAliases = [...aliasToField.keys()].sort((a, b) => b.length - a.length)
const CREATED_MONTH_ALIASES = new Set(['month', 'submission month', 'candidate month', 'created month', 'added month', 'month added'])

const STATUS_ALIASES = new Map([
  ['-', '-'], ['dash', '-'], ['hyphen', '-'], ['minus', '-'],
  ['in discussion', 'In Discussion'], ['in discussions', 'In Discussion'], ['discussion', 'In Discussion'], ['under discussion', 'In Discussion'], ['being discussed', 'In Discussion'], ['discussion stage', 'In Discussion'], ['in discusion', 'In Discussion'], ['in dicussion', 'In Discussion'],
  ['interested', 'Interested'], ['intersted', 'Interested'],
  ['not interested', 'Not Interested'], ['not intersted', 'Not Interested'],
  ['interview', 'Interview'], ['interview stage', 'Interview'],
  ['client submission', 'Client Submission'], ['submitted to client', 'Client Submission'], ['client submitted', 'Client Submission'], ['client submision', 'Client Submission'], ['client submisson', 'Client Submission'],
  ['offered', 'Offered'], ['offer', 'Offered'], ['received an offer', 'Offered'],
  ['hired', 'Hired'],
  ['offer declined', 'Offer Declined'], ['declined offer', 'Offer Declined'],
  ['dropout', 'Dropout'], ['dropped out', 'Dropout'],
  ['rejected by recruiter', 'Rejected by Recruiter'], ['recruiter rejected', 'Rejected by Recruiter'], ['rejected by recruter', 'Rejected by Recruiter'],
  ['rejected by client', 'Rejected by Client'], ['client rejected', 'Rejected by Client'], ['rejected by clint', 'Rejected by Client']
])
for (const status of CANDIDATE_STATUSES) STATUS_ALIASES.set(status.toLowerCase(), status)

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function normalizeWords(value) { return clean(value).toLowerCase().replace(/[_-]+/g, ' ') }
function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3)
  return digits
}
function phoneStorageVariants(value) {
  const phone = normalizePhone(value)
  if (!phone) return []
  if (phone.length !== 10) return [phone]
  return [...new Set([phone, `+91${phone}`, `91${phone}`, `091${phone}`])]
}
function normalizeStatus(value) {
  if (clean(value) === '-') return '-'
  const text = normalizeWords(value).replace(/^currently\s+/, '')
  return STATUS_ALIASES.get(text) || ''
}

const SMALL_NUMBERS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9],
  ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90]
])

function numberFromWords(value) {
  const tokens = normalizeWords(value).split(/\s+/).filter(Boolean)
  let total = 0
  let current = 0
  let consumed = false
  for (const token of tokens) {
    if (token === 'and' && consumed) continue
    if (SMALL_NUMBERS.has(token)) {
      const amount = SMALL_NUMBERS.get(token)
      current += amount
      consumed = true
      continue
    }
    if (token === 'hundred' && consumed) {
      current = Math.max(current, 1) * 100
      continue
    }
    if (token === 'thousand' && consumed) {
      total += Math.max(current, 1) * 1000
      current = 0
      continue
    }
    if (consumed) break
  }
  return consumed ? total + current : null
}

function numericValue(value) {
  const text = clean(value).toLowerCase().replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (match) return Number(match[0])
  return numberFromWords(text)
}

function normalizeMoney(value) {
  const text = clean(value).toLowerCase().replace(/,/g, '')
  const amount = numericValue(text)
  if (!Number.isFinite(amount) || amount < 0) return null
  if (/\b(?:crore|crores|cr)\b/.test(text)) return Math.round(amount * 10000000)
  if (/\b(?:lakh|lakhs|lac|lpa)\b/.test(text) || amount <= 200) return Math.round(amount * 100000)
  return Math.round(amount)
}
function normalizeNumber(value, fieldName) {
  const text = clean(value).toLowerCase()
  let number = numericValue(text)
  if (!Number.isFinite(number) || number < 0) return null
  if (fieldName === 'experience') {
    if (/\bmonths?\b/.test(text)) number /= 12
    if (/\bweeks?\b/.test(text)) number /= 52
  }
  if (fieldName === 'notice_period') {
    if (/\bmonths?\b/.test(text)) number *= 30
    if (/\bweeks?\b/.test(text)) number *= 7
    if (/\byears?\b/.test(text)) number *= 365
  }
  return number
}
function kolkataDateParts(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function validIsoDate(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return ''
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function normalizeDate(value, now = new Date()) {
  const text = clean(value).toLowerCase()
  const today = new Date(`${kolkataDateParts(now)}T00:00:00+05:30`)
  if (text === 'today') return kolkataDateParts(today)
  if (text === 'tomorrow' || text === 'yesterday') {
    today.setUTCDate(today.getUTCDate() + (text === 'tomorrow' ? 1 : -1))
    return kolkataDateParts(today)
  }
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (ymd) return validIsoDate(ymd[1], ymd[2], ymd[3]) || null
  const numericDmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (numericDmy) return validIsoDate(numericDmy[3], numericDmy[2], numericDmy[1]) || null
  const dmy = text.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/)
  if (dmy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.findIndex(item => dmy[2].startsWith(item))
    if (month >= 0) return validIsoDate(dmy[3] || kolkataDateParts(today).slice(0, 4), month + 1, dmy[1]) || null
  }
  const monthYear = text.match(/^([a-z]+)(?:\s+(\d{4}))?$/)
  if (monthYear) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.findIndex(item => monthYear[1].startsWith(item))
    if (month >= 0) {
      const year = Number(monthYear[2] || kolkataDateParts(today).slice(0, 4))
      return `${year}-${String(month + 1).padStart(2, '0')}-01`
    }
  }
  return null
}
function relativeDateRange(value, now = new Date()) {
  const text = normalizeWords(value).replace(/^in the /, '')
  const today = new Date(`${kolkataDateParts(now)}T00:00:00+05:30`)
  const day = (date) => kolkataDateParts(date)
  const shift = (date, amount) => { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next }
  if (text === 'this week' || text === 'last week') {
    const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(today)
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayName]
    const start = shift(today, 1 - weekday + (text === 'last week' ? -7 : 0))
    return [day(start), day(shift(start, 6))]
  }
  if (text === 'this month' || text === 'last month') {
    const parts = day(today).split('-').map(Number)
    const start = new Date(Date.UTC(parts[0], parts[1] - 1 + (text === 'last month' ? -1 : 0), 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    const utcDay = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    return [utcDay(start), utcDay(end)]
  }
  if (text === 'this year' || text === 'last year') {
    const currentYear = Number(day(today).slice(0, 4)) + (text === 'last year' ? -1 : 0)
    return [`${currentYear}-01-01`, `${currentYear}-12-31`]
  }
  if (['this financial year', 'current financial year', 'this fy', 'current fy'].includes(text)) {
    const parts = day(today).split('-').map(Number)
    const startYear = parts[1] >= 4 ? parts[0] : parts[0] - 1
    return [`${startYear}-04-01`, `${startYear + 1}-03-31`]
  }
  const monthOnly = text.match(/^(?:in\s+)?([a-z]+)(?:\s+(\d{4}))?$/)
  if (monthOnly) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.findIndex(item => monthOnly[1].startsWith(item))
    if (month >= 0) {
      const year = Number(monthOnly[2] || day(today).slice(0, 4))
      const endDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      return [`${year}-${String(month + 1).padStart(2, '0')}-01`, `${year}-${String(month + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`]
    }
  }
  const days = text.match(/^last (\d+) days?$/)
  if (days) return [day(shift(today, -(Number(days[1]) - 1))), day(today)]
  return null
}

function normalizeOperator(value) {
  const text = normalizeWords(value)
  const map = {
    'is': 'equals', '=': 'equals', 'equals': 'equals', 'equal to': 'equals', 'exactly': 'equals', 'as': 'equals',
    'is not': 'not_equals', 'not equal': 'not_equals', 'not equals': 'not_equals', 'except': 'not_equals', 'anything except': 'not_equals',
    'contains': 'contains', 'include': 'contains', 'includes': 'contains', 'has': 'contains', 'having': 'contains',
    'does not contain': 'not_contains', 'does not include': 'not_contains', 'without': 'not_contains',
    'starts with': 'starts_with', 'ends with': 'ends_with', 'ending in': 'ends_with', 'ending with': 'ends_with',
    '>': 'greater_than', 'above': 'greater_than', 'more than': 'greater_than', 'greater than': 'greater_than', 'over': 'greater_than',
    '>=': 'greater_than_or_equal', 'at least': 'greater_than_or_equal', 'minimum': 'greater_than_or_equal',
    '<': 'less_than', 'below': 'less_than', 'less than': 'less_than', 'under': 'less_than',
    '<=': 'less_than_or_equal', 'up to': 'less_than_or_equal', 'at most': 'less_than_or_equal', 'maximum': 'less_than_or_equal',
    'before': 'before', 'after': 'after', 'on': 'on', 'on or before': 'on_or_before', 'on or after': 'on_or_after', 'between': 'between'
  }
  return map[text] || text.replace(/\s+/g, '_')
}

function condition(fieldName, operator, value) { return { type: 'condition', field: fieldName, operator, ...(value !== undefined ? { value } : {}) } }
function group(combinator, children) { return children.length === 1 ? children[0] : { type: 'group', combinator, children } }

function preparePrompt(input) {
  let text = clean(input).replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  text = text.replace(/^(.+?)(?:'s|s')\s+(?:assigned\s+)?candidates?$/i, 'consultant is $1')
  text = text.replace(/^(?:please\s+)?(?:show|give|find|get|list|display|fetch|return)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:candidates?|people|anyone|applicants?)\s+(?:who|whose|where|having|with)?\s*/i, '')
  text = text.replace(/^i\s+(?:need|want)\s+(?:all\s+)?(?:candidates?|people)\s+(?:who|whose|where|with)?\s*/i, '')
  text = text.replace(/^submitted to (?:the )?client by\s+(.+)$/i, 'status is Client Submission and consultant is $1')
  text = text.replace(/^named\s+(.+)$/i, 'candidate name contains $1')
  text = text.replace(/^(?:show|find)\s+(?:me\s+)?(?:candidates?\s+)?named\s+(.+)$/i, 'candidate name contains $1')
  text = text.replace(/^show\s+me\s+([a-z][\w .'-]+)$/i, 'candidate name contains $1')
  text = text.replace(/^are\s+(?:currently\s+)?(?:in|under)\s+discussion$/i, 'status is In Discussion')
  text = text.replace(/\b(?:who|that)\s+are\s+(?:currently\s+)?(?:in|under)\s+discussion\b/gi, 'status is In Discussion')
  text = text.replace(/\bcurrently\s+under\s+discussion\b|\bbeing\s+discussed\b/gi, 'status is In Discussion')
  text = text.replace(/\bnot handled by\s+/gi, 'consultant is not ').replace(/\bhandled by\s+/gi, 'consultant is ').replace(/\bmanaged by\s+/gi, 'consultant is ').replace(/\bassigned to\s+/gi, 'consultant is ')
  text = text.replace(/\bno consultant assigned\b/gi, 'consultant is empty')
  text = text.replace(/\bnumber ending (?:in|with)\s+/gi, 'mobile ends with ').replace(/\blast four digits (?:are|is)\s+/gi, 'mobile ends with ')
  text = text.replace(/\bwithout (?:a )?(?:mobile|phone)(?: number)?\b/gi, 'mobile is empty').replace(/\bwithout (?:an )?email\b/gi, 'email is empty')
  text = text.replace(/\b(?:without (?:a )?(?:selected )?status|no status assigned|no selected status|status has not been assigned)\b/gi, 'status is empty')
  text = text.replace(/^(?:candidates?\s+)?with a (?:dash|hyphen) status$/i, 'status is -')
  text = text.replace(/^(?:candidates?\s+)?at (?:the )?interview stage$/i, 'status is Interview')
  text = text.replace(/^show\s+(.+?)\s+candidates?$/i, '$1 candidates')
  text = text.replace(/\bemail domain\s+(?:is|equals)?\s*([a-z0-9.-]+)\b/gi, 'email ends with @$1')
  text = text.replace(/\bcan join immediately\b|\bimmediate joiner\b/gi, 'notice period equals 0')
  text = text.replace(/^serving notice(?: period)?$/i, 'notice period greater than 0')
  text = text.replace(/^salary is (blank|empty|missing)$/i, '(current ctc is $1 or expected ctc is $1)')
  text = text.replace(/^has both (.+?) and (.+)$/i, 'skills contains $1 and skills contains $2')
  text = text.replace(/^has (any|all) of (.+)$/i, (_, mode, list) => list.split(/\s*,\s*|\s+(?:or|and)\s+/i).map(item => item.replace(/^(?:or|and)\s+/i, '')).filter(Boolean).map(item => `skills contains ${item}`).join(mode.toLowerCase() === 'any' ? ' or ' : ' and '))
  text = text.replace(/^(.+?)\s+but not\s+(.+)$/i, 'skills contains $1 and skills does not contain $2')
  text = text.replace(/^(.+?)\s+candidates?\s+without\s+(.+?)(?=\s+and\s+|$)/i, 'skills contains $1 and skills does not contain $2')
  text = text.replace(/^does not know\s+(.+)$/i, 'skills does not contain $1')
  text = text.replace(/\bwithout skills\b/gi, 'skills is empty').replace(/\bskills are\b/gi, 'skills is')
  text = text.replace(/^(\d+(?:\.\d+)?)\s*(years?|months?)\s+experience\s+in\s+(.+)$/i, 'experience equals $1 $2 and skills contains $3')
  text = text.replace(/^(\d+(?:\.\d+)?)\s*(years?|months?)\s+(?:of\s+)?experience$/i, 'experience equals $1 $2')
  text = text.replace(/\b(more than|at least|less than|up to)\s+(\d+(?:\.\d+)?)\s*(years?|months?)\s+(?:of\s+)?experience\b/gi, 'experience $1 $2 $3')
  text = text.replace(/\b(\d+(?:\.\d+)?)\+\s*years?\s+(?:of\s+)?experience\b/gi, 'experience at least $1 years')
  text = text.replace(/\bbetween\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s+years?\s+(?:of\s+)?experience\b/gi, 'experience between $1 and $2')
  text = text.replace(/\b(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s+years?\s+(?:of\s+)?experience\b/gi, 'experience between $1 and $2')
  text = text.replace(/\s+with\s+(?=(?:status|consultant|client|location|experience|notice|skills?|mobile|email|current|expected)\b)/gi, ' and ')
  text = text.replace(/\bstatus\s*[:=]\s*/gi, 'status is ').replace(/\bmobile\s*:\s*/gi, 'mobile is ').replace(/\bconsultant\s*:\s*/gi, 'consultant is ')
  text = text.replace(/\s*,\s*(?=(?:status|consultant|mobile|email|location|experience|client|mandate|skills?)\b)/gi, ' and ')
  return clean(text)
}

function splitTopLevel(text, word) {
  const result = []
  let depth = 0
  let quote = ''
  let start = 0
  const lowerText = text.toLowerCase()
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') { depth += 1; continue }
    if (char === ')') { depth -= 1; continue }
    if (depth !== 0) continue
    const token = ` ${word} `
    if (lowerText.slice(index, index + token.length) !== token) continue
    const before = text.slice(start, index)
    if (word === 'and' && before.toLowerCase().lastIndexOf('between') > before.toLowerCase().lastIndexOf(' and ')) continue
    result.push(clean(before)); start = index + token.length; index = start - 1
  }
  result.push(clean(text.slice(start)))
  return result.filter(Boolean)
}

function stripOuterParens(value) {
  let text = clean(value)
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0; let closesAtEnd = true
    for (let i = 0; i < text.length; i += 1) { if (text[i] === '(') depth += 1; if (text[i] === ')') depth -= 1; if (depth === 0 && i < text.length - 1) { closesAtEnd = false; break } }
    if (!closesAtEnd) break
    text = clean(text.slice(1, -1))
  }
  return text
}

function findField(text) {
  const normalized = normalizeWords(text)
  let best = null
  for (const alias of sortedAliases) {
    const index = normalized.search(new RegExp(`(?:^|\\b)${escapeRegex(alias)}(?:\\b|$)`, 'i'))
    if (index >= 0 && (!best || index < best.index || (index === best.index && alias.length > best.alias.length))) best = { field: aliasToField.get(alias), alias, index }
  }
  return best
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function parseConditionText(raw, inherited = null, now = new Date()) {
  let text = stripOuterParens(clean(raw).replace(/[.;]+$/, ''))
  if (!text) return null
  const sourceText = text
  const low = normalizeWords(text)

  const impliedStatus = [...STATUS_ALIASES.entries()].sort((a, b) => b[0].length - a[0].length).find(([alias]) => low === `${alias} candidates` || low === `candidates ${alias}` || low === alias)
  if (impliedStatus) return condition('status', 'equals', impliedStatus[1])
  if (/^(?:candidates?\s+)?(?:in discussions?|discussion stage)(?:\s+candidates?)?$/i.test(text)) return condition('status', 'equals', 'In Discussion')
  if (/^(?:has|knows|experience in)\s+(.+)$/i.test(text)) return condition('skills', 'contains', text.match(/^(?:has|knows|experience in)\s+(.+)$/i)[1])
  if (/^([a-z0-9+#. -]+)\s+candidates?$/i.test(text) && !findField(text)) return condition('skills', 'contains', text.match(/^(.+?)\s+candidates?$/i)[1])
  if (/^[a-z][a-z0-9+#.-]*$/i.test(text) && !findField(text) && !inherited) return condition('skills', 'contains', text)
  if (/^(?:based|located|living)\s+in\s+(.+)$/i.test(text)) return condition('current_location', 'contains', text.match(/\s+in\s+(.+)$/i)[1])
  if (/^(?:from)\s+(.+)$/i.test(text)) return condition('current_location', 'contains', text.match(/^from\s+(.+)$/i)[1])

  const found = findField(text)
  let fieldName = found?.field || inherited?.field
  if (!fieldName) return null
  const meta = FIELD_REGISTRY[fieldName]
  const prefixText = found ? clean(sourceText.slice(0, found.index)) : ''
  if (found) text = clean(text.slice(found.index + found.alias.length))

  if (fieldName === 'status' && /^(?:is\s+)?not selected$/i.test(text)) return condition(fieldName, 'is_empty')
  if (/^(?:is\s+)?not\s+(?:blank|empty|missing|assigned|provided|filled)$/i.test(text)) return condition(fieldName, 'is_not_empty')
  if (meta.type !== 'boolean' && /^(?:is\s+)?(?:available|present|provided|filled)$/i.test(text)) return condition(fieldName, 'is_not_empty')
  if (/^(?:is\s+)?(?:blank|empty|missing|null|not selected|unselected|not assigned|not provided|not filled|not available|unavailable|not applicable|n\/?a|unknown)$/i.test(text)) return condition(fieldName, 'is_empty')
  if (/^(?:has no value|without)$/i.test(text)) return condition(fieldName, 'is_empty')
  if (fieldName === 'status' && /^is\s+not interested$/i.test(text) && !/^is\s+not Interested$/.test(text)) return condition(fieldName, 'equals', 'Not Interested')

  if (meta.type === 'boolean') {
    const booleanText = normalizeWords(sourceText)
    if (/\b(?:not|not open|not willing|unwilling|cannot|can't|no|false)\b/.test(booleanText)) return condition(fieldName, 'equals', false)
    if (!text || /\b(?:open|willing|can|yes|true)\b/.test(booleanText)) return condition(fieldName, 'equals', true)
  }

  if (meta.type === 'date') {
    const relative = relativeDateRange(text, now)
    if (relative) return condition(fieldName, 'between', relative)
    if (/^(?:today|tomorrow|yesterday)$/i.test(text)) return condition(fieldName, 'on', text)
  }

  const between = text.match(/^(?:is\s+)?between\s+(.+?)\s+and\s+(.+)$/i) || text.match(/^(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)(.*)$/i)
  if (between) return condition(fieldName, 'between', [between[1], between[2]])
  const operatorMatch = text.match(/^(?:is\s+)?(anything except|does not contain|does not include|greater than or equal to|less than or equal to|more than|greater than|less than|at least|at most|starts with|ends with|ending in|ending with|not equal(?:s)?|is not|equal to|equals|exactly|contains|includes|include|having|has|above|below|under|over|up to|minimum|maximum|before|after|on|as|is|=|>=|<=|>|<)\s*(.*)$/i)
  let operator = operatorMatch ? normalizeOperator(operatorMatch[1]) : inherited?.operator || (['enum', 'phone', 'email'].includes(meta.type) ? 'equals' : 'contains')
  if (!operatorMatch && /\bnot\b/i.test(prefixText) && ['text', 'email', 'phone'].includes(meta.type)) operator = 'not_equals'
  let value = clean(operatorMatch ? operatorMatch[2] : text).replace(/^["']|["']$/g, '')
  if (!value) return null
  if (EMPTY_WORDS.test(value)) return condition(fieldName, operator === 'not_equals' ? 'is_not_empty' : 'is_empty')
  if (fieldName === 'status' && /^not interested$/i.test(value) && operator === 'equals') value = 'Not Interested'
  return condition(fieldName, operator, value)
}

function parseExpression(text, inherited = null, now = new Date()) {
  const source = stripOuterParens(text)
  const ors = splitTopLevel(source, 'or')
  if (ors.length > 1) {
    let last = inherited
    const children = ors.map(part => { const node = parseExpression(part, last, now); const leaf = rightmostCondition(node); if (leaf) last = leaf; return node }).filter(Boolean)
    return children.length === ors.length ? group('OR', children) : null
  }
  const ands = splitTopLevel(source, 'and')
  if (ands.length > 1) {
    let last = inherited
    const children = ands.map(part => { const node = parseExpression(part, last, now); const leaf = rightmostCondition(node); if (leaf) last = leaf; return node }).filter(Boolean)
    return children.length === ands.length ? group('AND', children) : null
  }
  return parseConditionText(source, inherited, now)
}
function rightmostCondition(node) { return node?.type === 'condition' ? node : node?.children?.length ? rightmostCondition(node.children[node.children.length - 1]) : null }

function parseCandidatePrompt(prompt, options = {}) {
  if (candidatePromptIssue(prompt)) return null
  const prepared = preparePrompt(prompt)
  let root = parseExpression(prepared, null, options.now || new Date())
  if (!root) return null
  const hasStatus = flattenConditions(root).some(item => item.field === 'status')
  if (!hasStatus) {
    const normalizedPrompt = normalizeWords(prompt)
    const implied = [...STATUS_ALIASES.entries()]
      .filter(([alias, status]) => status !== '-' && normalizedPrompt.includes(`${alias} candidates`))
      .sort((left, right) => right[0].length - left[0].length)[0]
    if (implied) root = group('AND', [condition('status', 'equals', implied[1]), root])
  }
  try { return validateCandidateFilter({ root }, options) } catch { return null }
}
function candidatePromptIssue(prompt) {
  if (typeof prompt !== 'string' || !clean(prompt)) return 'A filter query is required.'
  if (prompt.length > MAX_QUERY_LENGTH) return 'The filter query is too long.'
  if (/\b(?:delete|update|insert|drop|alter|truncate|run sql|select \*|ignore permissions?|bypass permissions?|show everything)\b/i.test(prompt)) return 'Only read-only candidate filters are supported.'
  if ((prompt.match(/\(/g) || []).length !== (prompt.match(/\)/g) || []).length) return 'The filter has unbalanced parentheses.'
  return ''
}

function normalizeValue(meta, fieldName, operator, raw, now) {
  if (['is_empty', 'is_not_empty', 'is_null', 'is_not_null'].includes(operator)) return undefined
  const values = ['between', 'in', 'not_in', 'contains_all', 'contains_any'].includes(operator) ? (Array.isArray(raw) ? raw : String(raw ?? '').split(',')) : null
  if (values) {
    if (!values.length || values.length > MAX_IN_VALUES || (operator === 'between' && values.length !== 2)) throw invalid('Invalid filter values.')
    const normalized = values.map(value => normalizeValue(meta, fieldName, operator === 'between' ? 'equals' : operator === 'contains_all' || operator === 'contains_any' ? 'contains' : 'equals', value, now))
    if (operator === 'between' && normalized[0] > normalized[1]) throw invalid('Invalid filter range.')
    return normalized
  }
  if (meta.type === 'enum') {
    const status = normalizeStatus(raw)
    if (!status) throw invalid('Unknown candidate status.')
    return status
  }
  if (meta.type === 'phone') {
    const phone = normalizePhone(raw)
    if (!phone || phone.length < 4 || phone.length > 15) throw invalid('Invalid mobile number.')
    return phone
  }
  if (meta.type === 'number') {
    const number = normalizeNumber(raw, fieldName)
    if (number === null) throw invalid('Invalid numeric filter.')
    return number
  }
  if (meta.type === 'money') {
    const amount = normalizeMoney(raw)
    if (amount === null) throw invalid('Invalid salary filter.')
    return amount
  }
  if (meta.type === 'boolean') {
    const text = normalizeWords(raw)
    if (['yes', 'true', 'willing', 'open', 'can relocate', 'willing to relocate', 'open to relocate'].includes(text)) return true
    if (['no', 'false', 'not willing', 'not open', 'cannot relocate', 'unwilling to relocate', 'not open to relocate'].includes(text)) return false
    throw invalid('Invalid yes/no filter.')
  }
  if (meta.type === 'date') {
    const date = normalizeDate(raw, now)
    if (!date) throw invalid('Invalid date filter.')
    return date
  }
  const value = clean(raw)
  if (!value || value.length > 180) throw invalid('Invalid text filter.')
  return meta.type === 'email' ? value.toLowerCase() : value
}

function validateCandidateFilter(input, options = {}) {
  const allowed = options.allowedFields ? new Set(options.allowedFields) : null
  let count = 0
  function visit(node, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) throw invalid('Filter is too deeply nested.')
    if (node.type === 'group') {
      const combinator = String(node.combinator || '').toUpperCase()
      if (!['AND', 'OR'].includes(combinator) || !Array.isArray(node.children) || node.children.length < 2 || node.children.length > MAX_CONDITIONS) throw invalid('Invalid filter group.')
      return { type: 'group', combinator, children: node.children.map(child => visit(child, depth + 1)) }
    }
    if (node.type !== 'condition') throw invalid('Invalid filter node.')
    count += 1
    if (count > MAX_CONDITIONS) throw invalid('Too many filter conditions.')
    const requestedField = normalizeWords(node.field)
    const fieldName = aliasToField.get(requestedField) || node.field
    const meta = FIELD_REGISTRY[fieldName]
    if (!meta || (allowed && !allowed.has(fieldName))) throw invalid('Unsupported or unavailable candidate field.')
    let operator = normalizeOperator(node.operator)
    let rawValue = node.value
    if (
      meta.type === 'date' &&
      typeof rawValue === 'string' &&
      (['equals', 'on'].includes(operator) || (fieldName === 'created_date' && CREATED_MONTH_ALIASES.has(requestedField) && operator === 'contains'))
    ) {
      const period = relativeDateRange(rawValue, options.now || new Date())
      if (period) {
        operator = 'between'
        rawValue = period
      }
    }
    if (!meta.operators.includes(operator)) throw invalid(`Operator ${operator} is not supported for ${fieldName}.`)
    const value = normalizeValue(meta, fieldName, operator, rawValue, options.now || new Date())
    return condition(fieldName, operator, value)
  }
  const root = visit(input?.root || legacyRoot(input), 1)
  return { version: 1, mode: 'ast', root, conditions: flattenConditions(root) }
}
function legacyRoot(input) {
  const conditions = Array.isArray(input?.conditions) ? input.conditions.map(item => ({ type: 'condition', ...item })) : []
  if (!conditions.length) return null
  return group(String(input.logic || '').toUpperCase() === 'OR' || input.mode === 'any' ? 'OR' : 'AND', conditions)
}
function flattenConditions(node) { return node.type === 'condition' ? [node] : node.children.flatMap(flattenConditions) }
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_CANDIDATE_FILTER' }) }

function nodeDomain(node) {
  if (node.type === 'condition') return FIELD_REGISTRY[node.field].domain
  const domains = new Set(node.children.map(nodeDomain))
  return domains.size === 1 ? [...domains][0] : 'mixed'
}
function quoteValue(value) { return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` }
function nextCalendarDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
function kolkataDayStart(value) { return `${value}T00:00:00+05:30` }
function scalarClause(column, operator, value, meta) {
  if (operator === 'is_null') return `${column}.is.null`
  if (operator === 'is_not_null') return `${column}.not.is.null`
  if (operator === 'is_empty') {
    const clauses = [`${column}.is.null`]
    if (['number', 'money', 'date', 'identifier'].includes(meta.type)) return clauses[0]
    if (meta.type === 'skills') clauses.push(`${column}.eq.{}`)
    else {
      clauses.push(`${column}.eq.${quoteValue('')}`, `${column}.eq.-`, `${column}.match.${quoteValue('^\\s*$')}`)
      for (const emptyValue of meta.emptyValues || []) clauses.push(`${column}.eq.${quoteValue(emptyValue)}`)
    }
    return `or(${clauses.join(',')})`
  }
  if (operator === 'is_not_empty') {
    const clauses = [`${column}.not.is.null`]
    if (['number', 'money', 'date', 'identifier'].includes(meta.type)) return clauses[0]
    if (meta.type === 'skills') clauses.push(`${column}.neq.{}`)
    else {
      clauses.push(`${column}.neq.${quoteValue('')}`, `${column}.neq.-`, `${column}.not.match.${quoteValue('^\\s*$')}`)
      for (const emptyValue of meta.emptyValues || []) clauses.push(`${column}.neq.${quoteValue(emptyValue)}`)
    }
    return `and(${clauses.join(',')})`
  }
  if (meta.type === 'skills') {
    const values = Array.isArray(value) ? value : [value]
    if (operator === 'contains_all') return `${column}.cs.${quoteValue(`{${values.join(',')}}`)}`
    if (operator === 'contains_any') return `or(${values.map(item => `${column}.cs.${quoteValue(`{${item}}`)}`).join(',')})`
    if (operator === 'not_contains') return `${column}.not.cs.${quoteValue(`{${values[0]}}`)}`
    return `${column}.cs.${quoteValue(`{${values[0]}}`)}`
  }
  if (meta.type === 'phone' && ['equals', 'not_equals'].includes(operator)) {
    const variants = phoneStorageVariants(value).map(quoteValue).join(',')
    return `${column}.${operator === 'equals' ? 'in' : 'not.in'}.(${variants})`
  }
  if (meta.type === 'date' && meta.timestamp) {
    const start = item => quoteValue(kolkataDayStart(item))
    const next = item => quoteValue(kolkataDayStart(nextCalendarDate(item)))
    if (operator === 'equals' || operator === 'on') return `and(${column}.gte.${start(value)},${column}.lt.${next(value)})`
    if (operator === 'not_equals') return `or(${column}.lt.${start(value)},${column}.gte.${next(value)})`
    if (operator === 'between') return `and(${column}.gte.${start(value[0])},${column}.lt.${next(value[1])})`
    if (operator === 'before') return `${column}.lt.${start(value)}`
    if (operator === 'after') return `${column}.gte.${next(value)}`
    if (operator === 'on_or_before') return `${column}.lt.${next(value)}`
    if (operator === 'on_or_after') return `${column}.gte.${start(value)}`
  }
  const caseInsensitiveExact = ['text', 'email'].includes(meta.type)
  const op = { equals: caseInsensitiveExact ? 'ilike' : 'eq', not_equals: caseInsensitiveExact ? 'not.ilike' : 'neq', contains: 'ilike', not_contains: 'not.ilike', starts_with: 'ilike', ends_with: 'ilike', greater_than: 'gt', greater_than_or_equal: 'gte', less_than: 'lt', less_than_or_equal: 'lte', before: 'lt', after: 'gt', on: 'eq', on_or_before: 'lte', on_or_after: 'gte' }[operator]
  if (operator === 'between') return `and(${column}.gte.${quoteValue(value[0])},${column}.lte.${quoteValue(value[1])})`
  if (operator === 'in' || operator === 'not_in') {
    if (caseInsensitiveExact) {
      const clauses = value.map(item => `${column}.${operator === 'in' ? 'ilike' : 'not.ilike'}.${quoteValue(item)}`)
      return `${operator === 'in' ? 'or' : 'and'}(${clauses.join(',')})`
    }
    return `${column}.${operator === 'in' ? 'in' : 'not.in'}.(${value.map(quoteValue).join(',')})`
  }
  const pattern = operator === 'contains' || operator === 'not_contains' ? `*${value}*` : operator === 'starts_with' ? `${value}*` : operator === 'ends_with' ? `*${value}` : value
  return `${column}.${op}.${quoteValue(pattern)}`
}
function compileCondition(node) {
  const meta = FIELD_REGISTRY[node.field]
  const negative = ['not_equals', 'not_contains', 'not_in'].includes(node.operator)
  const clauses = meta.columns.map(column => {
    const clause = scalarClause(column, node.operator, node.value, meta)
    return negative && meta.columns.length > 1 ? `or(${column}.is.null,${clause})` : clause
  })
  if (clauses.length === 1) return clauses[0]
  const requireEveryColumn = negative || ['is_empty', 'is_null'].includes(node.operator)
  return `${requireEveryColumn ? 'and' : 'or'}(${clauses.join(',')})`
}
function compileCandidateAst(node) {
  if (node.type === 'condition') return compileCondition(node)
  return `${node.combinator.toLowerCase()}(${node.children.map(compileCandidateAst).join(',')})`
}

function compare(actual, node) {
  const meta = FIELD_REGISTRY[node.field]
  const values = Array.isArray(actual) ? actual : [actual]
  const allNull = values.every(value => value == null)
  const empty = values.every(value => value == null || clean(value) === '' || clean(value) === '-' || (meta.emptyValues || []).includes(clean(value)) || (Array.isArray(value) && !value.length))
  if (node.operator === 'is_null') return allNull
  if (node.operator === 'is_not_null') return !allNull
  if (node.operator === 'is_empty') return empty
  if (node.operator === 'is_not_empty') return !empty
  const expected = node.value
  const compareOne = raw => {
    if (raw == null) return false
    if (['number', 'money'].includes(meta.type)) {
      const left = Number(raw); if (!Number.isFinite(left)) return false
      if (node.operator === 'between') return left >= expected[0] && left <= expected[1]
      if (node.operator === 'greater_than') return left > expected
      if (node.operator === 'greater_than_or_equal') return left >= expected
      if (node.operator === 'less_than') return left < expected
      if (node.operator === 'less_than_or_equal') return left <= expected
      if (node.operator === 'not_equals') return left !== expected
      return left === expected
    }
    if (meta.type === 'date') {
      const parsed = meta.timestamp ? new Date(raw) : null
      const left = meta.timestamp && !Number.isNaN(parsed.getTime()) ? kolkataDateParts(parsed) : clean(raw).slice(0, 10)
      if (node.operator === 'between') return left >= expected[0] && left <= expected[1]
      if (node.operator === 'before') return left < expected
      if (node.operator === 'after') return left > expected
      if (node.operator === 'on_or_before') return left <= expected
      if (node.operator === 'on_or_after') return left >= expected
      return left === expected
    }
    const left = meta.type === 'phone' ? normalizePhone(raw) : clean(raw).toLowerCase()
    const right = meta.type === 'phone' ? expected : clean(expected).toLowerCase()
    if (node.operator === 'equals') return left === right
    if (node.operator === 'not_equals') return left !== right
    if (node.operator === 'starts_with') return left.startsWith(right)
    if (node.operator === 'ends_with') return left.endsWith(right)
    if (node.operator === 'not_contains') return !left.includes(right)
    if (node.operator === 'in' || node.operator === 'not_in') { const hit = expected.map(item => clean(item).toLowerCase()).includes(left); return node.operator === 'in' ? hit : !hit }
    return left.includes(right)
  }
  const negative = ['not_equals', 'not_contains', 'not_in'].includes(node.operator)
  return negative ? values.every(compareOne) : values.some(compareOne)
}
function evaluateCandidateAst(node, row, getter = (item, fieldName) => item[fieldName]) {
  if (node.type === 'condition') return compare(getter(row, node.field), node)
  return node.combinator === 'AND' ? node.children.every(child => evaluateCandidateAst(child, row, getter)) : node.children.some(child => evaluateCandidateAst(child, row, getter))
}

module.exports = {
  FIELD_REGISTRY, STATUS_ALIASES, MAX_QUERY_LENGTH, MAX_DEPTH, MAX_CONDITIONS,
  normalizePhone, phoneStorageVariants, normalizeStatus, normalizeMoney, normalizeDate,
  candidatePromptIssue, parseCandidatePrompt, validateCandidateFilter,
  flattenConditions, nodeDomain, compileCandidateAst, evaluateCandidateAst
}
