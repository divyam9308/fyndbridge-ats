const test = require('node:test')
const assert = require('node:assert/strict')
const { compileCandidateAst, evaluateCandidateAst, flattenConditions } = require('./candidateAiFilter')
const {
  matchingConsultantProfile,
  resolveCandidateFilterReferences
} = require('./candidateFilterReferences')

function filter(operator = 'equals', value = 'Cherry') {
  return {
    version: 2,
    mode: 'structured',
    root: { type: 'condition', field: 'consultant', operator, value }
  }
}

const profiles = [
  { user_id: '11111111-1111-1111-1111-111111111111', name: 'Cherry Sagar' },
  { user_id: '22222222-2222-2222-2222-222222222222', name: 'Rahul Mehta' }
]

test('consultant lookup is trimmed and case-insensitive, preferring exact names', () => {
  assert.equal(matchingConsultantProfile(profiles, '  CHERRY   SAGAR '), profiles[0])
  assert.equal(matchingConsultantProfile(profiles, 'rahul mehta'), profiles[1])
})

test('partial consultant lookup resolves only an unambiguous profile', () => {
  assert.equal(matchingConsultantProfile(profiles, '  cherry '), profiles[0])
  assert.throws(
    () => matchingConsultantProfile([...profiles, { user_id: '3', name: 'Cherry Gupta' }], 'cherry'),
    error => error.statusCode === 400 && /ambiguous/i.test(error.message)
  )
})

test('consultant equals matches profile ID and legacy full-name rows', async () => {
  const resolved = await resolveCandidateFilterReferences(filter(), { profiles })
  const leaves = flattenConditions(resolved.root)
  assert.ok(leaves.some(item => item.field === 'consultant_user_id' && item.value === profiles[0].user_id))
  assert.ok(leaves.some(item => item.field === 'consultant' && item.operator === 'equals' && item.value === 'Cherry Sagar'))
  assert.doesNotMatch(compileCandidateAst(resolved.root), /\*Cherry(?: Sagar)?\*/)
  assert.equal(evaluateCandidateAst(resolved.root, {
    consultant_user_id: null,
    consultant: 'cherry sagar'
  }), true)
  assert.equal(evaluateCandidateAst(resolved.root, {
    consultant_user_id: profiles[0].user_id,
    consultant: null
  }), true)
  assert.equal(evaluateCandidateAst(resolved.root, {
    consultant_user_id: profiles[1].user_id,
    consultant: 'Rahul Mehta'
  }), false)
  assert.equal(evaluateCandidateAst(resolved.root, {
    consultant_user_id: null,
    consultant: 'Cherry Gupta'
  }), false)
})

test('consultant not_equals excludes matching legacy names and IDs but keeps other or empty assignments', async () => {
  const resolved = await resolveCandidateFilterReferences(filter('not_equals'), { profiles })
  assert.equal(evaluateCandidateAst(resolved.root, { consultant_user_id: null, consultant: 'CHERRY SAGAR' }), false)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant_user_id: profiles[0].user_id, consultant: null }), false)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant_user_id: profiles[1].user_id, consultant: 'Rahul Mehta' }), true)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant_user_id: null, consultant: 'Cherry Gupta' }), true)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant_user_id: null, consultant: null }), true)
})

test('unknown consultant remains a safe case-insensitive text equality filter', async () => {
  const resolved = await resolveCandidateFilterReferences(filter('equals', '  External Recruiter  '), { profiles })
  assert.deepEqual(resolved.root, {
    type: 'condition', field: 'consultant', operator: 'equals', value: 'External Recruiter'
  })
  assert.equal(evaluateCandidateAst(resolved.root, { consultant: 'external recruiter' }), true)
})

test('all resolvable consultant leaves use one profile-directory query per request', async () => {
  let directoryQueries = 0
  const database = {
    from(table) {
      assert.equal(table, 'user_profiles')
      directoryQueries += 1
      return {
        select() { return this },
        not() { return this },
        order() { return Promise.resolve({ data: profiles, error: null }) }
      }
    }
  }
  const input = {
    root: {
      type: 'group', combinator: 'OR', children: [
        { type: 'condition', field: 'consultant', operator: 'equals', value: 'Cherry' },
        { type: 'condition', field: 'consultant', operator: 'equals', value: 'Rahul' }
      ]
    }
  }
  const resolved = await resolveCandidateFilterReferences(input, { supabase: database })
  assert.equal(directoryQueries, 1)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant: 'Cherry Sagar', consultant_user_id: null }), true)
  assert.equal(evaluateCandidateAst(resolved.root, { consultant: 'Rahul Mehta', consultant_user_id: null }), true)
})

test('contains consultant filters do not query or require the profile directory', async () => {
  const input = filter('contains', 'cher')
  const resolved = await resolveCandidateFilterReferences(input, {
    supabase: { from() { throw new Error('profile query must not run') } }
  })
  assert.deepEqual(resolved.root, input.root)
})

test('display client/job IDs resolve in one bounded lookup per referenced entity type', async () => {
  const calls = []
  const rows = {
    clients: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_display_id: 'CL12' }],
    jobs: [
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', job_display_id: 'JB7' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', job_display_id: 'JB8' }
    ]
  }
  const database = {
    from(table) {
      const state = { table }
      calls.push(state)
      return {
        select(value) { state.select = value; return this },
        in(column, values) { state.in = [column, values]; return this },
        limit(value) { state.limit = value; return Promise.resolve({ data: rows[table], error: null }) }
      }
    }
  }
  const input = {
    root: {
      type: 'group', combinator: 'AND', children: [
        { type: 'condition', field: 'client_id', operator: 'equals', value: 'cl12' },
        { type: 'condition', field: 'job_id', operator: 'in', value: ['JB7', 'jb8'] }
      ]
    }
  }
  const resolved = await resolveCandidateFilterReferences(input, { supabase: database, profiles: [] })
  assert.equal(calls.length, 2)
  assert.deepEqual(flattenConditions(resolved.root).map(item => item.value), [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']
  ])
})

test('arbitrary non-UUID values cannot reach UUID-backed client/job columns', async () => {
  await assert.rejects(
    resolveCandidateFilterReferences({
      root: { type: 'condition', field: 'client_id', operator: 'equals', value: 'select *' }
    }, { supabase: { from() { throw new Error('database query must not run') } }, profiles: [] }),
    error => error.statusCode === 400 && /Invalid client/.test(error.message)
  )
})
