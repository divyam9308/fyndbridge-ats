const test = require('node:test')
const assert = require('node:assert/strict')
const { parseCandidateIntent } = require('./candidateIntent')

const NOW = new Date('2026-07-15T06:00:00.000Z')

function response(filters, overrides = {}) {
  return {
    mode: 'structured',
    logic: 'and',
    filters,
    search_text: null,
    sort: [],
    confidence: 0.96,
    unsupported: false,
    ...overrides
  }
}

const acceptanceCases = [
  ['consultant is Cherry', response([{ field: 'consultant', operator: 'equals', value: 'Cherry' }]), [['consultant', 'equals', 'Cherry']]],
  ['show candidates handled by Cherry', response([{ field: 'consultant', operator: 'equals', value: 'Cherry' }]), [['consultant', 'equals', 'Cherry']]],
  ["Cherry's candidates", response([{ field: 'consultant', operator: 'equals', value: 'Cherry' }]), [['consultant', 'equals', 'Cherry']]],
  ['consultant is not Cherry', response([{ field: 'consultant', operator: 'not_equals', value: 'Cherry' }]), [['consultant', 'not_equals', 'Cherry']]],
  ['consultant is Cherry or Rahul', response([{ logic: 'or', filters: [
    { field: 'consultant', operator: 'equals', value: 'Cherry' },
    { field: 'consultant', operator: 'equals', value: 'Rahul' }
  ] }]), [['consultant', 'equals', 'Cherry'], ['consultant', 'equals', 'Rahul']]],
  ['experience greater than 8', response([{ field: 'experience', operator: 'greater_than', value: 8 }]), [['experience', 'greater_than', 8]]],
  ['experience between 5 and 10', response([{ field: 'experience', operator: 'between', value: [5, 10] }]), [['experience', 'between', [5, 10]]]],
  ['notice period below 60', response([{ field: 'notice_period', operator: 'less_than', value: '60 days' }]), [['notice_period', 'less_than', 60]]],
  ['current ctc between 10 and 20 lpa', response([{ field: 'current_ctc', operator: 'between', value: ['10 LPA', '20 LPA'] }]), [['current_ctc', 'between', [1000000, 2000000]]]],
  ['expected ctc above 25 lpa', response([{ field: 'expected_ctc', operator: 'greater_than', value: '25 LPA' }]), [['expected_ctc', 'greater_than', 2500000]]],
  ['skills include React and Node', response([{ field: 'skills', operator: 'contains_all', value: ['React', 'Node'] }]), [['skills', 'contains_all', ['React', 'Node']]]],
  ['skills include React or Node', response([{ field: 'skills', operator: 'contains_any', value: ['React', 'Node'] }]), [['skills', 'contains_any', ['React', 'Node']]]],
  ['organization is not TCS', response([{ field: 'organisation', operator: 'not_equals', value: 'TCS' }]), [['organisation', 'not_equals', 'TCS']]],
  ['location is Delhi or Gurgaon', response([{ logic: 'or', filters: [
    { field: 'current_location', operator: 'contains', value: 'Delhi' },
    { field: 'current_location', operator: 'contains', value: 'Gurgaon' }
  ] }]), [['current_location', 'contains', 'Delhi'], ['current_location', 'contains', 'Gurgaon']]],
  ['email is empty', response([{ field: 'email', operator: 'is_empty' }]), [['email', 'is_empty', undefined]]],
  ['linkedin not available', response([{ field: 'linkedin', operator: 'is_empty' }]), [['linkedin', 'is_empty', undefined]]],
  ['open to relocate', response([{ field: 'open_to_relocate', operator: 'equals', value: true }]), [['open_to_relocate', 'equals', true]]],
  ['not open to relocate', response([{ field: 'open_to_relocate', operator: 'equals', value: false }]), [['open_to_relocate', 'equals', false]]],
  ['status is hired', response([{ field: 'status', operator: 'equals', value: 'hired' }]), [['status', 'equals', 'Hired']]],
  ['added this month', response([{ field: 'created_date', operator: 'between', value: ['2026-07-01', '2026-07-31'] }]), [['created_date', 'between', ['2026-07-01', '2026-07-31']]]],
  ['client is ABC and role is HR Manager', response([
    { field: 'client_name', operator: 'equals', value: 'ABC' },
    { field: 'role', operator: 'equals', value: 'HR Manager' }
  ]), [['client_name', 'equals', 'ABC'], ['role', 'equals', 'HR Manager']]],
  ['consultant is Cherry and experience above 5 and status is hired', response([
    { field: 'consultant', operator: 'equals', value: 'Cherry' },
    { field: 'experience', operator: 'greater_than', value: 5 },
    { field: 'status', operator: 'equals', value: 'hired' }
  ]), [['consultant', 'equals', 'Cherry'], ['experience', 'greater_than', 5], ['status', 'equals', 'Hired']]]
]

for (const [prompt, mockedResponse, expected] of acceptanceCases) {
  test(`mocked intent acceptance: ${prompt}`, async () => {
    let calls = 0
    const result = await parseCandidateIntent(prompt, {
      now: NOW,
      aiCall: async () => {
        calls += 1
        return mockedResponse
      }
    })
    assert.equal(calls, 1)
    assert.equal(result.ai, true)
    assert.deepEqual(
      result.filters.conditions.map(item => [item.field, item.operator, item.value]),
      expected
    )
  })
}
