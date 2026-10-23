const { test: base, expect } = require('./fixtures.cjs')
const { fork } = require('node:child_process')
const path = require('node:path')
const test = base.extend({ eventCrm: [async ({ page, app }, use) => {
  const child = fork(path.resolve(__dirname, '../test-support/crmServer.cjs'), { stdio: ['ignore','ignore','pipe','ipc'] })
  const ready = await new Promise((resolve,reject) => { child.once('message',resolve); child.once('error',reject); child.once('exit',code => reject(new Error(`CRM fixture exited ${code}`))) })
  const url = `http://127.0.0.1:${ready.port}`
  app.staff = [{ id: ready.USER_ID, name: 'Test Recruiter', status: 'active' }]
  await page.route('**/api/crm**', async route => { const target = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: url + target.pathname + target.search }) }) })
  await page.route('**/rest/v1/page_view_permissions*', async route => route.fulfill({ json: await (await fetch(url + '/test/permissions')).json() }))
  const post = (endpoint, body = {}) => fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
  try { await use({ post, url, ...ready }) } finally { await page.unrouteAll({ behavior: 'wait' }); await page.close(); child.send('close'); await new Promise(resolve => child.once('exit',resolve)) }
}, { auto: true }] })
test('original Gmail dates order the database timeline across 25-entry pages and show one IST date per email', async ({ page, eventCrm, app }, info) => {
  const { data } = await (await eventCrm.post('/api/crm', { organisation_name:'Event time organisation', contacts:[{ name:'HR',email:'hr@client.test' }],comment:'Manual event stays in its creation position.' })).json()
  for(let index=0;index<26;index++) {
    const response=await eventCrm.post('/test/gmail-activity', { client_id:data.id,message_id:`dated-${index}`,metadata:{ source:'gmail',direction:'incoming',sender:'hr@client.test',recipients:['recruiter@fyndbridge.in'],subject:`Original message ${index}`,email_at:index===25?'2024-12-31T20:00:00Z':'2025-01-11T04:45:12Z',summary:'Original message summary.',meeting:null,negative_response:null,sentiment:{label:'unknown',evidence:null} } })
    expect(response.ok).toBeTruthy()
  }
  const fetchPage=async page => (await fetch(`${eventCrm.url}/api/crm/${data.id}/activities?page=${page}`)).json()
  const first=await fetchPage(1), second=await fetchPage(2)
  expect(first.data).toHaveLength(25); expect(first.total).toBe(28); expect(second.data).toHaveLength(3)
  const all=[...first.data,...second.data]
  expect(new Set(all.map(row=>row.id)).size).toBe(28)
  expect(all.slice(0,2).every(row=>row.activity_type!=='gmail_email')).toBeTruthy()
  expect(all.at(-1).gmail_message_id).toBe('dated-25')
  for(let index=1;index<all.length;index++) {
    expect(new Date(all[index-1].occurred_at).getTime()).toBeGreaterThanOrEqual(new Date(all[index].occurred_at).getTime())
    if(all[index-1].occurred_at===all[index].occurred_at) expect(all[index-1].id>all[index].id).toBeTruthy()
  }
  await page.goto('/dashboard/crm')
  await page.locator('.crm-table tbody tr').filter({hasText:'Event time organisation'}).getByRole('button',{name:'Activity History',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Activity History'})
  await expect(dialog.locator('.crm-history-entry')).toHaveCount(25)
  const email=dialog.locator('.crm-history-entry').filter({hasText:'Incoming email'}).first()
  await expect(email).toContainText(/11 Jan 2025(?:,| at) 10:15 IST/)
  await expect(email.locator('.sub-text').filter({hasText:/IST/})).toHaveCount(1)
  await expect(dialog).toContainText('CRM client created')
  await expect(dialog).toContainText('Page 1 of 2')
  await dialog.getByRole('button',{name:'Next',exact:true}).click()
  await expect(dialog.locator('.crm-history-entry')).toHaveCount(3)
  await expect(dialog.locator('.crm-history-entry').last()).toContainText(/1 Jan 2025(?:,| at) 01:30 IST/)
  await expect(dialog.getByRole('button',{name:'Next',exact:true})).toBeDisabled()
  if(info.project.name==='chromium') await page.screenshot({path:'/tmp/crm-gmail-event-time.png',animations:'disabled'})
  expect(app.consoleErrors).toEqual([])
})
