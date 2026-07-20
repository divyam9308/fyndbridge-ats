const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { MANDATE_STATUSES, normalizeMandateStatus } = require('./mandateStatuses')

const root = path.resolve(__dirname, '../../..')
const candidatesPage = fs.readFileSync(path.join(root, 'src/pages/CandidatesPage.jsx'), 'utf8')
const statusMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260720093624_mandate_priority_statuses.sql'),
  'utf8'
)

test('mandate status model stores the complete P1, P2 and P3 labels', () => {
  assert.deepEqual(MANDATE_STATUSES, [
    'Ongoing (P1)',
    'Delivered (P2)',
    'Paused (P3)',
    'Completed',
    'Scrapped'
  ])
  assert.equal(normalizeMandateStatus('Ongoing'), 'Ongoing (P1)')
  assert.equal(normalizeMandateStatus('P1'), 'Ongoing (P1)')
  assert.equal(normalizeMandateStatus('P2'), 'Delivered (P2)')
  assert.equal(normalizeMandateStatus('P3'), 'Paused (P3)')
})

test('candidate mandate selection excludes only Completed', () => {
  assert.match(candidatesPage, /normalizeMandateStatus\([\s\S]*?\)\s*!==\s*'Completed'/)
  assert.doesNotMatch(candidatesPage, /normalizeMandateStatus\([\s\S]{0,160}?\)\s*!==\s*'(?:Delivered \(P2\)|Paused \(P3\)|Scrapped)'/)
})

test('migration backfills legacy Ongoing to full P1 and counts only full P1 for low allocation', () => {
  assert.match(statusMigration, /then 'Ongoing \(P1\)'/)
  assert.match(statusMigration, /then 'Delivered \(P2\)'/)
  assert.match(statusMigration, /then 'Paused \(P3\)'/)
  assert.match(statusMigration, /job\.mandate_status[\s\S]*?= 'ongoing \(p1\)'/i)
  assert.match(statusMigration, /check \(mandate_status in \('Ongoing \(P1\)', 'Delivered \(P2\)', 'Paused \(P3\)', 'Completed', 'Scrapped'\)\)/)
})
