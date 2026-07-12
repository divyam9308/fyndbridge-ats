const COMPANY_TIME_ZONE = process.env.COMPANY_TIME_ZONE || 'Asia/Kolkata'

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
function calculateCompletedMonthsInFinancialYear(financialYear,asOfDate,eligibleFrom=null){const {end}=getFinancialYearRange(financialYear),asOf=localDate(asOfDate),cutoff=asOf>end?addDays(end,1):asOf.slice(0,8)+'01';return getFinancialYearMonths(financialYear).filter(month=>month<cutoff&&(!eligibleFrom||month>=eligibleFrom)).length}
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

module.exports={COMPANY_TIME_ZONE,localDate,addDays,weekday,workedMinutes,calculateLeave,bad,getFinancialYearForDate,getFinancialYearRange,getFinancialYearMonths,previousFinancialYear,calculateCompletedMonthsInFinancialYear,calculateLeaveEntitlement,calculateCarryForward}
