const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateCandidateAst } = require('./candidateAiFilter')
const {
  MAX_MATCH_IDS,
  NO_MATCH_UUID,
  CANDIDATE_TABLE,
  ASSOCIATION_TABLE,
  combineSets,
  queryAssociationRowIds,
  projectCandidateOnlyRoot,
  queryCandidateOnlyIds,
  resolveAssociationIds,
  splitConjunctiveDomains,
  createCandidateAstQueryPlan,
  applyCandidateAstPlan,
  buildCandidateAstQuery
} = require('./candidateFilterQuery')

function condition(field, operator, value) {
  return { type: 'condition', field, operator, ...(value !== undefined ? { value } : {}) }
}

function group(combinator, ...children) {
  return { type: 'group', combinator, children }
}

class RecordingQuery {
  constructor(table, calls, responses) {
    this.table = table
    this.calls = calls
    this.responses = responses
  }

  record(method, ...args) {
    this.calls.push({ table: this.table, method, args })
    return this
  }

  select(...args) { return this.record('select', ...args) }
  or(...args) { return this.record('or', ...args) }
  is(...args) { return this.record('is', ...args) }
  in(...args) { return this.record('in', ...args) }
  eq(...args) { return this.record('eq', ...args) }
  order(...args) { return this.record('order', ...args) }
  range(...args) { return this.record('range', ...args) }

  limit(...args) {
    this.record('limit', ...args)
    return Promise.resolve(this.responses.shift() || { data: [], error: null })
  }
}

function recordingSupabase(responses = []) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push({ table, method: 'from', args: [table] })
      return new RecordingQuery(table, calls, responses)
    }
  }
}

const baseExperience = condition('experience', 'greater_than', 5)
const baseDelhi = condition('current_location', 'contains', 'Delhi')
const consultantCherry = condition('consultant', 'equals', 'Cherry')
const statusHired = condition('status', 'equals', 'Hired')

test('set algebra is stable, deduplicated, and does not mutate its inputs', () => {
  const left = new Set(['a1', 'a2', 'a4'])
  const right = new Set(['a2', 'a3', 'a4'])
  const inputs = [left, right]
  assert.deepEqual([...combineSets('AND', inputs)], ['a2', 'a4'])
  assert.deepEqual([...combineSets('OR', inputs)].sort(), ['a1', 'a2', 'a3', 'a4'])
  assert.equal(inputs[0], left)
  assert.equal(inputs[1], right)
})

test('same-domain nested OR stays intact when a mixed AND is split for a direct joined query', () => {
  const associationChoice = group('OR', consultantCherry, statusHired)
  const root = group('AND', group('AND', baseExperience, consultantCherry), associationChoice, baseDelhi)
  const split = splitConjunctiveDomains(root)
  assert.ok(split)
  assert.equal(split.baseRoot.type, 'group')
  assert.equal(split.baseRoot.combinator, 'AND')
  assert.deepEqual(split.baseRoot.children, [baseExperience, baseDelhi])
  assert.equal(split.associationRoot.type, 'group')
  assert.equal(split.associationRoot.combinator, 'AND')
  assert.deepEqual(split.associationRoot.children, [consultantCherry, associationChoice])
})

test('cross-domain OR is never split into independent filters', () => {
  assert.equal(splitConjunctiveDomains(group('OR', baseExperience, consultantCherry)), null)
  assert.equal(
    splitConjunctiveDomains(group('AND', group('OR', baseExperience, consultantCherry), statusHired)),
    null
  )
})

function fixtureLookup() {
  const rows = [
    { id: 'a1', base: { experience: 6 }, association: { consultant: 'Cherry', status: 'Interested' } },
    { id: 'a2', base: { experience: 6 }, association: { consultant: 'Rahul', status: 'Hired' } },
    { id: 'a3', base: { experience: 3 }, association: { consultant: 'Cherry', status: 'Hired' } },
    { id: 'a4', base: { experience: 10 }, association: { consultant: 'Rahul', status: 'Hired' } },
    { id: 'a5', base: { experience: 10 }, association: { consultant: 'Cherry', status: 'Hired' } }
  ]
  return async (domain, subtree) => new Set(rows
    .filter(row => evaluateCandidateAst(subtree, row, (item, field) => (
      domain === 'base' ? item.base[field] : item.association[field]
    )))
    .map(row => row.id))
}

test('mixed AND resolves exact association rows instead of widening to sibling assignments', async () => {
  const root = group('AND', baseExperience, consultantCherry)
  const ids = await resolveAssociationIds(null, root, { lookup: fixtureLookup() })
  assert.deepEqual([...ids].sort(), ['a1', 'a5'])
  assert.ok(!ids.has('a2'), 'Rahul assignment for a matching candidate must not leak')
  assert.ok(!ids.has('a3'), 'Cherry assignment for a non-matching candidate must not leak')
})

test('nested mixed AND/OR is evaluated at association-row grain', async () => {
  const root = group(
    'AND',
    group('OR', baseExperience, consultantCherry),
    statusHired
  )
  const ids = await resolveAssociationIds(null, root, { lookup: fixtureLookup() })
  assert.deepEqual([...ids].sort(), ['a2', 'a3', 'a4', 'a5'])
})

test('base AND nested association OR preserves all and only matching rows', async () => {
  const root = group('AND', baseExperience, group('OR', consultantCherry, statusHired))
  const ids = await resolveAssociationIds(null, root, { lookup: fixtureLookup() })
  assert.deepEqual([...ids].sort(), ['a1', 'a2', 'a4', 'a5'])
})

test('base lookup projects association IDs through an inner candidates embed', async () => {
  const db = recordingSupabase([{ data: [{ id: 'a1' }, { id: 'a2' }], error: null }])
  assert.deepEqual([...await queryAssociationRowIds(db, baseExperience, 'base')], ['a1', 'a2'])
  assert.deepEqual(db.calls.map(call => [call.table, call.method]), [
    [ASSOCIATION_TABLE, 'from'],
    [ASSOCIATION_TABLE, 'select'],
    [ASSOCIATION_TABLE, 'or'],
    [ASSOCIATION_TABLE, 'limit']
  ])
  const select = db.calls.find(call => call.method === 'select')
  const filter = db.calls.find(call => call.method === 'or')
  assert.equal(select.args[0], 'id, candidates!inner(id)')
  assert.deepEqual(filter.args[1], { referencedTable: CANDIDATE_TABLE })
  assert.equal(db.calls.at(-1).args[0], MAX_MATCH_IDS + 1)
})

test('association lookup filters candidate_associations directly', async () => {
  const db = recordingSupabase([{ data: [{ id: 'a1' }], error: null }])
  assert.deepEqual([...await queryAssociationRowIds(db, consultantCherry, 'association')], ['a1'])
  assert.equal(db.calls.find(call => call.method === 'select').args[0], 'id')
  assert.equal(db.calls.find(call => call.method === 'or').args.length, 1)
})

test('candidate-only projection preserves only base branches that can be true without an assignment', () => {
  assert.deepEqual(projectCandidateOnlyRoot(group('OR', baseExperience, consultantCherry)), baseExperience)
  assert.equal(projectCandidateOnlyRoot(group('AND', baseExperience, consultantCherry)), null)
  assert.deepEqual(
    projectCandidateOnlyRoot(group('OR', group('AND', baseExperience, consultantCherry), baseDelhi)),
    baseDelhi
  )
})

test('candidate-only lookup filters the left embedded association to null', async () => {
  const db = recordingSupabase([{ data: [{ id: 'c0' }], error: null, count: 1 }])
  assert.deepEqual([...await queryCandidateOnlyIds(db, baseExperience)], ['c0'])
  assert.deepEqual(db.calls.map(call => call.method), ['from', 'select', 'or', 'is', 'limit'])
  assert.deepEqual(db.calls.find(call => call.method === 'is').args, ['candidate_associations', null])
})

test('bounded ID lookups propagate database errors and reject excessive result sets', async () => {
  const expected = new Error('database unavailable')
  const failed = recordingSupabase([{ data: null, error: expected }])
  await assert.rejects(queryAssociationRowIds(failed, consultantCherry, 'association'), expected)

  const broad = recordingSupabase([{
    data: Array.from({ length: MAX_MATCH_IDS + 1 }, (_, index) => ({ id: `a${index}` })),
    error: null
  }])
  await assert.rejects(
    queryAssociationRowIds(broad, consultantCherry, 'association'),
    error => error.statusCode === 400 && error.code === 'CANDIDATE_FILTER_TOO_BROAD'
  )

  const truncated = recordingSupabase([{ data: [{ id: 'a1' }], error: null, count: 2 }])
  await assert.rejects(
    queryAssociationRowIds(truncated, consultantCherry, 'association'),
    error => error.statusCode === 400 && error.code === 'CANDIDATE_FILTER_TOO_BROAD'
  )
})

test('plans keep base-only filters on candidates and association filters on association rows', async () => {
  const basePlan = await createCandidateAstQueryPlan(null, baseExperience)
  assert.equal(basePlan.table, CANDIDATE_TABLE)
  assert.equal(basePlan.rowMode, 'candidate')
  assert.equal(basePlan.baseRoot, baseExperience)

  const associationPlan = await createCandidateAstQueryPlan(null, consultantCherry)
  assert.equal(associationPlan.table, ASSOCIATION_TABLE)
  assert.equal(associationPlan.rowMode, 'association')
  assert.equal(associationPlan.resolution, 'direct')
  assert.equal(associationPlan.associationRoot, consultantCherry)
})

test('base AI plus manual association filters uses association-row count and pagination', async () => {
  const plan = await createCandidateAstQueryPlan(null, baseExperience, { forceAssociationRows: true })
  assert.equal(plan.table, ASSOCIATION_TABLE)
  assert.equal(plan.rowMode, 'association')
  assert.equal(plan.baseRoot, baseExperience)
  assert.equal(plan.associationRoot, null)
})

test('common mixed conjunction uses one joined query and no ID preflight', async () => {
  const root = group('AND', baseExperience, group('OR', consultantCherry, statusHired))
  const plan = await createCandidateAstQueryPlan(null, root, {
    lookup: async () => { throw new Error('lookup must not run') }
  })
  assert.equal(plan.table, ASSOCIATION_TABLE)
  assert.equal(plan.rowMode, 'association')
  assert.equal(plan.domain, 'mixed')
  assert.equal(plan.resolution, 'direct')
  assert.equal(plan.baseRoot, baseExperience)
  assert.deepEqual(plan.associationRoot, group('OR', consultantCherry, statusHired))
})

test('cross-domain OR plan resolves and filters exact association IDs', async () => {
  const root = group('OR', baseExperience, consultantCherry)
  const plan = await createCandidateAstQueryPlan(null, root, {
    lookup: fixtureLookup(),
    candidateOnlyLookup: async () => new Set()
  })
  assert.equal(plan.table, ASSOCIATION_TABLE)
  assert.equal(plan.resolution, 'association_ids')
  assert.deepEqual([...plan.associationIds].sort(), ['a1', 'a2', 'a3', 'a4', 'a5'])

  const db = recordingSupabase()
  const query = db.from(plan.table).select(plan.select, { count: 'exact' })
  applyCandidateAstPlan(query, plan)
  assert.deepEqual(db.calls.at(-1), {
    table: ASSOCIATION_TABLE,
    method: 'in',
    args: ['id', plan.associationIds]
  })
})

test('cross-domain OR includes matching candidates that have no association row', async () => {
  const root = group('OR', baseExperience, consultantCherry)
  const plan = await createCandidateAstQueryPlan(null, root, {
    lookup: fixtureLookup(),
    candidateOnlyLookup: async projected => {
      assert.deepEqual(projected, baseExperience)
      return new Set(['c0'])
    }
  })
  assert.equal(plan.rowMode, 'mixed')
  assert.deepEqual(plan.candidateOnlyIds, ['c0'])
  assert.deepEqual([...plan.associationIds].sort(), ['a1', 'a2', 'a3', 'a4', 'a5'])
})

test('empty mixed resolution produces a safe no-match UUID predicate', async () => {
  const root = group('OR', baseExperience, consultantCherry)
  const plan = await createCandidateAstQueryPlan(null, root, {
    lookup: async () => new Set(),
    candidateOnlyLookup: async () => new Set()
  })
  const db = recordingSupabase()
  applyCandidateAstPlan(db.from(plan.table).select(plan.select, { count: 'exact' }), plan)
  assert.deepEqual(db.calls.at(-1), {
    table: ASSOCIATION_TABLE,
    method: 'eq',
    args: ['id', NO_MATCH_UUID]
  })
})

test('direct joined query applies all AST filters before range and counts association rows', async () => {
  const root = group('AND', baseExperience, group('OR', consultantCherry, statusHired))
  const db = recordingSupabase()
  const { query, plan } = await buildCandidateAstQuery(db, root)
  query.order('created_at', { ascending: false }).range(10, 19)

  assert.equal(plan.table, ASSOCIATION_TABLE)
  assert.equal(plan.rowMode, 'association')
  const methods = db.calls.map(call => call.method)
  assert.deepEqual(methods, ['from', 'select', 'or', 'or', 'order', 'range'])
  assert.deepEqual(db.calls[1].args, ['*, candidates!inner(*)', { count: 'exact' }])
  assert.equal(db.calls[2].args.length, 1)
  assert.deepEqual(db.calls[3].args[1], { referencedTable: CANDIDATE_TABLE })
  assert.ok(methods.indexOf('or') < methods.indexOf('range'))
})

test('base-only query preserves the existing candidate container response shape', async () => {
  const db = recordingSupabase()
  const { query, plan } = await buildCandidateAstQuery(db, baseExperience)
  query.range(0, 49)
  assert.equal(plan.table, CANDIDATE_TABLE)
  assert.equal(plan.rowMode, 'candidate')
  assert.deepEqual(db.calls[1].args, ['*, candidate_associations(*)', { count: 'exact' }])
  assert.deepEqual(db.calls.map(call => call.method), ['from', 'select', 'or', 'range'])
})
