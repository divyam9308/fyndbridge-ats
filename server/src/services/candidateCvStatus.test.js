const test = require('node:test')
const assert = require('node:assert/strict')
const { addCandidateCvStatus } = require('./candidateCvStatus')

test('candidate responses batch only managed CV paths and preserve ready, pending and failed states', async () => {
  const paths = ['ready', 'queued', 'retrying', 'failed'].map(name => `branded/fb1/${name}.pdf`)
  const rows = [{ cv_attachments: paths.map(path => ({ path })) }, { cv_attachments: [{ path: paths[0] }, { path: 'legacy.pdf' }] }]
  const calls = []
  const result = await addCandidateCvStatus(rows, { service: { statuses: async wanted => {
    calls.push(wanted)
    return wanted.map((path, index) => ({ path, status: ['ready', 'queued', 'retrying', 'failed'][index] }))
  } } })
  assert.deepEqual(calls, [paths])
  assert.deepEqual(result[0].cv_attachments.map(item => item.branding_status), ['ready', 'queued', 'retrying', 'failed'])
  assert.equal(result[1].cv_attachments[0].branding_status, 'ready')
  assert.deepEqual(result[1].cv_attachments[1], { path: 'legacy.pdf' })
  assert.equal(rows[0].cv_attachments[0].branding_status, undefined)
})

test('large pages keep metadata queries bounded and a lookup outage preserves the existing fallback', async () => {
  const rows = [{ cv_attachments: Array.from({ length: 205 }, (_, index) => ({ path: `branded/fb1/${index}.pdf` })) }]
  const sizes = []
  const result = await addCandidateCvStatus(rows, { service: { statuses: async paths => {
    sizes.push(paths.length); return paths.map(path => ({ path, status: 'ready' }))
  } } })
  assert.deepEqual(sizes, [100, 100, 5])
  assert.equal(result[0].cv_attachments.every(item => item.branding_status === 'ready'), true)
  const failed = await addCandidateCvStatus(rows, { service: { statuses: async () => { throw new Error('Metadata unavailable') } }, logger: { error() {} } })
  assert.equal(failed, rows)
})
