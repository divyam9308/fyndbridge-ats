const test = require('node:test')
const assert = require('node:assert/strict')
const { withAssignedCvParsing } = require('./assignedCvParsing')
test('CV parsing is bounded across requests and errors release capacity', async () => {
  let active = 0; let maximum = 0
  await Promise.all(Array.from({ length: 12 }, () => withAssignedCvParsing(async () => {
    active += 1; maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    active -= 1
  })))
  assert.equal(maximum, 3)
  await assert.rejects(withAssignedCvParsing(async () => { throw new Error('Synthetic parse failure') }), /Synthetic parse failure/)
  assert.equal(await withAssignedCvParsing(async () => 'recovered'), 'recovered')
})
test('overloaded parsing fails recoverably and drains the waiting batch', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const queued = Array.from({ length: 27 }, () => withAssignedCvParsing(() => gate))
  await assert.rejects(withAssignedCvParsing(async () => null), { statusCode: 503 })
  release()
  await Promise.all(queued)
  assert.equal(await withAssignedCvParsing(async () => 'ready'), 'ready')
})
