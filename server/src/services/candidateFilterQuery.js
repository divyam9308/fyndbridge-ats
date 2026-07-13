const { compileCandidateAst, nodeDomain } = require('./candidateAiFilter')

const MAX_MATCH_IDS = 20000

function idSet(rows, key) {
  return new Set((rows || []).map(row => row[key]).filter(Boolean))
}

function combineSets(combinator, sets) {
  if (!sets.length) return new Set()
  if (combinator === 'OR') return new Set(sets.flatMap(set => [...set]))
  const [first, ...rest] = sets.sort((a, b) => a.size - b.size)
  return new Set([...first].filter(id => rest.every(set => set.has(id))))
}

async function queryDomainIds(supabase, node, domain) {
  const table = domain === 'base' ? 'candidates' : 'candidate_associations'
  const key = domain === 'base' ? 'id' : 'candidate_id'
  const { data, error } = await supabase
    .from(table)
    .select(key)
    .or(compileCandidateAst(node))
    .limit(MAX_MATCH_IDS)
  if (error) throw error
  if ((data || []).length >= MAX_MATCH_IDS) {
    throw Object.assign(new Error('This AI filter is too broad. Add another condition to narrow the results.'), { statusCode: 400 })
  }
  return idSet(data, key)
}

async function resolveCandidateIds(supabase, node) {
  const domain = nodeDomain(node)
  if (domain !== 'mixed') return queryDomainIds(supabase, node, domain)
  const sets = await Promise.all(node.children.map(child => resolveCandidateIds(supabase, child)))
  return combineSets(node.combinator, sets)
}

async function applyCandidateAstQuery(supabase, query, root) {
  if (!root) return { query, domain: '' }
  const domain = nodeDomain(root)
  if (domain === 'base') return { query: query.or(compileCandidateAst(root)), domain }
  if (domain === 'association') return { query: query.or(compileCandidateAst(root), { referencedTable: 'candidate_associations' }), domain }
  const ids = [...await resolveCandidateIds(supabase, root)]
  return { query: ids.length ? query.in('id', ids) : query.eq('id', '00000000-0000-0000-0000-000000000000'), domain, resolvedIds: ids.length }
}

module.exports = { MAX_MATCH_IDS, combineSets, resolveCandidateIds, applyCandidateAstQuery }
