const ExcelJS = require('exceljs')
const { CANDIDATE_STATUSES } = require('./candidateStatuses')

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_ROW_LIMIT = 80

const COLORS = Object.freeze({
  navy: '07196B',
  darkHeader: '102A78',
  blue: '347CC4',
  blueLight: 'EAF2FC',
  teal: '1E8982',
  tealLight: 'E8F5F3',
  green: '3D8D50',
  greenLight: 'EDF7EF',
  red: 'BE4552',
  redLight: 'FCECEF',
  amber: 'C28A16',
  amberLight: 'FFF5D9',
  purple: '6957B8',
  purpleLight: 'F0EDFA',
  background: 'F5F7FA',
  text: '18243A',
  muted: '5D6B82',
  border: 'D7DFEA',
  white: 'FFFFFF'
})

const STATUS_COLORS = Object.freeze({
  'Ongoing (P1)': { fill: 'E0F2FE', text: '075985' },
  'Delivered (P2)': { fill: 'EDE9FE', text: '5B21B6' },
  'Paused (P3)': { fill: COLORS.amberLight, text: COLORS.amber },
  Completed: { fill: COLORS.greenLight, text: COLORS.green },
  Scrapped: { fill: 'F0F1F4', text: COLORS.muted }
})

const TONE_COLORS = Object.freeze({
  navy: COLORS.navy,
  blue: COLORS.blue,
  cyan: '1689A5',
  teal: COLORS.teal,
  green: COLORS.green,
  red: COLORS.red,
  amber: COLORS.amber,
  orange: 'C96B2B',
  purple: COLORS.purple,
  indigo: '565DB3',
  neutral: '718096'
})

const TONE_LIGHT_COLORS = Object.freeze({
  navy: 'EDF0F8',
  blue: COLORS.blueLight,
  cyan: 'EBF7FA',
  teal: COLORS.tealLight,
  green: COLORS.greenLight,
  red: COLORS.redLight,
  amber: COLORS.amberLight,
  orange: 'FBF1EB',
  purple: COLORS.purpleLight,
  indigo: 'EFF0FA',
  neutral: 'F0F2F5'
})

const BORDER = Object.freeze({
  top: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
  left: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
  bottom: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
  right: { style: 'thin', color: { argb: `FF${COLORS.border}` } }
})

const NUMBER_FORMAT = '0;[Red]-0;"—"'
const DECIMAL_FORMAT = '0.0;[Red]-0.0;"—"'
const DAYS_FORMAT = '0.0 "days";[Red]-0.0 "days";"—"'
const LEAVE_DAYS_FORMAT = '0.## "days";[Red]-0.## "days";"—"'
const PERCENT_FORMAT = '0.0%;[Red]-0.0%;"—"'
const STAGE_DAYS_FORMAT = '0 "d";[Red]-0 "d";"—"'
const DATE_FORMAT = 'dd-mmm-yyyy'

function argb(value) {
  const color = String(value || '').replace('#', '').toUpperCase()
  return color.length === 8 ? color : `FF${color || COLORS.white}`
}

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } }
}

function font({ color = COLORS.text, size = 10, bold = false, italic = false } = {}) {
  return { name: 'Arial', family: 2, color: { argb: argb(color) }, size, bold, italic }
}

function alignment(horizontal = 'left', wrapText = true) {
  return { horizontal, vertical: 'middle', wrapText }
}

function applyStyle(cell, style = {}) {
  if (style.font) cell.font = style.font
  if (style.fill) cell.fill = style.fill
  if (style.border) cell.border = style.border
  if (style.alignment) cell.alignment = style.alignment
  if (style.numFmt) cell.numFmt = style.numFmt
}

function styleArea(worksheet, startRow, startColumn, endRow, endColumn, style) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      applyStyle(worksheet.getCell(row, column), style)
    }
  }
}

function mergeStyled(worksheet, startRow, startColumn, endRow, endColumn, value, style) {
  worksheet.mergeCells(startRow, startColumn, endRow, endColumn)
  worksheet._reportPreviewMerges ||= []
  worksheet._reportPreviewMerges.push({ startRow, startColumn, endRow, endColumn })
  styleArea(worksheet, startRow, startColumn, endRow, endColumn, style)
  worksheet.getCell(startRow, startColumn).value = value
  return worksheet.getCell(startRow, startColumn)
}

function setColumnWidths(worksheet, widths) {
  widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width })
}

function dateValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}

function formatDate(value) {
  const date = value instanceof Date ? value : dateValue(value)
  if (!date || Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(date).replace(/ /g, '-')
}

function formatReportPeriodDate(value) {
  return formatDate(value).replaceAll('-', ' ')
}

function formatGeneratedAt(value, timeZone = 'Asia/Kolkata') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone
  }).format(date).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase())
}

function safeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function finiteOrText(value, text = 'Not tracked') {
  const number = Number(value)
  return Number.isFinite(number) ? number : text
}

function excelFilePart(value) {
  const cleaned = String(value || 'Consultant')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned.slice(0, 70) || 'Consultant'
}

function workbookFileName(report) {
  const name = excelFilePart(report?.consultant?.name || 'Consultant')
  const start = String(report?.meta?.startDate || 'start')
  const end = String(report?.meta?.endDate || 'end')
  return `Fyndbridge_Consultant_Report_${name}_${start}_to_${end}.xlsx`
}

function reportScopeLine(report) {
  return `Consultant: ${report?.consultant?.name || 'Consultant'}    |    Report Period: ${formatReportPeriodDate(report?.meta?.startDate)} – ${formatReportPeriodDate(report?.meta?.endDate)}`
}

function reportMetaLine(report) {
  const generated = formatGeneratedAt(report?.meta?.generatedAt, report?.meta?.timezone)
  return `Generated on ${generated}    •    Generated by ${report?.meta?.generatedBy || 'Fyndbridge ATS'}`
}

function configureWorksheet(worksheet, {
  widths,
  frozenRows,
  frozenColumns = 0,
  zoomScale = 90,
  orientation = 'portrait',
  fitToHeight = 1,
  tabColor = COLORS.navy
}) {
  setColumnWidths(worksheet, widths)
  worksheet.properties.defaultRowHeight = 15
  worksheet.properties.tabColor = { argb: argb(tabColor) }
  worksheet.views = [{
    state: 'frozen',
    xSplit: frozenColumns,
    ySplit: frozenRows,
    topLeftCell: worksheet.getCell(frozenRows + 1, frozenColumns + 1).address,
    activeCell: worksheet.getCell(frozenRows + 1, frozenColumns + 1).address,
    showGridLines: false,
    zoomScale
  }]
  worksheet.pageSetup = {
    paperSize: 9,
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.5, footer: 0.5 }
  }
  worksheet.headerFooter = {
    oddFooter: '&CFyndbridge ATS&RPage &P of &N'
  }
}

function writeSheetTitle(worksheet, title, report, lastColumn) {
  worksheet.getRow(1).height = 35
  worksheet.getRow(2).height = 25
  mergeStyled(worksheet, 1, 1, 1, lastColumn, title, {
    font: font({ color: COLORS.white, size: 22, bold: true }),
    fill: fill(COLORS.navy),
    border: BORDER,
    alignment: alignment('left', false)
  })
  mergeStyled(worksheet, 2, 1, 2, lastColumn, reportScopeLine(report), {
    font: font({ color: COLORS.muted, size: 9, italic: true }),
    fill: fill(COLORS.background),
    border: BORDER,
    alignment: alignment('left', true)
  })
}

function writeSummaryTitle(worksheet, report, lastColumn) {
  worksheet.getRow(1).height = 36
  worksheet.getRow(2).height = 25
  mergeStyled(worksheet, 1, 1, 1, lastColumn, 'Consultant-Wise Report', {
    font: font({ color: COLORS.white, size: 22, bold: true }),
    fill: fill(COLORS.navy),
    border: BORDER,
    alignment: alignment('left', false)
  })
  mergeStyled(worksheet, 2, 1, 2, lastColumn, reportMetaLine(report), {
    font: font({ color: COLORS.muted, size: 10, italic: true }),
    fill: fill(COLORS.background),
    border: BORDER,
    alignment: alignment('left', false)
  })
}

function sectionStyle(color) {
  return {
    font: font({ color: COLORS.white, size: 12, bold: true }),
    fill: fill(color),
    border: BORDER,
    alignment: alignment('left', false)
  }
}

function writeSection(worksheet, row, startColumn, endColumn, title, color = COLORS.darkHeader) {
  worksheet.getRow(row).height = 27
  return mergeStyled(worksheet, row, startColumn, row, endColumn, title, sectionStyle(color))
}

function headerStyle(color = COLORS.blueLight) {
  return {
    font: font({ color: COLORS.navy, size: 9, bold: true }),
    fill: fill(color),
    border: BORDER,
    alignment: alignment('center', true)
  }
}

function tableHeaderStyle() {
  return {
    font: font({ color: COLORS.white, size: 9, bold: true }),
    fill: fill(COLORS.darkHeader),
    border: BORDER,
    alignment: alignment('center', true)
  }
}

function bodyStyle({ horizontal = 'left', fillColor = COLORS.white, bold = false, color = COLORS.text, numFmt } = {}) {
  return {
    font: font({ color, size: 10, bold }),
    fill: fill(fillColor),
    border: BORDER,
    alignment: alignment(horizontal, true),
    numFmt
  }
}

function writeHeaders(worksheet, row, startColumn, labels) {
  worksheet.getRow(row).height = 34
  labels.forEach((label, index) => {
    const cell = worksheet.getCell(row, startColumn + index)
    cell.value = label
    applyStyle(cell, tableHeaderStyle())
  })
}

function toneColor(tone) {
  return TONE_COLORS[tone] || COLORS.blue
}

function toneLightColor(tone) {
  return TONE_LIGHT_COLORS[tone] || COLORS.blueLight
}

function writeMetricCard(worksheet, labelRow, valueRow, startColumn, endColumn, label, value, tone = 'blue', options = {}) {
  mergeStyled(worksheet, labelRow, startColumn, labelRow, endColumn, label, {
    font: font({ color: toneColor(tone), size: 9, bold: true }),
    fill: fill(toneLightColor(tone)),
    border: BORDER,
    alignment: alignment('center', true)
  })
  const valueCell = mergeStyled(worksheet, valueRow, startColumn, valueRow, endColumn, value, {
    font: font({ color: toneColor(tone), size: options.compact ? 14 : 21, bold: true }),
    fill: fill(COLORS.white),
    border: BORDER,
    alignment: alignment('center', true),
    numFmt: options.numFmt
  })
  worksheet.getRow(labelRow).height = Math.max(23, worksheet.getRow(labelRow).height || 0)
  worksheet.getRow(valueRow).height = options.compact ? 28 : 39
  return valueCell
}

function writeLabelValueRow(worksheet, row, labelStart, labelEnd, valueStart, valueEnd, label, value, options = {}) {
  const fillColor = options.fillColor || (row % 2 ? COLORS.white : COLORS.background)
  mergeStyled(worksheet, row, labelStart, row, labelEnd, label, bodyStyle({ fillColor, bold: Boolean(options.bold) }))
  const cell = mergeStyled(worksheet, row, valueStart, row, valueEnd, value, bodyStyle({
    horizontal: options.horizontal || 'center',
    fillColor,
    bold: Boolean(options.valueBold),
    color: options.valueColor || COLORS.text,
    numFmt: options.numFmt
  }))
  worksheet.getRow(row).height = options.height || 28
  return cell
}

function summaryAttendanceMetric(item) {
  if (item?.key === 'workedTime') {
    const minutes = safeNumber(item.numericValue)
    return { value: typeof item.value === 'string' && item.value ? item.value : `${Math.floor(minutes / 60)}h ${minutes % 60}m` }
  }
  if (item?.key === 'attendancePercentage') {
    return { value: safeNumber(item.numericValue) / 100, numFmt: PERCENT_FORMAT }
  }
  if (item?.key === 'leaveBalance') {
    return { value: safeNumber(item.numericValue), numFmt: DAYS_FORMAT }
  }
  return typeof item?.value === 'number'
    ? { value: item.value, numFmt: Number.isInteger(item.value) ? NUMBER_FORMAT : DECIMAL_FORMAT }
    : { value: item?.value ?? '—' }
}

function buildSummarySheet(workbook, report) {
  const worksheet = workbook.addWorksheet('00 Summary')
  configureWorksheet(worksheet, {
    widths: [16, 7, 7, 15, 8, 10, 3, 16, 8, 12, 12, 12, 13],
    frozenRows: 6,
    zoomScale: 90,
    orientation: 'portrait',
    fitToHeight: 2,
    tabColor: COLORS.navy
  })
  writeSummaryTitle(worksheet, report, 13)

  const identity = [
    { columns: [1, 3], label: 'Consultant', value: report?.consultant?.name || '—' },
    { columns: [4, 6], label: 'Email', value: report?.consultant?.email || '—' },
    { columns: [7, 9], label: 'Employee Status', value: report?.consultant?.isOverall ? 'Combined View' : (report?.consultant?.employeeStatus || 'Active') },
    { columns: [10, 13], label: 'Report Period', value: `${formatReportPeriodDate(report?.meta?.startDate)} – ${formatReportPeriodDate(report?.meta?.endDate)}` }
  ]
  identity.forEach(({ columns, label, value }) => {
    mergeStyled(worksheet, 4, columns[0], 4, columns[1], label, headerStyle(COLORS.blueLight))
    mergeStyled(worksheet, 5, columns[0], 5, columns[1], value, bodyStyle({ horizontal: 'center', bold: true }))
  })
  worksheet.getRow(4).height = 24
  worksheet.getRow(5).height = 30

  writeSection(worksheet, 7, 1, 13, 'Mandate Summary', COLORS.navy)
  const mandateSummary = report?.mandateSummary || {}
  const mandateCards = [
    { columns: [1, 3], label: 'Total Mandates', value: safeNumber(mandateSummary.total), tone: 'navy' },
    { columns: [4, 5], label: 'Ongoing (P1)', value: safeNumber(mandateSummary.p1), tone: 'teal' },
    { columns: [6, 7], label: 'Delivered (P2)', value: safeNumber(mandateSummary.p2), tone: 'purple' },
    { columns: [8, 9], label: 'Paused (P3)', value: safeNumber(mandateSummary.p3), tone: 'amber' },
    { columns: [10, 11], label: 'Completed', value: safeNumber(mandateSummary.completed), tone: 'green' },
    { columns: [12, 13], label: 'Scrapped', value: safeNumber(mandateSummary.scrapped), tone: 'neutral' }
  ]
  mandateCards.forEach((item) => writeMetricCard(worksheet, 8, 9, item.columns[0], item.columns[1], item.label, item.value, item.tone, { numFmt: NUMBER_FORMAT }))

  writeSection(worksheet, 11, 1, 6, 'Average Conversion Time', COLORS.blue)
  writeSection(worksheet, 11, 8, 13, 'Candidate Pipeline', COLORS.teal)
  mergeStyled(worksheet, 12, 1, 12, 3, 'Milestone', tableHeaderStyle())
  mergeStyled(worksheet, 12, 4, 12, 4, 'Average', tableHeaderStyle())
  mergeStyled(worksheet, 12, 5, 12, 5, 'Tracked', tableHeaderStyle())
  mergeStyled(worksheet, 12, 6, 12, 6, 'Not Tracked', tableHeaderStyle())
  mergeStyled(worksheet, 12, 8, 12, 11, 'Stage', tableHeaderStyle())
  mergeStyled(worksheet, 12, 12, 12, 12, 'Count', tableHeaderStyle())
  mergeStyled(worksheet, 12, 13, 12, 13, '% of Total', tableHeaderStyle())
  worksheet.getRow(12).height = 34
  const conversions = Array.isArray(report?.conversionSummary) ? report.conversionSummary : []
  conversions.slice(0, 4).forEach((item, index) => {
    const row = 13 + index
    mergeStyled(worksheet, row, 1, row, 3, item.label, bodyStyle())
    mergeStyled(worksheet, row, 4, row, 4, finiteOrText(item.averageDays), bodyStyle({ horizontal: 'center', numFmt: Number.isFinite(Number(item.averageDays)) ? DAYS_FORMAT : undefined }))
    mergeStyled(worksheet, row, 5, row, 5, safeNumber(item.trackedMandates), bodyStyle({ horizontal: 'center', numFmt: NUMBER_FORMAT }))
    mergeStyled(worksheet, row, 6, row, 6, safeNumber(item.untrackedMandates), bodyStyle({ horizontal: 'center', numFmt: NUMBER_FORMAT }))
    worksheet.getRow(row).height = 32
  })
  const pipeline = Array.isArray(report?.candidatePipeline) ? report.candidatePipeline : []
  pipeline.slice(0, 6).forEach((item, index) => {
    const row = 13 + index
    mergeStyled(worksheet, row, 8, row, 11, item.label, bodyStyle({ bold: index === 0 }))
    mergeStyled(worksheet, row, 12, row, 12, safeNumber(item.count), bodyStyle({ horizontal: 'center', bold: index === 0, numFmt: NUMBER_FORMAT }))
    mergeStyled(worksheet, row, 13, row, 13, safeNumber(item.percentage) / 100, bodyStyle({ horizontal: 'center', bold: index === 0, numFmt: PERCENT_FORMAT }))
    worksheet.getRow(row).height = index < 4 ? 32 : 28
  })

  writeSection(worksheet, 21, 1, 6, 'Candidate Overview', COLORS.teal)
  writeSection(worksheet, 21, 8, 13, 'Exceptions', COLORS.red)
  mergeStyled(worksheet, 22, 1, 22, 5, 'Candidate Status', tableHeaderStyle())
  mergeStyled(worksheet, 22, 6, 22, 6, 'Count', tableHeaderStyle())
  mergeStyled(worksheet, 22, 8, 22, 12, 'Exception', tableHeaderStyle())
  mergeStyled(worksheet, 22, 13, 22, 13, 'Value', tableHeaderStyle())
  const candidateCounts = report?.candidateOverview?.counts || {}
  writeLabelValueRow(worksheet, 23, 1, 5, 6, 6, 'Total Candidates', safeNumber(report?.candidateOverview?.total), {
    numFmt: NUMBER_FORMAT,
    bold: true,
    valueBold: true,
    fillColor: COLORS.tealLight,
    height: 30
  })
  CANDIDATE_STATUSES.forEach((status, index) => {
    writeLabelValueRow(worksheet, 24 + index, 1, 5, 6, 6, status, safeNumber(candidateCounts[status]), {
      numFmt: NUMBER_FORMAT,
      fillColor: COLORS.white,
      height: index < 3 ? 30 : 28
    })
  })
  const exceptions = Array.isArray(report?.exceptions) ? report.exceptions : []
  exceptions.slice(0, 6).forEach((item, index) => {
    writeLabelValueRow(worksheet, 23 + index, 8, 12, 13, 13, item.label, safeNumber(item.value), {
      numFmt: NUMBER_FORMAT,
      fillColor: index % 2 === 0 ? COLORS.redLight : COLORS.white,
      height: index === 3 ? 42 : 30
    })
  })

  writeSection(worksheet, 29, 8, 13, 'Positive Outcomes', COLORS.green)
  mergeStyled(worksheet, 30, 8, 30, 12, 'Outcome', tableHeaderStyle())
  mergeStyled(worksheet, 30, 13, 30, 13, 'Value', tableHeaderStyle())
  const positiveOutcomes = Array.isArray(report?.positiveOutcomes) ? report.positiveOutcomes : []
  positiveOutcomes.slice(0, 6).forEach((item, index) => {
    writeLabelValueRow(worksheet, 31 + index, 8, 12, 13, 13, item.label, safeNumber(item.value), {
      numFmt: NUMBER_FORMAT,
      fillColor: index % 2 === 0 ? COLORS.greenLight : COLORS.white,
      height: 28
    })
  })

  writeSection(worksheet, 38, 1, 6, 'Attendance Snapshot', COLORS.blue)
  writeSection(worksheet, 38, 8, 13, 'Leave Balance', COLORS.teal)
  mergeStyled(worksheet, 39, 1, 39, 5, 'Metric', tableHeaderStyle())
  mergeStyled(worksheet, 39, 6, 39, 6, 'Value', tableHeaderStyle())
  mergeStyled(worksheet, 39, 8, 39, 12, 'Metric', tableHeaderStyle())
  mergeStyled(worksheet, 39, 13, 39, 13, 'Value', tableHeaderStyle())
  const attendanceMetrics = (Array.isArray(report?.attendance?.metrics) ? report.attendance.metrics : [])
    .filter((item) => item.key !== 'leaveBalance')
  attendanceMetrics.slice(0, 9).forEach((item, index) => {
    const metric = summaryAttendanceMetric(item)
    writeLabelValueRow(worksheet, 40 + index, 1, 5, 6, 6, item.label, metric.value, {
      numFmt: metric.numFmt,
      fillColor: COLORS.white,
      height: 28
    })
  })
  const availableBalance = safeNumber(report?.attendance?.leaveBalance?.availableBalance)
  writeLabelValueRow(worksheet, 40, 8, 12, 13, 13, 'Available Leave Balance', availableBalance, {
    numFmt: LEAVE_DAYS_FORMAT,
    fillColor: COLORS.tealLight,
    height: 28
  })

  worksheet.pageSetup.printArea = 'A1:M48'
  return worksheet
}

function writeOverallMandateNumbers(worksheet, report) {
  writeSection(worksheet, 4, 1, 20, 'Mandate Summary', COLORS.navy)
  const summary = report?.mandateSummary || {}
  const cards = [
    { columns: [1, 3], label: 'Total Mandates', value: safeNumber(summary.total), tone: 'navy' },
    { columns: [4, 6], label: 'Ongoing (P1)', value: safeNumber(summary.p1), tone: 'teal' },
    { columns: [7, 9], label: 'Delivered (P2)', value: safeNumber(summary.p2), tone: 'purple' },
    { columns: [10, 12], label: 'Paused (P3)', value: safeNumber(summary.p3), tone: 'amber' },
    { columns: [13, 16], label: 'Completed', value: safeNumber(summary.completed), tone: 'green' },
    { columns: [17, 20], label: 'Scrapped', value: safeNumber(summary.scrapped), tone: 'neutral' }
  ]
  cards.forEach((item) => writeMetricCard(worksheet, 5, 6, item.columns[0], item.columns[1], item.label, item.value, item.tone, { numFmt: NUMBER_FORMAT }))
}

function buildMandatesSheet(workbook, report, mandates) {
  const worksheet = workbook.addWorksheet('01 Mandates')
  configureWorksheet(worksheet, {
    widths: [18, 18, 22, 25, 18, 15, 19, 17, 15, 12, 14, 14, 11, 17, 11, 10, 14, 11, 20, 18],
    frozenRows: 5,
    frozenColumns: 2,
    zoomScale: 80,
    orientation: 'landscape',
    fitToHeight: 1,
    tabColor: COLORS.teal
  })
  writeSheetTitle(worksheet, 'Mandates', report, 20)
  if (report?.consultant?.isOverall) {
    writeOverallMandateNumbers(worksheet, report)
    worksheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false, zoomScale: 85 }]
    worksheet.pageSetup.printArea = 'A1:T6'
    return worksheet
  }

  writeSection(worksheet, 4, 1, 9, 'Mandates', COLORS.blue)
  writeSection(worksheet, 4, 10, 20, 'Candidate Status Split', COLORS.teal)
  const headers = [
    'Consultant', 'Team Lead', 'Client Name', 'Role', 'Budget', 'Mandate Status', 'Sector',
    'Date of Allocation', 'Candidates Assigned', ...CANDIDATE_STATUSES
  ]
  writeHeaders(worksheet, 5, 1, headers)
  worksheet.getRow(5).height = 56
  const rows = Array.isArray(mandates) ? mandates : []
  if (!rows.length) {
    mergeStyled(worksheet, 6, 1, 8, 20, 'No mandate rows were found for this consultant and report period.', {
      font: font({ color: COLORS.muted, size: 10, italic: true }),
      fill: fill(COLORS.background), border: BORDER, alignment: alignment('center', true)
    })
  } else {
    rows.forEach((mandate, index) => {
      const rowNumber = 6 + index
      const background = index % 2 ? COLORS.background : COLORS.white
      const date = dateValue(mandate.allocationDate)
      const values = [
        mandate.consultant || report.consultant.name,
        mandate.teamLead || '—',
        mandate.clientName || '—',
        mandate.role || '—',
        mandate.budget || '—',
        mandate.status || '—',
        mandate.sector || '—',
        date || mandate.allocationDate || '—',
        safeNumber(mandate.candidatesAssigned),
        ...CANDIDATE_STATUSES.map((status) => safeNumber(mandate.counts?.[status]))
      ]
      values.forEach((value, columnIndex) => {
        const cell = worksheet.getCell(rowNumber, columnIndex + 1)
        cell.value = value
        const numeric = columnIndex >= 8
        applyStyle(cell, bodyStyle({
          horizontal: numeric || columnIndex === 5 || columnIndex === 7 ? 'center' : 'left',
          fillColor: background,
          numFmt: columnIndex === 7 && date ? DATE_FORMAT : (numeric ? NUMBER_FORMAT : undefined)
        }))
      })
      const statusCell = worksheet.getCell(rowNumber, 6)
      const statusColors = STATUS_COLORS[mandate.status]
      if (statusColors) applyStyle(statusCell, bodyStyle({ horizontal: 'center', fillColor: statusColors.fill, bold: true, color: statusColors.text }))
      worksheet.getRow(rowNumber).height = 29
    })
  }
  const lastRow = Math.max(8, 5 + rows.length)
  worksheet.autoFilter = { from: 'A5', to: 'T5' }
  worksheet.pageSetup.printArea = `A1:T${lastRow}`
  worksheet.pageSetup.printTitlesRow = '1:5'
  return worksheet
}

function buildConversionsSheet(workbook, report, mandates) {
  const worksheet = workbook.addWorksheet('02 Conversion & Ageing')
  configureWorksheet(worksheet, {
    widths: [23, 27, 15, 17, 23, 19, 16, 16, 23],
    frozenRows: 4,
    zoomScale: 90,
    orientation: 'landscape',
    fitToHeight: 1,
    tabColor: COLORS.blue
  })
  writeSheetTitle(worksheet, 'Mandate Conversion & Ageing', report, 9)
  if (report?.consultant?.isOverall) {
    writeSection(worksheet, 4, 1, 9, 'Average Conversion Time', COLORS.blue)
    writeHeaders(worksheet, 5, 1, ['Milestone', 'Average Days', 'Tracked Mandates', 'Not Tracked', '', '', '', '', ''])
    worksheet.mergeCells(5, 1, 5, 5)
    worksheet._reportPreviewMerges ||= []
    worksheet._reportPreviewMerges.push({ startRow: 5, startColumn: 1, endRow: 5, endColumn: 5 })
    worksheet.mergeCells(5, 6, 5, 7)
    worksheet._reportPreviewMerges.push({ startRow: 5, startColumn: 6, endRow: 5, endColumn: 7 })
    worksheet.mergeCells(5, 8, 5, 9)
    worksheet._reportPreviewMerges.push({ startRow: 5, startColumn: 8, endRow: 5, endColumn: 9 })
    worksheet.getCell('A5').value = 'Milestone'
    worksheet.getCell('F5').value = 'Average Days'
    worksheet.getCell('H5').value = 'Tracking Coverage'
    const conversions = Array.isArray(report?.conversionSummary) ? report.conversionSummary : []
    conversions.slice(0, 4).forEach((item, index) => {
      const row = 6 + index
      mergeStyled(worksheet, row, 1, row, 5, item.label, bodyStyle({ fillColor: row % 2 ? COLORS.white : COLORS.background }))
      mergeStyled(worksheet, row, 6, row, 7, finiteOrText(item.averageDays), bodyStyle({ horizontal: 'center', fillColor: row % 2 ? COLORS.white : COLORS.background, bold: true, color: toneColor(item.tone), numFmt: Number.isFinite(Number(item.averageDays)) ? DAYS_FORMAT : undefined }))
      mergeStyled(worksheet, row, 8, row, 9, `${safeNumber(item.trackedMandates)} tracked · ${safeNumber(item.untrackedMandates)} not tracked`, bodyStyle({ horizontal: 'center', fillColor: row % 2 ? COLORS.white : COLORS.background }))
      worksheet.getRow(row).height = 28
    })
    worksheet.pageSetup.printArea = 'A1:I9'
    return worksheet
  }

  const headers = ['Client Name', 'Role', 'Status', 'Allocation Date', 'First Client Submission', 'First Interview', 'First Offer', 'First Hire', 'Age / Final Duration']
  writeHeaders(worksheet, 4, 1, headers)
  worksheet.getRow(4).height = 52
  const rows = Array.isArray(mandates) ? mandates : []
  if (!rows.length) {
    mergeStyled(worksheet, 5, 1, 7, 9, 'No conversion or ageing rows were found for this consultant and report period.', {
      font: font({ color: COLORS.muted, size: 10, italic: true }), fill: fill(COLORS.background), border: BORDER, alignment: alignment('center', true)
    })
  } else {
    rows.forEach((mandate, index) => {
      const rowNumber = 5 + index
      const ageing = Boolean(mandate.isAgeingWarning)
      const background = ageing ? COLORS.amberLight : (index % 2 ? COLORS.background : COLORS.white)
      const conversionValues = [
        mandate.clientName || '—',
        mandate.role || '—',
        mandate.status || '—',
        dateValue(mandate.allocationDate) || mandate.allocationDate || '—',
        finiteOrText(mandate.firstClientSubmissionDays),
        finiteOrText(mandate.firstInterviewDays),
        finiteOrText(mandate.firstOfferDays),
        finiteOrText(mandate.firstHireDays),
        mandate.durationLabel || '—'
      ]
      conversionValues.forEach((value, columnIndex) => {
        const cell = worksheet.getCell(rowNumber, columnIndex + 1)
        cell.value = value
        const conversionNumber = columnIndex >= 4 && columnIndex <= 7 && typeof value === 'number'
        applyStyle(cell, bodyStyle({
          horizontal: columnIndex >= 2 ? 'center' : 'left',
          fillColor: background,
          bold: columnIndex === 8 && ageing,
          color: columnIndex === 8 && ageing ? COLORS.amber : COLORS.text,
          numFmt: columnIndex === 3 && value instanceof Date ? DATE_FORMAT : (conversionNumber ? STAGE_DAYS_FORMAT : undefined)
        }))
      })
      const statusColors = STATUS_COLORS[mandate.status]
      if (statusColors) applyStyle(worksheet.getCell(rowNumber, 3), bodyStyle({ horizontal: 'center', fillColor: statusColors.fill, bold: true, color: statusColors.text }))
      worksheet.getRow(rowNumber).height = 30
    })
  }
  const lastRow = Math.max(7, 4 + rows.length)
  worksheet.autoFilter = { from: 'A4', to: 'I4' }
  worksheet.pageSetup.printArea = `A1:I${lastRow}`
  worksheet.pageSetup.printTitlesRow = '1:4'
  return worksheet
}

function buildCandidatesSheet(workbook, report) {
  const worksheet = workbook.addWorksheet('03 Candidates & Pipeline')
  configureWorksheet(worksheet, {
    widths: [31, 14, 4, 4, 26, 13, 16],
    frozenRows: 5,
    zoomScale: 95,
    orientation: 'portrait',
    fitToHeight: 1,
    tabColor: COLORS.purple
  })
  writeSheetTitle(worksheet, 'Candidates & Pipeline', report, 7)
  writeSection(worksheet, 4, 1, 2, 'Candidate Overview', COLORS.teal)
  writeSection(worksheet, 4, 5, 7, 'Candidate Pipeline', COLORS.purple)
  writeHeaders(worksheet, 5, 1, ['Candidate Status', 'Count'])
  writeHeaders(worksheet, 5, 5, ['Stage', 'Count', '% of Total'])
  const counts = report?.candidateOverview?.counts || {}
  const totalLabel = worksheet.getCell(6, 1)
  totalLabel.value = 'Total Candidates'
  applyStyle(totalLabel, bodyStyle({ fillColor: COLORS.tealLight, bold: true }))
  const totalValue = worksheet.getCell(6, 2)
  totalValue.value = safeNumber(report?.candidateOverview?.total)
  applyStyle(totalValue, bodyStyle({ horizontal: 'center', fillColor: COLORS.tealLight, bold: true, numFmt: NUMBER_FORMAT }))
  worksheet.getRow(6).height = 29
  CANDIDATE_STATUSES.forEach((status, index) => {
    const row = 7 + index
    const labelCell = worksheet.getCell(row, 1)
    labelCell.value = status
    applyStyle(labelCell, bodyStyle())
    const valueCell = worksheet.getCell(row, 2)
    valueCell.value = safeNumber(counts[status])
    applyStyle(valueCell, bodyStyle({ horizontal: 'center', numFmt: NUMBER_FORMAT }))
    worksheet.getRow(row).height = 29
  })
  const pipeline = Array.isArray(report?.candidatePipeline) ? report.candidatePipeline : []
  pipeline.slice(0, 6).forEach((item, index) => {
    const row = 6 + index
    const background = index === 0 ? COLORS.purpleLight : COLORS.white
    const values = [item.label, safeNumber(item.count), safeNumber(item.percentage) / 100]
    values.forEach((value, valueIndex) => {
      const cell = worksheet.getCell(row, 5 + valueIndex)
      cell.value = value
      applyStyle(cell, bodyStyle({
        horizontal: valueIndex ? 'center' : 'left',
        fillColor: background,
        bold: index === 0,
        color: COLORS.text,
        numFmt: valueIndex === 1 ? NUMBER_FORMAT : (valueIndex === 2 ? PERCENT_FORMAT : undefined)
      }))
    })
    worksheet.getRow(row).height = 29
  })
  worksheet.pageSetup.printArea = 'A1:G17'
  return worksheet
}

function writeMetricList(worksheet, startRow, startColumn, endLabelColumn, valueColumn, items, highlightColor) {
  items.forEach((item, index) => {
    const row = startRow + index
    writeLabelValueRow(worksheet, row, startColumn, endLabelColumn, valueColumn, valueColumn, item.label, safeNumber(item.value), {
      numFmt: NUMBER_FORMAT,
      fillColor: index % 2 === 0 ? highlightColor : COLORS.white,
      height: index === 3 && startColumn === 1 ? 42 : 32
    })
  })
}

function buildAttendanceSheet(workbook, report) {
  const overall = Boolean(report?.consultant?.isOverall)
  const lastColumn = overall ? 11 : 7
  const worksheet = workbook.addWorksheet('04 Attendance & Outcomes')
  const widths = overall
    ? [28, 14, 13, 13, 13, 14, 15, 16, 20, 18, 15]
    : [28, 28, 12, 4, 27, 27, 14]
  configureWorksheet(worksheet, {
    widths,
    frozenRows: 5,
    zoomScale: overall ? 80 : 95,
    orientation: overall ? 'landscape' : 'portrait',
    fitToHeight: overall ? 0 : 1,
    tabColor: COLORS.green
  })
  writeSheetTitle(worksheet, 'Attendance & Outcomes', report, lastColumn)

  writeSection(worksheet, 4, 1, 3, 'Exceptions', COLORS.red)
  writeSection(worksheet, 4, 5, 7, 'Positive Outcomes', COLORS.green)
  writeHeaders(worksheet, 5, 1, ['Exception', '', 'Value'])
  worksheet.mergeCells(5, 1, 5, 2)
  worksheet._reportPreviewMerges ||= []
  worksheet._reportPreviewMerges.push({ startRow: 5, startColumn: 1, endRow: 5, endColumn: 2 })
  worksheet.getCell('A5').value = 'Exception'
  writeHeaders(worksheet, 5, 5, ['Outcome', '', 'Value'])
  worksheet.mergeCells(5, 5, 5, 6)
  worksheet._reportPreviewMerges.push({ startRow: 5, startColumn: 5, endRow: 5, endColumn: 6 })
  worksheet.getCell('E5').value = 'Outcome'
  writeMetricList(worksheet, 6, 1, 2, 3, Array.isArray(report?.exceptions) ? report.exceptions.slice(0, 6) : [], COLORS.redLight)
  writeMetricList(worksheet, 6, 5, 6, 7, Array.isArray(report?.positiveOutcomes) ? report.positiveOutcomes.slice(0, 6) : [], COLORS.greenLight)

  writeSection(worksheet, 14, 1, 3, 'Attendance Snapshot', COLORS.blue)
  writeSection(worksheet, 14, 5, 7, 'Leave Balance', COLORS.teal)
  writeHeaders(worksheet, 15, 1, ['Metric', '', 'Value'])
  worksheet.mergeCells(15, 1, 15, 2)
  worksheet._reportPreviewMerges.push({ startRow: 15, startColumn: 1, endRow: 15, endColumn: 2 })
  worksheet.getCell('A15').value = 'Attendance Metric'
  writeHeaders(worksheet, 15, 5, ['Metric', '', 'Value'])
  worksheet.mergeCells(15, 5, 15, 6)
  worksheet._reportPreviewMerges.push({ startRow: 15, startColumn: 5, endRow: 15, endColumn: 6 })
  worksheet.getCell('E15').value = 'Leave Metric'
  const attendanceMetrics = (Array.isArray(report?.attendance?.metrics) ? report.attendance.metrics : [])
    .filter((item) => item.key !== 'leaveBalance')
  attendanceMetrics.slice(0, 9).forEach((item, index) => {
    const row = 16 + index
    const metric = summaryAttendanceMetric(item)
    writeLabelValueRow(worksheet, row, 1, 2, 3, 3, item.label, metric.value, {
      numFmt: metric.numFmt,
      fillColor: COLORS.white,
      height: 29
    })
  })
  writeLabelValueRow(worksheet, 16, 5, 6, 7, 7, 'Available Leave Balance', safeNumber(report?.attendance?.leaveBalance?.availableBalance), {
    numFmt: LEAVE_DAYS_FORMAT,
    fillColor: COLORS.tealLight,
    height: 29
  })

  let lastRow = 25
  if (overall) {
    const consultants = Array.isArray(report?.attendance?.consultants) ? report.attendance.consultants : []
    writeSection(worksheet, 28, 1, 11, 'ATTENDANCE BY CONSULTANT · TEAM ATTENDANCE MEMBERS ONLY', COLORS.darkHeader)
    const headers = [
      'Consultant', 'Working Days', 'Present Days', 'Leave Days', 'Half-Day Leave',
      'Unmarked Days', 'Corrected Attendance', 'Pending Corrections', 'Total Worked Hours',
      'Available Leave Balance', 'Attendance %'
    ]
    writeHeaders(worksheet, 29, 1, headers)
    if (!consultants.length) {
      mergeStyled(worksheet, 30, 1, 32, 11, 'No Team Attendance consultants were available for this report period.', {
        font: font({ color: COLORS.muted, size: 10, italic: true }), fill: fill(COLORS.background), border: BORDER, alignment: alignment('center', true)
      })
      lastRow = 32
    } else {
      consultants.forEach((entry, index) => {
        const row = 30 + index
        const metrics = new Map((Array.isArray(entry.metrics) ? entry.metrics : []).map((item) => [item.key, item]))
        const workedMinutes = safeNumber(metrics.get('workedTime')?.numericValue)
        const availableBalance = safeNumber(entry.leaveBalance?.availableBalance ?? metrics.get('leaveBalance')?.numericValue)
        const percentage = safeNumber(metrics.get('attendancePercentage')?.numericValue)
        const values = [
          entry.consultant?.name || '—',
          safeNumber(metrics.get('workingDays')?.value),
          safeNumber(metrics.get('presentDays')?.value),
          safeNumber(metrics.get('leaveDays')?.value),
          safeNumber(metrics.get('halfDayLeave')?.value),
          safeNumber(metrics.get('unmarkedDays')?.value),
          safeNumber(metrics.get('correctedAttendance')?.value),
          safeNumber(metrics.get('pendingCorrections')?.value),
          typeof metrics.get('workedTime')?.value === 'string'
            ? metrics.get('workedTime').value
            : `${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m`,
          availableBalance,
          percentage / 100
        ]
        values.forEach((value, valueIndex) => {
          const cell = worksheet.getCell(row, valueIndex + 1)
          cell.value = value
          applyStyle(cell, bodyStyle({
            horizontal: valueIndex ? 'center' : 'left',
            fillColor: index % 2 ? COLORS.background : COLORS.white,
            bold: valueIndex === 0,
            numFmt: valueIndex === 9 ? LEAVE_DAYS_FORMAT : (valueIndex === 10 ? PERCENT_FORMAT : (valueIndex > 0 && valueIndex !== 8 ? DECIMAL_FORMAT : undefined))
          }))
        })
        worksheet.getRow(row).height = 27
      })
      lastRow = 29 + consultants.length
    }
    worksheet.autoFilter = { from: 'A29', to: 'K29' }
    worksheet.pageSetup.printTitlesRow = '1:5'
  }
  worksheet.pageSetup.printArea = `A1:${overall ? 'K' : 'G'}${lastRow}`
  return worksheet
}

function excelColumnName(number) {
  let value = number
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function colorFromStyle(color, fallback) {
  const raw = color?.argb || ''
  return raw ? `#${raw.slice(-6)}` : fallback
}

function previewText(cell) {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'object') {
    if (value.text !== undefined) return String(value.text)
    if (value.result !== undefined) return String(value.result)
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('')
  }
  if (typeof value !== 'number') return String(value)
  const numFmt = String(cell.numFmt || '')
  if (numFmt.includes('%')) return `${(value * 100).toFixed(1)}%`
  if (numFmt.includes('[h]')) {
    const minutes = Math.round(value * 1440)
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }
  if (numFmt.includes('days')) return value === 0 ? '—' : `${value.toFixed(1)} days`
  if (value === 0 && numFmt.includes('—')) return '—'
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function previewCellStyle(cell) {
  const leftBorder = cell.border?.left?.color || cell.border?.bottom?.color
  return {
    backgroundColor: colorFromStyle(cell.fill?.fgColor, '#FFFFFF'),
    color: colorFromStyle(cell.font?.color, '#18243A'),
    fontFamily: cell.font?.name || 'Arial',
    fontSize: safeNumber(cell.font?.size, 10),
    fontWeight: cell.font?.bold ? 700 : 400,
    fontStyle: cell.font?.italic ? 'italic' : 'normal',
    textAlign: cell.alignment?.horizontal || 'left',
    verticalAlign: cell.alignment?.vertical || 'middle',
    whiteSpace: cell.alignment?.wrapText ? 'normal' : 'nowrap',
    borderColor: colorFromStyle(leftBorder, '#D7DFEA')
  }
}

function worksheetPreview(worksheet) {
  const totalRows = worksheet.rowCount
  const shownRows = Math.min(totalRows, PREVIEW_ROW_LIMIT)
  const totalColumns = worksheet.columnCount
  const masterMerges = new Map()
  const coveredCells = new Set()
  for (const merge of worksheet._reportPreviewMerges || []) {
    masterMerges.set(`${merge.startRow}:${merge.startColumn}`, {
      rowSpan: merge.endRow - merge.startRow + 1,
      colSpan: merge.endColumn - merge.startColumn + 1
    })
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        if (row !== merge.startRow || column !== merge.startColumn) coveredCells.add(`${row}:${column}`)
      }
    }
  }
  const rows = []
  for (let rowNumber = 1; rowNumber <= shownRows; rowNumber += 1) {
    const cells = []
    for (let column = 1; column <= totalColumns; column += 1) {
      const key = `${rowNumber}:${column}`
      if (coveredCells.has(key)) {
        cells.push({ key, hidden: true })
        continue
      }
      const cell = worksheet.getCell(rowNumber, column)
      const span = masterMerges.get(key) || { rowSpan: 1, colSpan: 1 }
      cells.push({
        key,
        text: previewText(cell),
        rowSpan: span.rowSpan,
        colSpan: span.colSpan,
        style: previewCellStyle(cell)
      })
    }
    rows.push({ rowNumber, height: worksheet.getRow(rowNumber).height || 20, cells })
  }
  return {
    name: worksheet.name,
    totalRows,
    shownRows,
    truncatedRows: Math.max(0, totalRows - shownRows),
    totalColumns,
    columnLabels: Array.from({ length: totalColumns }, (_, index) => excelColumnName(index + 1)),
    columnWidths: Array.from({ length: totalColumns }, (_, index) => {
      const width = safeNumber(worksheet.getColumn(index + 1).width, 12)
      return Math.min(240, Math.max(54, Math.round(width * 7.2)))
    }),
    rows
  }
}

async function buildConsultantReportWorkbook({ report, mandates = [] }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Fyndbridge ATS'
  workbook.lastModifiedBy = 'Fyndbridge ATS'
  workbook.company = 'Fyndbridge'
  workbook.subject = 'Consultant performance report'
  workbook.title = `${report?.consultant?.name || 'Consultant'} report`
  workbook.description = 'ATS-only consultant report generated by Fyndbridge ATS.'
  const generatedAt = new Date(report?.meta?.generatedAt || Date.now())
  workbook.created = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt
  workbook.modified = workbook.created
  workbook.properties.date1904 = false

  buildSummarySheet(workbook, report)
  buildMandatesSheet(workbook, report, mandates)
  buildConversionsSheet(workbook, report, mandates)
  buildCandidatesSheet(workbook, report)
  buildAttendanceSheet(workbook, report)

  const fileName = workbookFileName(report)
  const preview = {
    workbookName: fileName,
    sheets: workbook.worksheets.map(worksheetPreview)
  }
  const output = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true })
  return {
    buffer: Buffer.from(output),
    fileName,
    mimeType: MIME_TYPE,
    preview
  }
}

module.exports = {
  COLORS,
  MIME_TYPE,
  buildConsultantReportWorkbook,
  workbookFileName
}
