const {
  TEXT_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  DATE_OPERATORS,
  BOOLEAN_OPERATORS,
  field,
  createEntityFilter,
  normalizeWords
} = require('./entityAiFilterCore')

const CLIENT_STATUSES = [
  'Active',
  'Inactive',
  'Converted',
  'Not Converted',
  'Follow Up Required',
  'Not Hiring',
  'Not Adding Consultants',
  "Didn't Pick Up"
]

const CLIENT_SECTORS = [
  'Agriculture',
  'Automotive',
  'Consumer, Retail & Durables',
  'EPC',
  'Ecommerce',
  'Education',
  'Financial Services',
  'Healthcare',
  'Hospitality',
  'Logistics & Supply Chain',
  'Manufacturing',
  'Oil & Gas',
  'Others',
  'Pharmaceuticals',
  'Power',
  'Real Estate',
  'Social Sector',
  'Technology'
]

const CLIENT_FILTER_PERMISSION_KEYS = {
  client_id: 'client_display_id', client_name: 'client_name', consultant: 'consultant_name',
  location: 'location', region: 'region', contact_person: 'contact_person', mobile: 'mobile',
  email: 'email', linkedin: 'linkedin', designation: 'designation', sector: 'sector',
  connected_on: 'connected_on_date', comments: 'comments', follow_up_date: 'follow_up_date',
  next_follow_up_date: 'follow_up_date', follow_up_overdue: 'follow_up_date', follow_up_upcoming: 'follow_up_date',
  status: 'status', terms_signed: 'terms_signed_type', terms_type: 'terms_signed_type', gstin: 'gstin',
  pan: 'pan', address_on_invoice: 'address_on_invoice', contract_signed: 'contract_signed',
  contract_document: 'contract_document', value: 'terms_value', billing_entity: 'terms_value'
}

const STATUS_ALIASES = Object.fromEntries([
  ['active', 'Active'], ['open', 'Active'], ['inactive', 'Inactive'],
  ['converted', 'Converted'], ['not converted', 'Not Converted'],
  ['follow up', 'Follow Up Required'], ['follow up required', 'Follow Up Required'],
  ['not hiring', 'Not Hiring'], ['not adding consultants', 'Not Adding Consultants'],
  ['did not pick up', "Didn't Pick Up"], ['didnt pick up', "Didn't Pick Up"], ["didn't pick up", "Didn't Pick Up"]
])

const SECTOR_ALIASES = Object.fromEntries([
  ['fintech', 'Financial Services'], ['finance', 'Financial Services'], ['financial services', 'Financial Services'],
  ['banking', 'Financial Services'], ['insurance', 'Financial Services'], ['bfsi', 'Financial Services'],
  ['tech', 'Technology'], ['technology', 'Technology'], ['software', 'Technology'], ['it', 'Technology'],
  ['e commerce', 'Ecommerce'], ['ecommerce', 'Ecommerce'], ['retail', 'Consumer, Retail & Durables'],
  ['consumer', 'Consumer, Retail & Durables'], ['pharma', 'Pharmaceuticals'],
  ['logistics', 'Logistics & Supply Chain'], ['supply chain', 'Logistics & Supply Chain']
])

function compileAnyFollowUp(node, { quoteValue }) {
  const range = (from, to) => `ai_follow_up_ranges.ov.${quoteValue(`[${from},${to}]`)}`
  if (node.operator === 'is_empty') return 'ai_follow_up_count.eq.0'
  if (node.operator === 'is_not_empty') return 'ai_follow_up_count.gt.0'
  if (node.operator === 'on') return range(node.value, node.value)
  if (node.operator === 'between') return range(node.value[0], node.value[1])
  if (node.operator === 'before') return `ai_first_follow_up_date.lt.${quoteValue(node.value)}`
  if (node.operator === 'after') return `ai_follow_up_date.gt.${quoteValue(node.value)}`
  if (node.operator === 'on_or_before') return `ai_first_follow_up_date.lte.${quoteValue(node.value)}`
  if (node.operator === 'on_or_after') return `ai_follow_up_date.gte.${quoteValue(node.value)}`
  throw new Error(`Unsupported follow-up operator: ${node.operator}`)
}

const CLIENT_FIELDS = {
  client_id: field('text', ['client_display_id'], ['client id', 'client number', 'account id', 'customer id', 'cl id'], TEXT_OPERATORS),
  client_name: field('text', ['client_name', 'name'], ['client name', 'company name', 'organization name', 'organisation name', 'account name', 'customer name'], TEXT_OPERATORS),
  consultant: field('text', ['ai_consultant_name_normalized'], ['consultant name', 'relationship owner', 'account owner', 'assigned consultant', 'assigned to', 'handled by', 'managed by', 'consultant', 'owner'], TEXT_OPERATORS, { reference: 'profile' }),
  location: field('text', ['location', 'city'], ['office location', 'based in', 'located in', 'client location', 'location', 'city'], TEXT_OPERATORS),
  region: field('enum', ['region', 'state'], ['territory', 'region', 'zone', 'area'], ENUM_OPERATORS, {
    values: ['North', 'South', 'East', 'West', 'International'],
    valueAliases: { northern: 'North', southern: 'South', eastern: 'East', western: 'West', global: 'International', overseas: 'International' }
  }),
  contact_person: field('text', ['ai_contact_person_search'], ['point of contact', 'client representative', 'contact person', 'contact', 'poc'], TEXT_OPERATORS),
  mobile: field('phone', ['ai_mobile_search'], ['mobile number', 'phone number', 'contact number', 'mobile', 'phone'], TEXT_OPERATORS),
  email: field('email', ['ai_email_search'], ['email address', 'mail address', 'email', 'mail'], TEXT_OPERATORS),
  linkedin: field('text', ['ai_linkedin_search'], ['linkedin profile', 'linkedin url', 'linkedin'], TEXT_OPERATORS),
  designation: field('text', ['ai_designation_search'], ['contact designation', 'job title', 'designation'], TEXT_OPERATORS),
  sector: field('enum', ['sector'], ['business category', 'client industry', 'industry', 'domain', 'vertical', 'sector'], ENUM_OPERATORS, {
    values: CLIENT_SECTORS,
    valueAliases: SECTOR_ALIASES
  }),
  connected_on: field('date', ['connected_on_date'], ['relationship started', 'connected on', 'connected date', 'added on', 'onboarded on', 'connected'], DATE_OPERATORS),
  comments: field('text', ['ai_comments_search'], ['client comments', 'remarks', 'comment', 'comments', 'notes'], TEXT_OPERATORS),
  follow_up_date: field('date', ['ai_follow_up_ranges'], ['any follow up', 'any follow-up', 'follow up date', 'follow-up date', 'callback', 'reminder date', 'next contact', 'follow up', 'follow-up'], DATE_OPERATORS, {
    derived: true,
    relation: 'client_follow_ups',
    compile: compileAnyFollowUp
  }),
  next_follow_up_date: field('date', ['ai_next_follow_up_date'], ['next follow up date', 'next follow-up date', 'next follow up', 'next follow-up'], DATE_OPERATORS, { derived: true, relation: 'client_follow_ups' }),
  follow_up_overdue: field('boolean', ['ai_follow_up_overdue'], ['overdue follow up', 'overdue follow-up', 'follow up overdue', 'follow-up overdue'], BOOLEAN_OPERATORS, {
    derived: true,
    booleanAliases: { true: ['overdue'], false: ['not overdue'] }
  }),
  follow_up_upcoming: field('boolean', ['ai_follow_up_upcoming'], ['upcoming follow up', 'upcoming follow-up', 'future follow up'], BOOLEAN_OPERATORS, {
    derived: true,
    booleanAliases: { true: ['upcoming'], false: ['not upcoming'] }
  }),
  status: field('enum', ['status'], ['client status', 'account status', 'status'], ENUM_OPERATORS, { values: CLIENT_STATUSES, valueAliases: STATUS_ALIASES }),
  terms_signed: field('boolean', ['ai_terms_signed'], ['commercial terms accepted', 'agreement terms', 'terms accepted', 'terms signed', 'commercial terms', 'terms'], BOOLEAN_OPERATORS, {
    derived: true,
    booleanAliases: {
      true: ['terms signed', 'signed terms', 'accepted terms', 'terms accepted', 'completed'],
      false: ['terms not signed', 'unsigned terms', 'pending terms', 'not accepted']
    }
  }),
  terms_type: field('enum', ['terms_signed_type'], ['commercial model', 'terms model', 'terms type'], ENUM_OPERATORS, {
    values: ['%', 'Fixed Fee Model', 'Slab %', 'Any Other'],
    valueAliases: { percentage: '%', percent: '%', fixed: 'Fixed Fee Model', 'fixed fee': 'Fixed Fee Model', slab: 'Slab %', other: 'Any Other' }
  }),
  gstin: field('text', ['gstin'], ['tax registration', 'gst registration', 'gst number', 'gstin'], TEXT_OPERATORS),
  pan: field('text', ['pan'], ['permanent account number', 'pan number', 'pan'], TEXT_OPERATORS),
  address_on_invoice: field('text', ['address_on_invoice'], ['billing address', 'invoice address', 'address on invoice'], TEXT_OPERATORS),
  contract_signed: field('boolean', ['contract_signed'], ['agreement signed', 'signed contract', 'contract signed', 'contract'], BOOLEAN_OPERATORS, {
    booleanAliases: { true: ['contract signed', 'signed contract', 'agreement signed', 'signed'], false: ['contract not signed', 'unsigned contract', 'agreement not signed', 'pending'] }
  }),
  contract_document: field('availability', ['contract_document', 'contract_pdf_url', 'contract_pdf_storage_path'], ['agreement file', 'contract file', 'uploaded contract', 'contract document'], BOOLEAN_OPERATORS, {
    booleanAliases: { true: ['uploaded', 'available', 'present', 'attached'], false: ['missing', 'absent', 'not uploaded', 'unavailable', 'no contract document'] }
  }),
  value: field('money', ['ai_terms_value_amount'], ['contract value', 'commercial value', 'account value', 'revenue value', 'client value', 'value'], NUMBER_OPERATORS, { unit: 'absolute INR', derived: true }),
  billing_entity: field('enum', ['billing_entity'], ['legal billing entity', 'billing entity'], ENUM_OPERATORS, { values: ['FCS', 'FCAPL'] }),
  created_at: field('date', ['created_at'], ['client created', 'created date', 'added date', 'created at'], DATE_OPERATORS, { timestamp: true }),
  updated_at: field('date', ['updated_at'], ['client updated', 'updated date', 'modified date', 'updated at'], DATE_OPERATORS, { timestamp: true })
}

function prepareClientPrompt(value) {
  let text = String(value || '').replace(/[’‘]/g, "'").replace(/\bplus\b/gi, 'and').replace(/\bwith\b/gi, 'and')
  const possessive = text.match(/^\s*(.+?)\s*'s\s+clients?\s*$/i)
  if (possessive) return `consultant equals ${possessive[1]}`
  text = text.replace(/^\s*(?:show|find|list|get|give me)\s+(?:me\s+)?/i, '')
  text = text.replace(/^\s*(?:all\s+)?clients?\s+/i, '')
  text = text.replace(/^in\s+/i, 'location contains ')
  text = text.replace(/^where\s+/i, '')
  text = text.replace(/\bsigned terms\b/gi, 'terms signed')
  text = text.replace(/\bunsigned terms\b/gi, 'terms not signed')
  text = text.replace(/\bsigned contracts?\b/gi, 'contract signed')
  text = text.replace(/\bunsigned contracts?\b/gi, 'contract not signed')
  return text
}

function parseClientSpecial(text, helpers) {
  const normalized = normalizeWords(text)
  if (/^(?:no|without)\s+follow[ -]?up(?:\s+scheduled)?$/.test(normalized)) return helpers.condition('follow_up_date', 'is_empty')
  if (/^(?:follow[ -]?up\s+)?overdue$/.test(normalized) || /^overdue\s+follow[ -]?ups?$/.test(normalized)) return helpers.condition('follow_up_overdue', 'equals', true)
  if (/^upcoming\s+follow[ -]?ups?$/.test(normalized)) return helpers.condition('follow_up_upcoming', 'equals', true)
  if (/^(?:terms\s+not\s+signed|unsigned\s+terms)$/.test(normalized)) return helpers.condition('terms_signed', 'equals', false)
  if (/^(?:terms\s+signed|signed\s+terms)$/.test(normalized)) return helpers.condition('terms_signed', 'equals', true)
  if (/^(?:contract\s+not\s+signed|unsigned\s+contract)$/.test(normalized)) return helpers.condition('contract_signed', 'equals', false)
  if (/^(?:contract\s+signed|signed\s+contract)$/.test(normalized)) return helpers.condition('contract_signed', 'equals', true)
  const adjective = normalized.match(/^(.+?)\s+clients?$/)
  if (adjective && SECTOR_ALIASES[adjective[1]]) return helpers.condition('sector', 'equals', SECTOR_ALIASES[adjective[1]])
  return null
}

function parseClientSort(prompt) {
  const text = normalizeWords(prompt)
  if (/\b(?:latest|newest|recent)\b/.test(text)) return [{ field: 'created_at', direction: 'desc' }]
  if (/\b(?:oldest|earliest added)\b/.test(text)) return [{ field: 'created_at', direction: 'asc' }]
  if (/\b(?:highest|largest|greatest)\s+(?:client\s+)?value\b|\bvalue\s+(?:high to low|descending)\b/.test(text)) return [{ field: 'value', direction: 'desc' }]
  if (/\bearliest\s+follow[ -]?up\b/.test(text)) return [{ field: 'next_follow_up_date', direction: 'asc' }]
  return []
}

const clientAiFilter = createEntityFilter({
  key: 'clients',
  label: 'Client',
  fields: CLIENT_FIELDS,
  keywordFields: ['client_id', 'client_name', 'consultant', 'location', 'contact_person', 'email', 'sector', 'comments', 'gstin', 'pan'],
  preparePrompt: prepareClientPrompt,
  parseSpecialCondition: parseClientSpecial,
  parseSort: parseClientSort,
  examples: [
    'clients in Delhi handled by Cherry',
    'fintech clients with unsigned terms',
    'clients with contract signed but contract document missing',
    'follow up this week',
    'value above 10 lakh'
  ],
  guidance: [
    'terms_signed is a derived boolean indicating that a real terms model is present; it is separate from contract_signed.',
    'follow_up_date means any related follow-up; next_follow_up_date means the earliest scheduled date on or after today.',
    'value is normalized to absolute Indian rupees; percentage and slab-percentage terms are not numeric client values.'
  ]
})

module.exports = {
  CLIENT_STATUSES,
  CLIENT_SECTORS,
  CLIENT_FILTER_PERMISSION_KEYS,
  CLIENT_FIELDS,
  clientAiFilter,
  prepareClientPrompt,
  parseClientSort
}
