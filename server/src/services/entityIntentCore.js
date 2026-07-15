const { callAiJson } = require('./aiProvider')
const {
  MAX_DEPTH,
  MAX_CONDITIONS,
  MAX_LIST_VALUES,
  clean,
  flattenConditions
} = require('./entityAiFilterCore')

const INTENT_VERSION = 2
const MIN_AI_CONFIDENCE = 0.55
const MAX_SEARCH_TEXT_LENGTH = 600
const MAX_SORTS = 2
const MAX_SORT_INPUTS = 12

const MODES = new Set(['structured', 'hybrid', 'keyword'])
const LOGIC_VALUES = new Set(['and', 'or'])
const SORT_DIRECTIONS = new Set(['asc', 'desc'])
const CANONICAL_TOP_LEVEL_KEYS = new Set([
  'mode', 'logic', 'filters', 'search_text', 'sort', 'confidence', 'unsupported'
])
const REPAIRABLE_TOP_LEVEL_KEYS = new Set([
  ...CANONICAL_TOP_LEVEL_KEYS, 'root', 'conditions'
])
const PERSISTED_TOP_LEVEL_KEYS = new Set([
  'version', 'mode', 'logic', 'filters', 'root', 'conditions', 'search_text', 'sort', 'confidence'
])
const LEAF_KEYS = new Set(['field', 'operator', 'value'])
const LEGACY_LEAF_KEYS = new Set(['type', ...LEAF_KEYS])
const GROUP_KEYS = new Set(['logic', 'filters'])
const LEGACY_GROUP_KEYS = new Set(['type', 'combinator', 'children'])
const SORT_KEYS = new Set(['field', 'direction'])

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizedName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function normalizeLogic(value, fallback = 'and', fail) {
  const logic = clean(value || fallback).toLowerCase()
  if (!LOGIC_VALUES.has(logic)) throw fail('Invalid intent logic.')
  return logic
}

function normalizeSortConfig(sortFields) {
  const entries = Array.isArray(sortFields)
    ? sortFields.map(item => {
      if (typeof item === 'string') return [item, {}]
      if (!plainObject(item)) return ['', {}]
      return [item.field || item.name || '', item]
    })
    : Object.entries(plainObject(sortFields) ? sortFields : {})

  const result = {}
  for (const [rawName, rawMeta] of entries) {
    const name = clean(rawName)
    if (!name) continue
    const meta = plainObject(rawMeta) ? rawMeta : {}
    result[name] = {
      aliases: Array.isArray(meta.aliases) ? meta.aliases.map(clean).filter(Boolean) : [],
      description: clean(meta.description || meta.meaning),
      permissionField: clean(meta.permissionField || meta.permission_field || name),
      directions: Array.isArray(meta.directions)
        ? meta.directions.map(item => clean(item).toLowerCase()).filter(item => SORT_DIRECTIONS.has(item))
        : ['asc', 'desc']
    }
  }
  return result
}

function valueIsSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return Array.isArray(value) && value.length <= MAX_LIST_VALUES && value.every(item => (
    item === null || typeof item === 'string' || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
  ))
}

function canonicalNodeToAst(node) {
  if (Object.hasOwn(node, 'filters')) {
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

function buildAst(filters, logic) {
  const children = filters.map(canonicalNodeToAst)
  if (!children.length) return null
  if (children.length === 1) return children[0]
  return { type: 'group', combinator: logic.toUpperCase(), children }
}

function astToTopFilters(root, logic) {
  if (!root) return []
  if (root.type === 'group' && root.combinator.toLowerCase() === logic) {
    return root.children.map(astNodeToCanonical)
  }
  return [astNodeToCanonical(root)]
}

function kolkataDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function fieldUnit(meta) {
  if (meta.unit) return clean(meta.unit)
  if (meta.type === 'money') return 'absolute INR rupees; 10 lakh/10 LPA = 1000000 and 1 crore = 10000000'
  if (meta.type === 'date') return 'YYYY-MM-DD calendar date'
  if (meta.type === 'number') return 'plain number'
  if (meta.type === 'numeric_range') return 'numeric range with inclusive lower and upper bounds'
  if (meta.type === 'boolean') return 'boolean true or false'
  if (meta.type === 'availability') return 'is_empty or is_not_empty'
  if (meta.type === 'array') return 'text array'
  return ''
}

function resolveLines(value, context) {
  const resolved = typeof value === 'function' ? value(context) : value
  if (Array.isArray(resolved)) return resolved.map(clean).filter(Boolean)
  const line = clean(resolved)
  return line ? [line] : []
}

/**
 * Build an entity-specific v2 intent contract around a filter created by
 * createEntityFilter(). The returned API deliberately mirrors candidateIntent
 * without coupling Clients or Mandates to Candidate registry behavior.
 */
function createEntityIntent(config = {}) {
  const entityFilter = config.filter || config.entityFilter
  if (!entityFilter?.registry || typeof entityFilter.validateFilter !== 'function') {
    throw new TypeError('createEntityIntent requires an entity filter.')
  }

  const registry = entityFilter.registry
  const entityKey = normalizedName(config.entityKey || config.key || config.label || 'entity') || 'entity'
  const singular = clean(config.singular || config.label || entityKey) || entityKey
  const plural = clean(config.plural || config.promptName || `${singular}s`) || `${singular}s`
  const displayName = config.displayName || plural
  const sortRegistry = normalizeSortConfig(config.sortFields)
  const sortAliasMap = new Map()
  for (const [name, meta] of Object.entries(sortRegistry)) {
    for (const alias of [name, ...meta.aliases]) sortAliasMap.set(normalizedName(alias), name)
  }

  function fail(message) {
    return Object.assign(new Error(message), {
      code: `INVALID_${entityKey.toUpperCase()}_INTENT`,
      statusCode: 400
    })
  }

  function assertOnlyKeys(value, allowed, message) {
    if (!plainObject(value) || Object.keys(value).some(key => !allowed.has(key))) throw fail(message)
  }

  function allowedFieldNames(allowedFields) {
    const requested = Array.isArray(allowedFields) || allowedFields instanceof Set
      ? new Set(allowedFields)
      : null
    return Object.keys(registry).filter(name => {
      const meta = registry[name]
      return !meta.internal && (!requested || requested.has(name))
    })
  }

  function allowedSortNames(allowedFields, allowedSortFields) {
    const visible = Array.isArray(allowedFields) || allowedFields instanceof Set
      ? new Set(allowedFields)
      : null
    const explicitlyAllowed = Array.isArray(allowedSortFields) || allowedSortFields instanceof Set
      ? new Set(allowedSortFields)
      : null
    return Object.keys(sortRegistry).filter(name => {
      if (explicitlyAllowed && !explicitlyAllowed.has(name)) return false
      const permissionField = sortRegistry[name].permissionField
      return !visible || !permissionField || visible.has(permissionField)
    })
  }

  function normalizeSort(sort, options = {}) {
    if (sort === undefined) return []
    if (!Array.isArray(sort)) throw fail(`Invalid ${singular} intent sort.`)
    const allowed = new Set(allowedSortNames(options.allowedFields, options.allowedSortFields))
    const result = []
    const seen = new Set()

    // Invalid or unsupported sort entries are intentionally omitted. Filters
    // remain valid, and the bounded scan prevents a malformed response from
    // becoming an unbounded cleanup operation.
    for (const entry of sort.slice(0, MAX_SORT_INPUTS)) {
      if (!plainObject(entry) || Object.keys(entry).some(key => !SORT_KEYS.has(key))) continue
      if (typeof entry.field !== 'string' || typeof entry.direction !== 'string') continue
      const field = sortAliasMap.get(normalizedName(entry.field)) || clean(entry.field)
      const direction = clean(entry.direction).toLowerCase()
      const meta = sortRegistry[field]
      if (!meta || !allowed.has(field) || !SORT_DIRECTIONS.has(direction) || !meta.directions.includes(direction)) continue
      const identity = `${field}:${direction}`
      if (seen.has(identity)) continue
      result.push({ field, direction })
      seen.add(identity)
      if (result.length === MAX_SORTS) break
    }
    return result
  }

  function intentSchema(allowedFields = Object.keys(registry)) {
    const fields = allowedFieldNames(allowedFields)
    const operators = [...new Set(fields.flatMap(name => registry[name].operators || []))]
    const sorts = allowedSortNames(allowedFields)
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['structured', 'hybrid', 'keyword'] },
        logic: { type: 'string', enum: ['and', 'or'] },
        filters: {
          type: 'array',
          maxItems: MAX_CONDITIONS,
          items: { anyOf: [{ $ref: '#/$defs/filter' }, { $ref: '#/$defs/group' }] }
        },
        search_text: {
          anyOf: [{ type: 'string', minLength: 1, maxLength: MAX_SEARCH_TEXT_LENGTH }, { type: 'null' }]
        },
        sort: {
          type: 'array',
          maxItems: MAX_SORTS,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string', enum: sorts },
              direction: { type: 'string', enum: ['asc', 'desc'] }
            },
            required: ['field', 'direction']
          }
        },
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
            operator: { type: 'string', enum: operators },
            value: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                {
                  type: 'array',
                  maxItems: MAX_LIST_VALUES,
                  items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] }
                },
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
              maxItems: MAX_CONDITIONS,
              items: { anyOf: [{ $ref: '#/$defs/filter' }, { $ref: '#/$defs/group' }] }
            }
          },
          required: ['logic', 'filters']
        }
      }
    }
  }

  function buildIntentPrompt(prompt, allowedFields = Object.keys(registry), now = new Date()) {
    const today = kolkataDate(now)
    const visibleFields = allowedFieldNames(allowedFields)
    const fields = visibleFields.map(name => {
      const meta = registry[name]
      const parts = [
        `${name}: type=${meta.type}`,
        meta.description || meta.meaning ? `meaning=${clean(meta.description || meta.meaning)}` : '',
        fieldUnit(meta) ? `unit=${fieldUnit(meta)}` : '',
        `operators=${(meta.operators || []).join(',')}`,
        meta.aliases?.length ? `aliases=${meta.aliases.join(',')}` : '',
        meta.values?.length ? `values=${meta.values.join(',')}` : '',
        meta.semantics ? `semantics=${clean(meta.semantics)}` : ''
      ]
      return parts.filter(Boolean).join('; ')
    }).join('\n')
    const sortLines = allowedSortNames(allowedFields).map(name => {
      const meta = sortRegistry[name]
      return `${name}: directions=${meta.directions.join(',')}${meta.description ? `; meaning=${meta.description}` : ''}`
    }).join('\n')
    const context = { today, fields: visibleFields, sorts: allowedSortNames(allowedFields) }
    const extraInstructions = resolveLines(config.extraInstructions || config.promptInstructions, context)
    const examples = resolveLines(config.examples, context)

    const exampleField = visibleFields[0]
    const exampleMeta = exampleField ? registry[exampleField] : null
    const exampleOperator = exampleMeta?.operators?.find(operator => !['is_empty', 'is_not_empty'].includes(operator)) || exampleMeta?.operators?.[0]
    const scalarExampleValue = exampleMeta?.values?.[0] ?? (
      exampleMeta?.type === 'boolean' ? true
        : exampleMeta?.type === 'number' || exampleMeta?.type === 'money' || exampleMeta?.type === 'numeric_range' ? 1
          : exampleMeta?.type === 'date' ? today
            : 'Example'
    )
    const exampleValue = exampleOperator === 'between'
      ? (exampleMeta?.type === 'date' ? [today, today] : [1, 2])
      : ['in', 'not_in', 'contains_all', 'contains_any', 'overlaps'].includes(exampleOperator)
          ? [scalarExampleValue]
          : scalarExampleValue
    const exampleLeaf = exampleField && exampleOperator
      ? {
          field: exampleField,
          operator: exampleOperator,
          ...(!['is_empty', 'is_not_empty'].includes(exampleOperator) ? { value: exampleValue } : {})
        }
      : null
    const structuredExample = exampleLeaf
      ? JSON.stringify({
          mode: 'structured', logic: 'and', filters: [exampleLeaf], search_text: null,
          sort: [], confidence: 0.98, unsupported: false
        })
      : ''

    return [
      config.promptIntro,
      `Convert one natural-language ${displayName}-page filter into the strict JSON object described below.`,
      'Return JSON only. Do not return markdown, prose, SQL, PostgREST, JavaScript, database column names, database functions, mutations, or permission instructions.',
      `You receive only ${singular} field metadata and the user sentence. Never invent fields, operators, enum values, profile IDs, or dates.`,
      'Output exactly these keys: mode, logic, filters, search_text, sort, confidence, unsupported. No additional properties are allowed at any level.',
      'A filter leaf is {"field":"canonical_field","operator":"allowed_operator","value":...}. Empty-value operators omit value.',
      'A nested group is {"logic":"and|or","filters":[leaf_or_group,...]}. Preserve the requested AND/OR grouping exactly and use nested groups when needed.',
      'mode="structured" when the request maps to safe filters or a safe sort; search_text must be null.',
      'mode="hybrid" when safe filters and meaningful general text both remain; it requires filters and non-empty search_text.',
      'mode="keyword" only when no reliable filter can be extracted; filters must be [] and search_text must contain the meaningful request.',
      'Use equals only for explicit identity/equality and contains for conversational partial text. Use only the operators listed for that field.',
      'Normalize more than/above to greater_than, at least to greater_than_or_equal, below to less_than, up to to less_than_or_equal, and ranges to between.',
      'Missing, unavailable, blank, whitespace, null, dash, and an empty array mean is_empty. Available, present, and not empty mean is_not_empty.',
      `Today in Asia/Kolkata is ${today}. Resolve relative dates deterministically and return YYYY-MM-DD values or inclusive between boundaries.`,
      'Never discard a reliable filter because a sort is invalid. Omit unsupported sort entries and preserve every valid filter.',
      sortLines
        ? `Sort is an array of at most ${MAX_SORTS} objects with exactly field and direction (asc or desc). Allowed sort fields:\n${sortLines}`
        : 'Sorting is not enabled; sort must be [].',
      ...extraInstructions,
      structuredExample ? `Example structured: ${structuredExample}` : '',
      ...examples.map(example => `Module example: ${example}`),
      `Allowed ${singular} fields:\n${fields || '(none; use keyword mode or a safe sort)'}`,
      `User request: ${clean(prompt)}`
    ].map(item => String(item ?? '').trim()).filter(Boolean).join('\n\n')
  }

  function repairLeaf(node) {
    if (typeof node.field !== 'string' || typeof node.operator !== 'string') {
      throw fail(`Invalid ${singular} filter leaf.`)
    }
    if (Object.hasOwn(node, 'value') && !valueIsSafe(node.value)) {
      throw fail(`Invalid ${singular} filter value type.`)
    }
    return {
      field: clean(node.field),
      operator: clean(node.operator),
      ...(Object.hasOwn(node, 'value') ? { value: node.value } : {})
    }
  }

  function repairFilterNode(node, state, depth = 1) {
    if (!plainObject(node) || depth > MAX_DEPTH) throw fail(`Invalid or deeply nested ${singular} filter.`)
    state.count += 1
    if (state.count > MAX_CONDITIONS) throw fail(`Too many ${singular} filters.`)

    if (node.type === 'condition') {
      assertOnlyKeys(node, LEGACY_LEAF_KEYS, `Unknown ${singular} filter property.`)
      return repairLeaf(node)
    }
    if (node.type === 'group') {
      assertOnlyKeys(node, LEGACY_GROUP_KEYS, `Unknown ${singular} group property.`)
      if (!Array.isArray(node.children)) throw fail(`Invalid ${singular} group.`)
      return {
        logic: normalizeLogic(node.combinator, 'and', fail),
        filters: node.children.map(child => repairFilterNode(child, state, depth + 1))
      }
    }
    if (Object.hasOwn(node, 'filters') || Object.hasOwn(node, 'logic')) {
      assertOnlyKeys(node, GROUP_KEYS, `Unknown ${singular} group property.`)
      if (!Array.isArray(node.filters)) throw fail(`Invalid ${singular} group.`)
      return {
        logic: normalizeLogic(node.logic, 'and', fail),
        filters: node.filters.map(child => repairFilterNode(child, state, depth + 1))
      }
    }

    assertOnlyKeys(node, LEAF_KEYS, `Unknown ${singular} filter property.`)
    return repairLeaf(node)
  }

  function legacyRootFilters(root, explicitLogic, state) {
    const repaired = repairFilterNode(root, state)
    if (Object.hasOwn(repaired, 'filters') && (!explicitLogic || repaired.logic === normalizeLogic(explicitLogic, 'and', fail))) {
      return { logic: repaired.logic, filters: repaired.filters }
    }
    return { logic: normalizeLogic(explicitLogic, 'and', fail), filters: [repaired] }
  }

  function repairIntent(raw, options = {}) {
    assertOnlyKeys(raw, REPAIRABLE_TOP_LEVEL_KEYS, `Unknown ${singular} intent property.`)
    if (raw.mode !== undefined && typeof raw.mode !== 'string') throw fail(`Invalid ${singular} intent mode.`)
    if (raw.logic !== undefined && typeof raw.logic !== 'string') throw fail(`Invalid ${singular} intent logic.`)
    if (raw.search_text !== undefined && raw.search_text !== null && typeof raw.search_text !== 'string') throw fail(`Invalid ${singular} search text.`)
    if (raw.sort !== undefined && !Array.isArray(raw.sort)) throw fail(`Invalid ${singular} intent sort.`)
    if (raw.confidence !== undefined && (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence))) throw fail(`Invalid ${singular} intent confidence.`)
    if (raw.unsupported !== undefined && typeof raw.unsupported !== 'boolean') throw fail(`Invalid ${singular} unsupported flag.`)
    if (raw.root !== undefined && raw.root !== null && !plainObject(raw.root)) throw fail(`Invalid ${singular} intent root.`)
    if (raw.conditions !== undefined && !Array.isArray(raw.conditions)) throw fail(`Invalid ${singular} intent conditions.`)

    const state = { count: 0 }
    const hasCanonicalFilters = Object.hasOwn(raw, 'filters')
    const hasLegacyRoot = plainObject(raw.root)
    const hasLegacyConditions = Array.isArray(raw.conditions) && raw.conditions.length > 0
    if (hasCanonicalFilters && (hasLegacyRoot || hasLegacyConditions)) throw fail(`Ambiguous ${singular} intent filter shape.`)
    if (hasLegacyRoot && hasLegacyConditions) throw fail(`Ambiguous ${singular} intent filter shape.`)

    let logic = normalizeLogic(raw.logic || raw.root?.combinator || 'and', 'and', fail)
    let filters
    if (hasCanonicalFilters) {
      if (!Array.isArray(raw.filters)) throw fail(`${singular} intent filters must be an array.`)
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

    const inferredMode = filters.length ? (clean(raw.search_text) ? 'hybrid' : 'structured') : 'keyword'
    return {
      mode: clean(raw.mode || inferredMode).toLowerCase(),
      logic,
      filters,
      search_text: raw.search_text == null ? null : raw.search_text,
      sort: normalizeSort(raw.sort, options),
      confidence: raw.confidence === undefined ? 0 : raw.confidence,
      unsupported: raw.unsupported === undefined ? false : raw.unsupported
    }
  }

  function validateSearchText(value) {
    if (typeof value !== 'string') throw fail(`Invalid ${singular} keyword search.`)
    const hasControlCharacter = [...value].some(character => character.charCodeAt(0) < 32)
    const searchText = clean(value)
    if (!searchText || searchText.length > MAX_SEARCH_TEXT_LENGTH || hasControlCharacter) {
      throw fail(`Invalid ${singular} keyword search.`)
    }
    return searchText
  }

  function keywordIntent(searchText, confidence = 0, sort = []) {
    return {
      version: INTENT_VERSION,
      mode: 'keyword',
      logic: 'and',
      filters: [],
      root: null,
      conditions: [],
      search_text: validateSearchText(searchText),
      sort: normalizeSort(sort),
      confidence
    }
  }

  function deterministicIntent(parsed, sort = parsed?.sort || []) {
    const normalizedSort = normalizeSort(sort)
    const root = parsed?.root || null
    if (!root && !normalizedSort.length) throw fail(`Invalid deterministic ${singular} intent.`)
    const logic = root?.type === 'group' ? root.combinator.toLowerCase() : 'and'
    return {
      version: INTENT_VERSION,
      mode: 'structured',
      logic,
      filters: astToTopFilters(root, logic),
      root,
      conditions: root ? (parsed.conditions || flattenConditions(root)) : [],
      search_text: null,
      sort: normalizedSort,
      confidence: 1
    }
  }

  function validateIntent(raw, options = {}) {
    let source = raw
    if (Object.hasOwn(raw || {}, 'version')) {
      if (options.requireAiConfidence !== false) throw fail(`Persisted ${singular} intent is not valid raw AI output.`)
      assertOnlyKeys(raw, PERSISTED_TOP_LEVEL_KEYS, `Unknown persisted ${singular} intent property.`)
      if (raw.version !== INTENT_VERSION) throw fail(`Unsupported ${singular} intent version.`)
      if (raw.root !== undefined && raw.root !== null && !plainObject(raw.root)) throw fail(`Invalid persisted ${singular} intent root.`)
      if (raw.conditions !== undefined && !Array.isArray(raw.conditions)) throw fail(`Invalid persisted ${singular} intent conditions.`)
      source = Object.fromEntries([...CANONICAL_TOP_LEVEL_KEYS]
        .filter(key => key !== 'unsupported' && Object.hasOwn(raw, key))
        .map(key => [key, raw[key]]))
    }

    const input = repairIntent(source, options)
    if (!MODES.has(input.mode)) throw fail(`Invalid ${singular} intent mode.`)
    if (!LOGIC_VALUES.has(input.logic)) throw fail(`Invalid ${singular} intent logic.`)
    if (typeof input.unsupported !== 'boolean') throw fail(`Invalid ${singular} unsupported flag.`)
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw fail(`Invalid ${singular} intent confidence.`)
    }
    if (input.unsupported || (options.requireAiConfidence !== false && input.confidence < MIN_AI_CONFIDENCE)) {
      throw fail(`${singular} intent is unsupported or low confidence.`)
    }

    if (input.mode === 'keyword') {
      if (input.filters.length) throw fail(`Keyword ${singular} intent cannot contain structured filters.`)
      const searchText = validateSearchText(input.search_text)
      return { ...keywordIntent(searchText, input.confidence, input.sort), sort: input.sort }
    }

    if (input.mode === 'hybrid' && !input.filters.length) throw fail(`Hybrid ${singular} intent requires filters.`)
    if (input.mode === 'structured' && input.search_text !== null) throw fail(`Structured ${singular} intent cannot contain search text.`)
    if (input.mode === 'structured' && !input.filters.length && !input.sort.length) {
      throw fail(`Structured ${singular} intent requires filters or a safe sort.`)
    }
    const searchText = input.mode === 'hybrid' ? validateSearchText(input.search_text) : null
    const root = buildAst(input.filters, input.logic)
    const normalized = root ? entityFilter.validateFilter({ root }, options) : { root: null, conditions: [] }
    return {
      version: INTENT_VERSION,
      mode: input.mode,
      logic: input.logic,
      filters: astToTopFilters(normalized.root, input.logic),
      root: normalized.root,
      conditions: normalized.conditions,
      search_text: searchText,
      sort: input.sort,
      confidence: input.confidence
    }
  }

  function executionFilter(filters, options = {}) {
    if (!plainObject(filters)) throw fail(`Invalid ${singular} intent.`)
    const keyword = filters.search_text
      ? entityFilter.buildKeywordFilter(filters.search_text, options)
      : null
    const root = filters.root && keyword?.root
      ? { type: 'group', combinator: 'AND', children: [filters.root, keyword.root] }
      : filters.root || keyword?.root || null
    if (!root && !(Array.isArray(filters.sort) && filters.sort.length)) {
      throw fail(`Invalid ${singular} intent.`)
    }
    return { ...filters, root, conditions: root ? flattenConditions(root) : [] }
  }

  async function parseIntent(prompt, options = {}) {
    const issue = entityFilter.promptIssue(prompt)
    if (issue) throw Object.assign(new Error(issue), { statusCode: 400 })

    const aiCall = options.aiCall || callAiJson
    try {
      const parsed = await aiCall({
        prompt: buildIntentPrompt(prompt, options.allowedFields, options.now || new Date()),
        schema: intentSchema(options.allowedFields),
        schemaName: config.schemaName || `${entityKey}_intent_v2`,
        temperature: 0,
        primaryOnly: true
      })
      return { filters: validateIntent(parsed, options), ai: true, semantic: true }
    } catch {
      let parsed = null
      let sort = []
      try {
        const deterministicParser = options.deterministicParser || config.parseDeterministic || entityFilter.parsePrompt
        parsed = await deterministicParser(prompt, options)
        sort = normalizeSort(config.parseSort ? await config.parseSort(prompt, options) : parsed?.sort, options)
        if (parsed?.root) parsed = entityFilter.validateFilter({ root: parsed.root }, options)
      } catch {
        parsed = null
        sort = []
      }
      if (parsed?.root || sort.length) {
        return { filters: deterministicIntent(parsed, sort), parser: true, fallback: true }
      }
      const fallback = keywordIntent(prompt)
      // Prove that the bounded keyword plan is executable with the caller's
      // visible fields before returning it as the final fallback.
      entityFilter.buildKeywordFilter(fallback.search_text, options)
      return { filters: fallback, keyword: true, fallback: true }
    }
  }

  return {
    entityKey,
    registry,
    intentSchema,
    buildIntentPrompt,
    repairIntent,
    validateIntent,
    executionFilter,
    deterministicIntent,
    keywordIntent,
    parseIntent
  }
}

module.exports = {
  INTENT_VERSION,
  MIN_AI_CONFIDENCE,
  MAX_SEARCH_TEXT_LENGTH,
  MAX_FILTER_DEPTH: MAX_DEPTH,
  MAX_FILTERS: MAX_CONDITIONS,
  MAX_SORTS,
  MAX_SORT_INPUTS,
  createEntityIntent
}
