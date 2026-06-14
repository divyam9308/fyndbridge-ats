const { configs, normalizeCondition } = require('./filterEngine')

function escapeLike(value) {
  return String(value || '').replace(/[%_,]/g, '\\$&')
}

function escapeOrValue(value) {
  return String(value || '').replace(/,/g, '\\,').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function toArrayLiteral(values) {
  return `{${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')}}`
}

function normalizeFilters(page, filters) {
  const config = configs[page]
  return (filters?.conditions || [])
    .map((condition) => normalizeCondition(config, condition))
    .filter(Boolean)
}

function applySingleCondition(query, definition, condition) {
  const column = definition.column
  const operator = condition.operator
  const value = condition.value

  if (definition.kind === 'array') {
    const values = Array.isArray(value) ? value : [value]
    if (operator === 'is_empty') return query.or(`${column}.is.null,${column}.eq.{}`)
    if (operator === 'is_not_empty') return query.not(column, 'is', null).neq(column, '{}')
    if (['contains', 'equals', 'in'].includes(operator)) return query.contains(column, values)
    if (operator === 'not_equals') return query.not(column, 'cs', toArrayLiteral(values))
    return query
  }

  if (operator === 'is_empty') return query.or(`${column}.is.null,${column}.eq.""`)
  if (operator === 'is_not_empty') return query.not(column, 'is', null).not(column, 'eq', '')

  if (definition.kind === 'boolean') {
    if (operator === 'not_equals') return query.neq(column, value)
    return query.eq(column, value)
  }

  if (definition.kind === 'number' || definition.kind === 'date') {
    if (operator === 'greater_than') return query.gt(column, value)
    if (operator === 'greater_than_or_equal') return query.gte(column, value)
    if (operator === 'less_than') return query.lt(column, value)
    if (operator === 'less_than_or_equal') return query.lte(column, value)
    if (operator === 'between' && Array.isArray(value) && value.length >= 2) return query.gte(column, value[0]).lte(column, value[1])
    if (operator === 'not_equals') return query.neq(column, value)
    return query.eq(column, value)
  }

  const textValue = escapeLike(value)
  if (operator === 'contains') return query.ilike(column, `%${textValue}%`)
  if (operator === 'starts_with') return query.ilike(column, `${textValue}%`)
  if (operator === 'ends_with') return query.ilike(column, `%${textValue}`)
  if (operator === 'not_equals') return query.neq(column, value)
  if (operator === 'in' && Array.isArray(value)) return query.in(column, value)
  return query.eq(column, value)
}

function buildOrClause(definition, condition) {
  const column = definition.column
  const operator = condition.operator
  const value = condition.value

  if (definition.kind === 'array') {
    const values = Array.isArray(value) ? value : [value]
    if (operator === 'is_empty') return `${column}.is.null`
    if (operator === 'is_not_empty') return `${column}.not.is.null`
    if (['contains', 'equals', 'in'].includes(operator)) return `${column}.cs.${toArrayLiteral(values)}`
    if (operator === 'not_equals') return `${column}.not.cs.${toArrayLiteral(values)}`
    return null
  }

  if (operator === 'is_empty') return `${column}.is.null`
  if (operator === 'is_not_empty') return `${column}.not.is.null`

  if (definition.kind === 'boolean') {
    return `${column}.${operator === 'not_equals' ? 'neq' : 'eq'}.${value}`
  }

  if (definition.kind === 'number' || definition.kind === 'date') {
    if (operator === 'greater_than') return `${column}.gt.${value}`
    if (operator === 'greater_than_or_equal') return `${column}.gte.${value}`
    if (operator === 'less_than') return `${column}.lt.${value}`
    if (operator === 'less_than_or_equal') return `${column}.lte.${value}`
    if (operator === 'between' && Array.isArray(value) && value.length >= 2) return `${column}.gte.${value[0]}`
    if (operator === 'not_equals') return `${column}.neq.${value}`
    return `${column}.eq.${value}`
  }

  const textValue = escapeOrValue(value)
  if (operator === 'contains') return `${column}.ilike.*${textValue}*`
  if (operator === 'starts_with') return `${column}.ilike.${textValue}*`
  if (operator === 'ends_with') return `${column}.ilike.*${textValue}`
  if (operator === 'not_equals') return `${column}.neq.${textValue}`
  if (operator === 'in' && Array.isArray(value)) return `${column}.in.(${value.map(escapeOrValue).join(',')})`
  return `${column}.eq.${textValue}`
}

function applyQueryFilters(query, page, filters, mapping, extras = {}) {
  const normalized = normalizeFilters(page, filters)
  if (!normalized.length) return { query, normalized }

  if (filters?.mode === 'any') {
    const orClauses = normalized.flatMap((condition) => {
      const definitions = mapping[condition.field] || []
      return definitions
        .map((definition) => buildOrClause(definition, condition))
        .filter(Boolean)
    })
    const extraClauses = extras.orClauses ? extras.orClauses(normalized) : []
    const clauses = [...orClauses, ...extraClauses].filter(Boolean)
    if (clauses.length) query = query.or(clauses.join(','))
    return { query, normalized }
  }

  for (const condition of normalized) {
    const definitions = mapping[condition.field] || []
    const extraQuery = extras.applyCondition ? extras.applyCondition(query, condition) : query
    query = extraQuery
    if (!definitions.length) continue
    for (const definition of definitions) {
      query = applySingleCondition(query, definition, condition)
    }
  }

  return { query, normalized }
}

module.exports = { applyQueryFilters, normalizeFilters }
