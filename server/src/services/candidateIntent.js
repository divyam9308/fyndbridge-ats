const { callAiJson } = require('./aiProvider')
const {
  FIELD_REGISTRY,
  candidatePromptIssue,
  parseCandidatePrompt,
  validateCandidateFilter,
  flattenConditions
} = require('./candidateAiFilter')

const INTENT_VERSION = 2
const MIN_AI_CONFIDENCE = 0.55
const MAX_SEARCH_TEXT_LENGTH = 600
const MAX_FILTER_DEPTH = 5
const MAX_FILTERS = 24
const MODES = new Set(['structured', 'hybrid', 'keyword'])
const LOGIC_VALUES = new Set(['and', 'or'])
const CANONICAL_TOP_LEVEL_KEYS = new Set(['mode', 'logic', 'filters', 'search_text', 'sort', 'confidence', 'unsupported'])
const REPAIRABLE_TOP_LEVEL_KEYS = new Set([...CANONICAL_TOP_LEVEL_KEYS, 'root', 'conditions'])
const PERSISTED_TOP_LEVEL_KEYS = new Set(['version', 'mode', 'logic', 'filters', 'root', 'conditions', 'search_text', 'sort', 'confidence'])
const LEAF_KEYS = new Set(['field', 'operator', 'value'])
const LEGACY_LEAF_KEYS = new Set(['type', ...LEAF_KEYS])
const GROUP_KEYS = new Set(['logic', 'filters'])
const LEGACY_GROUP_KEYS = new Set(['type', 'combinator', 'children'])

const EXTRA_ALIASES = {
  candidate_name: ['candidate', 'candidate name', 'person', 'applicant'],
  consultant: ['working with', 'handled by', 'assigned to', 'managed by'],
  organisation: ['employer', 'works at', 'working at'],
  experience: ['years of experience', 'work experience'],
  current_location: ['based in', 'located in', 'city'],
  notice_period: ['days to join', 'available in'],
  skills: ['technology stack', 'expertise'],
  current_ctc: ['present salary', 'present package'],
  expected_ctc: ['desired salary', 'desired package'],
  client_name: ['hiring client', 'company hiring'],
  role: ['job', 'opening', 'position']
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_CANDIDATE_INTENT', statusCode: 400 })
}

function assertOnlyKeys(value, allowed, message) {
  if (!plainObject(value) || Object.keys(value).some(key => !allowed.has(key))) throw invalid(message)
}

function normalizeLogic(value, fallback = 'and') {
  const logic = clean(value || fallback).toLowerCase()
  if (!LOGIC_VALUES.has(logic)) throw invalid('Invalid candidate filter logic.')
  return logic
}

function allowedFieldNames(allowedFields) {
  const requested = Array.isArray(allowedFields) ? new Set(allowedFields) : null
  return Object.keys(FIELD_REGISTRY).filter(name => {
    const meta = FIELD_REGISTRY[name]
    return !meta.internal && (!requested || requested.has(name))
  })
}

function fieldUnit(name, meta) {
  if (name === 'experience') return 'years; convert months to years'
  if (name === 'notice_period') return 'days; convert each stated month to 30 days'
  if (meta.type === 'money') return 'absolute INR rupees; 10 LPA/10 lakh = 1000000 and 1 crore = 10000000'
  if (meta.type === 'date') return 'YYYY-MM-DD calendar date'
  if (meta.type === 'boolean') return 'boolean true or false'
  if (meta.type === 'skills') return 'text array'
  return ''
}

function kolkataDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function financialYearRange(today) {
  const [year, month] = today.split('-').map(Number)
  const startYear = month >= 4 ? year : year - 1
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`]
}

function candidateIntentSchema(allowedFields = Object.keys(FIELD_REGISTRY)) {
  const fields = allowedFieldNames(allowedFields)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['structured', 'hybrid', 'keyword'] },
      logic: { type: 'string', enum: ['and', 'or'] },
      filters: {
        type: 'array',
        items: { anyOf: [{ $ref: '#/$defs/filter' }, { $ref: '#/$defs/group' }] }
      },
      search_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      sort: { type: 'array', maxItems: 0 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      unsupported: { type: 'boolean' }
    },
    required: ['mode', 'logic', 'filters', 'search_text', 'sort', 'confidence', 'unsupported'],
    $defs: {
      filter: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string', enum: fields },
          operator: { type: 'string' },
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
      },
      group: {
        type: 'object',
        additionalProperties: false,
        properties: {
          logic: { type: 'string', enum: ['and', 'or'] },
          filters: {
            type: 'array',
            items: { anyOf: [{ $ref: '#/$defs/filter' }, { $ref: '#/$defs/group' }] }
          }
        },
        required: ['logic', 'filters']
      }
    }
  }
}

function buildCandidateIntentPrompt(prompt, allowedFields = Object.keys(FIELD_REGISTRY), now = new Date()) {
  const today = kolkataDate(now)
  const [financialYearStart, financialYearEnd] = financialYearRange(today)
  const fields = allowedFieldNames(allowedFields).map(name => {
    const meta = FIELD_REGISTRY[name]
    const aliases = [...new Set([...(meta.aliases || []), ...(EXTRA_ALIASES[name] || [])])]
    return [
      `${name}: type=${meta.type}`,
      fieldUnit(name, meta) ? `unit=${fieldUnit(name, meta)}` : '',
      `operators=${meta.operators.join(',')}`,
      aliases.length ? `aliases=${aliases.join(',')}` : '',
      meta.values ? `values=${meta.values.join(',')}` : ''
    ].filter(Boolean).join('; ')
  }).join('\n')

  return [
    'Convert one natural-language Candidates-page filter into the strict JSON object described below.',
    'Return JSON only. Do not return markdown, prose, SQL, PostgREST, JavaScript, database column names, mutations, or permission instructions.',
    'You receive only field metadata and the user sentence. Never request, reveal, or invent candidate personal data. Never invent fields, operators, enum values, or dates.',
    'Output exactly these keys: mode, logic, filters, search_text, sort, confidence, unsupported. No additional properties are allowed at any level.',
    'A filter leaf is {"field":"canonical_field","operator":"allowed_operator","value":...}. An empty-value operator omits value.',
    'A nested group is {"logic":"and|or","filters":[leaf_or_group,...]}. Preserve the requested AND/OR grouping and use nested groups when needed.',
    'mode="structured" when the whole request maps to filters; it requires filters and search_text=null.',
    'mode="hybrid" when reliable filters and meaningful general recruiting text both remain; it requires filters and non-empty search_text.',
    'mode="keyword" only when no reliable field filter can be extracted; it requires filters=[] and non-empty search_text copied from the meaningful request.',
    'sort must always be [] because AI sorting is not enabled. Set unsupported=true only when the request cannot be represented safely.',
    'Use equals only for explicit identity/equality. Use contains for conversational partial text. For lists use in/not_in, and for skills use contains_all/contains_any.',
    'Normalize more than/above to greater_than, at least to greater_than_or_equal, below to less_than, up to to less_than_or_equal, and ranges to between.',
    'Normalize salary/CTC to absolute INR rupees, experience to years, and notice period to days. Convert two months notice to 60 days.',
    'Normalize open/willing/can relocate to boolean true and not open/unwilling/cannot relocate to boolean false.',
    'Missing, unavailable, blank, whitespace, null, dash, and an empty array mean is_empty; available/present/not empty mean is_not_empty.',
    `Today in Asia/Kolkata is ${today}. Resolve all relative dates deterministically and return YYYY-MM-DD boundaries. The current financial year is ${financialYearStart} through ${financialYearEnd}.`,
    'For a date period use between with two inclusive YYYY-MM-DD values. Never leave relative date words in filter values.',
    'The Candidates Month concept is the candidate created month: use created_date with between covering that complete calendar month. There is no separate month field.',
    'Consultant means the assigned recruiter/owner. Possessive requests such as "Alex\'s candidates" mean consultant equals Alex.',
    'A candidate "from Infosys or Wipro" refers to organisation; a candidate "in Delhi or Gurgaon" refers to current_location. Preserve the OR alternatives.',
    'Never discard a reliable clause. If general recruiting words remain after extracting every reliable field clause, use hybrid mode and put only those remaining words in search_text.',
    'Example structured: {"mode":"structured","logic":"and","filters":[{"field":"consultant","operator":"equals","value":"Alex"}],"search_text":null,"sort":[],"confidence":0.98,"unsupported":false}',
    'Example hybrid: {"mode":"hybrid","logic":"and","filters":[{"field":"consultant","operator":"equals","value":"Alex"}],"search_text":"senior react","sort":[],"confidence":0.9,"unsupported":false}',
    'Example nested: {"mode":"structured","logic":"and","filters":[{"logic":"or","filters":[{"field":"current_location","operator":"contains","value":"Delhi"},{"field":"current_location","operator":"contains","value":"Gurgaon"}]},{"field":"experience","operator":"greater_than","value":5}],"search_text":null,"sort":[],"confidence":0.96,"unsupported":false}',
    `Allowed candidate fields:\n${fields || '(none; use keyword mode)'}`,
    `User request: ${clean(prompt)}`
  ].join('\n\n')
}

function repairFilterNode(node, state, depth = 1) {
  if (!plainObject(node) || depth > MAX_FILTER_DEPTH) throw invalid('Invalid or deeply nested candidate filter.')
  state.count += 1
  if (state.count > MAX_FILTERS) throw invalid('Too many candidate filters.')

  if (node.type === 'condition') {
    assertOnlyKeys(node, LEGACY_LEAF_KEYS, 'Unknown candidate filter property.')
    return repairLeaf(node)
  }
  if (node.type === 'group') {
    assertOnlyKeys(node, LEGACY_GROUP_KEYS, 'Unknown candidate group property.')
    if (!Array.isArray(node.children)) throw invalid('Invalid candidate group.')
    return {
      logic: normalizeLogic(node.combinator),
      filters: node.children.map(child => repairFilterNode(child, state, depth + 1))
    }
  }
  if (Object.hasOwn(node, 'filters') || Object.hasOwn(node, 'logic')) {
    assertOnlyKeys(node, GROUP_KEYS, 'Unknown candidate group property.')
    if (!Array.isArray(node.filters)) throw invalid('Invalid candidate group.')
    return {
      logic: normalizeLogic(node.logic),
      filters: node.filters.map(child => repairFilterNode(child, state, depth + 1))
    }
  }

  assertOnlyKeys(node, LEAF_KEYS, 'Unknown candidate filter property.')
  return repairLeaf(node)
}

function repairLeaf(node) {
  if (typeof node.field !== 'string' || typeof node.operator !== 'string') throw invalid('Invalid candidate filter leaf.')
  if (Object.hasOwn(node, 'value') && !validFilterValue(node.value)) throw invalid('Invalid candidate filter value type.')
  return {
    field: clean(node.field),
    operator: clean(node.operator),
    ...(Object.hasOwn(node, 'value') ? { value: node.value } : {})
  }
}

function validFilterValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return Array.isArray(value) && value.every(item => (
    item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
  ))
}

function legacyRootFilters(root, explicitLogic, state) {
  const repaired = repairFilterNode(root, state)
  if (repaired.filters && (!explicitLogic || repaired.logic === normalizeLogic(explicitLogic))) {
    return { logic: repaired.logic, filters: repaired.filters }
  }
  return { logic: normalizeLogic(explicitLogic), filters: [repaired] }
}

function repairCandidateIntent(raw) {
  assertOnlyKeys(raw, REPAIRABLE_TOP_LEVEL_KEYS, 'Unknown candidate intent property.')
  if (Object.hasOwn(raw, 'mode') && typeof raw.mode !== 'string') throw invalid('Invalid candidate intent mode.')
  if (Object.hasOwn(raw, 'logic') && typeof raw.logic !== 'string') throw invalid('Invalid candidate intent logic.')
  if (raw.search_text !== undefined && raw.search_text !== null && typeof raw.search_text !== 'string') throw invalid('Invalid candidate search text.')
  if (raw.sort !== undefined && !Array.isArray(raw.sort)) throw invalid('Invalid candidate intent sort.')
  if (raw.confidence !== undefined && (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence))) throw invalid('Invalid candidate intent confidence.')
  if (raw.unsupported !== undefined && typeof raw.unsupported !== 'boolean') throw invalid('Invalid unsupported flag.')
  const state = { count: 0 }
  const hasCanonicalFilters = Object.hasOwn(raw, 'filters')
  const hasLegacyRoot = plainObject(raw.root)
  const hasLegacyConditions = Array.isArray(raw.conditions) && raw.conditions.length > 0
  if (hasCanonicalFilters && (hasLegacyRoot || hasLegacyConditions)) throw invalid('Ambiguous candidate intent filter shape.')

  let logic = normalizeLogic(raw.logic || raw.root?.combinator || 'and')
  let filters
  if (hasCanonicalFilters) {
    if (!Array.isArray(raw.filters)) throw invalid('Candidate intent filters must be an array.')
    filters = raw.filters.map(node => repairFilterNode(node, state))
  } else if (hasLegacyRoot) {
    const repaired = legacyRootFilters(raw.root, raw.logic, state)
    logic = repaired.logic
    filters = repaired.filters
  } else if (hasLegacyConditions) {
    filters = raw.conditions.map(node => repairFilterNode(node, state))
  } else {
    filters = []
  }

  const searchText = raw.search_text == null ? null : clean(raw.search_text)
  const inferredMode = filters.length ? (searchText ? 'hybrid' : 'structured') : 'keyword'
  const repaired = {
    mode: clean(raw.mode || inferredMode).toLowerCase(),
    logic,
    filters,
    search_text: searchText || null,
    sort: raw.sort === undefined ? [] : raw.sort,
    confidence: raw.confidence === undefined ? 0 : raw.confidence,
    unsupported: raw.unsupported === undefined ? false : raw.unsupported
  }
  assertOnlyKeys(repaired, CANONICAL_TOP_LEVEL_KEYS, 'Unknown candidate intent property.')
  return repaired
}

function canonicalNodeToAst(node) {
  if (node.filters) {
    return {
      type: 'group',
      combinator: node.logic.toUpperCase(),
      children: node.filters.map(canonicalNodeToAst)
    }
  }
  return {
    type: 'condition',
    field: node.field,
    operator: node.operator,
    ...(Object.hasOwn(node, 'value') ? { value: node.value } : {})
  }
}

function astNodeToCanonical(node) {
  if (node.type === 'group') {
    return {
      logic: node.combinator.toLowerCase(),
      filters: node.children.map(astNodeToCanonical)
    }
  }
  return {
    field: node.field,
    operator: node.operator,
    ...(Object.hasOwn(node, 'value') ? { value: node.value } : {})
  }
}

function astToTopFilters(root, logic) {
  if (root?.type === 'group' && root.combinator.toLowerCase() === logic) return root.children.map(astNodeToCanonical)
  return root ? [astNodeToCanonical(root)] : []
}

function buildAst(filters, logic) {
  const children = filters.map(canonicalNodeToAst)
  if (children.length === 1) return children[0]
  return { type: 'group', combinator: logic.toUpperCase(), children }
}

function validateSearchText(value) {
  if (typeof value !== 'string') throw invalid('Invalid candidate keyword search.')
  const searchText = clean(value)
  const hasControlCharacter = [...searchText].some(character => character.charCodeAt(0) < 32)
  if (!searchText || searchText.length > MAX_SEARCH_TEXT_LENGTH || hasControlCharacter) throw invalid('Invalid candidate keyword search.')
  return searchText
}

function validateCandidateIntent(raw, options = {}) {
  let source = raw
  if (Object.hasOwn(raw || {}, 'version')) {
    if (options.requireAiConfidence !== false) throw invalid('Persisted candidate intent is not valid raw AI output.')
    assertOnlyKeys(raw, PERSISTED_TOP_LEVEL_KEYS, 'Unknown persisted candidate intent property.')
    if (raw.version !== INTENT_VERSION) throw invalid('Unsupported candidate intent version.')
    source = Object.fromEntries([...CANONICAL_TOP_LEVEL_KEYS]
      .filter(key => key !== 'unsupported' && Object.hasOwn(raw, key))
      .map(key => [key, raw[key]]))
  }
  const input = repairCandidateIntent(source)
  if (!MODES.has(input.mode)) throw invalid('Invalid candidate intent mode.')
  if (!LOGIC_VALUES.has(input.logic)) throw invalid('Invalid candidate intent logic.')
  if (!Array.isArray(input.sort) || input.sort.length) throw invalid('Candidate intent sorting is not supported.')
  if (typeof input.unsupported !== 'boolean') throw invalid('Invalid unsupported flag.')
  const confidence = input.confidence
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw invalid('Invalid candidate intent confidence.')
  if (input.unsupported || (options.requireAiConfidence !== false && confidence < MIN_AI_CONFIDENCE)) throw invalid('Candidate intent is unsupported or low confidence.')

  if (input.mode === 'keyword') {
    if (input.filters.length) throw invalid('Keyword candidate intent cannot contain structured filters.')
    const searchText = validateSearchText(input.search_text)
    return keywordIntent(searchText, confidence)
  }

  if (!input.filters.length) throw invalid('Structured candidate intent requires filters.')
  if (input.mode === 'structured' && input.search_text !== null) throw invalid('Structured candidate intent cannot contain search text.')
  const searchText = input.mode === 'hybrid' ? validateSearchText(input.search_text) : null
  const root = buildAst(input.filters, input.logic)
  const normalized = validateCandidateFilter({ root }, options)
  return {
    version: INTENT_VERSION,
    mode: input.mode,
    logic: input.logic,
    filters: astToTopFilters(normalized.root, input.logic),
    root: normalized.root,
    conditions: normalized.conditions,
    search_text: searchText,
    sort: [],
    confidence
  }
}

function deterministicIntent(parsed) {
  const logic = parsed.root?.type === 'group' ? parsed.root.combinator.toLowerCase() : 'and'
  return {
    version: INTENT_VERSION,
    mode: 'structured',
    logic,
    filters: astToTopFilters(parsed.root, logic),
    root: parsed.root,
    conditions: parsed.conditions || flattenConditions(parsed.root),
    search_text: null,
    sort: [],
    confidence: 1
  }
}

function keywordIntent(searchText, confidence = 0) {
  return {
    version: INTENT_VERSION,
    mode: 'keyword',
    logic: 'and',
    filters: [],
    root: null,
    conditions: [],
    search_text: clean(searchText),
    sort: [],
    confidence
  }
}

async function parseCandidateIntent(prompt, options = {}) {
  const issue = candidatePromptIssue(prompt)
  if (issue) throw Object.assign(new Error(issue), { statusCode: 400 })

  const aiCall = options.aiCall || callAiJson
  try {
    const parsed = await aiCall({
      prompt: buildCandidateIntentPrompt(prompt, options.allowedFields, options.now || new Date()),
      schema: candidateIntentSchema(options.allowedFields),
      schemaName: 'candidate_intent_v2',
      temperature: 0,
      primaryOnly: true
    })
    return { filters: validateCandidateIntent(parsed, options), ai: true, semantic: true }
  } catch {
    const deterministic = parseCandidatePrompt(prompt, options)
    if (deterministic) return { filters: deterministicIntent(deterministic), parser: true, fallback: true }
    return { filters: keywordIntent(prompt), keyword: true, fallback: true }
  }
}

module.exports = {
  INTENT_VERSION,
  MIN_AI_CONFIDENCE,
  candidateIntentSchema,
  buildCandidateIntentPrompt,
  repairCandidateIntent,
  validateCandidateIntent,
  deterministicIntent,
  keywordIntent,
  parseCandidateIntent
}
