const dashboardNow = new Date()

export const DASHBOARD_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']

export function dashboardFinancialYearForDate(date) {
  const year = date.getFullYear()
  const start = date.getMonth() >= 3 ? year : year - 1
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function financialYearLabel(start) {
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

const currentFinancialYearStart = Number(dashboardFinancialYearForDate(dashboardNow).slice(3, 7))

export const DASHBOARD_FINANCIAL_YEARS = [-1, 0, 1].map(offset => financialYearLabel(currentFinancialYearStart + offset))

export function dashboardFinancialYearMonths(financialYear) {
  const start = Number(String(financialYear).slice(3, 7))
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(start, 3 + index, 1)
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      value,
      label: date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    }
  })
}

export const dashboardMonthPeriod = month => `Month ${month}`
export const dashboardQuarterPeriod = (financialYear, quarter) => `${financialYear} ${quarter}`

function dashboardDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dashboardPeriodDateRange(period, currentDate = new Date()) {
  const today = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
  const capEnd = date => date < today ? date : today
  const financialYear = String(period).match(/^FY (\d{4})-\d{2}$/)
  if (financialYear) {
    const startYear = Number(financialYear[1])
    return {
      startDate: dashboardDateValue(new Date(startYear, 3, 1)),
      endDate: dashboardDateValue(capEnd(new Date(startYear + 1, 2, 31)))
    }
  }
  const quarter = String(period).match(/^FY (\d{4})-\d{2} Q([1-4])$/)
  if (quarter) {
    const startMonth = 3 + ((Number(quarter[2]) - 1) * 3)
    const startYear = Number(quarter[1])
    return {
      startDate: dashboardDateValue(new Date(startYear, startMonth, 1)),
      endDate: dashboardDateValue(capEnd(new Date(startYear, startMonth + 3, 0)))
    }
  }
  const month = String(period).match(/^Month (\d{4})-(0[1-9]|1[0-2])$/)
  if (month) {
    const year = Number(month[1])
    const monthIndex = Number(month[2]) - 1
    return {
      startDate: dashboardDateValue(new Date(year, monthIndex, 1)),
      endDate: dashboardDateValue(capEnd(new Date(year, monthIndex + 1, 0)))
    }
  }
  return null
}

export function dashboardPeriodLabel(period) {
  const month = String(period).match(/^Month (\d{4})-(0[1-9]|1[0-2])$/)
  if (month) {
    return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }
  const quarter = String(period).match(/^(FY \d{4}-\d{2}) (Q[1-4])$/)
  return quarter ? `${quarter[2]} · ${quarter[1]}` : period
}

export const DEFAULT_DASHBOARD_MONTH = `${dashboardNow.getFullYear()}-${String(dashboardNow.getMonth() + 1).padStart(2, '0')}`
export const DEFAULT_DASHBOARD_PERIOD = dashboardFinancialYearForDate(dashboardNow)
