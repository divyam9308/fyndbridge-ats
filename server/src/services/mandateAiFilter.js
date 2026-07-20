const {
  TEXT_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  DATE_OPERATORS,
  BOOLEAN_OPERATORS,
  ARRAY_OPERATORS,
  field,
  createEntityFilter,
  normalizeWords
} = require('./entityAiFilterCore')
const { MANDATE_STATUSES } = require('./mandateStatuses')

const MANDATE_SECTORS = [
  'Agriculture', 'Automotive', 'Consumer, Retail & Durables', 'EPC', 'Ecommerce', 'Education',
  'Financial Services', 'Healthcare', 'Hospitality', 'Logistics & Supply Chain', 'Manufacturing',
  'Oil & Gas', 'Others', 'Pharmaceuticals', 'Power', 'Real Estate', 'Social Sector', 'Technology'
]

const MANDATE_FILTER_PERMISSION_KEYS = {
  job_id: 'job_display_id', consultant: 'consultants', consultant_count: 'consultants',
  team_lead: 'team_lead', client_id: 'client_id', client_name: 'client_name', role: 'title',
  location: 'city', budget: 'budget', experience: 'experience', sector: 'vertical',
  date_of_allocation: 'allocation_date', jd: 'jd_storage_path', status: 'mandate_status', comments: 'comments'
}

const STATUS_ALIASES = {
  active: 'Ongoing (P1)', open: 'Ongoing (P1)', ongoing: 'Ongoing (P1)', 'in progress': 'Ongoing (P1)', p1: 'Ongoing (P1)',
  delivered: 'Delivered (P2)', p2: 'Delivered (P2)',
  paused: 'Paused (P3)', 'on hold': 'Paused (P3)', p3: 'Paused (P3)',
  completed: 'Completed', complete: 'Completed', closed: 'Completed', filled: 'Completed',
  scrapped: 'Scrapped', cancelled: 'Scrapped', canceled: 'Scrapped', abandoned: 'Scrapped'
}

const SECTOR_ALIASES = {
  fintech: 'Financial Services', finance: 'Financial Services', banking: 'Financial Services',
  insurance: 'Financial Services', bfsi: 'Financial Services', technology: 'Technology', tech: 'Technology',
  software: 'Technology', it: 'Technology', retail: 'Consumer, Retail & Durables',
  ecommerce: 'Ecommerce', 'e commerce': 'Ecommerce', pharma: 'Pharmaceuticals',
  logistics: 'Logistics & Supply Chain', 'supply chain': 'Logistics & Supply Chain'
}

function compileSemanticRange(node, context) {
  const { minimum, maximum, ceiling } = this.rangeColumns
  const quote = context.quoteValue
  const value = node.value
  if (node.operator === 'is_empty') return `${minimum}.is.null`
  if (node.operator === 'is_not_empty') return `${minimum}.not.is.null`
  // A requested interval matches only when it has positive-width overlap with
  // the stored label interval. Merely touching at 10/15/20 is not a match.
  if (node.operator === 'between') return `and(${ceiling}.gt.${quote(value[0])},${minimum}.lt.${quote(value[1])})`
  if (node.operator === 'greater_than') return `${ceiling}.gt.${quote(value)}`
  if (node.operator === 'greater_than_or_equal') return `${ceiling}.gte.${quote(value)}`
  if (node.operator === 'less_than') return `${minimum}.lt.${quote(value)}`
  if (node.operator === 'less_than_or_equal') return `${minimum}.lte.${quote(value)}`
  if (node.operator === 'equals' && Array.isArray(value)) return `and(${minimum}.eq.${quote(value[0])},${maximum}.eq.${quote(value[1])})`
  if (node.operator === 'not_equals' && Array.isArray(value)) return `or(${minimum}.neq.${quote(value[0])},${maximum}.neq.${quote(value[1])})`
  if (node.operator === 'equals') return `and(${minimum}.lte.${quote(value)},${ceiling}.gte.${quote(value)})`
  if (node.operator === 'not_equals') return `or(${minimum}.gt.${quote(value)},${ceiling}.lt.${quote(value)})`
  if (node.operator === 'in') return `or(${value.map(item => compileSemanticRange.call(this, { ...node, operator: 'equals', value: item }, context)).join(',')})`
  if (node.operator === 'not_in') return `and(${value.map(item => compileSemanticRange.call(this, { ...node, operator: 'not_equals', value: item }, context)).join(',')})`
  throw new Error(`Unsupported semantic range operator: ${node.operator}`)
}

const budgetRange = {
  minimum: 'ai_budget_min_lpa',
  maximum: 'ai_budget_max_lpa',
  ceiling: 'ai_budget_ceiling_lpa'
}

const experienceRange = {
  minimum: 'ai_experience_min_years',
  maximum: 'ai_experience_max_years',
  ceiling: 'ai_experience_ceiling_years'
}

const MANDATE_FIELDS = {
  job_id: field('text', ['job_display_id'], ['mandate id', 'job id', 'job number', 'jb id'], TEXT_OPERATORS),
  consultant: field('array', ['ai_consultants_normalized'], ['assigned consultant', 'assigned consultants', 'assigned to', 'handled by', 'recruiter assigned', 'consultant', 'consultants', 'recruiter', 'owner'], ARRAY_OPERATORS, {
    reference: 'profile',
    elementType: 'profile_name'
  }),
  consultant_count: field('number', ['ai_consultant_count'], ['number of consultants', 'consultant count', 'multiple consultants'], NUMBER_OPERATORS, { derived: true }),
  team_lead: field('text', ['ai_team_lead_normalized'], ['reporting lead', 'supervised by', 'team lead', 'led by', 'manager', 'lead'], TEXT_OPERATORS, { reference: 'profile' }),
  client_id: field('text', ['ai_client_display_id'], ['client id', 'account id', 'cl id'], TEXT_OPERATORS),
  client_name: field('text', ['ai_client_name', 'ai_client_legacy_name'], ['hiring company', 'client name', 'company', 'organization', 'organisation', 'account', 'client'], TEXT_OPERATORS, { relation: 'clients' }),
  role: field('text', ['title'], ['mandate title', 'job title', 'role opening', 'position', 'opening', 'requirement', 'designation', 'role'], TEXT_OPERATORS),
  location: field('text', ['city', 'state'], ['job location', 'workplace', 'based in', 'located in', 'location', 'city'], TEXT_OPERATORS),
  budget: field('numeric_range', ['budget'], ['salary range', 'compensation', 'package', 'pay range', 'salary', 'budget', 'ctc'], NUMBER_OPERATORS, {
    unit: 'LPA',
    derived: true,
    rangeColumns: budgetRange,
    compile: compileSemanticRange
  }),
  experience: field('numeric_range', ['experience_label', 'experience_min'], ['required experience', 'minimum experience', 'years required', 'experience', 'exp'], NUMBER_OPERATORS, {
    numberKind: 'experience',
    unit: 'years',
    derived: true,
    rangeColumns: experienceRange,
    compile: compileSemanticRange
  }),
  sector: field('enum', ['vertical'], ['business function', 'industry', 'domain', 'vertical', 'function', 'sector'], ENUM_OPERATORS, {
    values: MANDATE_SECTORS,
    valueAliases: SECTOR_ALIASES
  }),
  date_of_allocation: field('date', ['allocation_date'], ['date of allocation', 'allocation date', 'allocated on', 'assigned on', 'opened on', 'mandate date', 'allocated'], DATE_OPERATORS),
  jd: field('availability', ['jd_storage_path', 'jd_url'], ['job description file', 'job description document', 'job description', 'description document', 'jd'], BOOLEAN_OPERATORS, {
    booleanAliases: { true: ['with jd', 'uploaded', 'available', 'present', 'attached'], false: ['without jd', 'missing', 'not uploaded', 'unavailable', 'absent'] }
  }),
  status: field('enum', ['mandate_status'], ['mandate status', 'job status', 'progress', 'status', 'state'], ENUM_OPERATORS, { values: MANDATE_STATUSES, valueAliases: STATUS_ALIASES }),
  comments: field('text', ['notes'], ['mandate comments', 'remarks', 'comments', 'comment', 'notes'], TEXT_OPERATORS),
  created_at: field('date', ['created_at'], ['mandate created', 'created date', 'created at'], DATE_OPERATORS, { timestamp: true }),
  updated_at: field('date', ['updated_at'], ['mandate updated', 'updated date', 'modified date', 'updated at'], DATE_OPERATORS, { timestamp: true })
}

// Bind the custom range compiler to each field's metadata. The generic core
// intentionally gives compilers no database schema beyond their own registry.
MANDATE_FIELDS.budget.compile = compileSemanticRange.bind(MANDATE_FIELDS.budget)
MANDATE_FIELDS.experience.compile = compileSemanticRange.bind(MANDATE_FIELDS.experience)

function prepareMandatePrompt(value) {
  let text = String(value || '').replace(/[’‘]/g, "'")
  const possessive = text.match(/^\s*(.+?)\s*'s\s+(?:mandates?|jobs?)\s*$/i)
  if (possessive) return `consultant contains ${possessive[1]}`
  text = text.replace(/^\s*(?:show|find|list|get|give me)\s+(?:me\s+)?/i, '')
  text = text.replace(/^\s*(ongoing|active|open|p1|delivered|p2|paused|on hold|p3|completed|closed|scrapped|cancelled|canceled)\s+(?:mandates?|jobs?)\s+/i, 'status equals $1 and ')
  text = text.replace(/^\s*(?:all\s+)?(?:mandates?|jobs?|vacancies|openings)\s+/i, '')
  text = text.replace(/\bwithout (?:a )?jd\b/gi, 'jd missing')
  text = text.replace(/\bwith (?:a )?jd\b/gi, 'jd available')
  text = text.replace(/\bplus\b/gi, 'and').replace(/\bwith\b/gi, 'and')
  text = text.replace(/^in\s+/i, 'location contains ')
  text = text.replace(/^for\s+/i, 'client name contains ')
  text = text.replace(/^where\s+/i, '')
  text = text.replace(/\bnot assigned to\b/gi, 'consultant not contains')
  text = text.replace(/\bassigned to both\s+(.+?)\s+and\s+(.+)$/i, 'consultant contains all $1, $2')
  return text
}

function parseMandateSpecial(text, helpers) {
  const normalized = normalizeWords(text)
  if (/^(?:no|without)\s+consultants?(?:\s+assigned)?$/.test(normalized)) return helpers.condition('consultant', 'is_empty')
  if (/^(?:multiple|more than one)\s+consultants?(?:\s+assigned)?$/.test(normalized)) return helpers.condition('consultant_count', 'greater_than', 1)
  if (/^(?:no|without)\s+team\s+lead$/.test(normalized)) return helpers.condition('team_lead', 'is_empty')
  if (/^team\s+lead\s+(?:exists|available|present)$/.test(normalized)) return helpers.condition('team_lead', 'is_not_empty')
  if (/^(?:with\s+)?(?:a\s+)?jd$|^jd\s+(?:uploaded|available|present)$/.test(normalized)) return helpers.condition('jd', 'equals', true)
  if (/^(?:without\s+)?(?:a\s+)?jd\s*(?:missing|not uploaded)?$|^jd\s+(?:missing|not uploaded|unavailable)$/.test(normalized)) return helpers.condition('jd', 'equals', false)
  if (/^(?:ongoing|active|open|p1)\s+(?:mandates?|jobs?)?$/.test(normalized)) return helpers.condition('status', 'equals', 'Ongoing (P1)')
  if (/^(?:delivered|p2)\s+(?:mandates?|jobs?)?$/.test(normalized)) return helpers.condition('status', 'equals', 'Delivered (P2)')
  if (/^(?:paused|on hold|p3)\s+(?:mandates?|jobs?)?$/.test(normalized)) return helpers.condition('status', 'equals', 'Paused (P3)')
  if (/^(?:completed|closed)\s+(?:mandates?|jobs?)?$/.test(normalized)) return helpers.condition('status', 'equals', 'Completed')
  if (/^(?:scrapped|cancelled|canceled)\s+(?:mandates?|jobs?)?$/.test(normalized)) return helpers.condition('status', 'equals', 'Scrapped')
  if (/^remote\s+(?:mandates?|jobs?)$/.test(normalized)) return helpers.condition('location', 'contains', 'Remote')
  if (/^(?:fresher|entry level)\s+(?:roles?|mandates?|jobs?)$/.test(normalized)) return helpers.condition('experience', 'equals', 0)
  if (/^senior\s+(?:roles?|mandates?|jobs?)$/.test(normalized)) return helpers.condition('experience', 'greater_than_or_equal', 8)
  const plusBudget = normalized.match(/^(\d+(?:\.\d+)?)\+\s+(?:lpa\s+)?budget$/)
  if (plusBudget) return helpers.condition('budget', 'greater_than_or_equal', Number(plusBudget[1]))
  return null
}

function parseMandateSort(prompt) {
  const text = normalizeWords(prompt)
  if (/\b(?:latest|newest|recent)\b/.test(text)) return [{ field: 'date_of_allocation', direction: 'desc' }]
  if (/\b(?:oldest|earliest)\b/.test(text)) return [{ field: 'date_of_allocation', direction: 'asc' }]
  if (/\bhighest\s+(?:salary|budget|package)|\b(?:salary|budget|package)\s+(?:high to low|descending)\b/.test(text)) return [{ field: 'budget', direction: 'desc' }]
  if (/\blowest\s+experience|\bexperience\s+(?:low to high|ascending)\b/.test(text)) return [{ field: 'experience', direction: 'asc' }]
  return []
}

const mandateAiFilter = createEntityFilter({
  key: 'mandates',
  label: 'Mandate',
  fields: MANDATE_FIELDS,
  keywordFields: ['job_id', 'consultant', 'team_lead', 'client_id', 'client_name', 'role', 'location', 'sector', 'comments'],
  preparePrompt: prepareMandatePrompt,
  parseSpecialCondition: parseMandateSpecial,
  parseSort: parseMandateSort,
  examples: [
    'mandates assigned to Cherry',
    'assigned to both Cherry and Rahul',
    'team lead is Amit and consultant is Cherry',
    'Delhi mandates with budget above 15 lpa',
    'completed mandates allocated last month'
  ],
  guidance: [
    'consultant is a true array: contains_any means either assignee, contains_all means every named assignee, and not_contains excludes an exact array element.',
    'budget is measured in LPA and compared against parsed stored range-label bounds, never lexical label order.',
    'experience is measured in years and compared against experience_min plus the parsed experience_label maximum.',
    'date_of_allocation always uses allocation_date, never created_at.'
  ]
})

module.exports = {
  MANDATE_STATUSES,
  MANDATE_SECTORS,
  MANDATE_FILTER_PERMISSION_KEYS,
  MANDATE_FIELDS,
  mandateAiFilter,
  prepareMandatePrompt,
  parseMandateSort,
  compileSemanticRange
}
