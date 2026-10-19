const test=require('node:test')
const assert=require('node:assert/strict')
const { createDatabase,assign,ADMIN,CONSULTANT,OTHER,SUPER,INACTIVE,CLIENT,JOB }=require('../../test-support/assignedCandidatesSchema.cjs')
const { databaseAdapter }=require('../../test-support/assignedCandidatesAdapter.cjs')

test('real Assigned Candidates routes validate roles, lifecycle, duplicate dialogs and cleanup against PostgreSQL',async t=>{
  const db=await createDatabase();t.after(()=>db.close())
  const adapter=databaseAdapter(db)
  const modulePath=require.resolve('./supabaseAdmin');require.cache[modulePath]={id:modulePath,filename:modulePath,loaded:true,exports:adapter}
  const express=require('express');const app=express();app.use(express.json())
  let current=CONSULTANT
  app.use((req,res,next)=>{req.user={id:current,email:'test@example.test',name:'Test Consultant'};next()})
  app.use('/api/assigned-candidates',require('../routes/assignedCandidates'))
  const server=app.listen(0);t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}/api/assigned-candidates`
  const request=async(route='',method='GET',body)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {...await r.json(),httpStatus:r.status}}
  const own=await assign(db,201);await assign(db,202,{consultant:OTHER})
  await t.test('consultant lists own records and cannot spoof scope, create, reassign, delete or open another CV',async()=>{
    assert.equal((await request()).data.length,1)
    assert.equal((await request(`?consultant_id=${OTHER}`)).httpStatus,403)
    assert.equal((await request('','POST',{rows:[]})).httpStatus,403)
    assert.equal((await request(`/${own.id}`,'DELETE',{})).httpStatus,403)
    assert.equal((await request(`/${own.id}/consultant`,'PATCH',{assigned_consultant_id:OTHER})).httpStatus,403)
    const other=(await db.query('select id from assigned_candidates where assigned_consultant_id=$1',[OTHER])).rows[0].id
    assert.equal((await request(`/${other}/cv`)).httpStatus,404)
    assert.equal((await request(`/${own.id}/cv`)).httpStatus,200)
  })
  await t.test('both uncontacted states reject transfer before candidate creation',async()=>{
    for(const status of ['Not Contacted','Didn’t Pick Up']) {
      assert.equal((await request(`/${own.id}/status`,'PATCH',{status})).httpStatus,200)
      assert.equal((await request(`/${own.id}/transfer`,'POST',{status:'Interested'})).httpStatus,409)
    }
  })
  await t.test('existing form validation is reused; full transfer is retryable and no new CV upload is needed',async()=>{
    await request(`/${own.id}/status`,'PATCH',{status:'Interested'})
    const invalid=await request(`/${own.id}/transfer`,'POST',{status:'Interested'});assert.equal(invalid.httpStatus,400);assert.ok(invalid.errors.full_name)
    const body={full_name:'Test Candidate 201',email:'synthetic201@example.test',mobile_number:'9876500201',client_id:CLIENT,job_id:JOB,status:'Interested',consultant_name:'Other Consultant',consultant_user_id:OTHER}
    const result=await request(`/${own.id}/transfer`,'POST',body)
    assert.equal(result.httpStatus,201,JSON.stringify(result));assert.equal(result.consultant_user_id,CONSULTANT)
    assert.ok(result.cv_storage_path);assert.match(result.candidate_display_id,/^CA/)
    assert.equal((await request(`/${own.id}/transfer`,'POST',body)).idempotent,true)
    assert.equal((await db.query('select count(*)::int as n from candidates')).rows[0].n,1)
  })
  await t.test('duplicate detection is the original dialog contract; explicit Update Existing links without adding to totals',async()=>{
    const duplicate=await assign(db,203,{status:'Interested'})
    const body={full_name:'Test Candidate 201',email:'synthetic201@example.test',mobile_number:'9876500201',client_id:CLIENT,job_id:JOB,status:'Interested',consultant_name:'Test Consultant',consultant_user_id:CONSULTANT}
    const response=await request(`/${duplicate.id}/transfer`,'POST',body)
    assert.equal(response.httpStatus,409);assert.equal(response.duplicate,true);assert.equal(response.exactAssociation,true)
    assert.equal((await request(`/${duplicate.id}/transfer`,'POST',{...body,full_name:'Reviewed Existing Candidate',status:'In Discussion',notes:'Reviewed details',duplicate_action:'update_current'})).httpStatus,201)
    assert.equal((await db.query('select full_name from candidates')).rows[0].full_name,'Reviewed Existing Candidate')
    assert.equal((await db.query('select status,notes from candidate_associations')).rows[0].status,'In Discussion')
    assert.equal((await db.query('select status,notes from candidate_associations')).rows[0].notes,'Reviewed details')
    assert.equal((await db.query('select count(*)::int as n from candidates')).rows[0].n,1)
  })
  await t.test('admin and super-admin get aggregated consultant data; inactive users cannot read',async()=>{
    for(const uid of [ADMIN,SUPER]){current=uid;const result=await request();assert.equal(result.httpStatus,200);assert.ok(result.consultants.length>=4);assert.ok(!result.consultants.some(c=>c.id===INACTIVE));assert.ok(result.can_manage)}
    current=INACTIVE;assert.equal((await request()).httpStatus,403)
  })
  await t.test('Add Duplicate reuses the existing person for a different mandate and appends the stored CV',async()=>{
    current=CONSULTANT
    const nextJob=require('node:crypto').randomUUID()
    await db.query('insert into jobs(id,client_id,title,job_display_id) values($1,$2,$3,$4)',[nextJob,CLIENT,'Second Mandate','JB12'])
    const next=await assign(db,206,{status:'Interested'})
    const body={full_name:'Test Candidate 201',email:'synthetic201@example.test',mobile_number:'9876500201',client_id:CLIENT,job_id:nextJob,status:'Interested',consultant_name:'Test Consultant',consultant_user_id:CONSULTANT}
    const warning=await request(`/${next.id}/transfer`,'POST',body)
    assert.equal(warning.httpStatus,409);assert.equal(warning.allowAddDuplicate,true);assert.equal(warning.exactAssociation,false)
    const saved=await request(`/${next.id}/transfer`,'POST',{...body,duplicate_action:'add_duplicate'})
    assert.equal(saved.httpStatus,201,JSON.stringify(saved))
    assert.equal((await db.query('select count(*)::int as n from candidates')).rows[0].n,1)
    assert.equal((await db.query('select count(*)::int as n from candidate_associations')).rows[0].n,2)
    const master=(await db.query('select cv_storage_path,cv_attachments from candidates')).rows[0]
    assert.ok(master.cv_attachments.some(cv=>cv.path.endsWith('000000000206.pdf')))
    assert.ok(master.cv_storage_path.endsWith('000000000201.pdf'))
  })
  await t.test('upload failure keeps a durable manifest; retry and manual correction save one assignment',async()=>{
    current=ADMIN
    const uploadId=require('node:crypto').randomUUID()
    const files=adapter.storage.from
    let failUpload=true
    adapter.storage.from=()=>({...files(),upload:async(...args)=>{if(failUpload){failUpload=false;return {error:new Error('Synthetic network interruption')}}return files().upload(...args)}})
    const upload=async()=>{const body=new FormData();body.append('upload_id',uploadId);body.append('cv_file',new Blob(['synthetic Word data'],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'Manual.docx');const response=await fetch(base+'/uploads',{method:'POST',body});return {httpStatus:response.status,...await response.json()}}
    assert.equal((await upload()).httpStatus,500)
    assert.equal((await db.query('select storage_ready from assigned_candidate_uploads where id=$1',[uploadId])).rows[0].storage_ready,false)
    const ready=await upload();assert.equal(ready.httpStatus,200);assert.ok(ready.parse_error);assert.deepEqual(Object.keys(ready).sort(),['full_name','httpStatus','mobile_number','parse_error','upload_id'])
    const row={upload_id:uploadId,full_name:'Manually Corrected',mobile_number:'9999999299',client_id:CLIENT,job_id:JOB,status:'Not Contacted',assigned_consultant_id:CONSULTANT}
    assert.equal((await request('','POST',{rows:[row]})).httpStatus,201)
    assert.equal((await request('','POST',{rows:[row]})).count,1)
    assert.equal((await db.query('select count(*)::int as n from assigned_candidates where upload_id=$1',[uploadId])).rows[0].n,1)
  })
  await t.test('reassignment refreshes scoped counts and rejects inactive recipients',async()=>{
    current=ADMIN;const reassigned=await assign(db,205)
    const before=(await request('/count')).count
    assert.equal((await request(`/${reassigned.id}/consultant`,'PATCH',{assigned_consultant_id:INACTIVE})).httpStatus,400)
    assert.equal((await request(`/${reassigned.id}/consultant`,'PATCH',{assigned_consultant_id:OTHER})).httpStatus,200)
    assert.equal((await request('/count')).count,before)
    current=CONSULTANT;assert.ok(!(await request()).data.some(row=>row.id===reassigned.id))
    assert.equal((await request(`/${reassigned.id}/status`,'PATCH',{status:'Interested'})).httpStatus,404)
  })
  await t.test('main Candidates document cleanup preserves files owned by live assignments',async()=>{
    const cv=(await db.query('select cv_storage_path from candidates limit 1')).rows[0].cv_storage_path
    await db.exec('begin')
    try{
      await db.exec("update candidates set cv_storage_path=null,cv_link=null,resume_url=null,cv_attachments='[]'")
      await require('./documentStorage').removeUnreferencedDocuments('resumes',[{path:cv}],{table:'candidates',attachmentField:'cv_attachments',legacyFields:['cv_storage_path','cv_link','resume_url']})
      assert.ok(!adapter.removedPaths.includes(cv))
    }finally{await db.exec('rollback')}
  })
  await t.test('individual, bulk and Delete All preserve main candidates and reference-aware storage',async()=>{
    current=ADMIN
    const result=await request(`/${own.id}`,'DELETE',{});assert.equal(result.httpStatus,200,JSON.stringify(result));assert.equal(result.deleted,1)
    assert.ok(!adapter.removedPaths.some(path=>path.endsWith('000000000201.pdf')))
    const disposable=await assign(db,204,{status:'Interested'})
    assert.equal((await request('/delete','POST',{ids:[disposable.id],consultant_id:CONSULTANT})).deleted,1)
    assert.ok(adapter.removedPaths.some(path=>path.endsWith('000000000204.pdf')))
    assert.equal((await request('/delete','POST',{contacted_only:true})).httpStatus,200)
    assert.equal((await db.query('select count(*)::int as n from candidates')).rows[0].n,1)
    const pending=await request();assert.ok(pending.data.every(row=>['Not Contacted','Didn’t Pick Up'].includes(row.status)))
  })
})
