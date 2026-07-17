const supabase=require('./supabaseAdmin')
const {localDate,addDays,weekday,workedMinutes,calculateLeave,applySandwichContext,bad,getFinancialYearForDate,getFinancialYearRange,getFinancialYearMonths,previousFinancialYear,calculateLeaveEntitlement,calculateCarryForward}=require('./attendanceUtils')
const {buildActiveProfiles,buildTodayAttendanceSummary}=require('./teamAttendanceToday')
const {buildAttendancePeriodSummary}=require('./attendancePeriodSummary')
const {excludeSuperAdminProfiles,isSuperAdminProfile}=require('./attendanceLeaveEligibility')
const KEYS=['attendance_approve_corrections','attendance_approve_leave','attendance_view_all','attendance_manage_holidays','attendance_manage_leave_balances','attendance_receive_correction_notifications','attendance_receive_leave_notifications']
const clean=v=>String(v||'').trim()
let openClockInsExpiredBefore=''
let openClockInExpiryPromise=null
async function expireOpenClockIns(beforeDate=localDate()){
 if(openClockInsExpiredBefore>=beforeDate)return
 if(openClockInExpiryPromise){await openClockInExpiryPromise;return expireOpenClockIns(beforeDate)}
 openClockInExpiryPromise=(async()=>{
  const {error}=await supabase.from('attendance_records').update({status:'not_marked',updated_at:new Date().toISOString()}).eq('status','clocked_in').is('clock_out_at',null).lt('attendance_date',beforeDate)
  if(error)throw error
  openClockInsExpiredBefore=beforeDate
 })()
 try{await openClockInExpiryPromise}finally{openClockInExpiryPromise=null}
}
async function admin(user){const {data,error}=await supabase.from('admin_users').select('*').or(`user_id.eq.${user.id},email.ilike.${user.email}`).maybeSingle();if(error)throw error;return data}
async function permissions(){const {data,error}=await supabase.from('attendance_permissions').select('*');if(error)throw error;return Object.fromEntries(KEYS.map(k=>[k,data?.find(x=>x.permission_key===k)?.access_level||'admins']))}
async function allowed(user,key){const a=await admin(user);if(!a)return false;const p=await permissions();return a.role==='super_admin'||a.is_super_admin||p[key]==='admins'}
async function requirePermission(user,key){if(!await allowed(user,key))throw bad('You do not have permission to perform this action.',403)}
async function profileName(userId,fallback='Team member'){const {data}=await supabase.from('user_profiles').select('name,email').eq('user_id',userId).maybeSingle();return clean(data?.name)||clean(data?.email).split('@')[0]||fallback}
async function notify(row){let {error}=await supabase.from('notifications').insert(row);if(error&&(error.code==='PGRST204'||error.code==='42703')){const legacy={...row};delete legacy.entity_type;delete legacy.entity_id;delete legacy.action_url;delete legacy.idempotency_key;({error}=await supabase.from('notifications').insert(legacy))}if(error&&error.code!=='23505')throw error}
async function notifyReviewers(key,entity,message,url,sender){const p=await permissions(),{data:admins}=await supabase.from('admin_users').select('*');const authUsers=await supabase.auth.admin.listUsers({page:1,perPage:1000});if(authUsers.error)throw authUsers.error;const idsByEmail=new Map((authUsers.data.users||[]).map(user=>[String(user.email||'').toLowerCase(),user.id]));const recipients=new Set();for(const a of admins||[]){const recipientId=a.user_id||idsByEmail.get(String(a.email||'').toLowerCase());if(!recipientId||recipients.has(recipientId)||((p[key]==='super_admins')&&!(a.role==='super_admin'||a.is_super_admin)))continue;recipients.add(recipientId);await notify({recipient_user_id:recipientId,sender_user_id:sender,role_type:'system',title:'Attendance approval required',message,status:'pending',action_type:'attendance_request',entity_type:entity.type,entity_id:entity.id,action_url:url,idempotency_key:`${entity.type}-submitted:${entity.id}:${recipientId}`})}}
async function ledgerTotal(userId,financialYear){const {data,error}=await supabase.from('leave_ledger').select('amount').eq('user_id',userId).eq('financial_year',financialYear);if(error)throw error;return (data||[]).reduce((n,x)=>n+Number(x.amount),0)}
async function leaveEligibilityAdmins(){const {data,error}=await supabase.from('admin_users').select('user_id,email,role,is_super_admin');if(error)throw error;return data||[]}
async function ensureFinancialYearLedger(userId,financialYear,asOfDate=localDate(),eligibilityAdmins=null){
 const authUser=await supabase.auth.admin.getUserById(userId);if(authUser.error)throw authUser.error
 const admins=eligibilityAdmins||await leaveEligibilityAdmins()
 if(isSuperAdminProfile({user_id:userId,email:authUser.data.user.email},admins))return
 const joined=localDate(authUser.data.user.created_at),joinFinancialYear=getFinancialYearForDate(joined),range=getFinancialYearRange(financialYear)
 if(range.end<joined)return
 if(localDate(asOfDate)<range.start)return
 if(range.start>getFinancialYearRange(joinFinancialYear).start){
  const previous=previousFinancialYear(financialYear),previousRange=getFinancialYearRange(previous)
  await ensureFinancialYearLedger(userId,previous,addDays(previousRange.end,1),admins)
  const carry=calculateCarryForward(await ledgerTotal(userId,previous))
  const {error}=await supabase.from('leave_ledger').insert({user_id:userId,entry_date:range.start,entry_type:'opening_balance',amount:carry,financial_year:financialYear,description:`Carry-forward from ${previous} (maximum 5 days)`})
  if(error&&error.code!=='23505')throw error
 }
 const joinMonth=`${joined.slice(0,7)}-01`,eligibleCursor=new Date(`${joinMonth}T12:00:00Z`);eligibleCursor.setUTCMonth(eligibleCursor.getUTCMonth()+1);const eligibleMonth=eligibleCursor.toISOString().slice(0,10)
 const effectiveAsOf=localDate(asOfDate),cutoff=effectiveAsOf>range.end?addDays(range.end,1):effectiveAsOf.slice(0,8)+'01'
 for(const month of getFinancialYearMonths(financialYear)){
  if(month>=cutoff||month<eligibleMonth)continue
  const entryDate=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)
  const {error}=await supabase.from('leave_ledger').insert({user_id:userId,entry_date:entryDate,entry_type:'accrual',amount:1.5,accrual_month:month,financial_year:financialYear,description:`Monthly leave accrual for ${month.slice(0,7)}`})
  if(error&&error.code!=='23505')throw error
 }
}
async function leaveBalanceSummary(userId,financialYear=getFinancialYearForDate(localDate()),asOfDate=localDate(),eligibilityAdmins=null){
 await ensureFinancialYearLedger(userId,financialYear,asOfDate,eligibilityAdmins)
 const range=getFinancialYearRange(financialYear),[{data:ledger,error:ledgerError},{data:pending,error:pendingError},holidayRows]=await Promise.all([
  supabase.from('leave_ledger').select('entry_type,amount').eq('user_id',userId).eq('financial_year',financialYear),
  supabase.from('leave_requests').select('start_date,end_date,duration_type,half_day_session,charged_leave_days,status').eq('user_id',userId).in('status',['pending','approved']).lte('start_date',range.end).gte('end_date',range.start),
  holidays(range.start,range.end)
 ])
 if(ledgerError)throw ledgerError;if(pendingError)throw pendingError
 const amount=type=>(ledger||[]).filter(x=>x.entry_type===type).reduce((n,x)=>n+Number(x.amount),0),opening=amount('opening_balance'),accrued=amount('accrual'),holidayDates=(holidayRows||[]).map(h=>h.holiday_date)
 const approvedRows=(pending||[]).filter(x=>x.status==='approved'),approvedCharges=new Map()
 approvedRows.forEach(row=>{
  const calc=calculateLeave({startDate:row.start_date,endDate:row.end_date,durationType:row.duration_type,halfDaySession:row.half_day_session,holidays:holidayDates,balance:0})
  calc.calculation_breakdown.filter(item=>item.charged>0&&item.date>=range.start&&item.date<=range.end).forEach(item=>approvedCharges.set(item.date,Math.max(approvedCharges.get(item.date)||0,item.charged)))
 })
 for(let date=range.start;date<=range.end;date=addDays(date,1))if(weekday(date)===0&&!approvedCharges.has(date)&&approvedCharges.has(addDays(date,-1))&&approvedCharges.has(addDays(date,1)))approvedCharges.set(date,1)
 const used=[...approvedCharges.values()].reduce((n,x)=>n+x,0),adjustments=amount('adjustment')+amount('reversal'),available=opening+accrued-used+adjustments
 const pendingRows=(pending||[]).filter(row=>row.status==='pending'),pendingCharges=new Map(),pendingDates=new Set(),approvedDirectDates=new Set()
 approvedRows.forEach(row=>{const calc=calculateLeave({startDate:row.start_date,endDate:row.end_date,durationType:row.duration_type,halfDaySession:row.half_day_session,holidays:holidayDates,balance:0});calc.calculation_breakdown.filter(item=>item.charged>0&&item.date>=range.start&&item.date<=range.end).forEach(item=>approvedDirectDates.add(item.date))})
 pendingRows.forEach(row=>{const calc=calculateLeave({startDate:row.start_date,endDate:row.end_date,durationType:row.duration_type,halfDaySession:row.half_day_session,holidays:holidayDates,balance:available});calc.calculation_breakdown.filter(item=>item.charged>0&&item.date>=range.start&&item.date<=range.end).forEach(item=>{pendingDates.add(item.date);pendingCharges.set(item.date,Math.max(pendingCharges.get(item.date)||0,item.charged))})})
 const contextDates=new Set([...approvedDirectDates,...pendingDates]);for(let date=range.start;date<=range.end;date=addDays(date,1))if(weekday(date)===0&&!pendingCharges.has(date)&&(pendingDates.has(addDays(date,-1))||pendingDates.has(addDays(date,1)))&&contextDates.has(addDays(date,-1))&&contextDates.has(addDays(date,1)))pendingCharges.set(date,1)
 const pendingDays=[...pendingCharges.values()].reduce((n,x)=>n+x,0),projected=available-pendingDays
 return {financial_year:financialYear,annual_entitlement:calculateLeaveEntitlement(),opening_carry_forward:opening,accrued_leave:accrued,used_leave:used,pending_leave:pendingDays,available_balance:available,projected_balance:projected,loss_of_pay_exposure:Math.max(0,-projected)}
}
async function balance(userId,financialYear,asOfDate){return (await leaveBalanceSummary(userId,financialYear,asOfDate)).available_balance}
async function listLeaveBalances(user,financialYear){await requirePermission(user,'attendance_manage_leave_balances');const [profilesResult,admins]=await Promise.all([supabase.from('user_profiles').select('user_id,name,email').order('name'),leaveEligibilityAdmins()]);if(profilesResult.error)throw profilesResult.error;const profiles=excludeSuperAdminProfiles(profilesResult.data||[],admins);return Promise.all(profiles.map(async profile=>({user:profile,balance:await leaveBalanceSummary(profile.user_id,financialYear,localDate(),admins)})))}
async function adjustLeaveBalance(user,targetUserId,amount,description,financialYear){await requirePermission(user,'attendance_manage_leave_balances');const numeric=Number(amount);if(!Number.isFinite(numeric)||numeric===0)throw bad('Enter a non-zero balance adjustment.');const fy=financialYear||getFinancialYearForDate(localDate()),{data,error}=await supabase.from('leave_ledger').insert({user_id:targetUserId,entry_date:localDate(),entry_type:'adjustment',amount:numeric,financial_year:fy,description:clean(description)||'Manual leave balance adjustment',created_by:user.id}).select().single();if(error)throw error;return {entry:data,balance:await leaveBalanceSummary(targetUserId,fy)}}
async function holidays(start,end,active=true){let q=supabase.from('company_holidays').select('*').gte('holiday_date',start).lte('holiday_date',end);if(active)q=q.eq('is_active',true);const {data,error}=await q.order('holiday_date');if(error)throw error;return data||[]}
async function today(user){const date=localDate();await expireOpenClockIns(date);const {data,error}=await supabase.from('attendance_records').select('*').eq('user_id',user.id).eq('attendance_date',date).maybeSingle();if(error)throw error;return data}
async function clockIn(user){const date=localDate();if(weekday(date)===0)throw bad('Attendance is disabled on weekly off.');if((await holidays(date,date)).length)throw bad('Attendance is disabled on a company holiday.');const {data:leave}=await supabase.from('leave_requests').select('id').eq('user_id',user.id).eq('status','approved').lte('start_date',date).gte('end_date',date).maybeSingle();if(leave)throw bad('Attendance is disabled during approved leave.');const {data,error}=await supabase.from('attendance_records').upsert({user_id:user.id,attendance_date:date,clock_in_at:new Date().toISOString(),status:'clocked_in',source:'clock',created_by:user.id,updated_by:user.id},{onConflict:'user_id,attendance_date',ignoreDuplicates:true}).select().maybeSingle();if(error)throw error;if(!data)throw bad('You have already clocked in today.',409);return data}
async function clockOut(user){const row=await today(user);if(!row?.clock_in_at)throw bad('Clock in before clocking out.');if(row.clock_out_at)throw bad('You have already clocked out today.',409);const at=new Date().toISOString(),{data,error}=await supabase.from('attendance_records').update({clock_out_at:at,worked_minutes:workedMinutes(row.clock_in_at,at),status:'present',updated_at:at,updated_by:user.id}).eq('id',row.id).is('clock_out_at',null).select().maybeSingle();if(error)throw error;if(!data)throw bad('You have already clocked out today.',409);return data}
async function periodSummary(user,userId,start,end){
 if(userId&&userId!==user.id)await requirePermission(user,'attendance_view_all')
 await expireOpenClockIns()
 const uid=userId||user.id
 const [records,hs,leaves,corrections]=await Promise.all([
  supabase.from('attendance_records').select('*').eq('user_id',uid).gte('attendance_date',start).lte('attendance_date',end),
  holidays(start,end),
  supabase.from('leave_requests').select('*').eq('user_id',uid).in('status',['pending','approved','rejected']).lte('start_date',end).gte('end_date',start),
  supabase.from('attendance_correction_requests').select('*').eq('user_id',uid).gte('attendance_date',start).lte('attendance_date',end)
 ])
 for(const x of [records,leaves,corrections])if(x.error)throw x.error
 return buildAttendancePeriodSummary({start,end,records:records.data||[],holidayRows:hs||[],leaveRequests:leaves.data||[],correctionRequests:corrections.data||[]})
}
async function monthly(user,userId,year,month){
 const start=`${year}-${String(month).padStart(2,'0')}-01`,end=new Date(Date.UTC(+year,+month,0)).toISOString().slice(0,10)
 return periodSummary(user,userId,start,end)
}
async function team(user,year,month,financialYear){
 await requirePermission(user,'attendance_view_all')
 const date=localDate()
 await expireOpenClockIns(date)
 const [profilesResult,statusesResult,adminsResult]=await Promise.all([
  supabase.from('user_profiles').select('user_id,name,email').not('name','is',null).order('name'),
  supabase.from('employee_statuses').select('user_id,status'),
  supabase.from('admin_users').select('user_id,email,role,is_super_admin')
 ])
 for(const result of [profilesResult,statusesResult,adminsResult])if(result.error)throw result.error
 const profiles=buildActiveProfiles(profilesResult.data,statusesResult.data,adminsResult.data)
 if(!profiles.length)return {rows:[],today:{date,present:[],leave:[],unmarked:[]}}
 const userIds=profiles.map(profile=>profile.user_id)
 const [attendanceResult,leaveResult,correctionResult,holidayRows,rows]=await Promise.all([
  supabase.from('attendance_records').select('user_id,status,clock_in_at,clock_out_at,updated_at').eq('attendance_date',date).in('user_id',userIds),
  supabase.from('leave_requests').select('user_id,duration_type,start_date,end_date,status,reviewed_at').eq('status','approved').lte('start_date',date).gte('end_date',date).in('user_id',userIds),
  supabase.from('attendance_correction_requests').select('user_id,existing_clock_in_at,existing_clock_out_at,status').eq('status','pending').eq('attendance_date',date).in('user_id',userIds),
  holidays(date,date),
  Promise.all(profiles.map(async profile=>{const [monthData,leaveBalance]=await Promise.all([monthly(user,profile.user_id,year,month),leaveBalanceSummary(profile.user_id,financialYear)]);return {user:profile,summary:monthData.kpis,leave_balance:leaveBalance}}))
 ])
 for(const result of [attendanceResult,leaveResult,correctionResult])if(result.error)throw result.error
 return {
  rows,
  today:buildTodayAttendanceSummary({date,profiles,attendanceRecords:attendanceResult.data||[],approvedLeaves:leaveResult.data||[],pendingCorrections:correctionResult.data||[],holidays:holidayRows})
 }
}
async function previewLeave(user,input){const financialYear=getFinancialYearForDate(input.start_date),hs=await holidays(input.start_date,input.end_date),summary=await leaveBalanceSummary(user.id,financialYear,localDate()),nearby=await supabase.from('leave_requests').select('start_date,end_date').eq('user_id',user.id).in('status',['pending','approved']).lte('start_date',addDays(input.end_date,1)).gte('end_date',addDays(input.start_date,-1)),existingDates=[];for(const request of nearby.data||[]){for(let date=request.start_date;date<=request.end_date;date=addDays(date,1))existingDates.push(date)}const requestedDates=[];for(let date=input.start_date;date<=input.end_date;date=addDays(date,1))requestedDates.push(date);const calc=applySandwichContext(calculateLeave({startDate:input.start_date,endDate:input.end_date,durationType:input.duration_type,halfDaySession:input.half_day_session,holidays:hs.map(x=>x.holiday_date),balance:summary.available_balance}),[...existingDates,...requestedDates]);return {...calc,...summary,projected_balance:summary.available_balance-calc.charged_leave_days,loss_of_pay_days:Math.max(0,calc.charged_leave_days-Math.max(summary.available_balance,0))}}
async function createLeave(user,input){if(!clean(input.reason))throw bad('Reason is required.');const calc=await previewLeave(user,input),row={user_id:user.id,start_date:input.start_date,end_date:input.end_date,duration_type:input.duration_type,half_day_session:input.duration_type==='half_day'?input.half_day_session:null,reason:clean(input.reason),charged_leave_days:calc.charged_leave_days,paid_leave_days:calc.paid_leave_days,loss_of_pay_days:calc.loss_of_pay_days,balance_before:calc.balance_before,projected_balance:calc.projected_balance,calculation_breakdown:calc.calculation_breakdown};const {data,error}=await supabase.from('leave_requests').insert(row).select().single();if(error?.code==='23P01')throw bad('This request overlaps an existing pending or approved leave.',409);if(error)throw error;await notifyReviewers('attendance_receive_leave_notifications',{type:'leave',id:data.id},`Leave request from ${await profileName(user.id,user.email)} for ${data.start_date} to ${data.end_date} requires review.`,`/attendance?tab=approval&type=leave&request=${data.id}`,user.id);return data}
async function createCorrection(user,input){const date=input.attendance_date;if(!date||date>localDate()||weekday(date)===0||(await holidays(date,date)).length)throw bad('Corrections are unavailable for this date.');if(!clean(input.reason))throw bad('Reason is required.');if(localDate(input.requested_clock_in_at)!==date||localDate(input.requested_clock_out_at)!==date)throw bad('Requested times must match the attendance date.');const mins=workedMinutes(input.requested_clock_in_at,input.requested_clock_out_at),existing=await supabase.from('attendance_records').select('*').eq('user_id',user.id).eq('attendance_date',date).maybeSingle();const {data,error}=await supabase.from('attendance_correction_requests').insert({user_id:user.id,attendance_date:date,existing_clock_in_at:existing.data?.clock_in_at,existing_clock_out_at:existing.data?.clock_out_at,requested_clock_in_at:input.requested_clock_in_at,requested_clock_out_at:input.requested_clock_out_at,requested_worked_minutes:mins,reason:clean(input.reason)}).select().single();if(error?.code==='23505')throw bad('A pending correction already exists for this date.',409);if(error)throw error;await supabase.from('attendance_records').upsert({user_id:user.id,attendance_date:date,status:'correction_pending',source:'correction',correction_request_id:data.id,updated_by:user.id},{onConflict:'user_id,attendance_date'});await notifyReviewers('attendance_receive_correction_notifications',{type:'correction',id:data.id},`Attendance correction request from ${await profileName(user.id,user.email)} for ${date} requires review.`,`/attendance?tab=approval&type=correction&request=${data.id}`,user.id);return data}
async function decorateRequests(rows){
 const ids=[...new Set((rows||[]).flatMap(row=>[row.user_id,row.reviewed_by].filter(Boolean)))]
 if(!ids.length)return rows||[]
 const {data,error}=await supabase.from('user_profiles').select('user_id,name').in('user_id',ids)
 if(error)throw error
 const names=new Map((data||[]).map(profile=>[profile.user_id,clean(profile.name)]))
 return (rows||[]).map(row=>({...row,employee_name:names.get(row.user_id)||null,reviewed_by_name:names.get(row.reviewed_by)||null}))
}
async function listRequests(user,type,approval=false){
 if(approval)await requirePermission(user,type==='correction'?'attendance_approve_corrections':'attendance_approve_leave')
 const table=type==='correction'?'attendance_correction_requests':'leave_requests';let q=supabase.from(table).select('*').order('created_at',{ascending:false})
 if(approval)q=q.eq('status','pending').neq('user_id',user.id);else q=q.eq('user_id',user.id)
 const {data,error}=await q;if(error)throw error;return decorateRequests(data||[])
}
async function cancel(user,type,id){const table=type==='correction'?'attendance_correction_requests':'leave_requests',{data,error}=await supabase.from(table).update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).eq('status','pending').select().maybeSingle();if(error)throw error;if(!data)throw bad('Only a pending request can be cancelled.',409);return data}
async function review(user,type,id,decision,note){const key=type==='correction'?'attendance_approve_corrections':'attendance_approve_leave';await requirePermission(user,key);if(decision==='rejected'&&!clean(note))throw bad('A rejection reason is required.');const table=type==='correction'?'attendance_correction_requests':'leave_requests',current=await supabase.from(table).select('*').eq('id',id).eq('status','pending').maybeSingle();if(current.error)throw current.error;if(!current.data)throw bad('This request has already been reviewed.',409);const update={status:decision,reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_note:clean(note)||null,updated_at:new Date().toISOString()},{data,error}=await supabase.from(table).update(update).eq('id',id).eq('status','pending').select().maybeSingle();if(error)throw error;if(!data)throw bad('This request has already been reviewed.',409);if(decision==='approved'&&type==='correction')await supabase.from('attendance_records').upsert({user_id:data.user_id,attendance_date:data.attendance_date,clock_in_at:data.requested_clock_in_at,clock_out_at:data.requested_clock_out_at,worked_minutes:workedMinutes(data.requested_clock_in_at,data.requested_clock_out_at),status:'corrected',source:'correction',correction_request_id:data.id,updated_by:user.id},{onConflict:'user_id,attendance_date'});if(type==='leave'&&decision==='approved'){const calc=await previewLeave({id:data.user_id},data),snapshot={charged_leave_days:calc.charged_leave_days,paid_leave_days:calc.paid_leave_days,loss_of_pay_days:calc.loss_of_pay_days,balance_before:calc.balance_before,projected_balance:calc.projected_balance,calculation_breakdown:calc.calculation_breakdown};await supabase.from('leave_requests').update(snapshot).eq('id',id);await supabase.from('leave_ledger').insert({user_id:data.user_id,entry_date:data.start_date,entry_type:'leave_used',amount:-calc.charged_leave_days,leave_request_id:id,financial_year:calc.financial_year,description:'Approved leave',created_by:user.id});for(const d of calc.calculation_breakdown.filter(x=>x.charged>0))await supabase.from('attendance_records').upsert({user_id:data.user_id,attendance_date:d.date,status:data.duration_type==='half_day'?'half_day_leave':'on_leave',source:'leave',leave_request_id:id,updated_by:user.id},{onConflict:'user_id,attendance_date'})}if(type==='correction'&&decision==='rejected')await supabase.from('attendance_records').update({status:'not_marked',correction_request_id:null}).eq('correction_request_id',id);await notify({recipient_user_id:data.user_id,sender_user_id:user.id,role_type:'system',title:'Attendance request updated',message:`Your ${type==='correction'?'attendance correction':'leave'} request has been ${decision}.`,status:'pending',action_type:'attendance_result',entity_type:type,entity_id:id,action_url:`/attendance?tab=requests&type=${type}&request=${id}`,idempotency_key:`${type}-${decision}:${id}:${data.user_id}`});return data}
async function updatePermissions(user,values){const a=await admin(user);if(!(a?.role==='super_admin'||a?.is_super_admin))throw bad('Super Admin required.',403);for(const [key,value] of Object.entries(values||{})){if(!KEYS.includes(key)||!['admins','super_admins'].includes(value))throw bad('Invalid attendance permission.');const {error}=await supabase.from('attendance_permissions').upsert({permission_key:key,access_level:value,updated_by:user.id,updated_at:new Date().toISOString()});if(error)throw error}return permissions()}
module.exports={permissions,updatePermissions,today,clockIn,clockOut,monthly,periodSummary,team,previewLeave,createLeave,createCorrection,listRequests,cancel,review,balance,leaveBalanceSummary,listLeaveBalances,adjustLeaveBalance,holidays,requirePermission,expireOpenClockIns}
