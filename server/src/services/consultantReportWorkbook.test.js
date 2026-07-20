const assert = require('node:assert/strict')
const test = require('node:test')
const ExcelJS = require('exceljs')
const { CANDIDATE_STATUSES } = require('./candidateStatuses')
const { buildConsultantReportWorkbook } = require('./consultantReportWorkbook')

function attendancePayload({ overall = false } = {}) {
  const metrics = [
    { key: 'workingDays', label: 'Working Days', value: 20, tone: 'blue' },
    { key: 'presentDays', label: 'Present Days', value: 16, tone: 'green' },
    { key: 'leaveDays', label: 'Leave Days', value: 2, tone: 'purple' },
    { key: 'halfDayLeave', label: 'Half-Day Leave', value: 1, tone: 'amber' },
    { key: 'unmarkedDays', label: 'Unmarked Days', value: 1, tone: 'red' },
    { key: 'correctedAttendance', label: 'Corrected Attendance', value: 2, tone: 'cyan' },
    { key: 'pendingCorrections', label: 'Pending Corrections', value: 1, tone: 'amber' },
    { key: 'workedTime', label: 'Total Worked Hours', value: '128h 30m', numericValue: 7710, tone: 'navy' },
    { key: 'leaveBalance', label: 'Leave Balance', value: '6.5 days', numericValue: 6.5, tone: 'teal' },
    { key: 'attendancePercentage', label: 'Attendance Percentage', value: '80%', numericValue: 80, tone: 'green' }
  ]
  const leaveBalance = {
    financialYear: '2026-27',
    annualEntitlement: 18,
    openingCarryForward: 2,
    accruedLeave: 9,
    usedLeave: 4.5,
    pendingLeave: 0.5,
    availableBalance: 6.5,
    projectedBalance: 11,
    lossOfPayExposure: 0
  }
  return {
    available: true,
    metrics,
    leaveBalance,
    consultants: overall ? [{
      consultant: { key: 'employee-1', name: 'Asha Rao' },
      metrics,
      leaveBalance
    }] : undefined
  }
}

function reportFixture({ overall = false } = {}) {
  const counts = Object.fromEntries(CANDIDATE_STATUSES.map((status, index) => [status, index + 1]))
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return {
    meta: {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      generatedAt: '2026-07-16T08:30:00.000Z',
      generatedBy: 'Super Admin',
      timezone: 'Asia/Kolkata'
    },
    consultant: overall
      ? { key: 'overall', name: 'Overall Consultants', isOverall: true }
      : { key: 'employee-1', name: 'Asha Rao', email: 'asha@example.com', employeeStatus: 'Active' },
    mandateSummary: { total: 6, p1: 2, p2: 1, p3: 1, completed: 1, scrapped: 1 },
    conversionSummary: [
      { key: 'clientSubmission', label: 'Mandate → First Client Submission', averageDays: 3.5, trackedMandates: 3, untrackedMandates: 1, tone: 'blue' },
      { key: 'interview', label: 'Mandate → First Interview', averageDays: 6, trackedMandates: 2, untrackedMandates: 2, tone: 'purple' },
      { key: 'offer', label: 'Mandate → First Offer', averageDays: 10, trackedMandates: 1, untrackedMandates: 3, tone: 'amber' },
      { key: 'hire', label: 'Mandate → First Hire', averageDays: 15, trackedMandates: 1, untrackedMandates: 3, tone: 'green' }
    ],
    candidateOverview: { total, counts },
    candidatePipeline: [
      { key: 'total', label: 'Total Candidates', count: total, percentage: 100 },
      { key: 'interested', label: 'Interested', count: counts.Interested, percentage: 12.5 },
      { key: 'clientSubmission', label: 'Client Submission', count: counts['Client Submission'], percentage: 15 },
      { key: 'interview', label: 'Interview', count: counts.Interview, percentage: 10 },
      { key: 'offered', label: 'Offered', count: counts.Offered, percentage: 5 },
      { key: 'hired', label: 'Hired', count: counts.Hired, percentage: 2.5 }
    ],
    exceptions: [
      { key: 'withoutCandidates', label: 'Mandates without candidates', value: 1, tone: 'neutral' },
      { key: 'withoutClientSubmission', label: 'Mandates with candidates but no Client Submission', value: 1, tone: 'blue' },
      { key: 'withoutInterview', label: 'Mandates with Client Submission but no Interview', value: 1, tone: 'purple' },
      { key: 'allRejected', label: 'Mandates where every candidate is rejected', value: 0, tone: 'red' },
      { key: 'ageing', label: 'P1, P2 or P3 mandates older than 45 days', value: 1, tone: 'amber' },
      { key: 'pendingStatusAssignment', label: 'Candidates Pending Status Assignment', value: 2, tone: 'orange' }
    ],
    positiveOutcomes: [
      { key: 'hiredCandidates', label: 'Hired Candidates', value: 2, tone: 'green' },
      { key: 'offeredCandidates', label: 'Offered Candidates', value: 3, tone: 'amber' },
      { key: 'completedMandates', label: 'Completed Mandates', value: 1, tone: 'blue' },
      { key: 'mandatesWithHire', label: 'Mandates with at least one Hire', value: 1, tone: 'teal' },
      { key: 'clientSubmissions', label: 'Total Client Submissions', value: 5, tone: 'cyan' },
      { key: 'interviews', label: 'Total Interviews', value: 4, tone: 'purple' }
    ],
    attendance: attendancePayload({ overall })
  }
}

function mandateFixture() {
  return {
    key: 'mandate-1',
    consultant: 'Asha Rao',
    teamLead: 'Vikram Sen',
    clientName: 'Private Client',
    role: 'Platform Engineer',
    budget: '₹30 LPA',
    status: 'Ongoing (P1)',
    sector: 'Technology',
    allocationDate: '2026-06-10',
    candidatesAssigned: 4,
    counts: Object.fromEntries(CANDIDATE_STATUSES.map((status, index) => [status, index === 0 ? 4 : 0])),
    firstClientSubmissionDays: 3,
    firstInterviewDays: 7,
    firstOfferDays: null,
    firstHireDays: null,
    durationLabel: '20 d (ongoing)',
    ageDays: 20,
    isAgeingWarning: false
  }
}

test('builds the aligned five-sheet individual consultant workbook with typed cells', async () => {
  const output = await buildConsultantReportWorkbook({ report: reportFixture(), mandates: [mandateFixture()] })
  assert.match(output.fileName, /^Fyndbridge_Consultant_Report_Asha_Rao_/)
  assert.equal(output.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(output.preview.sheets.length, 5)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(output.buffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    '00 Summary',
    '01 Mandates',
    '02 Conversion & Ageing',
    '03 Candidates & Pipeline',
    '04 Attendance & Outcomes'
  ])
  const summary = workbook.getWorksheet('00 Summary')
  assert.equal(summary.getCell('A1').value, 'Consultant-Wise Report')
  assert.equal(summary.getCell('J4').value, 'Report Period')
  assert.equal(summary.getCell('A11').value, 'Average Conversion Time')
  assert.equal(summary.getCell('E12').value, 'Tracked')
  assert.equal(summary.getCell('A23').value, 'Total Candidates')
  assert.equal(summary.getCell('H40').value, 'Available Leave Balance')
  assert.equal(summary.views[0].ySplit, 6)
  const mandates = workbook.getWorksheet('01 Mandates')
  assert.equal(mandates.getCell('A1').value, 'Mandates')
  assert.equal(mandates.getCell('J4').value, 'Candidate Status Split')
  assert.equal(mandates.getCell('D6').value, 'Platform Engineer')
  assert.ok(mandates.getCell('H6').value instanceof Date)
  assert.equal(mandates.getCell('H6').numFmt, 'dd-mmm-yyyy')
  assert.equal(mandates.getCell('J6').value, 4)
  assert.equal(mandates.views[0].xSplit, 2)
  assert.equal(mandates.views[0].showGridLines, false)
  assert.equal(workbook.getWorksheet('02 Conversion & Ageing').getCell('A4').value, 'Client Name')
  assert.equal(workbook.getWorksheet('03 Candidates & Pipeline').getCell('A6').value, 'Total Candidates')
  assert.equal(summary.getCell('H28').value, 'Candidates Pending Status Assignment')
  assert.equal(summary.getCell('M28').value, 2)
  assert.equal(workbook.getWorksheet('04 Attendance & Outcomes').getCell('A11').value, 'Candidates Pending Status Assignment')
  assert.equal(workbook.getWorksheet('04 Attendance & Outcomes').getCell('C11').value, 2)
  assert.equal(workbook.getWorksheet('04 Attendance & Outcomes').getCell('E16').value, 'Available Leave Balance')
})

test('keeps Overall Consultants aggregate-only and includes Team Attendance members', async () => {
  const output = await buildConsultantReportWorkbook({
    report: reportFixture({ overall: true }),
    mandates: [mandateFixture()]
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(output.buffer)

  for (const sheetName of ['01 Mandates', '02 Conversion & Ageing']) {
    const values = []
    workbook.getWorksheet(sheetName).eachRow((row) => row.eachCell((cell) => values.push(String(cell.value || ''))))
    assert.equal(values.includes('Private Client'), false)
    assert.equal(values.includes('Platform Engineer'), false)
  }
  const attendance = workbook.getWorksheet('04 Attendance & Outcomes')
  assert.equal(attendance.getCell('A30').value, 'Asha Rao')
  assert.equal(attendance.getCell('K30').value, 0.8)
  assert.equal(attendance.getCell('K30').numFmt, '0.0%;[Red]-0.0%;"—"')
  assert.match(output.preview.sheets[4].rows[27].cells[0].text, /TEAM ATTENDANCE MEMBERS ONLY/)
})
