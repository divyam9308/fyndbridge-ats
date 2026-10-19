const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {createDatabase,assign,upload,id,ADMIN,SUPER,CONSULTANT,OTHER,INACTIVE,CLIENT,JOB}=require('../../test-support/assignedCandidatesSchema.cjs')
const {databaseAdapter}=require('../../test-support/assignedCandidatesAdapter.cjs')
test('selected-consultant permissions persist and enforce separate CRM, New/Delete All and Overall access',async t=>{
  const db=await createDatabase();t.after(()=>db.close())
  await db.exec(await fs.readFile(path.resolve(__dirname,'../../../supabase/migrations/20261019105523_business_development_crm.sql'),'utf8'))
  const adapter=databaseAdapter(db),target=require.resolve('./supabaseAdmin')
  require.cache[target]={id:target,filename:target,loaded:true,exports:adapter}
  const express=require('express'),app=express();app.use(express.json())
  let current=CONSULTANT
  app.use((req,res,next)=>{req.user={id:current,email:'synthetic@example.test'};next()})
  app.use('/api/admin',require('../routes/admin'))
  app.use('/api/crm',require('../middleware/requireAuth'),require('../routes/crm'))
  app.use('/api/assigned-candidates',require('../middleware/requireAuth'),require('../routes/assignedCandidates'))
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const base=`http://127.0.0.1:${server.address().port}`
  const request=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,...await response.json()}}
  const set=async(key,ids,role='admin_only')=>{current=SUPER;const result=await request('/api/admin/page-view-permissions','PATCH',{pageKey:key,viewPermission:role,allowedUserIds:ids});assert.equal(result.status,200,JSON.stringify(result));return result}
  const own=await assign(db,801,{status:'Interested'}),other=await assign(db,802,{consultant:OTHER,status:'Interested'})
  await assign(db,803);await assign(db,804,{status:'Didn’t Pick Up'});await assign(db,805,{consultant:OTHER})
  await t.test('defaults retain administrator controls, ordinary consultant scope and protected settings',async()=>{
    let result=await request('/api/assigned-candidates')
    assert.equal(result.can_manage,false);assert.equal(result.can_create,false);assert.equal(result.can_view_overall,false)
    assert.ok(result.data.every(row=>row.assigned_consultant_id===CONSULTANT))
    assert.equal((await request('/api/admin/page-view-permissions','PATCH',{pageKey:'crm',viewPermission:'everyone'})).status,403)
    current=ADMIN;result=await request('/api/assigned-candidates');assert.equal(result.can_create,true);assert.equal(result.can_view_overall,true)
  })
  await t.test('CRM visibility supports role plus exact selected consultants and rejects other users',async()=>{
    const result=await set('crm',[CONSULTANT])
    assert.deepEqual(result.consultantAccess.crm,[CONSULTANT])
    current=CONSULTANT;assert.equal((await request('/api/crm')).status,200)
    current=OTHER;assert.equal((await request('/api/crm')).status,403)
    current=ADMIN;assert.equal((await request('/api/crm')).status,200)
  })
  await t.test('invalid, unavailable and inactive consultant IDs and unsupported resources are rejected',async()=>{
    current=SUPER
    for(const ids of [['bad-id'],[INACTIVE],[id(99999)],[null]]) assert.equal((await request('/api/admin/page-view-permissions','PATCH',{pageKey:'crm',viewPermission:'admin_only',allowedUserIds:ids})).status,400)
    assert.equal((await request('/api/admin/page-view-permissions','PATCH',{pageKey:'report',viewPermission:'admin_only',allowedUserIds:[CONSULTANT]})).status,400)
    assert.equal((await request('/api/admin/page-view-permissions','PATCH',{pageKey:'crm',viewPermission:'invalid',allowedUserIds:[]})).status,400)
    await assert.rejects(db.query("update page_view_permissions set allowed_user_ids=array[null]::uuid[] where page_key='crm'"),error=>error.code==='23514')
  })
  await t.test('New permission permits owned uploads and atomic creation without overall access or row admin powers',async()=>{
    await set('assigned_candidates_manage',[CONSULTANT]);current=CONSULTANT
    const result=await request('/api/assigned-candidates')
    assert.equal(result.can_create,true);assert.equal(result.can_delete_all,true);assert.equal(result.can_view_overall,false);assert.equal(result.can_manage,false)
    assert.ok(result.consultants.length>0)
    await upload(db,806,CONSULTANT)
    const created=await request('/api/assigned-candidates','POST',{rows:[{upload_id:id(806),full_name:'Delegated assignment',mobile_number:'9876543210',client_id:CLIENT,job_id:JOB,assigned_consultant_id:OTHER,status:'Not Contacted'}]})
    assert.equal(created.status,201,JSON.stringify(created))
    assert.equal((await request(`/api/assigned-candidates/${own.id}/consultant`,'PATCH',{assigned_consultant_id:OTHER})).status,403)
    assert.equal((await request(`/api/assigned-candidates/${own.id}`,'DELETE',{})).status,403)
    assert.equal((await request(`/api/assigned-candidates?consultant_id=${OTHER}`)).status,403)
  })
  await t.test('delegated Delete All is own-scope, contacted-only and cannot be changed into selected-ID deletion',async()=>{
    current=CONSULTANT
    assert.equal((await request('/api/assigned-candidates/delete','POST',{ids:[other.id]})).status,403)
    assert.equal((await request('/api/assigned-candidates/delete','POST',{contacted_only:true,consultant_id:OTHER})).status,403)
    await assert.rejects(db.query('select delete_assigned_candidates($1,$2,null,true)',[CONSULTANT,OTHER]),error=>error.code==='42501')
    const result=await request('/api/assigned-candidates/delete','POST',{contacted_only:true})
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(Number(result.deleted),1)
    assert.equal((await db.query('select count(*)::int as n from assigned_candidates where id=$1',[other.id])).rows[0].n,1)
    assert.equal((await db.query("select count(*)::int as n from assigned_candidates where assigned_consultant_id=$1 and status in ('Not Contacted','Didn’t Pick Up')",[CONSULTANT])).rows[0].n,2)
  })
  await t.test('Overall grants read scope and aggregate badge metadata without New, deletion, reassignment or colleague writes',async()=>{
    await set('assigned_candidates_overall',[OTHER]);current=OTHER
    const result=await request('/api/assigned-candidates')
    assert.equal(result.can_view_overall,true);assert.equal(result.can_create,false);assert.equal(result.can_manage,false)
    assert.ok(result.data.some(row=>row.assigned_consultant_id===CONSULTANT))
    const count=await request('/api/assigned-candidates/count');assert.equal(count.threshold,50);assert.equal(count.can_view_overall,true)
    const colleague=result.data.find(row=>row.assigned_consultant_id===CONSULTANT)
    assert.equal((await request(`/api/assigned-candidates/${colleague.id}/cv`)).status,200)
    assert.equal((await request(`/api/assigned-candidates/${colleague.id}/status`,'PATCH',{status:'Interested'})).status,404)
    assert.equal((await request(`/api/assigned-candidates/${colleague.id}/transfer`,'POST',{})).status,404)
    assert.equal((await request('/api/assigned-candidates/delete','POST',{contacted_only:true})).status,403)
    current=CONSULTANT;const individual=await request('/api/assigned-candidates/count');assert.equal(individual.threshold,10);assert.equal(individual.can_view_overall,false)
  })
  await t.test('RLS permits cross-consultant reads only for the selected Overall reader, with no direct mutation grants',async()=>{
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${OTHER}',false)`)
    assert.ok((await db.query('select * from assigned_candidates')).rows.some(row=>row.assigned_consultant_id===CONSULTANT))
    await assert.rejects(db.query('delete from assigned_candidates'),/permission denied/)
    await assert.rejects(db.query("update page_view_permissions set allowed_user_ids='{}'"),/permission denied/)
    await assert.rejects(db.query('select private.consultant_resource_actor_allowed($1,$2)',[CONSULTANT,'assigned_candidates_manage']),/permission denied/)
    await db.exec(`select set_config('request.jwt.claim.sub','${CONSULTANT}',false)`)
    assert.ok((await db.query('select * from assigned_candidates')).rows.every(row=>row.assigned_consultant_id===CONSULTANT))
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
  })
  await t.test('combining the two grants permits scoped Delete All while still retaining pending assignments',async()=>{
    await set('assigned_candidates_overall',[OTHER,CONSULTANT]);current=CONSULTANT
    const result=await request('/api/assigned-candidates/delete','POST',{contacted_only:true,consultant_id:OTHER})
    assert.equal(result.status,200);assert.equal(Number(result.deleted),1)
    assert.ok((await db.query("select * from assigned_candidates where assigned_consultant_id=$1 and status='Not Contacted'",[OTHER])).rows.length>0)
  })
  await t.test('grant revocation is immediate in middleware, list scope, RLS, and server-side creation',async()=>{
    await set('assigned_candidates_manage',[]);await set('assigned_candidates_overall',[]);await set('crm',[])
    current=CONSULTANT
    assert.equal((await request('/api/crm')).status,403)
    assert.equal((await request(`/api/assigned-candidates?consultant_id=${OTHER}`)).status,403)
    assert.equal((await request('/api/assigned-candidates','POST',{rows:[]})).status,403)
    await assert.rejects(db.query('select create_assigned_candidates($1,$2)',[CONSULTANT,'[]']),error=>error.code==='42501')
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${OTHER}',false)`)
    assert.ok((await db.query('select * from assigned_candidates')).rows.every(row=>row.assigned_consultant_id===OTHER))
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
  })
})
