const test = require('node:test')
const assert = require('node:assert/strict')
const { fork } = require('node:child_process')
const path = require('node:path')

test('CRM organisation deletion enforces access/version checks and atomically removes only CRM-owned history', async t => {
  const child = fork(path.resolve(__dirname, '../../test-support/crmServer.cjs'), { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const ready = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`CRM fixture exited ${code}`))) })
  t.after(() => new Promise(resolve => { child.once('exit', resolve); child.send('close') }))
  const request = async (endpoint, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${ready.port}${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) })
    return { status: response.status, ...await response.json() }
  }
  const baseline = await request('/test/state')
  const contacts = [{ name: 'HR', mobile: '9876543210', email: 'hr@example.test' }]
  const target = (await request('/api/crm', 'POST', { organisation_name: 'Delete CRM Organisation', contacts, comment: 'Delete only this CRM history.', ats_client_id: baseline.ats[0].id })).data
  const keep = (await request('/api/crm', 'POST', { organisation_name: 'Keep CRM Organisation', contacts, comment: 'Keep this history.' })).data
  await request('/test/gmail', 'POST', {})
  await request('/test/gmail-activity', 'POST', { client_id: target.id, metadata: { sentiment: { label: 'positive' } } })
  await request('/api/crm/activities/read-all', 'POST', {})
  const before = await request('/test/state')
  const activityIds = before.activities.filter(row => row.crm_client_id === target.id).map(row => row.id)
  assert.ok(before.reads.some(row => activityIds.includes(row.activity_id)))

  await t.test('anonymous, inactive and page-denied users cannot delete; caller cannot choose an audit identity', async () => {
    assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', { version: 1 }, { 'x-test-anonymous': 'yes' })).status, 401)
    assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', { version: 1 }, { 'x-test-user': ready.INACTIVE })).status, 403)
    await request('/test/permission', 'POST', { permission: 'admin_only' })
    assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', { version: 1 })).status, 403)
    await request('/test/permission', 'POST', { permission: 'everyone' })
    for (const body of [{}, { version: 0 }, { version: '1' }, { version: 1, user_id: ready.ADMIN }, { version: 1, id: keep.id }]) {
      assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', body)).status, 400)
    }
    assert.equal((await request('/api/crm/not-a-uuid', 'DELETE', { version: 1 })).status, 404)
    assert.deepEqual((await request('/test/state')).clients, before.clients)
  })
  await t.test('a stale deletion cannot remove a concurrently edited record or its history', async () => {
    const updated = await request(`/api/crm/${target.id}`, 'PATCH', { version: target.version, status: 'Negotiation' })
    assert.equal(updated.status, 200)
    assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', { version: target.version })).status, 409)
    const unchanged = await request('/test/state')
    assert.equal(unchanged.clients.find(row => row.id === target.id).status, 'Negotiation')
    assert.deepEqual(unchanged.comments, before.comments)
    assert.deepEqual(unchanged.reads, before.reads)
    target.version = updated.data.version
  })
  await t.test('confirmed current-version deletion cascades CRM history and receipts while preserving ATS and other clients', async () => {
    const deleted = await request(`/api/crm/${target.id}`, 'DELETE', { version: target.version })
    assert.equal(deleted.status, 200, JSON.stringify(deleted))
    assert.equal(deleted.deleted, target.id)
    const after = await request('/test/state')
    assert.equal(after.clients.some(row => row.id === target.id), false)
    assert.equal(after.comments.some(row => row.crm_client_id === target.id), false)
    assert.equal(after.activities.some(row => row.crm_client_id === target.id), false)
    assert.equal(after.reads.some(row => activityIds.includes(row.activity_id)), false)
    assert.deepEqual(after.ats, baseline.ats)
    assert.deepEqual(after.clients.find(row => row.id === keep.id), before.clients.find(row => row.id === keep.id))
    assert.deepEqual(after.comments.filter(row => row.crm_client_id === keep.id), before.comments.filter(row => row.crm_client_id === keep.id))
    assert.equal((await request('/api/crm/gmail/status')).connected, true)
    assert.equal((await request(`/api/crm/${target.id}`, 'DELETE', { version: target.version })).status, 409)
    assert.equal((await request(`/api/crm/${target.id}`)).status, 404)
  })
})
