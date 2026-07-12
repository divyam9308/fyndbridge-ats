export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const HOLIDAY_TYPES = ['National Holiday', 'Company Holiday', 'Optional Holiday']
export const PERMISSION_ITEMS = [
  ['attendance_approve_corrections','Approve Attendance Corrections','Review and approve attendance correction requests.'],
  ['attendance_approve_leave','Approve Leave Requests','Approve or reject leave applications.'],
  ['attendance_view_all','View All Employees’ Attendance','Access monthly attendance for the whole team.'],
  ['attendance_manage_holidays','Manage Holiday Calendar','Add, edit and remove company holidays.'],
  ['attendance_receive_correction_notifications','Receive Attendance Correction Notifications','Receive new correction approval notifications.'],
  ['attendance_receive_leave_notifications','Receive Leave Approval Notifications','Receive new leave approval notifications.']
]

export const employees = [
  { id:'me', name:'Aarav Mehta', role:'Senior Recruiter', working:22, present:17, leave:1.5, corrections:2, unmarked:2, hours:'142h 30m' },
  { id:'priya', name:'Priya Nair', role:'Talent Partner', working:22, present:19, leave:1, corrections:1, unmarked:1, hours:'154h 12m' },
  { id:'rohan', name:'Rohan Verma', role:'Recruiter', working:22, present:20, leave:0, corrections:0, unmarked:2, hours:'161h 22m' },
  { id:'sara', name:'Sara Kapoor', role:'Account Lead', working:22, present:18, leave:2, corrections:0, unmarked:2, hours:'149h 28m' }
]

export const initialHolidays = [
  { id:'h1', name:'Republic Day', date:'2026-01-26', type:'National Holiday', description:'National holiday' },
  { id:'h2', name:'Holi', date:'2026-03-04', type:'Company Holiday', description:'Festival holiday' },
  { id:'h3', name:'Independence Day', date:'2026-08-15', type:'National Holiday', description:'National holiday' },
  { id:'h4', name:'Diwali', date:'2026-11-09', type:'Company Holiday', description:'Festival holiday' }
]

export const initialCorrections = [
  { id:'c1', employee:'Priya Nair', submitted:'2026-07-06', date:'2026-07-03', clockIn:'09:42', clockOut:'18:18', duration:'8h 36m', reason:'Missed clock-out while travelling.', status:'Pending Review', reviewedBy:'—', reviewedOn:'—', note:'—' },
  { id:'c2', employee:'Aarav Mehta', submitted:'2026-06-18', date:'2026-06-17', clockIn:'09:31', clockOut:'18:25', duration:'8h 54m', reason:'Biometric device was unavailable.', status:'Approved', reviewedBy:'Divya Sharma', reviewedOn:'19 Jun 2026', note:'Verified with manager.' },
  { id:'c3', employee:'Aarav Mehta', submitted:'2026-05-12', date:'2026-05-09', clockIn:'10:15', clockOut:'17:00', duration:'6h 45m', reason:'Forgot to mark attendance.', status:'Rejected', reviewedBy:'Divya Sharma', reviewedOn:'13 May 2026', note:'Times could not be verified.' }
]

export const initialLeaves = [
  { id:'l1', employee:'Rohan Verma', submitted:'2026-07-07', start:'2026-07-20', end:'2026-07-21', type:'Full Day', charged:2, balance:1.5, projected:-0.5, lop:0.5, reason:'Family commitment.', status:'Pending Review', reviewedBy:'—', reviewedOn:'—', note:'—' },
  { id:'l2', employee:'Aarav Mehta', submitted:'2026-06-10', start:'2026-06-12', end:'2026-06-12', type:'Half Day · Second Half', charged:0.5, balance:4.5, projected:4, lop:0, reason:'Medical appointment.', status:'Approved', reviewedBy:'Divya Sharma', reviewedOn:'10 Jun 2026', note:'Approved.' },
  { id:'l3', employee:'Aarav Mehta', submitted:'2026-05-02', start:'2026-05-08', end:'2026-05-08', type:'Full Day', charged:1, balance:4, projected:3, lop:0, reason:'Personal work.', status:'Rejected', reviewedBy:'Divya Sharma', reviewedOn:'03 May 2026', note:'Team coverage unavailable.' }
]

export function iso(date) { return date.toLocaleDateString('en-CA') }
export function dateLabel(value) { return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }
export function initials(name) { return name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase() }
export function minutesBetween(a,b) { if(!a||!b) return 0; const [ah,am]=a.split(':').map(Number); const [bh,bm]=b.split(':').map(Number); return Math.max(0,bh*60+bm-ah*60-am) }
export function durationLabel(minutes) { return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m` }

export function calculateLeave(start,end,type,holidays=initialHolidays) {
  if(!start||!end||end<start) return { days:[], charged:0 }
  const days=[]; const cursor=new Date(`${start}T12:00:00`); const last=new Date(`${end}T12:00:00`)
  while(cursor<=last){ const key=iso(cursor); const sunday=cursor.getDay()===0; const holiday=holidays.some(h=>h.date===key); days.push({date:key, label:dateLabel(key), charged:(!sunday&&!holiday)?(type==='Half Day'?.5:1):0, reason:sunday?'Sunday':holiday?'Holiday':type}); cursor.setDate(cursor.getDate()+1) }
  if(days.length>=3){ days.forEach((d,i)=>{ if(d.reason==='Sunday'&&days[i-1]?.charged>0&&days[i+1]?.charged>0){d.charged=1;d.reason='Sandwich leave'} }) }
  return {days, charged:days.reduce((n,d)=>n+d.charged,0)}
}
