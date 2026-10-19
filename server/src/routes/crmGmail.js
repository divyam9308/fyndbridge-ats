const express = require('express')
const crypto = require('node:crypto')
const { createGmailService } = require('../services/crmGmail')
const { config } = require('../services/crmGmailGoogle')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')
const MESSAGES = {
  INVALID_STATE: 'Gmail connection expired or could not be verified. Please connect again.',
  OAUTH_DENIED: 'Gmail access was not granted. Please try again.',
  ACCOUNT_MISMATCH: 'Select the Gmail account matching your verified FyndBridge work email.',
  WORK_EMAIL_REQUIRED: 'A verified FyndBridge work email is required to connect Gmail.',
  WORK_EMAIL_CHANGED: 'Your work email changed. Please connect Gmail again.',
  ACCESS_DENIED: 'CRM access is required to connect Gmail.',
  SCOPE_REQUIRED: 'Allow read-only Gmail access to connect your mailbox.',
  OFFLINE_ACCESS_REQUIRED: 'Offline access was not granted. Please reconnect and approve access.',
  CONFIGURATION: 'Gmail integration is not configured. Please contact an administrator.',
  NOT_CONNECTED: 'Connect Gmail before synchronising.',
  REAUTHORIZE: 'Reconnect Gmail before synchronising.',
  SYNC_COOLDOWN: 'Please wait 30 seconds between manual Gmail syncs.'
}
const cookieName = () => config().secure ? '__Host-crm_gmail_oauth' : 'crm_gmail_oauth'
const cookieOptions = () => ({ httpOnly: true, secure: config().secure, sameSite: 'lax', path: '/', maxAge: 600000 })
function createHandlers(service = createGmailService()) {
  const router = express.Router()
  router.use(requirePageViewPermission('crm'))
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() })
  const safe = fn => async (req, res) => {
    try { await fn(req, res) }
    catch (error) {
      const status = error.code === 'SYNC_COOLDOWN' ? 429 : ['NOT_CONNECTED','REAUTHORIZE'].includes(error.code) ? 409 : error.code === 'WORK_EMAIL_REQUIRED' ? 400 : error.code === 'ACCESS_DENIED' ? 403 : 503
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
      res.status(status).json({ error: MESSAGES[error.code] || 'Unable to complete the Gmail request. Please try again.', ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) })
    }
  }
  router.get('/status', safe(async (req, res) => res.json(await service.status(req.user.id))))
  router.post('/connect', safe(async (req, res) => {
    const { url, browser } = await service.start(req.user.id)
    res.cookie(cookieName(), browser, cookieOptions()); res.json({ url })
  }))
  router.delete('/disconnect', safe(async (req, res) => { await service.disconnect(req.user.id); res.json({ connected: false }) }))
  router.post('/sync', safe(async (req, res) => res.json(await service.syncNow(req.user.id))))
  async function callback(req, res) {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' })
    let result = 'connected'
    try {
      const name = cookieName()
      const browser = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
      await service.callback({ state: req.query.state, browser, code: req.query.code, error: req.query.error })
    } catch (error) { result = Object.hasOwn(MESSAGES, error.code) ? error.code : 'CONNECTION_FAILED' }
    try {
      res.clearCookie(cookieName(), { ...cookieOptions(), maxAge: undefined })
      return res.redirect(303, `${config().origin}/dashboard/crm?gmail=${encodeURIComponent(result)}`)
    } catch { return res.status(503).send('Gmail integration is not configured. Please return to CRM.') }
  }
  function cron(schedule) {
    return async (req, res) => {
      res.set('Cache-Control', 'no-store')
      const secret = process.env.CRON_SECRET, header = req.get('authorization') || ''
      const expected = `Bearer ${secret || ''}`
      if (!secret || Buffer.byteLength(header) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return res.status(401).json({ error: 'Unauthorized' })
      try { return res.json(await service.run({ schedule })) }
      catch { return res.status(503).json({ error: 'Gmail worker failed; persisted work will be retried.' }) }
    }
  }
  return { router, callback, syncCron: cron(true), workerCron: cron(false) }
}
module.exports = { createHandlers, MESSAGES }
