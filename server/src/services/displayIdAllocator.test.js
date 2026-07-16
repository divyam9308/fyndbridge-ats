const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { allocateNextDisplayId } = require('./displayIdAllocator')

const root = path.resolve(__dirname, '../../..')
const candidateController = fs.readFileSync(path.join(root, 'server/src/controllers/candidateController.js'), 'utf8')
const candidateGapMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260716192438_candidate_display_id_lowest_available_gap.sql'),
  'utf8'
)

function fakeSupabase(rows) {
  return {
    from(table) {
      assert.equal(table, 'candidates')
      return {
        select(columns) {
          assert.equal(columns, 'id, candidate_display_id')
          return {
            async range(from, to) {
              return { data: rows.slice(from, to + 1), error: null }
            }
          }
        }
      }
    }
  }
}

test('candidate allocation reuses the lowest available CA number', async () => {
  const supabase = fakeSupabase([
    { id: '1', candidate_display_id: 'CA1' },
    { id: '2', candidate_display_id: 'CA3' },
    { id: '3', candidate_display_id: 'CA4' }
  ])

  assert.equal(await allocateNextDisplayId({
    supabase,
    table: 'candidates',
    column: 'candidate_display_id',
    prefix: 'CA'
  }), 'CA2')
})

test('candidate allocation uses largest plus one when there is no gap', async () => {
  const supabase = fakeSupabase([
    { id: '1', candidate_display_id: 'CA1' },
    { id: '2', candidate_display_id: 'CA2' },
    { id: '3', candidate_display_id: 'CA3' }
  ])

  assert.equal(await allocateNextDisplayId({
    supabase,
    table: 'candidates',
    column: 'candidate_display_id',
    prefix: 'CA'
  }), 'CA4')
})

test('candidate creation and database fallback both use lowest-gap allocation', () => {
  assert.match(
    candidateController,
    /allocateNextDisplayId\(\{\s*supabase,\s*table:\s*'candidates',\s*column:\s*'candidate_display_id',\s*prefix:\s*'CA'\s*\}\)/
  )
  assert.doesNotMatch(candidateController, /candidate_display_id'[\s\S]{0,100}mode:\s*'max_plus_one'/)
  assert.match(candidateGapMigration, /pg_advisory_xact_lock/)
  assert.match(candidateGapMigration, /generate_series\(/)
  assert.match(candidateGapMigration, /select count\(\*\)[\s\S]*candidate_display_id ~\* '\^CA\[0-9\]\+\$'/)
  assert.match(candidateGapMigration, /where not exists/)
  assert.match(candidateGapMigration, /new\.candidate_display_id := 'CA' \|\| next_number::text/)
  assert.match(candidateGapMigration, /create trigger candidates_display_id_before_insert/)
})
