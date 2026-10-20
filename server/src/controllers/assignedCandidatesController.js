const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')
const supabase = require('../services/supabaseAdmin')
const { isAdmin, canAccessResource } = require('../services/adminAccess')
const { listEmployeeDirectory, getEmployeeStatus } = require('../services/employeeStatus')
const { validateMandateReference } = require('../services/candidateCreation')
const { withAssignedCvParsing } = require('../services/assignedCvParsing')
const { parseBulkResume } = require('../services/bulkResumeParser')
const { prepareAssignedCv, cleanupAssignedCvs } = require('../services/assignedCandidateCv')
const { ASSIGNED_STATUSES, NOT_CONTACTED, DID_NOT_PICK_UP, assignmentScope, validateAssignment, isUuid, fail } = require('../services/assignedCandidates')

const SELECT = '*,clients(name,client_name,client_display_id),jobs(title,job_display_id),assigned_candidate_uploads(cv_original_name)'
const STATUS_FILTERS = Object.freeze({
  not_contacted: NOT_CONTACTED,
  did_not_pick_up: DID_NOT_PICK_UP,
  interested: 'Interested',
  not_interested: 'Not Interested',
  in_discussion: 'In Discussion',
  rejected_by_recruiter: 'Rejected by Recruiter',
  not_relevant: 'Not Relevant'
})
const unwrap = result => { if (result.error) throw result.error; return result.data }
async function context(req) {
  if(req.assignedAccess) return req.assignedAccess
  const employment = await getEmployeeStatus(req.user.id)
  if (!employment || employment.status === 'inactive') throw fail('Assignment access denied.', 403)
  const admin = await isAdmin(req.user)
  const [canCreate,canViewOverall] = await Promise.all([canAccessResource(req.user,'assigned_candidates_manage'),canAccessResource(req.user,'assigned_candidates_overall')])
  req.assignedAccess={ admin, canCreate, canViewOverall, scope: assignmentScope(req.user, canViewOverall, req.query.consultant_id || req.body?.consultant_id) }
  return req.assignedAccess
}
async function getRow(req, { write = true } = {}) {
  const { admin, canViewOverall } = await context(req)
  let query = supabase.from('assigned_candidates').select('*,assigned_candidate_uploads(*)').eq('id', req.params.id)
  if (!admin && (write || !canViewOverall)) query = query.eq('assigned_consultant_id', req.user.id)
  const row = unwrap(await query.maybeSingle())
  if (!row) throw fail('Assignment not found.', 404)
  return row
}
async function creationContext(req) { const result = await context(req); if (!result.canCreate) throw fail('New / Delete All access required.',403); return result }
const handle = fn => async (req, res) => {
  try { await fn(req, res) } catch (error) {
    const status = error.statusCode || (error.code === '42501' ? 403 : ['22023','23505','P0001','23514','22P02','40001'].includes(error.code) ? 409 : error.code === 'P0002' ? 404 : 500)
    if (status === 500) console.error('assigned candidates:', error.code || error.message)
    res.status(status).json({ error: status === 500 ? 'Unable to complete this request. Please retry.' : error.message })
  }
}

exports.list = handle(async (req,res) => {
  const { admin, scope, canCreate, canViewOverall } = await context(req)
  const page = Math.max(1,parseInt(req.query.page,10)||1); const limit = Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25))
  const filter = req.query.filter || 'assigned'
  if (!['assigned','added'].includes(filter) && !Object.hasOwn(STATUS_FILTERS,filter)) throw fail('Invalid assignment filter')
  let query = supabase.from('assigned_candidates').select(SELECT,{count:'exact'})
  if (filter === 'added') query = query.not('added_at','is',null)
  if (Object.hasOwn(STATUS_FILTERS,filter)) query = query.eq('status',STATUS_FILTERS[filter])
  if (scope) query = query.eq('assigned_consultant_id',scope)
  const result = await query.order('sort_group').order('assigned_at').order('id').range((page-1)*limit,page*limit-1)
  unwrap(result)
  // The existing RPC supplies Total, Added and the two pending statuses. Count
  // the remaining statuses across the same authorized scope, not this page or
  // the currently selected status. Head requests return no candidate records.
  const additionalStatuses = Object.entries(STATUS_FILTERS).filter(([key]) => !['not_contacted','did_not_pick_up'].includes(key))
  const [statsResult,...statusCounts] = await Promise.all([
    supabase.rpc('assigned_candidates_stats',{p_scope:scope,p_active_only:false}),
    ...additionalStatuses.map(([,status]) => {
      let countQuery = supabase.from('assigned_candidates').select('id',{count:'exact',head:true}).eq('status',status)
      if (scope) countQuery = countQuery.eq('assigned_consultant_id',scope)
      return countQuery
    })
  ])
  const stats = { ...unwrap(statsResult) }
  statusCounts.forEach((result,index) => {
    unwrap(result)
    stats[additionalStatuses[index][0]] = result.count
  })
  const directory = (admin || canCreate || canViewOverall) ? await listEmployeeDirectory() : []
  const consultantNames = new Map(directory.map(e=>[e.user_id,e.name]))
  const counts = canViewOverall ? unwrap(await supabase.rpc('assigned_candidates_consultant_counts')) || [] : []
  const countMap = new Map(counts.map(r=>[r.user_id,Number(r.not_contacted)]))
  res.json({ data:(admin || canViewOverall) ? result.data.map(row=>({...row,assigned_consultant_name:consultantNames.get(row.assigned_consultant_id)||null})) : result.data,total:result.count,page,limit,totalPages:Math.max(1,Math.ceil(result.count/limit)),stats,statuses:ASSIGNED_STATUSES,
    consultants:directory.filter(e=>e.status==='active').map(e=>({id:e.user_id,name:e.name,not_contacted:countMap.get(e.user_id)||0})),can_manage:admin,can_create:canCreate,can_delete_all:canCreate,can_view_overall:canViewOverall,current_user_id:req.user.id })
})
exports.count = handle(async(req,res)=>{
  const {canViewOverall,scope}=await context(req)
  const stats=unwrap(await supabase.rpc('assigned_candidates_stats',{p_scope:scope,p_active_only:canViewOverall}))
  res.json({count:Number(stats.not_contacted),can_view_overall:canViewOverall,threshold:canViewOverall?50:10})
})
exports.upload = handle(async(req,res)=>{
  try {
    await creationContext(req)
    const id=req.body.upload_id
    if (!isUuid(id)||!req.file) throw fail('Select a CV to upload.')
    let row=unwrap(await supabase.from('assigned_candidate_uploads').select('*').eq('id',id).eq('uploaded_by',req.user.id).maybeSingle())
    if (row?.retired_at || row?.cleanup_claimed_at) throw fail('CV expired. Please select it again.',409)
    const prepared=(!row || !row.storage_ready) ? await prepareAssignedCv(req.file,id,req.user.id) : null
    if (!row) {
      const saved=await supabase.from('assigned_candidate_uploads').insert(prepared.metadata).select('*').single()
      if (saved.error && saved.error.code!=='23505') throw saved.error
      row=saved.data || unwrap(await supabase.from('assigned_candidate_uploads').select('*').eq('id',id).eq('uploaded_by',req.user.id).single())
    }
    if (!row.storage_ready) {
      if (row.cv_file_hash!==prepared.metadata.cv_file_hash) throw fail('This upload belongs to a different CV. Select the file again.',409)
      const stored=await supabase.storage.from('resumes').upload(row.cv_storage_path,prepared.buffer,{contentType:row.cv_mimetype,upsert:false})
      if (stored.error&&!/already exists|duplicate/i.test(stored.error.message||'')) throw stored.error
      unwrap(await supabase.from('assigned_candidate_uploads').update({storage_ready:true}).eq('id',id))
    }
    res.json({upload_id:row.id,full_name:row.parsed_name,mobile_number:row.parsed_mobile,parse_error:row.parse_error})
  } finally { if(req.file?.path) await fs.unlink(req.file.path).catch(()=>{}) }
})
exports.create = handle(async(req,res)=>{
  await creationContext(req)
  if (!Array.isArray(req.body.rows)||!req.body.rows.length) throw fail('Select at least one CV.')
  const rows=req.body.rows.map(validateAssignment)
  if (new Set(rows.map(r=>r.upload_id)).size!==rows.length) throw fail('Each uploaded CV must appear once.')
  const mandates=new Map()
  for(const row of rows) {
    const key=`${row.client_id}:${row.job_id}`
    if(!mandates.has(key)) { const reference={client_id:row.client_id,job_id:row.job_id}; await validateMandateReference(supabase,reference); mandates.set(key,reference.client_id) }
    row.client_id=mandates.get(key)
  }
  const saved=unwrap(await supabase.rpc('create_assigned_candidates',{p_actor:req.user.id,p_rows:rows}))
  res.status(201).json({count:saved})
})
exports.status = handle(async(req,res)=>{
  await creationContext(req)
  if(!ASSIGNED_STATUSES.includes(req.body.status)) throw fail('Select a valid status.')
  const row=await getRow(req)
  unwrap(await supabase.rpc('update_assigned_candidate',{p_actor:req.user.id,p_id:row.id,p_data:{status:req.body.status},p_expected_version:row.version}))
  res.json({success:true})
})
exports.detail = handle(async(req,res)=>{
  await creationContext(req)
  const row=await getRow(req)
  res.json({data:Object.fromEntries(['full_name','mobile_number','client_id','job_id','assigned_consultant_id','status','version'].map(key=>[key,row[key]]))})
})
exports.update = handle(async(req,res)=>{
  await creationContext(req)
  const row=await getRow(req)
  const allowed=new Set(['full_name','mobile_number','client_id','job_id','assigned_consultant_id','status','expected_version'])
  if (!req.body || Object.keys(req.body).some(key=>!allowed.has(key)) || !Number.isSafeInteger(req.body.expected_version) || req.body.expected_version<1) throw fail('Send valid assignment fields and the original record version.')
  const values=validateAssignment({...row,...req.body})
  await validateMandateReference(supabase,values)
  const changes=Object.fromEntries(['full_name','mobile_number','client_id','job_id','assigned_consultant_id','status'].map(key=>[key,values[key]]))
  const data=unwrap(await supabase.rpc('update_assigned_candidate',{p_actor:req.user.id,p_id:row.id,p_data:changes,p_expected_version:req.body.expected_version}))
  res.json({data})
})
exports.reassign = handle(async(req,res)=>{
  await creationContext(req)
  const row=await getRow(req); const id=req.body.assigned_consultant_id
  const employees=await listEmployeeDirectory()
  if(!employees.some(e=>e.user_id===id&&e.status==='active')) throw fail('Select an Active consultant.')
  unwrap(await supabase.rpc('update_assigned_candidate',{p_actor:req.user.id,p_id:row.id,p_data:{assigned_consultant_id:id},p_expected_version:row.version}))
  res.json({success:true})
})
exports.cv = handle(async(req,res)=>{
  const row=await getRow(req,{write:false}); const cv=row.assigned_candidate_uploads
  const data=unwrap(await supabase.storage.from('resumes').createSignedUrl(cv.cv_storage_path,300))
  res.json({url:data.signedUrl,fileName:cv.cv_original_name,contentType:cv.cv_mimetype})
})
exports.parse = handle(async(req,res)=>{
  await creationContext(req)
  const row=await getRow(req)
  const file=path.join(os.tmpdir(),`${randomUUID()}.pdf`)
  try {
    const cv=row.assigned_candidate_uploads
    const blob=unwrap(await supabase.storage.from('resumes').download(cv.cv_storage_path))
    await fs.writeFile(file,Buffer.from(await blob.arrayBuffer()))
    const parsed=await withAssignedCvParsing(() => parseBulkResume({path:file,originalname:cv.cv_original_name,mimetype:cv.cv_mimetype}))
    res.json({data:require('./resumeController').rowFromParsed({originalname:cv.cv_original_name,mimetype:cv.cv_mimetype},parsed)})
  } finally {await fs.unlink(file).catch(()=>{})}
})
async function transfer(req,res) {
  await creationContext(req)
  const row=await getRow(req)
  if(row.added_at) return res.json({candidate_id:row.candidate_id,association_id:row.association_id,idempotent:true})
  if(row.status === 'Not Relevant') throw fail('Not Relevant assignments cannot be added to Candidates.',409)
  if([NOT_CONTACTED,DID_NOT_PICK_UP].includes(row.status)) throw fail('Contact the candidate and update the assignment status before adding to Candidates.',409)
  // Keep the existing complete validation and duplicate dialog contract.
  req.assignedCandidateId=row.id
  const {admin}=await context(req)
  const employee=(await listEmployeeDirectory()).find(e=>e.user_id===row.assigned_consultant_id)
  const body={...req.body}
  for(const key of ['cv_link','cv_storage_path','cv_attachments','cv_file_hash','resume_url','cv_original_name','cv_mimetype']) delete body[key]
  req.body={...body,source:'manual',...(!admin?{consultant_user_id:row.assigned_consultant_id,consultant_name:employee?.name || ''}:{})}
  return require('./candidateController').createCandidate(req,res)
}
exports.transfer = handle(transfer)
exports.review = handle(async(req,res)=>{
  req.assignedReviewOnly=true
  return transfer(req,res)
})
exports.remove = handle(async(req,res)=>{
  const access=await context(req)
  const all=req.body.contacted_only===true
  if (!access.canCreate) throw fail('New / Delete access required.',403)
  const {scope}=access
  const ids=req.params.id?[req.params.id]:req.body.ids
  if(!all&&(!Array.isArray(ids)||!ids.length||ids.some(id=>!isUuid(id)))) throw fail('Select valid assignments to delete.')
  if(all&&ids) throw fail('Delete All cannot contain a selection.')
  const count=unwrap(await supabase.rpc('delete_assigned_candidates',{p_actor:req.user.id,p_scope:scope,p_ids:ids?[...new Set(ids)]:null,p_contacted_only:all}))
  const pending=await cleanupAssignedCvs(supabase).catch(()=>1)
  res.json({deleted:count,cleanup_pending:pending})
})
exports.discard = handle(async(req,res)=>{
  await creationContext(req)
  const ids=req.body.ids
  if(!Array.isArray(ids)||ids.some(id=>!isUuid(id))) throw fail('Invalid upload selection.')
  if(ids.length) unwrap(await supabase.from('assigned_candidate_uploads').update({retired_at:new Date().toISOString()}).in('id',ids).eq('uploaded_by',req.user.id))
  const pending=await cleanupAssignedCvs(supabase).catch(()=>1)
  res.json({cleanup_pending:pending})
})
