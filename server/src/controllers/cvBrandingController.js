const crypto = require('node:crypto')
const { cvBranding, isBrandedCvPath } = require('../services/cvBranding')
const { assertDocumentAccess, assertPageAccess } = require('../services/documentAccess')
const { isAdmin } = require('../services/adminAccess')
const { isUuid } = require('../services/assignedCandidates')

async function brandingStatus(req, res) {
  res.set('Cache-Control', 'private, no-store')
  try {
    const items = req.body?.items
    if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(item =>
      !item || !['cv', 'assigned'].includes(item.type) || !isUuid(item.recordId) || !isBrandedCvPath(item.path))) {
      return res.status(400).json({ error: 'Choose valid candidate CVs.' })
    }
    // Never trust a caller-supplied storage path or merely the existence of a job.
    for (const item of items) {
      if (item.type === 'assigned') {
        await assertPageAccess(req.user, 'assigned_candidates', await isAdmin(req.user))
        const row = await require('./assignedCandidatesController').authorizeCv({ ...req, params: { id: item.recordId } })
        if (row.assigned_candidate_uploads?.cv_storage_path !== item.path) throw Object.assign(new Error('CV not found.'), { statusCode: 404 })
      } else await assertDocumentAccess(req.user, 'cv', item.recordId, item.path)
    }
    const service = cvBranding(), paths = [...new Set(items.map(item => item.path))]
    if (req.body.retry === true) await service.retry(paths)
    const data = await service.statuses(paths)
    res.json({ data })
    if (data.some(row => !['ready', 'cancelled'].includes(row.status))) service.schedule(paths)
  } catch (error) {
    if (res.headersSent) return
    res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : 'Unable to check CV branding. Please retry.' })
  }
}
async function workerCron(req, res) {
  res.set('Cache-Control', 'no-store')
  const secret = process.env.CRON_SECRET
  const header = req.get('authorization') || '', expected = `Bearer ${secret || ''}`
  if (!secret || Buffer.byteLength(header) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return res.status(401).json({ error: 'Unauthorized' })
  try { const service = cvBranding(); const cleanup = await service.reap(); res.json({ ...await service.run(), ...cleanup }) }
  catch { res.status(503).json({ error: 'CV branding worker failed. Queued work will be retried.' }) }
}
module.exports = { brandingStatus, workerCron }
