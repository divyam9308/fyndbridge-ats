const COMPANY_TIME_ZONE = process.env.COMPANY_TIME_ZONE || 'Asia/Kolkata'
// July 2026 was credited manually; automatic accruals are front-loaded from August onward.
const FRONT_LOADED_LEAVE_ACCRUAL_START_MONTH = '2026-08-01'
const MANUALLY_CREDITED_LEAVE_ACCRUAL_MONTHS = new Set(['2026-07-01'])

function localDate(value = new Date(), timeZone = COMPANY_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
function parseDate(value) { const [y,m,d]=String(value).split('-').map(Number); return new Date(Date.UTC(y,m-1,d,12)) }
function addDays(value, amount) { const d=parseDate(value); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10) }
function weekday(value) { return parseDate(value).getUTCDay() }
function workedMinutes(start,end) { const n=Math.floor((new Date(end)-new Date(start))/60000); if(!Number.isFinite(n)||n<0) throw bad('Clock-out must be after clock-in.'); return n }
function bad(message,statusCode=400){ const e=new Error(message);e.statusCode=statusCode;return e }

function getFinancialYearForDate(value) {
  const date=localDate(value), year=Number(date.slice(0,4)), month=Number(date.slice(5,7)), start=month>=4?year:year-1
  return `FY ${start}-${String((start+1)%100).padStart(2,'0')}`
}
function financialYearStart(financialYear) {
  const match=String(financialYear).match(/^FY (\d{4})-\d{2}$/)
  if(!match) throw bad('Invalid financial year.')
  return Number(match[1])
}
function getFinancialYearRange(financialYear) { const year=financialYearStart(financialYear);return {start:`${year}-04-01`,end:`${year+1}-03-31`} }
function getFinancialYearMonths(financialYear) { const year=financialYearStart(financialYear),months=[];for(let i=0;i<12;i++){const d=new Date(Date.UTC(year,3+i,1));months.push(d.toISOString().slice(0,7)+'-01')}return months }
function previousFinancialYear(financialYear){const year=financialYearStart(financialYear)-1;return `FY ${year}-${String((year+1)%100).padStart(2,'0')}`}
function getLeaveAccrualSchedule(financialYear,asOfDate,eligibleFrom=null){
  const {end}=getFinancialYearRange(financialYear),asOf=localDate(asOfDate),currentMonth=asOf.slice(0,8)+'01',financialYearComplete=asOf>end
  return getFinancialYearMonths(financialYear).filter(month=>{
    if((eligibleFrom&&month<eligibleFrom)||MANUALLY_CREDITED_LEAVE_ACCRUAL_MONTHS.has(month))return false
    if(financialYearComplete)return true
    return month>=FRONT_LOADED_LEAVE_ACCRUAL_START_MONTH?month<=currentMonth:month<currentMonth
  }).map(month=>({
    month,
    entryDate:month>=FRONT_LOADED_LEAVE_ACCRUAL_START_MONTH
      ?month
      :new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)
  }))
}
function calculateLeaveEntitlement(){return 18}
function calculateCarryForward(closingBalance){return Math.min(Math.max(Number(closingBalance)||0,0),5)}

function calculateLeave({startDate,endDate,durationType,halfDaySession,holidays=[],balance=0}) {
  if(!startDate||!endDate||endDate<startDate) throw bad('Enter a valid leave date range.')
  if(durationType==='half_day' && (!halfDaySession||startDate!==endDate)) throw bad('Half-day leave must be for one date with a session.')
  const holidaySet=new Set(holidays), breakdown=[]
  for(let date=startDate;date<=endDate;date=addDays(date,1)){
    const sunday=weekday(date)===0, holiday=holidaySet.has(date)
    breakdown.push({date,charged:sunday||holiday?0:durationType==='half_day'?0.5:1,reason:sunday?'Sunday':holiday?'Holiday':durationType})
  }
  for(let i=1;i<breakdown.length-1;i++) if(breakdown[i].reason==='Sunday'&&breakdown[i-1].charged>0&&breakdown[i+1].charged>0){breakdown[i]={...breakdown[i],charged:1,reason:'Sandwich leave'}}
  const charged=breakdown.reduce((n,x)=>n+x.charged,0), paid=Math.min(Math.max(Number(balance),0),charged)
  return {charged_leave_days:charged,paid_leave_days:paid,loss_of_pay_days:charged-paid,balance_before:Number(balance),projected_balance:Number(balance)-charged,calculation_breakdown:breakdown}
}
function applySandwichContext(calculation,leaveDates=[]){const dates=new Set(leaveDates),breakdown=[...calculation.calculation_breakdown];const first=breakdown[0]?.date,last=breakdown[breakdown.length-1]?.date;if(!first||!last)return calculation;for(const sunday of [addDays(first,-1),addDays(last,1)]){if(weekday(sunday)!==0||!dates.has(addDays(sunday,-1))&&!dates.has(addDays(sunday,1)))continue;const existing=breakdown.find(x=>x.date===sunday);if(existing)existing.charged=1,existing.reason='Sandwich leave';else breakdown.push({date:sunday,charged:1,reason:'Sandwich leave'})}breakdown.sort((a,b)=>a.date.localeCompare(b.date));return {...calculation,charged_leave_days:breakdown.reduce((n,x)=>n+x.charged,0),paid_leave_days:Math.min(Math.max(Number(calculation.balance_before),0),breakdown.reduce((n,x)=>n+x.charged,0)),loss_of_pay_days:Math.max(0,breakdown.reduce((n,x)=>n+x.charged,0)-Math.max(Number(calculation.balance_before),0)),projected_balance:Number(calculation.balance_before)-breakdown.reduce((n,x)=>n+x.charged,0),calculation_breakdown:breakdown}}

module.exports={COMPANY_TIME_ZONE,localDate,addDays,weekday,workedMinutes,calculateLeave,applySandwichContext,bad,getFinancialYearForDate,getFinancialYearRange,getFinancialYearMonths,previousFinancialYear,getLeaveAccrualSchedule,calculateLeaveEntitlement,calculateCarryForward}
