const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveEntityFilterReferences, matchingProfile } = require('./entityFilterReferences')

const PROFILES = [
  { user_id: '11111111-1111-4111-8111-111111111111', name: 'Cherry Sharma' },
  { user_id: '22222222-2222-4222-8222-222222222222', name: 'Rahul Mehta' },
  { user_id: '33333333-3333-4333-8333-333333333333', name: 'Rahul Verma' },
  { user_id: '44444444-4444-4444-8444-444444444444', name: 'Amit Singh' }
]

const leaf = (field, operator, value) => ({ type: 'condition', field, operator, ...(value !== undefined ? { value } : {}) })

test('profile matching is case-insensitive, exact-first and partial only when unique', () => {
  assert.equal(matchingProfile(PROFILES, '  cHeRrY  ', 'Consultant').name, 'Cherry Sharma')
  assert.equal(matchingProfile(PROFILES, 'Rahul Mehta', 'Consultant').name, 'Rahul Mehta')
  assert.throws(() => matchingProfile(PROFILES, 'Rahul', 'Consultant'), /ambiguous/i)
})

test('Client consultant names resolve to the normalized stored representation', async () => {
  const result = await resolveEntityFilterReferences('clients', {
    root: leaf('consultant', 'equals', 'cher')
  }, { profiles: PROFILES })
  assert.deepEqual(result.root, leaf('consultant', 'equals', 'cherry sharma'))
})

test('Mandate consultant arrays and Team Lead share one canonical profile set', async () => {
  const result = await resolveEntityFilterReferences('mandates', {
    root: {
      type: 'group', combinator: 'AND', children: [
        leaf('consultant', 'contains_all', ['CHERRY SHARMA', 'Rahul Mehta']),
        leaf('team_lead', 'equals', 'amit')
      ]
    }
  }, { profiles: PROFILES })
  assert.deepEqual(result.root.children[0].value, ['cherry sharma', 'rahul mehta'])
  assert.equal(result.root.children[1].value, 'amit singh')
})

test('ambiguous partial names fail explicitly and raw profile UUIDs are rejected', async () => {
  await assert.rejects(
    resolveEntityFilterReferences('mandates', { root: leaf('consultant', 'contains', 'Rahul') }, { profiles: PROFILES }),
    error => error.statusCode === 400 && /ambiguous/i.test(error.message)
  )
  await assert.rejects(
    resolveEntityFilterReferences('clients', { root: leaf('consultant', 'equals', PROFILES[0].user_id) }, { profiles: PROFILES }),
    error => error.statusCode === 400 && /by name/i.test(error.message)
  )
})

test('empty assignment filters do not fetch the profile directory', async () => {
  let queried = false
  const fakeSupabase = { from() { queried = true; throw new Error('must not query') } }
  const result = await resolveEntityFilterReferences('mandates', {
    root: leaf('consultant', 'is_empty')
  }, { supabase: fakeSupabase })
  assert.equal(queried, false)
  assert.equal(result.root.operator, 'is_empty')
})
