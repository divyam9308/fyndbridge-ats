const { compileCandidateAst, nodeDomain } = require('./candidateAiFilter')

// Cross-domain ORs require one bounded ID predicate because PostgREST cannot
// express an OR spanning the root table and an embedded relation. Keeping the
// set deliberately small prevents oversized GET URLs and fails broad requests
// explicitly instead of silently truncating them at the API row cap.
const MAX_MATCH_IDS = 100
const NO_MATCH_UUID = '00000000-0000-0000-0000-000000000000'
const CANDIDATE_TABLE = 'candidates'
const ASSOCIATION_TABLE = 'candidate_associations'
const CANDIDATE_SELECT = '*, candidate_associations(*)'
const ASSOCIATION_SELECT = '*, candidates!inner(*)'

function idSet(rows, key) {
  return new Set((rows || []).map(row => row[key]).filter(Boolean))
}

function combineSets(combinator, sets) {
  if (!sets.length) return new Set()
  if (combinator === 'OR') return new Set(sets.flatMap(set => [...set]))
  const [first, ...rest] = [...sets].sort((a, b) => a.size - b.size)
  return new Set([...first].filter(id => rest.every(set => set.has(id))))
}

function tooBroad() {
  return Object.assign(new Error('This AI filter is too broad. Add another condition to narrow the results.'), {
    statusCode: 400,
    code: 'CANDIDATE_FILTER_TOO_BROAD'
  })
}

function assertBounded(set) {
  if (set.size > MAX_MATCH_IDS) throw tooBroad()
  return set
}

async function boundedIdQuery(query, key) {
  const { data, error, count } = await query.limit(MAX_MATCH_IDS + 1)
  if (error) throw error
  if (Number.isFinite(count) && (count > MAX_MATCH_IDS || count !== (data || []).length)) throw tooBroad()
  if ((data || []).length > MAX_MATCH_IDS) throw tooBroad()
  return idSet(data, key)
}

/**
 * Resolve candidate IDs for the legacy candidates-table query path.
 *
 * Association conditions are evaluated together on one association row before
 * candidate_id is projected, so `consultant = Cherry AND status = Hired` cannot
 * be satisfied by two different assignments for the same candidate.
 */
async function queryDomainIds(supabase, node, domain) {
  const table = domain === 'base' ? CANDIDATE_TABLE : ASSOCIATION_TABLE
  const key = domain === 'base' ? 'id' : 'candidate_id'
  const query = supabase
    .from(table)
    .select(key, { count: 'exact' })
    .or(compileCandidateAst(node))
  return boundedIdQuery(query, key)
}

async function resolveCandidateIds(supabase, node) {
  const domain = nodeDomain(node)
  if (domain !== 'mixed') return queryDomainIds(supabase, node, domain)
  const sets = await Promise.all(node.children.map(child => resolveCandidateIds(supabase, child)))
  return assertBounded(combineSets(node.combinator, sets))
}

/**
 * Query association-row IDs for a same-domain AST subtree.
 *
 * Base-field predicates are applied through an inner embedded candidate. This
 * projects only IDs and avoids downloading candidate records or issuing an N+1
 * lookup. Association predicates run directly against candidate_associations.
 */
async function queryAssociationRowIds(supabase, node, domain) {
  let query = supabase.from(ASSOCIATION_TABLE)
  if (domain === 'base') {
    query = query
      .select('id, candidates!inner(id)', { count: 'exact' })
      .or(compileCandidateAst(node), { referencedTable: CANDIDATE_TABLE })
  } else {
    query = query
      .select('id', { count: 'exact' })
      .or(compileCandidateAst(node))
  }
  return boundedIdQuery(query, 'id')
}

function projectCandidateOnlyRoot(node) {
  if (node.type === 'condition') return nodeDomain(node) === 'base' ? node : null
  const projected = node.children.map(projectCandidateOnlyRoot)
  if (node.combinator === 'AND' && projected.some(child => !child)) return null
  return groupOrSingle(node.combinator, projected.filter(Boolean))
}

async function queryCandidateOnlyIds(supabase, node) {
  const query = supabase
    .from(CANDIDATE_TABLE)
    .select('id, candidate_associations(id)', { count: 'exact' })
    .or(compileCandidateAst(node))
    .is('candidate_associations', null)
  return boundedIdQuery(query, 'id')
}

/**
 * Resolve an arbitrary mixed-domain AST at association-row grain.
 *
 * The lookup is injectable for deterministic tests. A base subtree returns all
 * existing association rows belonging to matching candidates; an association
 * subtree returns only the matching assignments. Set algebra then preserves the
 * exact nested AND/OR tree without widening back to every assignment belonging
 * to a matched candidate.
 */
async function resolveAssociationIds(supabase, node, options = {}) {
  const lookup = options.lookup || ((domain, subtree) => queryAssociationRowIds(supabase, subtree, domain))

  async function visit(subtree) {
    const domain = nodeDomain(subtree)
    if (domain !== 'mixed') return assertBounded(await lookup(domain, subtree))
    const sets = await Promise.all(subtree.children.map(visit))
    return assertBounded(combineSets(subtree.combinator, sets))
  }

  return visit(node)
}

function groupOrSingle(combinator, children) {
  if (!children.length) return null
  if (children.length === 1) return children[0]
  return { type: 'group', combinator, children }
}

function flattenAndTerms(node) {
  if (node.type !== 'group' || node.combinator !== 'AND') return [node]
  return node.children.flatMap(flattenAndTerms)
}

/**
 * Split a conjunction into base and association subtrees when it is safe to
 * apply them as two PostgREST filters on candidate_associations + candidates.
 * Cross-domain OR cannot be represented by two independent relation filters and
 * deliberately returns null so it uses association-ID set resolution instead.
 */
function splitConjunctiveDomains(root) {
  const domain = nodeDomain(root)
  if (domain === 'base') return { baseRoot: root, associationRoot: null }
  if (domain === 'association') return { baseRoot: null, associationRoot: root }
  const terms = flattenAndTerms(root)
  const base = []
  const association = []
  for (const term of terms) {
    const termDomain = nodeDomain(term)
    if (termDomain === 'mixed') return null
    if (termDomain === 'base') base.push(term)
    else association.push(term)
  }
  return {
    baseRoot: groupOrSingle('AND', base),
    associationRoot: groupOrSingle('AND', association)
  }
}

/**
 * Build a source-aware execution plan.
 *
 * Base-only filters preserve the existing candidates-table response shape.
 * Any association filter switches to association-row grain, which is required
 * for an exact count/page and prevents non-matching sibling assignments from
 * leaking into the flattened Candidates response.
 */
async function createCandidateAstQueryPlan(supabase, root, options = {}) {
  if (!root) {
    return {
      table: CANDIDATE_TABLE,
      select: CANDIDATE_SELECT,
      rowMode: 'candidate',
      domain: '',
      resolution: 'none',
      baseRoot: null,
      associationRoot: null,
      associationIds: null
    }
  }

  const domain = nodeDomain(root)
  if (domain === 'base') {
    if (options.forceAssociationRows) {
      return {
        table: ASSOCIATION_TABLE,
        select: ASSOCIATION_SELECT,
        rowMode: 'association',
        domain,
        resolution: 'direct',
        baseRoot: root,
        associationRoot: null,
        associationIds: null
      }
    }
    return {
      table: CANDIDATE_TABLE,
      select: CANDIDATE_SELECT,
      rowMode: 'candidate',
      domain,
      resolution: 'direct',
      baseRoot: root,
      associationRoot: null,
      associationIds: null
    }
  }

  const direct = splitConjunctiveDomains(root)
  if (direct) {
    return {
      table: ASSOCIATION_TABLE,
      select: ASSOCIATION_SELECT,
      rowMode: 'association',
      domain,
      resolution: 'direct',
      ...direct,
      associationIds: null
    }
  }

  const associationIds = [...await resolveAssociationIds(supabase, root, options)]
  const candidateOnlyRoot = options.forceAssociationRows ? null : projectCandidateOnlyRoot(root)
  const candidateOnlyLookup = options.candidateOnlyLookup || ((subtree) => queryCandidateOnlyIds(supabase, subtree))
  const candidateOnlyIds = candidateOnlyRoot ? [...await candidateOnlyLookup(candidateOnlyRoot)] : []
  if (associationIds.length + candidateOnlyIds.length > MAX_MATCH_IDS) throw tooBroad()
  return {
    table: ASSOCIATION_TABLE,
    select: ASSOCIATION_SELECT,
    rowMode: candidateOnlyIds.length ? 'mixed' : 'association',
    domain,
    resolution: 'association_ids',
    baseRoot: null,
    associationRoot: null,
    associationIds,
    candidateOnlyIds
  }
}

function applyCandidateAstPlan(query, plan) {
  if (!plan) return query
  if (plan.table === CANDIDATE_TABLE) {
    return plan.baseRoot ? query.or(compileCandidateAst(plan.baseRoot)) : query
  }
  if (Array.isArray(plan.associationIds)) {
    return plan.associationIds.length
      ? query.in('id', plan.associationIds)
      : query.eq('id', NO_MATCH_UUID)
  }
  let next = query
  if (plan.associationRoot) next = next.or(compileCandidateAst(plan.associationRoot))
  if (plan.baseRoot) next = next.or(compileCandidateAst(plan.baseRoot), { referencedTable: CANDIDATE_TABLE })
  return next
}

async function buildCandidateAstQuery(supabase, root, options = {}) {
  const plan = await createCandidateAstQueryPlan(supabase, root, options)
  const query = supabase
    .from(plan.table)
    .select(options.select || plan.select, { count: options.count || 'exact' })
  return { query: applyCandidateAstPlan(query, plan), plan }
}

/**
 * Backward-compatible candidates-table adapter. New association-aware callers
 * should use createCandidateAstQueryPlan/applyCandidateAstPlan so they can switch
 * the root table and flatten according to plan.rowMode.
 */
async function applyCandidateAstQuery(supabase, query, root) {
  if (!root) return { query, domain: '' }
  const domain = nodeDomain(root)
  if (domain === 'base') return { query: query.or(compileCandidateAst(root)), domain }
  if (domain === 'association') {
    return {
      query: query.or(compileCandidateAst(root), { referencedTable: ASSOCIATION_TABLE }),
      domain,
      requiresAssociationRowQuery: true
    }
  }
  const ids = [...await resolveCandidateIds(supabase, root)]
  return {
    query: ids.length ? query.in('id', ids) : query.eq('id', NO_MATCH_UUID),
    domain,
    resolvedIds: ids.length,
    requiresAssociationRowQuery: true
  }
}

module.exports = {
  MAX_MATCH_IDS,
  NO_MATCH_UUID,
  CANDIDATE_TABLE,
  ASSOCIATION_TABLE,
  CANDIDATE_SELECT,
  ASSOCIATION_SELECT,
  combineSets,
  queryDomainIds,
  resolveCandidateIds,
  queryAssociationRowIds,
  projectCandidateOnlyRoot,
  queryCandidateOnlyIds,
  resolveAssociationIds,
  splitConjunctiveDomains,
  createCandidateAstQueryPlan,
  applyCandidateAstPlan,
  buildCandidateAstQuery,
  applyCandidateAstQuery
}
