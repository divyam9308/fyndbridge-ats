const { cvBranding, isBrandedCvPath } = require('./cvBranding')

async function addCandidateCvStatus(rows, { service = cvBranding(), logger = console } = {}) {
  const paths = [...new Set(rows.flatMap(row => (row.cv_attachments || []).map(item => item.path)).filter(isBrandedCvPath))]
  if (!paths.length) return rows
  try {
    const statuses = new Map()
    // Use only persisted job metadata; never download or queue CVs on list reads.
    for (let start = 0; start < paths.length; start += 100) {
      for (const item of await service.statuses(paths.slice(start, start + 100))) statuses.set(item.path, item.status)
    }
    return rows.map(row => ({ ...row, cv_attachments: (row.cv_attachments || []).map(item => statuses.has(item.path)
      ? { ...item, branding_status: statuses.get(item.path) } : item) }))
  } catch (error) {
    // A metadata outage keeps the existing authorized status-check fallback.
    logger.error('Candidate CV status lookup failed:', { code: error.code || 'CV_STATUS_UNAVAILABLE' })
    return rows
  }
}

module.exports = { addCandidateCvStatus }
