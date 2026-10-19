const {test:base,expect}=require('./fixtures.cjs')
const {fork}=require('node:child_process')
const fs=require('node:fs/promises'),path=require('node:path')
const {USER_ID}=require('../test-support/appliedCandidatesMemory.cjs')
const test=base.extend({access:[async({page,app},use)=>{
  const child=fork(path.resolve(__dirname,'../test-support/assignedCandidatesServer.cjs'),{stdio:['ignore','ignore','pipe','ipc']})
  const ready=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Access fixture exited ${code}`)))})
  const url=`http://127.0.0.1:${ready.port}`,state={user:USER_ID,...ready}
  const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  await post('/test/access-user',{user_id:USER_ID,super_admin:true})
  app.superAdmin=true
  app.staff=[{id:USER_ID,name:'Test Recruiter',email:'recruiter@fyndbridge.in',status:'active'},{id:ready.CONSULTANT,name:'Test Consultant',status:'active'},{id:ready.OTHER,name:'Other Consultant',status:'active'}]
  await page.route('**/api/**',async route=>{
    const request=route.request(),u=new URL(request.url())
    if(u.pathname.startsWith('/api/assigned-candidates')||u.pathname.startsWith('/api/crm')||u.pathname==='/api/admin/page-view-permissions') return route.fulfill({response:await route.fetch({url:url+u.pathname+u.search,headers:{...request.headers(),'x-test-user':state.user}})})
    return route.fallback()
  })
  await page.route('**/rest/v1/page_view_permissions*',async route=>route.fulfill({json:await(await fetch(url+'/test/permissions')).json()}))
  state.asConsultant=async()=>{await post('/test/access-user',{user_id:USER_ID,super_admin:false});app.superAdmin=false}
  state.grant=async(key,ids)=>{
    const response=await fetch(url+'/api/admin/page-view-permissions',{method:'PATCH',headers:{'Content-Type':'application/json','x-test-user':ready.SUPER},body:JSON.stringify({pageKey:key,viewPermission:'admin_only',allowedUserIds:ids})})
    expect(response.status).toBe(200)
  }
  state.permissions=async()=>await(await fetch(url+'/test/permissions')).json()
  await fs.mkdir('outputs/consultant-access-verification',{recursive:true})
  try{await use(state)}finally{await page.unrouteAll({behavior:'wait'});await page.close();child.send('close');await new Promise(resolve=>child.once('exit',resolve))}
},{auto:true}]})
const settingsRow=(page,label)=>page.locator('.page-view-permission-row').filter({has:page.locator('.admin-permission-label').getByText(label,{exact:true})})
async function chooseConsultant(page,label,name){
  const row=settingsRow(page,label)
  await row.locator('summary').click()
  await row.getByRole('group',{name:`Consultants with access to ${label}`}).getByLabel(name,{exact:true}).check()
}
test('Super Admin selects consultants, saves/cancels and reloads settings; CRM and New grants remain separate from Overall access',async({page,access,app},info)=>{
  await page.goto('/dashboard/admin')
  const crm=settingsRow(page,'CRM')
  await expect(crm).toBeVisible()
  await crm.getByRole('button',{name:'Admin Only',exact:true}).click()
  await chooseConsultant(page,'CRM','Test Recruiter')
  await chooseConsultant(page,'Assigned Candidates · New / Delete All','Test Recruiter')
  await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Save Changes',exact:true}).click()
  await expect(page.locator('.admin-unsaved-dock')).not.toHaveClass(/is-visible/)
  const rows=await access.permissions()
  expect(rows.find(row=>row.page_key==='crm').allowed_user_ids).toEqual([USER_ID])
  expect(rows.find(row=>row.page_key==='assigned_candidates_manage').allowed_user_ids).toEqual([USER_ID])
  await page.reload();await expect(crm).toBeVisible()
  await crm.locator('summary').click()
  await expect(crm.getByLabel('Test Recruiter',{exact:true})).toBeChecked()
  await crm.getByLabel('Test Recruiter',{exact:true}).uncheck()
  await page.locator('.admin-unsaved-dock').getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(crm.getByLabel('Test Recruiter',{exact:true})).toBeChecked()
  if(info.project.name==='chromium') { await page.screenshot({path:'outputs/consultant-access-verification/admin-settings.png',animations:'disabled',fullPage:true}); await crm.screenshot({path:'outputs/consultant-access-verification/crm-grant.png',animations:'disabled'}) }
  await access.asConsultant();await page.goto('/dashboard/crm')
  await expect(page.getByRole('heading',{name:'CRM',exact:true}).first()).toBeVisible();await expect(page.locator('#nav-crm')).toBeVisible()
  await page.goto('/dashboard/assigned-candidates')
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Delete All',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Consultant filter'})).toHaveCount(0)
  await page.getByRole('button',{name:'New',exact:true}).click();await expect(page.getByRole('dialog',{name:'Assign New Candidates'})).toBeVisible()
  const refreshed=page.waitForResponse(response=>response.url().includes('/rest/v1/page_view_permissions'))
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refreshed
  await expect(page.getByRole('dialog',{name:'Assign New Candidates'})).toBeVisible();await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Delete All',exact:true}).click()
  const confirmation=page.getByRole('alertdialog',{name:'Delete Contacted Assignments?'})
  await expect(confirmation).toContainText('assigned to you')
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click()
  await access.grant('crm',[]);await page.reload()
  await expect(page.locator('#nav-crm')).toHaveCount(0)
  await page.goto('/dashboard/crm');await expect(page).not.toHaveURL(/\/dashboard\/crm$/)
  expect(app.consoleErrors).toEqual([])
})
test('Overall-only consultants see the dropdown, cannot edit colleagues and do not get New/Delete All',async({page,access,app},info)=>{
  await access.grant('assigned_candidates_overall',[USER_ID]);await access.asConsultant()
  await page.goto('/dashboard/assigned-candidates')
  await expect(page.getByRole('button',{name:'Consultant filter'})).toBeVisible()
  await expect(page.getByRole('button',{name:'New',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Delete All',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Consultant filter'}).click();await page.getByRole('button',{name:/Other Consultant/}).click()
  const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Test Candidate 332',exact:true})})
  await expect(row).toBeVisible();await expect(row.getByRole('button',{name:/^Status for/})).toBeDisabled();await expect(row.getByRole('button',{name:'Add to Candidates'})).toBeDisabled()
  if(info.project.name==='chromium') await page.screenshot({path:'outputs/consultant-access-verification/overall-reader.png',animations:'disabled',fullPage:true})
  expect(app.consoleErrors).toEqual([])
})
test('Assigned badge uses individual 10 and overall 50 boundaries and the dashboard reminder cadence',async({page,access,app},info)=>{
  await access.asConsultant()
  let count=10,overall=false
  await page.route('**/api/assigned-candidates/count',route=>route.fulfill({json:{count,can_view_overall:overall,threshold:overall?50:10}}))
  await page.goto('/dashboard/assigned-candidates')
  const badge=page.locator('#nav-assigned-candidates .sidebar-count-badge')
  for(const [value,canOverall,high] of [[10,false,false],[11,false,true],[50,true,false],[51,true,true]]){
    count=value;overall=canOverall
    await page.evaluate(()=>window.dispatchEvent(new Event('ats:assigned-candidates-updated')))
    await expect(badge).toHaveText(String(value));await expect(badge).toHaveClass(new RegExp(high?'assigned-count-high':'assigned-count-low'))
    await expect(badge).toHaveCSS('background-color',high?'rgb(220, 38, 38)':'rgb(34, 197, 94)')
    const animation=await badge.evaluate(node=>getComputedStyle(node,'::after').animationName)
    expect(animation).toBe(high?'assigned-count-reminder':'none')
  }
  if(info.project.name==='chromium')await page.screenshot({path:'outputs/consultant-access-verification/sidebar-alert.png',animations:'disabled',fullPage:true})
  await page.emulateMedia({reducedMotion:'reduce'})
  expect(await badge.evaluate(node=>getComputedStyle(node,'::after').animationName)).toBe('none')
  await expect(badge).toHaveCSS('background-color','rgb(220, 38, 38)')
  expect(app.consoleErrors).toEqual([])
})
