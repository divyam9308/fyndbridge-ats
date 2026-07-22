const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')
const { cleanupPublicResume } = require('../middleware/publicApplicationUpload')
const {
  listEligiblePublicJobs,
  countEligiblePublicJobs,
  getPublicJobBySlug,
  publicRoleDto,
  validatePublicApplication,
  stagePublicApplication,
  parsedResumeDto
} = require('../services/publicApplications')
const { issueFormToken, validateSubmissionAbuse } = require('../services/publicApplicationAbuse')
const { buildPublicRoleShareHtml, safeFrontendOrigin } = require('../services/publicRoleSharePreview')
const { renderPublicRoleShareImage } = require('../services/publicRoleShareImage')

const PUBLIC_ROLE_NOT_FOUND = 'This role is not available for applications.'
const APPLICATION_SUCCESS = 'Your application has been submitted successfully.'

function safePublicError(res, error, routeName) {
  if (error?.statusCode && error.publicSafe) return res.status(error.statusCode).json({ error: error.message })
  if (error?.statusCode === 400 && error.errors) return res.status(400).json({ error: error.message, errors: error.errors })
  if (error?.statusCode === 409) return res.status(409).json({ error: error.message })
  console.error(`${routeName}:`, error?.message || error)
  return res.status(error?.statusCode === 503 ? 503 : 500).json({ error: error?.statusCode === 503 ? error.message : 'Request could not be completed. Please try again.' })
}

async function listOpenRoles(req, res) {
  try {
    return res.json({ data: await listEligiblePublicJobs(supabase) })
  } catch (error) {
    return safePublicError(res, error, 'listOpenRoles')
  }
}

async function countOpenRoles(req, res) {
  try {
    return res.json({ count: await countEligiblePublicJobs(supabase) })
  } catch (error) {
    return safePublicError(res, error, 'countOpenRoles')
  }
}

async function getOpenRole(req, res) {
  try {
    const job = await getPublicJobBySlug(supabase, req.params.slug)
    if (!job) return res.status(404).json({ error: PUBLIC_ROLE_NOT_FOUND })
    return res.json({ data: publicRoleDto(job, { detail: true }) })
  } catch (error) {
    return safePublicError(res, error, 'getOpenRole')
  }
}

function requestFrontendOrigin(req) {
  if (process.env.FRONTEND_URL) return safeFrontendOrigin(process.env.FRONTEND_URL)
  const forwardedProtocol = String(req.get('x-forwarded-proto') || '').split(',')[0].trim()
  const protocol = ['http', 'https'].includes(forwardedProtocol) ? forwardedProtocol : req.protocol
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  return safeFrontendOrigin(`${protocol}://${host}`)
}

async function shareOpenRole(req, res) {
  try {
    const job = await getPublicJobBySlug(supabase, req.params.slug)
    if (!job) return res.status(404).send(PUBLIC_ROLE_NOT_FOUND)
    const role = publicRoleDto(job)
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    return res.send(buildPublicRoleShareHtml(role, requestFrontendOrigin(req)))
  } catch (error) {
    return safePublicError(res, error, 'shareOpenRole')
  }
}

async function shareOpenRoleImage(req, res) {
  try {
    const job = await getPublicJobBySlug(supabase, req.params.slug)
    if (!job) return res.status(404).send(PUBLIC_ROLE_NOT_FOUND)
    const image = await renderPublicRoleShareImage(publicRoleDto(job))
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
    res.setHeader('Content-Type', 'image/jpeg')
    return res.send(image)
  } catch (error) {
    return safePublicError(res, error, 'shareOpenRoleImage')
  }
}

async function parsePublicResume(req, res) {
  try {
    const parsed = await parseResume(req.file.path)
    const form = issueFormToken(req)
    return res.json({
      data: parsedResumeDto(parsed),
      form_token: form.formToken,
      form_started_at: form.formStartedAt
    })
  } catch (error) {
    if (error?.code === 'AI_QUOTA_REACHED') {
      return res.status(503).json({ error: 'Resume parsing is temporarily unavailable. Please try again later.' })
    }
    return safePublicError(res, error, 'parsePublicResume')
  } finally {
    await cleanupPublicResume(req.file)
  }
}

async function submitPublicApplication(req, res) {
  try {
    const abuse = await validateSubmissionAbuse(req)
    if (abuse.bot) return res.status(201).json({ success: true, message: APPLICATION_SUCCESS })
    const errors = validatePublicApplication(req.body)
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Please complete all required fields.', errors })
    }
    const job = await getPublicJobBySlug(supabase, req.body.role_slug, { internal: true })
    if (!job) return res.status(404).json({ error: PUBLIC_ROLE_NOT_FOUND })
    await stagePublicApplication({ supabase, job, body: req.body, file: req.file })
    return res.status(201).json({ success: true, message: APPLICATION_SUCCESS })
  } catch (error) {
    return safePublicError(res, error, 'submitPublicApplication')
  } finally {
    await cleanupPublicResume(req.file)
  }
}

function publicRouteErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  return safePublicError(res, error, 'publicRoute')
}

module.exports = {
  PUBLIC_ROLE_NOT_FOUND,
  APPLICATION_SUCCESS,
  listOpenRoles,
  countOpenRoles,
  getOpenRole,
  shareOpenRole,
  shareOpenRoleImage,
  parsePublicResume,
  submitPublicApplication,
  publicRouteErrorHandler
}
