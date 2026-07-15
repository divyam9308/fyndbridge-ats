const reportService = require('../services/consultantReportService')

function sendError(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
  console.error('[consultant-report:error]', { message: error.message, stack: error.stack })
  return res.status(500).json({ error: 'Unable to load the consultant report.' })
}

async function options(req, res) {
  try {
    return res.json({ data: await reportService.getConsultantOptions(req.user) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function report(req, res) {
  try {
    return res.json({ data: await reportService.getConsultantReport(req.user, req.query) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function exportPreview(req, res) {
  try {
    return res.json({ data: await reportService.getConsultantReportExport(req.user, req.query) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function mandates(req, res) {
  try {
    return res.json({ data: await reportService.getConsultantMandates(req.user, req.query) })
  } catch (error) {
    return sendError(res, error)
  }
}

async function conversions(req, res) {
  try {
    return res.json({ data: await reportService.getConsultantConversions(req.user, req.query) })
  } catch (error) {
    return sendError(res, error)
  }
}

module.exports = { conversions, exportPreview, mandates, options, report }
