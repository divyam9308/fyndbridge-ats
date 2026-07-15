const { normalizeMoney, normalizeDate } = require('./candidateAiFilter')

const MAX_QUERY_LENGTH = 600
const MAX_DEPTH = 5
const MAX_CONDITIONS = 24
const MAX_LIST_VALUES = 20
const MAX_TEXT_VALUE_LENGTH = 180

const NODE_KEYS = Object.freeze({
  condition: new Set(['type', 'field', 'operator', 'value']),
  group: new Set(['type', 'combinator', 'children'])
})
const FIELD_TYPES = new Set(['text', 'email', 'phone', 'identifier', 'enum', 'number', 'money', 'date', 'boolean', 'availability', 'array', 'numeric_range'])

const TEXT_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty']
const ENUM_OPERATORS = ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty']
const NUMBER_OPERATORS = ['equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty']
const DATE_OPERATORS = ['on', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'is_empty', 'is_not_empty']
const BOOLEAN_OPERATORS = ['equals', 'not_equals', 'is_empty', 'is_not_empty']
const ARRAY_OPERATORS = ['contains', 'contains_all', 'contains_any', 'not_contains', 'overlaps', 'is_empty', 'is_not_empty']
const IDENTIFIER_OPERATORS = ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty']

const EMPTY_WORDS = /^(?:is\s+)?(?:blank|empty|missing|null|not selected|unselected|not assigned|not provided|not filled|not available|unavailable|not uploaded|not attached|absent|unknown|none|no value)$/i
const NOT_EMPTY_WORDS = /^(?:is\s+)?(?:not empty|available|present|provided|filled|uploaded|attached|exists|has value|has data)$/i

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeWords(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ')
}

function field(type, columns, aliases, operators, extra = {}) {
  return { type, columns, aliases, operators, ...extra }
}

function condition(fieldName, operator, value) {
  return { type: 'condition', field: fieldName, operator, ...(value !== undefined ? { value } : {}) }
}

function group(combinator, children) {
  const compact = children.filter(Boolean)
  if (!compact.length) return null
  return compact.length === 1 ? compact[0] : { type: 'group', combinator, children: compact }
}

function flattenConditions(node) {
  if (!node) return []
  return node.type === 'condition' ? [node] : (node.children || []).flatMap(flattenConditions)
}

function invalid(entityLabel, message) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: `INVALID_${String(entityLabel || 'ENTITY').toUpperCase()}_FILTER`
  })
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
      current += SMALL_NUMBERS.get(token)
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

function numberValue(value) {
  const text = clean(value).replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (match && Number.isFinite(Number(match[0]))) return Number(match[0])
  return numberFromWords(text)
}

function experienceValue(value) {
  const text = clean(value).toLowerCase()
  if (/\b(?:fresher|entry[ -]?level|no experience)\b/.test(text)) return 0
  let amount = numberValue(text)
  if (!Number.isFinite(amount) || amount < 0) return null
  if (/\bmonths?\b/.test(text)) amount /= 12
  if (/\bweeks?\b/.test(text)) amount /= 52
  return amount
}

function booleanValue(value, aliases = {}) {
  if (typeof value === 'boolean') return value
  const text = normalizeWords(value)
  const truthy = new Set(['true', 'yes', 'available', 'present', 'uploaded', 'attached', 'signed', 'completed', 'accepted', ...(aliases.true || []).map(normalizeWords)])
  const falsy = new Set(['false', 'no', 'missing', 'absent', 'unavailable', 'not uploaded', 'not attached', 'unsigned', 'not signed', 'pending', ...(aliases.false || []).map(normalizeWords)])
  if (truthy.has(text)) return true
  if (falsy.has(text)) return false
  return null
}

function kolkataDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function utcDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isoUtc(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function shiftDay(value, amount) {
  const date = utcDate(value)
  date.setUTCDate(date.getUTCDate() + amount)
  return isoUtc(date)
}

function monthRange(year, zeroBasedMonth) {
  const start = new Date(Date.UTC(year, zeroBasedMonth, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return [isoUtc(start), isoUtc(end)]
}

function relativeDateRange(value, now = new Date()) {
  const text = normalizeWords(value)
    .replace(/^in the /, '')
    .replace(/^during (?:the )?/, '')
  const today = kolkataDay(now)
  const current = utcDate(today)
  const weekday = current.getUTCDay() || 7
  if (text === 'this week' || text === 'next week' || text === 'last week') {
    const offset = text === 'next week' ? 7 : text === 'last week' ? -7 : 0
    const start = shiftDay(today, 1 - weekday + offset)
    return [start, shiftDay(start, 6)]
  }
  if (text === 'this month' || text === 'next month' || text === 'last month') {
    const offset = text === 'next month' ? 1 : text === 'last month' ? -1 : 0
    return monthRange(current.getUTCFullYear(), current.getUTCMonth() + offset)
  }
  if (text === 'this year' || text === 'next year' || text === 'last year') {
    const year = current.getUTCFullYear() + (text === 'last year' ? -1 : text === 'next year' ? 1 : 0)
    return [`${year}-01-01`, `${year}-12-31`]
  }
  if (['this financial year', 'current financial year', 'this fy', 'current fy', 'last financial year', 'last fy', 'next financial year', 'next fy'].includes(text)) {
    const currentStart = current.getUTCMonth() >= 3 ? current.getUTCFullYear() : current.getUTCFullYear() - 1
    const offset = text.startsWith('last') ? -1 : text.startsWith('next') ? 1 : 0
    const startYear = currentStart + offset
    return [`${startYear}-04-01`, `${startYear + 1}-03-31`]
  }
  if (['this quarter', 'current quarter', 'last quarter', 'next quarter'].includes(text)) {
    const currentQuarterStart = Math.floor(current.getUTCMonth() / 3) * 3
    const offset = text === 'last quarter' ? -3 : text === 'next quarter' ? 3 : 0
    const start = new Date(Date.UTC(current.getUTCFullYear(), currentQuarterStart + offset, 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0))
    return [isoUtc(start), isoUtc(end)]
  }
  const withinDays = text.match(/^(?:within(?: the)?(?: next)?|next|upcoming)\s+(\d+)\s+days?$/)
  if (withinDays) {
    const days = Number(withinDays[1])
    return days >= 1 && days <= 3660 ? [today, shiftDay(today, days)] : null
  }
  const lastDays = text.match(/^(?:last|past|previous)\s+(\d+)\s+days?$/)
  if (lastDays) {
    const days = Number(lastDays[1])
    return days >= 1 && days <= 3660 ? [shiftDay(today, -(days - 1)), today] : null
  }
  const month = text.match(/^(?:in\s+)?([a-z]+)(?:\s+(\d{4}))?$/)
  if (month && month[1].length >= 3) {
    const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const index = names.findIndex(name => month[1].startsWith(name))
    if (index >= 0) {
      const year = Number(month[2] || current.getUTCFullYear())
      return year >= 1000 && year <= 9999 ? monthRange(year, index) : null
    }
  }
  return null
}

function normalizeOperator(value) {
  const text = normalizeWords(value)
  const aliases = {
    is: 'equals', '=': 'equals', equals: 'equals', 'equal to': 'equals', exactly: 'equals',
    'is not': 'not_equals', 'not equal': 'not_equals', 'not equals': 'not_equals', except: 'not_equals', excluding: 'not_equals',
    contains: 'contains', include: 'contains', includes: 'contains', has: 'contains', having: 'contains',
    'does not contain': 'not_contains', 'does not include': 'not_contains', 'not contains': 'not_contains', 'contains no': 'not_contains', without: 'not_contains',
    'starts with': 'starts_with', 'ends with': 'ends_with',
    '>': 'greater_than', above: 'greater_than', over: 'greater_than', 'more than': 'greater_than', 'greater than': 'greater_than',
    '>=': 'greater_than_or_equal', 'at least': 'greater_than_or_equal', minimum: 'greater_than_or_equal',
    '<': 'less_than', below: 'less_than', under: 'less_than', 'less than': 'less_than',
    '<=': 'less_than_or_equal', 'at most': 'less_than_or_equal', 'up to': 'less_than_or_equal', maximum: 'less_than_or_equal',
    before: 'before', after: 'after', on: 'on', 'on or before': 'on_or_before', 'on or after': 'on_or_after',
    between: 'between', in: 'in', 'one of': 'in', 'any of': 'in', 'not in': 'not_in', overlaps: 'overlaps',
    'contains all': 'contains_all', 'contains any': 'contains_any'
  }
  return aliases[text] || text.replace(/\s+/g, '_')
}

function splitTopLevel(text, connector) {
  const result = []
  const token = ` ${connector} `
  const lower = text.toLowerCase()
  let depth = 0
  let quote = ''
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') { depth += 1; continue }
    if (char === ')') { depth -= 1; continue }
    if (depth || lower.slice(index, index + token.length) !== token) continue
    const before = text.slice(start, index)
    if (connector === 'and') {
      const sinceStart = before.toLowerCase()
      const betweenIndex = sinceStart.lastIndexOf('between ')
      const afterBetween = betweenIndex < 0 ? '' : sinceStart.slice(betweenIndex + 'between '.length)
      // The first "and" after "between" belongs to the range; later ANDs are
      // real boolean connectors ("between 3 and 5 and status is Ongoing").
      if (betweenIndex >= 0 && !/\band\b/.test(afterBetween)) continue
    }
    result.push(clean(before))
    start = index + token.length
    index = start - 1
  }
  result.push(clean(text.slice(start)))
  return result.filter(Boolean)
}

function stripOuterParens(value) {
  let text = clean(value)
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0
    let closesAtEnd = true
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      if (text[index] === ')') depth -= 1
      if (depth === 0 && index < text.length - 1) { closesAtEnd = false; break }
    }
    if (!closesAtEnd) break
    text = clean(text.slice(1, -1))
  }
  return text
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quoteValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function quoteArrayValue(values) {
  const items = values.map(value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return quoteValue(`{${items.join(',')}}`)
}

function nextDate(value) {
  return shiftDay(value, 1)
}

function scalarEmptyClauses(column, meta, negate = false) {
  if (['number', 'money', 'date', 'identifier', 'numeric_range', 'boolean'].includes(meta.type)) {
    return [`${column}.${negate ? 'not.is' : 'is'}.null`]
  }
  if (meta.type === 'array') {
    return negate
      ? [`${column}.not.is.null`, `${column}.neq.{}`]
      : [`${column}.is.null`, `${column}.eq.{}`]
  }
  const emptyValues = [...new Set(['', '-', ...(meta.emptyValues || [])].map(clean))]
  return negate
    ? [`${column}.not.is.null`, ...emptyValues.map(value => `${column}.neq.${quoteValue(value)}`), `${column}.not.match.${quoteValue('^\\s*$')}`]
    : [`${column}.is.null`, ...emptyValues.map(value => `${column}.eq.${quoteValue(value)}`), `${column}.match.${quoteValue('^\\s*$')}`]
}

function escapeLikeValue(value) {
  return String(value).replace(/[\\%_*]/g, match => `\\${match}`)
}

function scalarClause(column, node, meta) {
  const { operator, value } = node
  if (operator === 'is_empty') return `or(${scalarEmptyClauses(column, meta).join(',')})`
  if (operator === 'is_not_empty') return `and(${scalarEmptyClauses(column, meta, true).join(',')})`

  if (meta.type === 'array') {
    const values = Array.isArray(value) ? value : [value]
    if (operator === 'contains_all') return `${column}.cs.${quoteArrayValue(values)}`
    if (operator === 'contains_any' || operator === 'overlaps') return `${column}.ov.${quoteArrayValue(values)}`
    if (operator === 'not_contains') {
      return values.length === 1
        ? `${column}.not.cs.${quoteArrayValue(values)}`
        : `${column}.not.ov.${quoteArrayValue(values)}`
    }
    return `${column}.cs.${quoteArrayValue(values.slice(0, 1))}`
  }

  if (meta.type === 'date' && meta.timestamp) {
    const start = item => quoteValue(`${item}T00:00:00+05:30`)
    const end = item => quoteValue(`${nextDate(item)}T00:00:00+05:30`)
    if (operator === 'on') return `and(${column}.gte.${start(value)},${column}.lt.${end(value)})`
    if (operator === 'between') return `and(${column}.gte.${start(value[0])},${column}.lt.${end(value[1])})`
    if (operator === 'before') return `${column}.lt.${start(value)}`
    if (operator === 'after') return `${column}.gte.${end(value)}`
    if (operator === 'on_or_before') return `${column}.lt.${end(value)}`
    if (operator === 'on_or_after') return `${column}.gte.${start(value)}`
  }

  const caseInsensitive = ['text', 'email', 'phone'].includes(meta.type)
  if (operator === 'between') return `and(${column}.gte.${quoteValue(value[0])},${column}.lte.${quoteValue(value[1])})`
  if (operator === 'in' || operator === 'not_in') {
    if (caseInsensitive) {
      const clauses = value.map(item => `${column}.${operator === 'in' ? 'ilike' : 'not.ilike'}.${quoteValue(escapeLikeValue(item))}`)
      return `${operator === 'in' ? 'or' : 'and'}(${clauses.join(',')})`
    }
    return `${column}.${operator === 'in' ? 'in' : 'not.in'}.(${value.map(quoteValue).join(',')})`
  }
  const op = {
    equals: caseInsensitive ? 'ilike' : 'eq', not_equals: caseInsensitive ? 'not.ilike' : 'neq',
    contains: 'ilike', not_contains: 'not.ilike', starts_with: 'ilike', ends_with: 'ilike',
    greater_than: 'gt', greater_than_or_equal: 'gte', less_than: 'lt', less_than_or_equal: 'lte',
    before: 'lt', after: 'gt', on: 'eq', on_or_before: 'lte', on_or_after: 'gte'
  }[operator]
  if (!op) throw new Error(`Unsupported ${meta.type} operator: ${operator}`)
  const safeValue = caseInsensitive ? escapeLikeValue(value) : value
  const pattern = ['contains', 'not_contains'].includes(operator) ? `*${safeValue}*` : operator === 'starts_with' ? `${safeValue}*` : operator === 'ends_with' ? `*${safeValue}` : safeValue
  return `${column}.${op}.${quoteValue(pattern)}`
}

function rangeClause(node, meta) {
  const { minimum, maximum, ceiling = maximum } = meta.rangeColumns
  const value = node.value
  if (node.operator === 'is_empty') return `${minimum}.is.null`
  if (node.operator === 'is_not_empty') return `${minimum}.not.is.null`
  if (node.operator === 'between') return `and(${ceiling}.gte.${quoteValue(value[0])},${minimum}.lte.${quoteValue(value[1])})`
  if (node.operator === 'greater_than') return `${ceiling}.gt.${quoteValue(value)}`
  if (node.operator === 'greater_than_or_equal') return `${ceiling}.gte.${quoteValue(value)}`
  if (node.operator === 'less_than') return `${minimum}.lt.${quoteValue(value)}`
  if (node.operator === 'less_than_or_equal') return `${minimum}.lte.${quoteValue(value)}`
  if (node.operator === 'equals' && Array.isArray(value)) return `and(${minimum}.eq.${quoteValue(value[0])},${maximum}.eq.${quoteValue(value[1])})`
  if (node.operator === 'not_equals' && Array.isArray(value)) return `or(${minimum}.neq.${quoteValue(value[0])},${maximum}.neq.${quoteValue(value[1])})`
  if (node.operator === 'equals') return `and(${minimum}.lte.${quoteValue(value)},${ceiling}.gte.${quoteValue(value)})`
  if (node.operator === 'not_equals') return `or(${minimum}.gt.${quoteValue(value)},${ceiling}.lt.${quoteValue(value)})`
  if (node.operator === 'in') return `or(${value.map(item => rangeClause(condition(node.field, 'equals', item), meta)).join(',')})`
  if (node.operator === 'not_in') return `and(${value.map(item => rangeClause(condition(node.field, 'not_equals', item), meta)).join(',')})`
  throw new Error(`Unsupported range operator: ${node.operator}`)
}

function createEntityFilter(config) {
  if (!config || typeof config !== 'object' || !config.fields || typeof config.fields !== 'object') {
    throw new TypeError('Entity AI filter fields are required.')
  }
  const registry = config.fields
  const label = clean(config.label) || 'entity'
  const aliasToField = new Map()
  for (const [name, meta] of Object.entries(registry)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !meta || typeof meta !== 'object' || !FIELD_TYPES.has(meta.type) || !Array.isArray(meta.aliases) || !Array.isArray(meta.operators)) {
      throw new TypeError(`Invalid ${label} field registry entry: ${name}`)
    }
    if (meta.type === 'enum' && (!Array.isArray(meta.values) || !meta.values.length || meta.values.some(value => typeof value !== 'string' || !clean(value)))) {
      throw new TypeError(`Invalid ${label} enum values configured for ${name}.`)
    }
    if (meta.type !== 'numeric_range' && (!Array.isArray(meta.columns) || !meta.columns.length)) {
      throw new TypeError(`No ${label} filter columns configured for ${name}.`)
    }
    if (meta.type === 'numeric_range' && (!meta.rangeColumns?.minimum || !meta.rangeColumns?.maximum)) {
      throw new TypeError(`No ${label} range columns configured for ${name}.`)
    }
    const columns = [...(meta.columns || []), ...Object.values(meta.rangeColumns || {}).filter(Boolean)]
    if (columns.some(column => typeof column !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
      throw new TypeError(`Unsafe ${label} filter column configured for ${name}.`)
    }
    for (const alias of [name, ...(meta.aliases || [])]) {
      const normalized = normalizeWords(alias)
      if (!normalized) continue
      const existing = aliasToField.get(normalized)
      if (existing && existing !== name) throw new TypeError(`Ambiguous ${label} filter alias: ${alias}`)
      aliasToField.set(normalized, name)
    }
  }
  const aliases = [...aliasToField.keys()].sort((left, right) => right.length - left.length)

  function findField(text) {
    const normalized = normalizeWords(text)
    let best = null
    for (const alias of aliases) {
      const index = normalized.search(new RegExp(`(?:^|\\b)${escapeRegex(alias)}(?:\\b|$)`, 'i'))
      if (index >= 0 && (!best || index < best.index || (index === best.index && alias.length > best.alias.length))) {
        best = { field: aliasToField.get(alias), alias, index }
      }
    }
    return best
  }

  function normalizeEnum(meta, value) {
    const text = normalizeWords(value)
    const mapped = meta.valueAliases instanceof Map ? meta.valueAliases.get(text) : meta.valueAliases?.[text]
    if (mapped && meta.values.includes(mapped)) return mapped
    return meta.values.find(item => normalizeWords(item) === text) || ''
  }

  function normalizeRangeScalar(meta, raw) {
    if (meta.rangeKind === 'money_lpa' || normalizeWords(meta.unit) === 'lpa') {
      const amount = normalizeMoney(raw)
      return Number.isFinite(amount) ? amount / 100000 : null
    }
    if (meta.rangeKind === 'money') return normalizeMoney(raw)
    if (meta.rangeKind === 'number') return numberValue(raw)
    return experienceValue(raw)
  }

  function normalizeRange(meta, raw) {
    if (Array.isArray(raw)) return raw.map(item => normalizeRangeScalar(meta, item))
    if (raw && typeof raw === 'object') return null
    const text = clean(raw)
    if (meta.rangeKind !== 'money' && meta.rangeKind !== 'money_lpa' && /\b(?:fresher|entry[ -]?level|no experience)\b/i.test(text)) return 0
    const match = text.match(/^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i)
    if (match) return [normalizeRangeScalar(meta, match[1]), normalizeRangeScalar(meta, match[2])]
    const amount = normalizeRangeScalar(meta, text)
    return amount === null ? null : amount
  }

  function ensureNumberBounds(meta, fieldName, value) {
    const values = Array.isArray(value) ? value : [value]
    if (values.some(item => !Number.isFinite(item) || (meta.allowNegative !== true && item < 0))) {
      throw invalid(label, `Invalid ${fieldName} number.`)
    }
    if (Number.isFinite(meta.minimum) && values.some(item => item < meta.minimum)) throw invalid(label, `${fieldName} is below the allowed minimum.`)
    if (Number.isFinite(meta.maximum) && values.some(item => item > meta.maximum)) throw invalid(label, `${fieldName} is above the allowed maximum.`)
    return value
  }

  function normalizeValue(meta, fieldName, operator, raw, now) {
    if (['is_empty', 'is_not_empty'].includes(operator)) return undefined
    const listOperator = ['between', 'in', 'not_in', 'contains_all', 'contains_any', 'overlaps'].includes(operator) ||
      (meta.type === 'array' && operator === 'not_contains' && Array.isArray(raw))
    if (listOperator) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) throw invalid(label, `Invalid ${label} filter values.`)
      const source = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
      if (!source.length || source.length > MAX_LIST_VALUES || (operator === 'between' && source.length !== 2)) throw invalid(label, `Invalid ${label} filter values.`)
      const values = source.map((item, index) => {
        if (operator === 'between' && meta.type === 'date' && typeof item === 'string') {
          const period = relativeDateRange(item, now)
          if (period) return period[index === 0 ? 0 : 1]
        }
        return normalizeValue(meta, fieldName, operator === 'between' ? 'equals' : meta.type === 'array' ? 'contains' : 'equals', item, now)
      })
      if (values.some(item => item === null || item === '')) throw invalid(label, `Invalid ${label} filter values.`)
      if (operator === 'between' && values[0] > values[1]) throw invalid(label, `Invalid ${label} filter range.`)
      return values
    }
    if (meta.type === 'enum') {
      if (!Array.isArray(meta.values) || raw === null || typeof raw === 'object') throw invalid(label, `Unknown ${fieldName} value.`)
      const value = normalizeEnum(meta, raw)
      if (!value) throw invalid(label, `Unknown ${fieldName} value.`)
      return value
    }
    if (meta.type === 'number') {
      const value = meta.numberKind === 'experience' ? experienceValue(raw) : numberValue(raw)
      return ensureNumberBounds(meta, fieldName, value)
    }
    if (meta.type === 'money') {
      const value = normalizeMoney(raw)
      return ensureNumberBounds(meta, fieldName, value)
    }
    if (meta.type === 'numeric_range') {
      const value = normalizeRange(meta, raw)
      if (value === null || (Array.isArray(value) && (value.length !== 2 || value.some(item => !Number.isFinite(item)) || value[0] > value[1]))) {
        throw invalid(label, `Invalid ${fieldName} range.`)
      }
      return ensureNumberBounds(meta, fieldName, value)
    }
    if (meta.type === 'boolean' || meta.type === 'availability') {
      const value = booleanValue(raw, meta.booleanAliases)
      if (value === null) throw invalid(label, `Invalid ${fieldName} yes/no value.`)
      return value
    }
    if (meta.type === 'date') {
      if (raw === null || typeof raw === 'object') throw invalid(label, `Invalid ${fieldName} date.`)
      const value = normalizeDate(raw, now)
      if (!value) throw invalid(label, `Invalid ${fieldName} date.`)
      return value
    }
    if (raw === null || typeof raw === 'object') throw invalid(label, `Invalid ${fieldName} text.`)
    const rawText = clean(raw)
    if (!rawText || rawText.length > MAX_TEXT_VALUE_LENGTH) throw invalid(label, `Invalid ${fieldName} text.`)
    let value = rawText
    if (typeof meta.normalize === 'function') value = meta.normalize(value)
    if (meta.normalizeCase === 'lower') value = clean(value).toLowerCase()
    if (!value || value.length > MAX_TEXT_VALUE_LENGTH) throw invalid(label, `Invalid ${fieldName} text.`)
    if (meta.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw invalid(label, `Invalid ${fieldName} identifier.`)
    }
    return meta.type === 'email' ? value.toLowerCase() : value
  }

  function validateFilter(input, options = {}) {
    const allowed = options.allowedFields ? new Set(options.allowedFields) : null
    const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now : new Date()
    let count = 0
    function visit(node, depth) {
      if (depth > MAX_DEPTH) throw invalid(label, `${label} filter is too deeply nested.`)
      if (!node || typeof node !== 'object' || Array.isArray(node)) throw invalid(label, `Invalid ${label} filter node.`)
      if (node.type === 'group') {
        if (Object.keys(node).some(key => !NODE_KEYS.group.has(key))) throw invalid(label, `Invalid ${label} filter group keys.`)
        const combinator = clean(node.combinator).toUpperCase()
        if (!['AND', 'OR'].includes(combinator) || !Array.isArray(node.children) || node.children.length < 2 || node.children.length > MAX_CONDITIONS) {
          throw invalid(label, `Invalid ${label} filter group.`)
        }
        return { type: 'group', combinator, children: node.children.map(child => visit(child, depth + 1)) }
      }
      if (node.type !== 'condition') throw invalid(label, `Invalid ${label} filter node.`)
      if (Object.keys(node).some(key => !NODE_KEYS.condition.has(key))) throw invalid(label, `Invalid ${label} filter condition keys.`)
      count += 1
      if (count > MAX_CONDITIONS) throw invalid(label, `Too many ${label} filter conditions.`)
      const requested = normalizeWords(node.field)
      let fieldName = aliasToField.get(requested) || clean(node.field)
      let meta = registry[fieldName]
      if (!meta || (meta.internal && options.allowInternalFields !== true) || (allowed && !allowed.has(fieldName))) throw invalid(label, `Unsupported or unavailable ${label} field.`)
      let operator = normalizeOperator(node.operator)
      let rawValue = node.value
      if (meta.type === 'array') {
        if (operator === 'equals') operator = 'contains'
        if (operator === 'not_equals') operator = 'not_contains'
        if (operator === 'in') operator = 'contains_any'
        if (operator === 'not_in') {
          operator = 'not_contains'
          if (!Array.isArray(rawValue)) rawValue = String(rawValue ?? '').split(',')
        }
      }
      if (meta.type === 'date' && operator === 'equals') operator = 'on'
      if (meta.type === 'availability' && ['equals', 'not_equals'].includes(operator)) {
        const available = booleanValue(rawValue, meta.booleanAliases)
        if (available === null) throw invalid(label, `Invalid ${fieldName} availability.`)
        operator = (operator === 'equals' ? available : !available) ? 'is_not_empty' : 'is_empty'
        rawValue = undefined
      }
      if (meta.type === 'date' && typeof rawValue === 'string') {
        const range = relativeDateRange(rawValue, now)
        if (range && ['on', 'between'].includes(operator)) { operator = 'between'; rawValue = range }
        else if (range && operator === 'before') rawValue = range[0]
        else if (range && operator === 'on_or_before') rawValue = range[1]
        else if (range && operator === 'after') rawValue = range[1]
        else if (range && operator === 'on_or_after') rawValue = range[0]
      }
      if (typeof config.transformCondition === 'function') {
        const transformed = config.transformCondition({ field: fieldName, operator, value: rawValue }, { now, relativeDateRange, kolkataDay })
        if (transformed) {
          fieldName = transformed.field || fieldName
          operator = normalizeOperator(transformed.operator || operator)
          rawValue = Object.prototype.hasOwnProperty.call(transformed, 'value') ? transformed.value : rawValue
          meta = registry[fieldName]
          if (!meta || (meta.internal && options.allowInternalFields !== true) || (allowed && !allowed.has(fieldName))) throw invalid(label, `Unsupported or unavailable ${label} field.`)
        }
      }
      if (!meta.operators.includes(operator)) throw invalid(label, `Operator ${operator} is not supported for ${fieldName}.`)
      const hasValue = Object.prototype.hasOwnProperty.call(node, 'value') || rawValue !== undefined
      if (['is_empty', 'is_not_empty'].includes(operator)) {
        if (rawValue !== undefined && rawValue !== null) throw invalid(label, `Empty checks cannot include a ${fieldName} value.`)
      } else if (!hasValue) {
        throw invalid(label, `A value is required for ${fieldName}.`)
      }
      const value = normalizeValue(meta, fieldName, operator, rawValue, now)
      return condition(fieldName, operator, value)
    }
    const rootInput = input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'root') ? input.root : input
    const root = visit(rootInput, 1)
    return { version: 1, mode: 'ast', root, conditions: flattenConditions(root) }
  }

  function promptIssue(prompt) {
    if (typeof prompt !== 'string' || !clean(prompt)) return `A ${label} filter query is required.`
    if (prompt.length > MAX_QUERY_LENGTH) return `The ${label} filter query is too long.`
    if (/\b(?:delete|update|insert|drop|alter|truncate|run sql|select \*|ignore permissions?|bypass permissions?|show everything)\b/i.test(prompt)) return `Only read-only ${label} filters are supported.`
    if ((prompt.match(/\(/g) || []).length !== (prompt.match(/\)/g) || []).length) return `The ${label} filter has unbalanced parentheses.`
    return ''
  }

  function parseConditionText(raw, inherited = null, now = new Date()) {
    let text = stripOuterParens(clean(raw).replace(/[.;]+$/, ''))
    if (!text) return null
    const special = config.parseSpecialCondition?.(text, { condition, group, kolkataDay, relativeDateRange, shiftDay, now })
    if (special) return special
    const found = findField(text)
    const fieldName = found?.field || inherited?.field
    if (!fieldName) return null
    const meta = registry[fieldName]
    if (found) {
      const before = clean(text.slice(0, found.index))
      const after = clean(text.slice(found.index + found.alias.length))
      const prefixOperator = before.match(/(does not contain|does not include|not contains|contains no|contains all|contains any|greater than or equal to|less than or equal to|more than|greater than|less than|at least|at most|starts with|ends with|not equal(?:s)?|is not|equal to|equals|exactly|contains|includes|include|having|has|above|below|under|over|up to|minimum|maximum|before|after|on or before|on or after|not in|one of|any of|overlaps|without|is|on|in|=|>=|<=|>|<)\s*$/i)
      text = prefixOperator && after ? `${prefixOperator[1]} ${after}` : after || before
    }
    if (NOT_EMPTY_WORDS.test(text)) return condition(fieldName, 'is_not_empty')
    if (EMPTY_WORDS.test(text)) return condition(fieldName, 'is_empty')
    if (meta.type === 'availability' || meta.type === 'boolean') {
      const bool = booleanValue(text || raw, meta.booleanAliases)
      if (bool !== null) return condition(fieldName, 'equals', bool)
    }
    if (meta.type === 'date') {
      const period = relativeDateRange(text, now)
      if (period) return condition(fieldName, 'between', period)
      if (/^(?:today|tomorrow|yesterday)$/i.test(text)) return condition(fieldName, 'on', text)
    }
    const range = text.match(/^(?:is\s+)?between\s+(.+?)\s+and\s+(.+)$/i) || text.match(/^(.+?)\s+(?:to|–|—)\s+(.+)$/i)
    if (range && ['number', 'money', 'numeric_range', 'date'].includes(meta.type)) return condition(fieldName, 'between', [range[1], range[2]])
    const operatorMatch = text.match(/^(does not contain|does not include|not contains|contains no|contains all|contains any|greater than or equal to|less than or equal to|more than|greater than|less than|at least|at most|starts with|ends with|not equal(?:s)?|is not|equal to|equals|exactly|contains|includes|include|having|has|above|below|under|over|up to|minimum|maximum|before|after|on or before|on or after|not in|one of|any of|overlaps|without|is|on|in|=|>=|<=|>|<)\s*(.*)$/i)
    const defaultOperator = meta.type === 'array' ? 'contains' : meta.type === 'date' ? 'on' :
      ['enum', 'identifier', 'boolean', 'availability', 'number', 'money', 'numeric_range'].includes(meta.type) ? 'equals' : 'contains'
    const operator = operatorMatch ? normalizeOperator(operatorMatch[1]) : inherited?.operator || defaultOperator
    let value = clean(operatorMatch ? operatorMatch[2] : text).replace(/^["']|["']$/g, '')
    if (!value) return null
    if (!operatorMatch && ['number', 'money', 'numeric_range'].includes(meta.type) && /\+\s*(?:years?|lpa|lakhs?|lacs?)?$/i.test(value)) {
      value = value.replace(/\+\s*(?:years?|lpa|lakhs?|lacs?)?$/i, '')
      return condition(fieldName, 'greater_than_or_equal', value)
    }
    if (EMPTY_WORDS.test(value)) return condition(fieldName, operator === 'not_equals' ? 'is_not_empty' : 'is_empty')
    return condition(fieldName, operator, value)
  }

  function parseExpression(text, inherited = null, now = new Date()) {
    const source = stripOuterParens(text)
    const ors = splitTopLevel(source, 'or')
    if (ors.length > 1) {
      let last = inherited
      const children = ors.map(part => {
        const node = parseExpression(part, last, now)
        const leaves = flattenConditions(node)
        if (leaves.length) last = leaves[leaves.length - 1]
        return node
      }).filter(Boolean)
      return children.length === ors.length ? group('OR', children) : null
    }
    const ands = splitTopLevel(source, 'and')
    if (ands.length > 1) {
      let last = inherited
      const children = ands.map(part => {
        const node = parseExpression(part, last, now)
        const leaves = flattenConditions(node)
        if (leaves.length) last = leaves[leaves.length - 1]
        return node
      }).filter(Boolean)
      return children.length === ands.length ? group('AND', children) : null
    }
    return parseConditionText(source, inherited, now)
  }

  function parsePrompt(prompt, options = {}) {
    if (promptIssue(prompt)) return null
    const preparedInput = config.preparePrompt
      ? config.preparePrompt(clean(prompt), { condition, group, kolkataDay, relativeDateRange, shiftDay, now: options.now || new Date() })
      : clean(prompt)
    if (typeof preparedInput !== 'string' || !clean(preparedInput)) return null
    const prepared = clean(preparedInput)
      .replace(/\s+(?:but|as well as)\s+/gi, ' and ')
      .replace(/^(?:and|but|where|who|whose|that)\s+/i, '')
    const root = parseExpression(prepared, null, options.now || new Date())
    if (!root) return null
    try { return validateFilter({ root }, options) } catch { return null }
  }

  function compileCondition(node) {
    const meta = registry[node.field]
    if (!meta) throw new Error(`Unknown ${label} filter field: ${node.field}`)
    if (typeof meta.compile === 'function') return meta.compile(node, { quoteValue, scalarClause, rangeClause })
    if (meta.type === 'numeric_range') return rangeClause(node, meta)
    if (meta.type === 'availability') {
      const available = node.operator === 'is_not_empty'
      const clauses = meta.columns.map(column => scalarClause(column, { ...node, operator: available ? 'is_not_empty' : 'is_empty' }, { ...meta, type: 'text' }))
      return `${available ? 'or' : 'and'}(${clauses.join(',')})`
    }
    const clauses = meta.columns.map(column => scalarClause(column, node, meta))
    if (clauses.length === 1) return clauses[0]
    const every = ['not_equals', 'not_contains', 'not_in', 'is_empty'].includes(node.operator)
    return `${every ? 'and' : 'or'}(${clauses.join(',')})`
  }

  function compileAst(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`Invalid ${label} filter AST.`)
    if (node.type === 'condition') return compileCondition(node)
    if (node.type !== 'group' || !['AND', 'OR'].includes(node.combinator) || !Array.isArray(node.children) || node.children.length < 2) {
      throw new Error(`Invalid ${label} filter AST.`)
    }
    return `${node.combinator.toLowerCase()}(${node.children.map(compileAst).join(',')})`
  }

  function keywordTokens(searchText) {
    const stop = new Set(['a', 'all', 'an', 'and', 'any', 'client', 'clients', 'job', 'jobs', 'mandate', 'mandates', 'show', 'find', 'list', 'get', 'give', 'the', 'with', 'where', 'who', 'whose'])
    const values = clean(searchText).split(/\s+/)
      .map(item => item.replace(/^[^\p{L}\p{N}@+#.-]+|[^\p{L}\p{N}@+#.-]+$/gu, ''))
      .filter(item => item && !stop.has(item.toLowerCase()))
    return [...new Map(values.map(item => [item.toLowerCase(), item])).values()].slice(0, 4)
  }

  function buildKeywordFilter(searchText, options = {}) {
    const issue = promptIssue(searchText)
    if (issue) throw invalid(label, issue)
    const allowed = new Set(options.allowedFields || Object.keys(registry))
    const searchableTypes = new Set(['text', 'email', 'phone', 'array'])
    const fields = [...new Set(config.keywordFields || [])].filter(name => allowed.has(name) && !registry[name]?.internal && searchableTypes.has(registry[name]?.type))
    const tokens = keywordTokens(searchText)
    if (!fields.length || !tokens.length) throw invalid(label, `No searchable ${label} fields are available.`)
    const boundedFields = fields.slice(0, MAX_CONDITIONS)
    const boundedTokens = tokens.slice(0, Math.max(1, Math.floor(MAX_CONDITIONS / boundedFields.length)))
    const tokenGroups = boundedTokens.map(value => group('OR', boundedFields.map(fieldName => condition(
      fieldName,
      registry[fieldName].type === 'array' ? 'contains' : 'contains',
      value
    ))))
    return validateFilter({ root: group('AND', tokenGroups) }, options)
  }

  return {
    config,
    key: config.key,
    label,
    examples: config.examples || [],
    guidance: config.guidance || [],
    parseSort: config.parseSort,
    registry,
    aliasToField,
    parsePrompt,
    validateFilter,
    compileAst,
    flattenConditions,
    buildKeywordFilter,
    promptIssue
  }
}

module.exports = {
  MAX_QUERY_LENGTH,
  MAX_DEPTH,
  MAX_CONDITIONS,
  MAX_LIST_VALUES,
  MAX_TEXT_VALUE_LENGTH,
  TEXT_OPERATORS,
  ENUM_OPERATORS,
  NUMBER_OPERATORS,
  DATE_OPERATORS,
  BOOLEAN_OPERATORS,
  ARRAY_OPERATORS,
  IDENTIFIER_OPERATORS,
  clean,
  normalizeWords,
  numberValue,
  experienceValue,
  booleanValue,
  kolkataDay,
  relativeDateRange,
  normalizeOperator,
  condition,
  group,
  field,
  flattenConditions,
  createEntityFilter
}
