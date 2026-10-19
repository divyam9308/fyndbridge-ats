const test = require('node:test')
const assert = require('node:assert/strict')
const { createDatabase,id,ADMIN,CONSULTANT,OTHER,INACTIVE,SUPER,CLIENT,JOB,upload,assign,payload,association } = require('../../test-support/assignedCandidatesSchema.cjs')
const { ASSIGNED_STATUSES, assignmentScope, validateAssignment, rowGroup } = require('./assignedCandidates')
const { CANDIDATE_STATUSES } = require('./candidateStatuses')
test('contact-only statuses never enter the main Candidates status contract',()=>{
  assert.deepEqual(ASSIGNED_STATUSES,['Not Contacted', 'Didn’t Pick Up', 'Interested', 'Not Interested', 'In Discussion', 'Rejected by Recruiter', 'Not Relevant'])
  for(const status of ['Not Contacted','Didn’t Pick Up','Not Relevant']) assert.ok(!CANDIDATE_STATUSES.includes(status))
  assert.equal(rowGroup({status:'Not Contacted',added_at:'2026-10-19'}),4)
  for (const status of ['Not Contacted','Interested','In Discussion','Not Interested','Rejected by Recruiter']) assert.equal(rowGroup({status}),0)
  assert.equal(rowGroup({status:'Didn’t Pick Up'}),1); assert.equal(rowGroup({status:'Not Relevant'}),2)
  assert.throws(()=>assignmentScope({id:CONSULTANT},false,OTHER),{statusCode:403})
  assert.equal(assignmentScope({id:CONSULTANT},false,''),CONSULTANT)
  assert.equal(assignmentScope({id:ADMIN},true,''),null)
  assert.throws(()=>validateAssignment({full_name:'A',mobile_number:'invented'}))
})
test('migration, RLS, timestamps, atomic transfers and deletion execute in PostgreSQL',async t=>{
  const db=await createDatabase(); t.after(()=>db.close())
  const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0]
  await t.test('database validation accepts all seven assignment statuses',async()=>{
    for(const [index,status] of ASSIGNED_STATUSES.entries()) assert.equal((await assign(db,500+index,{status})).status,status)
  })
  await t.test('preliminary assignments do not affect main analytics and supplied timestamps are ignored',async()=>{
    const a=await assign(db,101)
    assert.equal(await scalar('select count(*)::int from candidates'),0)
    assert.equal(await scalar('select count(*)::int from candidate_associations'),0)
    assert.equal(a.contacted_at,null)
    await db.query("update assigned_candidates set assigned_at='2001-01-01',contacted_at='2001-01-01' where id=$1",[a.id])
    const row=(await db.query('select * from assigned_candidates where id=$1',[a.id])).rows[0]
    assert.equal(row.assigned_at.getTime(),a.assigned_at.getTime());assert.equal(row.contacted_at,null)
  })
  await t.test('contact date is set once, excluding no pickup, and preserved on all later changes',async()=>{
    const a=await assign(db,102)
    await db.query('update assigned_candidates set status=$1 where id=$2',['Didn’t Pick Up',a.id])
    assert.equal(await scalar('select contacted_at from assigned_candidates where id=$1',[a.id]),null)
    await db.query("update assigned_candidates set status='In Discussion' where id=$1",[a.id])
    const contacted=await scalar('select contacted_at from assigned_candidates where id=$1',[a.id]);assert.ok(contacted)
    for(const status of ['Not Interested','Not Contacted','Didn’t Pick Up']) {
      await db.query('update assigned_candidates set status=$1,contacted_at=null where id=$2',[status,a.id])
      assert.equal((await scalar('select contacted_at from assigned_candidates where id=$1',[a.id])).getTime(),contacted.getTime())
    }
    assert.ok((await assign(db,103,{status:'Interested'})).contacted_at)
    assert.equal((await assign(db,104,{status:'Didn’t Pick Up'})).contacted_at,null)
  })
  await t.test('inactive consultant, unauthorized admin and partial batch failures roll back',async()=>{
    await assert.rejects(assign(db,105,{consultant:INACTIVE}),/Active/)
    await assert.rejects(assign(db,106,{actor:CONSULTANT}),/Admin/)
    await assign(db,107,{actor:SUPER})
    await upload(db,108);await upload(db,109)
    const base={full_name:'Batch',mobile_number:'9999999999',client_id:CLIENT,job_id:JOB,assigned_consultant_id:CONSULTANT,status:'Not Contacted'}
    await assert.rejects(db.query('select create_assigned_candidates($1,$2)',[ADMIN,JSON.stringify([{...base,upload_id:id(108)},{...base,upload_id:id(109),client_id:id(999)}])]),/Invalid client/)
    assert.equal(await scalar('select count(*)::int from assigned_candidates where upload_id in ($1,$2)',[id(108),id(109)]),0)
  })
  await t.test('duplicate batch Save is idempotent and counts are assignment based',async()=>{
    const a=await assign(db,110)
    const row={upload_id:id(110),full_name:a.full_name,mobile_number:a.mobile_number,client_id:CLIENT,job_id:JOB,assigned_consultant_id:CONSULTANT,status:a.status}
    assert.equal(await scalar('select create_assigned_candidates($1,$2)',[ADMIN,JSON.stringify([row])]),1)
    assert.equal(await scalar('select count(*)::int from assigned_candidates where upload_id=$1',[id(110)]),1)
    const stats=await scalar('select assigned_candidates_stats($1,false)',[CONSULTANT])
    assert.equal(Number(stats.assigned),await scalar('select count(*)::int from assigned_candidates where assigned_consultant_id=$1',[CONSULTANT]))
  })
  await t.test('consultant RLS prevents other records, direct writes, upload metadata and RPC calls',async()=>{
    await assign(db,111,{consultant:OTHER})
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${CONSULTANT}',false);`)
    const rows=(await db.query('select * from assigned_candidates')).rows
    assert.ok(rows.length);assert.ok(rows.every(row=>row.assigned_consultant_id===CONSULTANT))
    for(const sql of ["update assigned_candidates set status='Interested'",'select * from assigned_candidate_uploads','select assigned_candidates_stats(null,false)']) await assert.rejects(db.query(sql),/permission denied/)
    await assert.rejects(db.query('select create_assigned_candidates($1,$2)',[CONSULTANT,'[]']),/permission denied/)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from assigned_candidates'),/permission denied/)
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
  })
  await t.test('admins and super admins see all; page restrictions and inactive users fail closed',async()=>{
    for(const uid of [ADMIN,SUPER]) {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`)
      assert.ok((await db.query('select distinct assigned_consultant_id from assigned_candidates')).rows.length>1)
      await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
    }
    await db.exec("update page_view_permissions set view_permission='super_admin_only'")
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ADMIN}',false);`)
    assert.equal((await db.query('select * from assigned_candidates')).rows.length,0)
    await db.exec(`reset role; update page_view_permissions set view_permission='everyone'; set role authenticated; select set_config('request.jwt.claim.sub','${INACTIVE}',false);`)
    assert.equal((await db.query('select * from assigned_candidates')).rows.length,0)
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
  })
  await t.test('service-role mutations work without broad auth.users access',async()=>{
    await upload(db,150)
    const row={upload_id:id(150),full_name:'Service fixture',mobile_number:'9999999150',client_id:CLIENT,job_id:JOB,assigned_consultant_id:CONSULTANT,status:'Interested'}
    await db.exec('set role service_role')
    assert.equal(await scalar('select create_assigned_candidates($1,$2)',[ADMIN,JSON.stringify([row])]),1)
    const created=(await db.query('select id from assigned_candidates where upload_id=$1',[id(150)])).rows[0]
    const result=await scalar('select transfer_assigned_candidate($1,$2,$3,$4,null)',[created.id,CONSULTANT,JSON.stringify(payload(150)),JSON.stringify(association())])
    assert.ok(result.association.candidate_id)
    await db.exec('reset role')
    await db.query('delete from assigned_candidates where id=$1',[created.id])
    await db.query('delete from candidates where id=$1',[result.association.candidate_id])
  })
  await t.test('transaction blocks pending and Not Relevant assignments even if the submitted form says Interested',async()=>{
    for(const [n,status] of [[112,'Not Contacted'],[113,'Didn’t Pick Up'],[118,'Not Relevant']]) {
      const a=await assign(db,n,{status})
      await assert.rejects(db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',[a.id,CONSULTANT,JSON.stringify(payload(n)),JSON.stringify(association())]),/Contact the candidate|Not Relevant/)
    }
    assert.equal(await scalar('select count(*)::int from candidates'),0)
  })
  await t.test('ordinary status updates retain assignment position; excluded statuses move immediately', async () => {
    const first = await assign(db, 119), second = await assign(db, 120)
    const order = async () => (await db.query('select id from assigned_candidates where id=any($1) order by sort_group,assigned_at,id', [[first.id, second.id]])).rows.map(row => row.id)
    const initial = await order()
    for (const status of ['Interested', 'In Discussion', 'Not Interested', 'Rejected by Recruiter']) {
      await db.query('update assigned_candidates set status=$1 where id=$2', [status, first.id])
      assert.deepEqual(await order(), initial)
      assert.equal(await scalar('select sort_group from assigned_candidates where id=$1', [first.id]), 0)
    }
    for (const [status, group] of [['Didn’t Pick Up',1],['Not Relevant',2]]) {
      await db.query('update assigned_candidates set status=$1 where id=$2', [status, first.id])
      assert.deepEqual(await order(), [second.id, first.id])
      assert.equal(await scalar('select sort_group from assigned_candidates where id=$1', [first.id]), group)
    }
    await db.query("update assigned_candidates set status='Interested' where id=$1", [first.id])
    assert.deepEqual(await order(), initial)
    assert.equal((await scalar('select assigned_at from assigned_candidates where id=$1', [first.id])).getTime(), first.assigned_at.getTime())
  })
  await t.test('unauthorized transfer and association failure preserve retryable assignments',async()=>{
    const a=await assign(db,114,{status:'Interested'})
    await assert.rejects(db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',[a.id,OTHER,JSON.stringify(payload(114)),JSON.stringify(association())]),/access denied/)
    await assert.rejects(db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',[a.id,CONSULTANT,JSON.stringify(payload(114)),JSON.stringify({...association(),current_salary:'invalid'})]))
    assert.equal(await scalar('select count(*)::int from candidates'),0)
    assert.equal(await scalar('select added_at from assigned_candidates where id=$1',[a.id]),null)
  })
  let transferred
  await t.test('successful transfer reuses CV; simultaneous retries create one real candidate',async()=>{
    const a=await assign(db,115,{status:'Interested'})
    const args=[a.id,CONSULTANT,JSON.stringify(payload(115)),JSON.stringify(association())]
    const [one,two]=await Promise.all([db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',args),db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',args)])
    const first=Object.values(one.rows[0])[0], second=Object.values(two.rows[0])[0]
    assert.equal(second.idempotent,true);assert.equal(first.association.candidate_id,second.association.candidate_id)
    assert.equal(await scalar('select count(*)::int from candidates'),1)
    assert.equal(await scalar('select count(*)::int from candidate_associations'),1)
    const saved=(await db.query('select * from assigned_candidates where id=$1',[a.id])).rows[0]
    assert.equal(saved.sort_group,4);assert.ok(saved.added_at);assert.equal(saved.assigned_at.getTime(),a.assigned_at.getTime())
    assert.equal(first.association.candidates.cv_storage_path,`assigned/${ADMIN}/${id(115)}.pdf`)
    assert.match(first.association.candidates.candidate_display_id,/^CA\d+$/)
    assert.ok(new Date(first.association.candidates.created_at)>=a.created_at)
    transferred={assignment:a.id,candidate:first.association.candidate_id}
  })
  await t.test('duplicate races roll back and explicit existing association links preserve main totals',async()=>{
    const a=await assign(db,116,{status:'Interested'})
    await assert.rejects(db.query('select transfer_assigned_candidate($1,$2,$3,$4,null)',[a.id,CONSULTANT,JSON.stringify(payload(115)),JSON.stringify(association())]),/identity changed/)
    await db.query('select transfer_assigned_candidate($1,$2,$3,$4,$5)',[a.id,CONSULTANT,JSON.stringify(payload(115)),JSON.stringify(association()),transferred.candidate])
    assert.equal(await scalar('select count(*)::int from candidates'),1)
    assert.equal(await scalar('select count(*)::int from candidate_associations'),1)
    assert.equal(Number((await scalar('select assigned_candidates_stats(null,false)')).added),2)
  })
  await t.test('group order stays correct across pages; completed overrides pending color',async()=>{
    await db.query("update assigned_candidates set status='Not Contacted' where id=$1",[transferred.assignment])
    // Exercise the upgrade against populated rows, including already-transferred CVs.
    const before=(await db.query('select id,upload_id,candidate_id,added_at from assigned_candidates order by id')).rows
    await db.exec(await require('node:fs/promises').readFile(require('node:path').resolve(__dirname,'../../../supabase/migrations/20261019120000_assigned_candidate_relevance_order.sql'),'utf8'))
    await db.exec(await require('node:fs/promises').readFile(require('node:path').resolve(__dirname,'../../../supabase/migrations/20261019121623_assigned_candidate_stable_status_order.sql'),'utf8'))
    assert.deepEqual((await db.query('select id,upload_id,candidate_id,added_at from assigned_candidates order by id')).rows,before)
    const groups=(await db.query('select sort_group from assigned_candidates order by sort_group,assigned_at,id')).rows.map(row=>row.sort_group)
    assert.deepEqual(groups,[...groups].sort((a,b)=>a-b))
    for(let offset=0;offset<groups.length;offset+=3) assert.deepEqual((await db.query('select sort_group from assigned_candidates order by sort_group,assigned_at,id limit 3 offset $1',[offset])).rows.map(row=>row.sort_group),groups.slice(offset,offset+3))
    assert.equal(await scalar('select sort_group from assigned_candidates where id=$1',[transferred.assignment]),4)
    assert.equal(await scalar("select sort_group from assigned_candidates where status='Not Relevant' and added_at is null limit 1"),2)
    assert.deepEqual([...new Set(groups)],[0,1,2,4])
  })
  await t.test('scoped Delete All preserves both pending statuses and main candidates',async()=>{
    await assert.rejects(db.query('select delete_assigned_candidates($1,null,null,true)',[CONSULTANT]),/Admin/)
    await db.query('select delete_assigned_candidates($1,$2,null,true)',[ADMIN,CONSULTANT])
    assert.equal(await scalar("select count(*)::int from assigned_candidates where assigned_consultant_id=$1 and status not in ('Not Contacted','Didn’t Pick Up')",[CONSULTANT]),0)
    assert.ok(await scalar('select count(*)::int from assigned_candidates where assigned_consultant_id=$1',[OTHER]))
    assert.equal(await scalar('select count(*)::int from candidates'),1)
    assert.equal(await scalar('select count(*)::int from candidate_associations'),1)
    assert.ok(await scalar('select count(*)::int from assigned_candidates where id=$1',[transferred.assignment]))
  })
  await t.test('bulk deletion checks scope and retries; durable cleanup excludes still-used files',async()=>{
    const other=(await db.query('select id from assigned_candidates where assigned_consultant_id=$1 limit 1',[OTHER])).rows[0].id
    await assert.rejects(db.query('select delete_assigned_candidates($1,$2,$3,false)',[ADMIN,CONSULTANT,[other]]),/outside/)
    const row=await assign(db,117)
    assert.equal(Number(await scalar('select delete_assigned_candidates($1,null,$2,false)',[ADMIN,[row.id]])),1)
    assert.equal(Number(await scalar('select delete_assigned_candidates($1,null,$2,false)',[ADMIN,[row.id]])),0)
    assert.equal(await scalar('select claim_assigned_cv_cleanup($1)',[id(117)]),true)
    assert.equal(await scalar('select claim_assigned_cv_cleanup($1)',[id(115)]),false)
    await db.query('select delete_assigned_candidates($1,null,null,true)',[SUPER])
    assert.equal(await scalar("select count(*)::int from assigned_candidates where status not in ('Not Contacted','Didn’t Pick Up')"),0)
    assert.equal(await scalar('select count(*)::int from candidates'),1)
  })
})
