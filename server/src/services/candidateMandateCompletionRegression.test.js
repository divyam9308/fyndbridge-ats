const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const candidateController = fs.readFileSync(
  path.join(root, 'server/src/controllers/candidateController.js'),
  'utf8'
)

function functionSource(name, nextName) {
  const start = candidateController.indexOf(`async function ${name}`)
  const end = candidateController.indexOf(`async function ${nextName}`, start + 1)
  assert.ok(start >= 0, `${name} must exist`)
  assert.ok(end > start, `${nextName} must follow ${name}`)
  return candidateController.slice(start, end)
}

test('existing mandate synchronisation completes the linked mandate when any association is Hired', () => {
  const source = functionSource('syncMandateStatusForJob', 'listCandidates')
  assert.match(source, /\.from\('candidate_associations'\)[\s\S]*?\.eq\('job_id', id\)[\s\S]*?\.eq\('status', 'Hired'\)/)
  assert.match(source, /if \(count <= 0\) return/)
  assert.match(source, /const nextStatus = 'Completed'/)
  assert.match(source, /\.from\('jobs'\)[\s\S]*?\.update\(\{ mandate_status: nextStatus, status: nextStatus, updated_at:/)
  assert.match(source, /\.eq\('id', id\)/)
})

test('mandates with no current Hired association remain unchanged and Scrapped is never overwritten', () => {
  const source = functionSource('syncMandateStatusForJob', 'listCandidates')
  assert.match(source, /job\.mandate_status === 'Scrapped' \|\| job\.status === 'Scrapped'/)
  assert.match(source, /if \(count <= 0\) return/)
  assert.doesNotMatch(source, /mandate_status:\s*'Ongoing'/)
  assert.doesNotMatch(source, /mandate_status:\s*'Scrapped'/)
})

test('both candidate create paths and the association update path still invoke mandate completion', () => {
  const callSites = candidateController.match(/syncMandateStatusForJob\(/g) || []
  assert.ok(callSites.length >= 4, 'expected the helper declaration plus create/update call sites')
  assert.match(candidateController, /association\.status === 'Hired'[\s\S]*?syncMandateStatusForJob\(association\.job_id \|\| assocInsert\.job_id\)/)
  assert.match(candidateController, /if \(assocUpdate\.status === 'Hired'\)[\s\S]*?affectedJobIds\.map\(syncMandateStatusForJob\)/)
  assert.match(candidateController, /if \(inserted\.status === 'Hired'\)[\s\S]*?syncMandateStatusForJob\(inserted\.job_id \|\| assocInsert\.job_id\)/)
})

test('changing a Hired candidate later does not introduce reverse mandate-status mutation', () => {
  const source = functionSource('syncMandateStatusForJob', 'listCandidates')
  assert.ok(source.indexOf('if (count <= 0) return') < source.indexOf(".update({ mandate_status: nextStatus"))
  assert.doesNotMatch(candidateController, /status\s*!==\s*'Hired'[\s\S]{0,300}mandate_status/)
})
