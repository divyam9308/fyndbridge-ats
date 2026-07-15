const { clean, flattenConditions, normalizeWords } = require('./entityAiFilterCore')

function referenceError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_FILTER_REFERENCE' })
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
}

function matchingProfile(profiles, value, label = 'Consultant') {
  const wanted = normalizeWords(value)
  if (!wanted || isUuid(wanted)) throw referenceError(`${label} must be entered by name.`)
  const available = (profiles || []).filter(profile => clean(profile.name))
  const exact = available.filter(profile => normalizeWords(profile.name) === wanted)
  const matches = exact.length
    ? exact
    : available.filter(profile => normalizeWords(profile.name).includes(wanted))
  if (matches.length > 1) {
    throw referenceError(`${label} name "${clean(value)}" is ambiguous. Please enter the full name.`)
  }
  return matches[0] || null
}

function conditionValues(node) {
  return Array.isArray(node.value) ? node.value : [node.value]
}

function resolvedProfileNames(node, profiles, label) {
  const resolved = conditionValues(node).map(value => {
    const profile = matchingProfile(profiles, value, label)
    // Historical assignments can remain after a user profile is removed. An
    // exact, non-UUID name is therefore still a valid safe stored-name match.
    return normalizeWords(profile?.name || value)
  })
  return {
    ...node,
    value: Array.isArray(node.value) ? [...new Set(resolved)] : resolved[0]
  }
}

async function resolveEntityFilterReferences(entity, filters, options = {}) {
  const conditions = flattenConditions(filters?.root)
  const profileLeaves = conditions.filter(node => (
    (entity === 'clients' && node.field === 'consultant') ||
    (entity === 'mandates' && ['consultant', 'team_lead'].includes(node.field))
  ) && !['is_empty', 'is_not_empty'].includes(node.operator))

  let profiles = options.profiles
  if (!Array.isArray(profiles) && profileLeaves.length) {
    const database = options.supabase || require('./supabaseAdmin')
    const { data, error } = await database
      .from('user_profiles')
      .select('user_id, name')
      .not('name', 'is', null)
      .order('name')
    if (error) throw error
    profiles = data || []
  }
  profiles = Array.isArray(profiles) ? profiles : []

  function visit(node) {
    if (node.type === 'group') return { ...node, children: node.children.map(visit) }
    if (entity === 'clients' && node.field === 'consultant' && !['is_empty', 'is_not_empty'].includes(node.operator)) {
      return resolvedProfileNames(node, profiles, 'Consultant')
    }
    if (entity === 'mandates' && node.field === 'consultant' && !['is_empty', 'is_not_empty'].includes(node.operator)) {
      return resolvedProfileNames(node, profiles, 'Consultant')
    }
    if (entity === 'mandates' && node.field === 'team_lead' && !['is_empty', 'is_not_empty'].includes(node.operator)) {
      return resolvedProfileNames(node, profiles, 'Team Lead')
    }
    return node
  }

  const root = filters?.root ? visit(filters.root) : null
  return { ...filters, root, conditions: flattenConditions(root) }
}

module.exports = {
  resolveEntityFilterReferences,
  matchingProfile,
  resolvedProfileNames,
  isUuid
}
