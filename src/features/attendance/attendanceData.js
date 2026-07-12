export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const HOLIDAY_TYPES = ['National Holiday', 'Company Holiday', 'Optional Holiday']
export const PERMISSION_ITEMS = [
  ['attendance_approve_corrections','Approve Attendance Corrections','Review and approve attendance correction requests.'],
  ['attendance_approve_leave','Approve Leave Requests','Approve or reject leave applications.'],
  ['attendance_view_all','View All Employees’ Attendance','Access monthly attendance for the whole team.'],
  ['attendance_manage_holidays','Manage Holiday Calendar','Add, edit and remove company holidays.'],
  ['attendance_manage_leave_balances','Manage Leave Balances','Adjust individual employee leave balances.'],
  ['attendance_receive_correction_notifications','Receive Attendance Correction Notifications','Receive new correction approval notifications.'],
  ['attendance_receive_leave_notifications','Receive Leave Approval Notifications','Receive new leave approval notifications.']
]

export function iso(date) { return date.toLocaleDateString('en-CA') }
export function dateLabel(value) { return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }
export function initials(name) { return name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase() }
export function minutesBetween(a,b) { if(!a||!b) return 0; const [ah,am]=a.split(':').map(Number); const [bh,bm]=b.split(':').map(Number); return Math.max(0,bh*60+bm-ah*60-am) }
export function durationLabel(minutes) { return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m` }
