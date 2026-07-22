const supabase = require('../services/supabaseAdmin')
const { parseResume } = require('../services/resumeParser')
const { cleanupPublicResume } = require('../middleware/publicApplicationUpload')
const {
  listEligiblePublicJobs,
  getPublicJobBySlug,
  publicRoleDto,
  validatePublicApplication,
  stagePublicApplication,
  parsedResumeDto
} = require('../services/publicApplications')
const { issueFormToken, validateSubmissionAbuse } = require('../services/publicApplicationAbuse')

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

async function getOpenRole(req, res) {
  try {
    const job = await getPublicJobBySlug(supabase, req.params.slug)
    if (!job) return res.status(404).json({ error: PUBLIC_ROLE_NOT_FOUND })
    return res.json({ data: publicRoleDto(job, { detail: true }) })
  } catch (error) {
    return safePublicError(res, error, 'getOpenRole')
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
  getOpenRole,
  parsePublicResume,
  submitPublicApplication,
  publicRouteErrorHandler
}
