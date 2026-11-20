const { test: base, expect } = require('@playwright/test')
const express = require('express')
const { presenceDatabase, USER } = require('../test-support/presenceDatabase.cjs')
const adminPath = require.resolve('../src/services/supabaseAdmin')
let database
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, children: [], exports: new Proxy({}, { get(_, key) { const value = database[key]; return typeof value === 'function' ? value.bind(database) : value } }) }
const presenceRouter = require('../src/routes/presence')
const test = base.extend({ activity: [async ({ page }, use) => {
  database = await presenceDatabase()
  const db = database
  const errors = [], requests = []
  const app = express()
  app.use(express.json())
  app.use((req,res,next) => { req.user = { id:USER,email:'tester@fyndbridge.in',name:'Test User' }; next() })
  app.use('/api/presence',presenceRouter)
  const server = app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  page.on('pageerror', error=>errors.push(error.message))
  await page.addInitScript(({id})=>{
    const user={id,email:'tester@fyndbridge.in',user_metadata:{full_name:'Test User'},aud:'authenticated',role:'authenticated'}
    const expires_at=Math.floor(Date.now()/1000)+3600
    const token=btoa(JSON.stringify({sub:id,role:'authenticated',exp:expires_at}))
    localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,refresh_token:'synthetic',expires_at,expires_in:3600,token_type:'bearer',user}))
  },{id:USER})
  await page.routeWebSocket('**/realtime/**',socket=>socket.onMessage(message=>{
    const [joinRef,ref,topic]=JSON.parse(String(message))
    socket.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:[]}}]))
  }))
  await page.route('http://127.0.0.1:54321/**',route=>route.fulfill({json:[]}))
  const api=`http://127.0.0.1:${server.address().port}`
  await page.route('**/api/presence**',async route=>{
    const request=route.request(), url=new URL(request.url())
    requests.push({path:url.pathname,query:url.search,body:request.postDataJSON()})
    await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})})
  })
  db.tables.user_presence.push({user_id:USER,tab_id:'seed',email:'tester@fyndbridge.in',display_name:'Test User',status:'online',current_path:'/dashboard/candidates',last_seen_at:new Date().toISOString()})
  await db.sql.query(`insert into public.user_daily_activity(user_id,activity_date,active_periods) values
    ($1,'2026-10-01',tstzmultirange(tstzrange('2026-10-01T04:00Z','2026-10-01T06:00Z','[)'))),
    ($1,(now() at time zone 'Asia/Kolkata')::date,tstzmultirange(tstzrange(now()-interval '15 minutes',now()-interval '5 minutes','[)')))` ,[USER])
  try { await use({db,requests,errors}) } finally { await page.close(); await new Promise(resolve=>server.close(resolve)); await db.sql.close() }
},{auto:true}] })

test('tooltip shows Today and quarter Average; quarter switching and mobile placement work',async({page,activity},info)=>{
  await page.goto('/server/browser-tests/presence-harness.html')
  const avatar=page.getByRole('button',{name:'Test User is online'})
  await expect(avatar).toBeVisible()
  await avatar.hover()
  const tip=page.getByRole('tooltip')
  await expect(tip).toContainText('Today: 10m')
  await expect(tip).toContainText('Average:')
  await expect(tip).toContainText('Q3 · FY 2026-27 · Mon–Sat')
  await expect(tip).not.toContainText('Page:')
  const expected=await activity.db.rpc('user_activity_summary',{p_user_ids:[USER],p_start:'2026-10-01',p_end:'2026-12-31'})
  const minutes=Math.floor(expected.data[0].average_seconds/60)
  await expect(tip).toContainText(`Average: ${minutes}m`)
  await page.getByRole('button',{name:'Q4',exact:true}).click()
  await expect.poll(()=>activity.requests.some(r=>r.query.includes('Q4'))).toBe(true)
  await avatar.hover()
  await expect(tip).toContainText('Average: 0m')
  await expect(tip).toContainText('Today: 10m')
  await page.setViewportSize({width:390,height:640})
  await expect(async () => {
    await page.mouse.move(0,0)
    await avatar.hover()
    await expect(tip).toBeVisible()
    const box=await tip.boundingBox()
    expect(box).not.toBeNull()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x+box.width).toBeLessThanOrEqual(390)
    expect(box.y+box.height).toBeLessThanOrEqual(640)
  }).toPass()
  await page.screenshot({path:`/tmp/fb-presence-${info.project.name}.png`})
  expect(activity.errors).toEqual([])
})

test('calendar holidays change the displayed quarter average and preserve Today',async({page,activity})=>{
  // A holiday today removes its time from Average while retaining Today.
  await activity.db.sql.exec("insert into public.company_holidays(holiday_date,holiday_type) values ((now() at time zone 'Asia/Kolkata')::date,'national')")
  await page.goto('/server/browser-tests/presence-harness.html')
  await page.getByRole('button',{name:'Test User is online'}).hover()
  const tip=page.getByRole('tooltip')
  await expect(tip).toContainText('Today: 10m')
  await expect(tip).toContainText('Average: 0m')
  // Selecting the quarter again reloads the updated calendar through the API.
  await activity.db.sql.exec("update public.company_holidays set is_active=false where holiday_date=(now() at time zone 'Asia/Kolkata')::date")
  await page.getByRole('button',{name:'Q4',exact:true}).click()
  await page.getByRole('button',{name:'Q3',exact:true}).click()
  await page.getByRole('button',{name:'Test User is online'}).hover()
  const restored=await activity.db.rpc('user_activity_summary',{p_user_ids:[USER],p_start:'2026-10-01',p_end:'2026-12-31'})
  const minutes=Math.floor(restored.data[0].average_seconds/60)
  expect(minutes).toBeGreaterThan(0)
  await expect(tip).toContainText(`Average: ${minutes}m`)
  await expect(tip).toContainText('Today: 10m')
  expect(activity.errors).toEqual([])
})

test('heartbeat, logout flush, and persisted activity work through the real API and SQL functions',async({page,activity})=>{
  await page.goto('/server/browser-tests/presence-harness.html')
  await page.locator('main').click({position:{x:2,y:2}})
  await expect.poll(()=>activity.requests.filter(r=>r.path.endsWith('/heartbeat')).length).toBeGreaterThan(0)
  await page.waitForTimeout(1100)
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect.poll(()=>activity.requests.filter(r=>r.path.endsWith('/offline')&&r.body?.all_tabs).length).toBe(1)
  const flushed=activity.requests.find(r=>r.body?.all_tabs).body.active_intervals
  expect(flushed.length).toBeGreaterThan(0)
  await expect.poll(async()=>Number((await activity.db.sql.query('select sum(active_seconds) as seconds from public.user_daily_activity where activity_date=(now() at time zone \'Asia/Kolkata\')::date')).rows[0].seconds)).toBeGreaterThan(600)
  await expect.poll(()=>activity.db.tables.user_presence.length).toBe(0)
  expect(activity.errors).toEqual([])
})
