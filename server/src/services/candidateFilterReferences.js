const { flattenConditions } = require('./candidateAiFilter')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function condition(field, operator, value) {
  return { type: 'condition', field, operator, ...(value !== undefined ? { value } : {}) }
}

function group(combinator, children) {
  const compact = children.filter(Boolean)
  return compact.length === 1 ? compact[0] : { type: 'group', combinator, children: compact }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanText(value))
}

async function resolveDisplayIdentifiers(node, config, database) {
  const listOperator = ['in', 'not_in'].includes(node.operator)
  const values = listOperator ? node.value : [node.value]
  const displayValues = values.filter(value => !isUuid(value))
  if (displayValues.some(value => !config.pattern.test(cleanText(value)))) {
    throw Object.assign(new Error(`Invalid ${config.label}.`), { statusCode: 400 })
  }
  if (!displayValues.length) return node

  const requested = [...new Set(displayValues.map(value => cleanText(value).toUpperCase()))]
  const { data, error } = await database
    .from(config.table)
    .select(`id, ${config.displayColumn}`)
    .in(config.displayColumn, requested)
    .limit(requested.length + 1)
  if (error) throw error
  const byDisplay = new Map()
  for (const row of data || []) {
    const key = cleanText(row[config.displayColumn]).toUpperCase()
    if (byDisplay.has(key)) throw Object.assign(new Error(`No unique ${config.label} matched "${key}".`), { statusCode: 400 })
    byDisplay.set(key, row.id)
  }
  if (requested.some(value => !byDisplay.has(value))) {
    throw Object.assign(new Error(`No unique ${config.label} matched the supplied ID.`), { statusCode: 400 })
  }
  const resolved = values.map(value => (
    isUuid(value) ? cleanText(value) : byDisplay.get(cleanText(value).toUpperCase())
  ))
  return { ...node, value: listOperator ? resolved : resolved[0] }
}

function matchingConsultantProfile(profiles, value) {
  const wanted = cleanText(value).toLowerCase()
  const exact = profiles.filter(row => cleanText(row.name).toLowerCase() === wanted)
  const matches = exact.length
    ? exact
    : profiles.filter(row => cleanText(row.name).toLowerCase().includes(wanted))
  if (matches.length > 1) {
    throw Object.assign(
      new Error(`Consultant name "${cleanText(value)}" is ambiguous. Please enter the full name.`),
      { statusCode: 400 }
    )
  }
  return matches[0] || null
}

function resolvedConsultantEquals(value, profile) {
  if (!profile) return condition('consultant', 'equals', cleanText(value))
  const original = cleanText(value)
  const canonical = cleanText(profile.name)
  return group('OR', [
    condition('consultant_user_id', 'equals', profile.user_id),
    condition('consultant', 'equals', canonical),
    canonical.toLowerCase() === original.toLowerCase() ? null : condition('consultant', 'equals', original)
  ])
}

function resolvedConsultantNotEquals(value, profile) {
  if (!profile) return condition('consultant', 'not_equals', cleanText(value))
  const original = cleanText(value)
  const canonical = cleanText(profile.name)
  return group('AND', [
    group('OR', [
      condition('consultant_user_id', 'is_null'),
      condition('consultant_user_id', 'not_equals', profile.user_id)
    ]),
    group('OR', [
      condition('consultant', 'is_null'),
      group('AND', [
        condition('consultant', 'not_equals', canonical),
        canonical.toLowerCase() === original.toLowerCase() ? null : condition('consultant', 'not_equals', original)
      ])
    ])
  ])
}

function resolveConsultantCondition(node, profiles) {
  const values = ['in', 'not_in'].includes(node.operator) ? node.value : [node.value]
  const resolved = values.map(value => {
    const profile = matchingConsultantProfile(profiles, value)
    return ['not_equals', 'not_in'].includes(node.operator)
      ? resolvedConsultantNotEquals(value, profile)
      : resolvedConsultantEquals(value, profile)
  })
  return group(node.operator === 'not_in' ? 'AND' : 'OR', resolved)
}

async function resolveCandidateFilterReferences(filters, options = {}) {
  const conditions = flattenConditions(filters.root)
  const needsConsultants = conditions.some(item => (
    item.field === 'consultant' && ['equals', 'not_equals', 'in', 'not_in'].includes(item.operator)
  ))
  let database = options.supabase || null
  const getDatabase = () => {
    if (!database) database = require('./supabaseAdmin')
    return database
  }
  const profileResult = Array.isArray(options.profiles)
    ? { data: options.profiles, error: null }
    : needsConsultants
      ? await getDatabase().from('user_profiles').select('user_id, name').not('name', 'is', null).order('name')
      : { data: [], error: null }
  if (profileResult.error) throw profileResult.error

  async function visit(node) {
    if (node.type === 'group') {
      return { ...node, children: await Promise.all(node.children.map(visit)) }
    }
    if (node.field === 'consultant' && ['equals', 'not_equals', 'in', 'not_in'].includes(node.operator)) {
      return resolveConsultantCondition(node, profileResult.data || [])
    }
    if (node.field === 'job_id' && ['equals', 'not_equals', 'in', 'not_in'].includes(node.operator)) {
      return resolveDisplayIdentifiers(node, {
        table: 'jobs', displayColumn: 'job_display_id', pattern: /^JB\d+$/i, label: 'mandate'
      }, getDatabase())
    }
    if (node.field === 'client_id' && ['equals', 'not_equals', 'in', 'not_in'].includes(node.operator)) {
      return resolveDisplayIdentifiers(node, {
        table: 'clients', displayColumn: 'client_display_id', pattern: /^CL\d+$/i, label: 'client'
      }, getDatabase())
    }
    return node
  }

  const root = await visit(filters.root)
  return { ...filters, root, conditions: flattenConditions(root) }
}

module.exports = {
  resolveCandidateFilterReferences,
  matchingConsultantProfile,
  resolvedConsultantEquals,
  resolvedConsultantNotEquals,
  resolveDisplayIdentifiers
}
