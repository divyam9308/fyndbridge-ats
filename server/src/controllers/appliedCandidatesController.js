const supabase = require('../services/supabaseAdmin')
const {
  listApplications,
  getApplication,
  publicApplicationDto,
  claimApplication,
  releaseApplicationClaim,
  recordConversionCandidate,
  finalizeApplication,
  rejectApplication,
  signedCv
} = require('../services/appliedCandidates')
const {
  parseStringArray,
  indiaDate,
  adoptStagedResume,
  removeAdoptedResumeIfUnreferenced
} = require('../services/publicApplications')
const candidateCreation = require('../services/candidateCreation')
const { normalizeMandateStatus } = require('../services/mandateStatuses')
const { createConsultantAssignmentNotification } = require('../services/assignmentNotifications')
const { assertCanUpdateColumns, assertRowEditable, isAdmin, stripHiddenFields } = require('../services/adminAccess')

const FILLABLE_CANDIDATE_FIELDS = Object.freeze([
  'full_name', 'email', 'mobile_number', 'current_designation', 'current_company',
  'current_organisation', 'experience_years', 'notice_period', 'open_to_relocate',
  'skills', 'location', 'linkedin_url'
])

function sendInternal(res, routeName, error) {
  if (error?.statusCode) {
    const body = { error: error.message }
    if (error.errors) body.errors = error.errors
    return res.status(error.statusCode).json(body)
  }
  console.error(`${routeName}:`, error?.message || error)
  return res.status(500).json({ error: 'Internal server error' })
}

async function listAppliedCandidates(req, res) {
  try {
    return res.json(await listApplications(supabase, req.query))
  } catch (error) {
    return sendInternal(res, 'listAppliedCandidates', error)
  }
}

async function getAppliedCandidate(req, res) {
  try {
    const application = await getApplication(supabase, req.params.id)
    if (!application) return res.status(404).json({ error: 'Application not found.' })
    return res.json({ data: publicApplicationDto(application, { detail: true }) })
  } catch (error) {
    return sendInternal(res, 'getAppliedCandidate', error)
  }
}

async function getAppliedCandidateCv(req, res) {
  try {
    const application = await getApplication(supabase, req.params.id)
    if (!application) return res.status(404).json({ error: 'Application not found.' })
    return res.json(await signedCv(supabase, application))
  } catch (error) {
    return sendInternal(res, 'getAppliedCandidateCv', error)
  }
}

async function rejectAppliedCandidate(req, res) {
  try {
    const application = await rejectApplication(supabase, req.params.id, req.user.id, req.body?.reason || req.body?.rejection_reason)
    return res.json({ data: publicApplicationDto(application, { detail: true }) })
  } catch (error) {
    return sendInternal(res, 'rejectAppliedCandidate', error)
  }
}

async function updateAppliedCandidateStatus(req, res) {
  try {
    const status = candidateCreation.clean(req.body?.application_status || req.body?.status).toLowerCase()
    if (status === 'rejected') {
      const application = await rejectApplication(supabase, req.params.id, req.user.id, req.body?.reason || req.body?.rejection_reason)
      return res.json({ data: publicApplicationDto(application, { detail: true }) })
    }
    if (status === 'pending') {
      const application = await getApplication(supabase, req.params.id)
      if (!application) return res.status(404).json({ error: 'Application not found.' })
      if (application.application_status !== 'pending') return res.status(409).json({ error: 'Only pending applications can remain pending.' })
      return res.json({ data: publicApplicationDto(application, { detail: true }) })
    }
    return res.status(400).json({ error: 'Status must be pending or rejected.' })
  } catch (error) {
    return sendInternal(res, 'updateAppliedCandidateStatus', error)
  }
}

async function duplicateResponse(res, candidates, admin) {
  const existing = await stripHiddenFields('candidates', (candidates || []).map(candidateCreation.duplicateCandidateDto), admin)
  return res.status(409).json({
    code: 'CANDIDATE_DUPLICATE',
    duplicate: true,
    error: 'A candidate already exists with this email or mobile number.',
    existing,
    actions: ['link_existing', 'keep_pending', 'reject']
  })
}

async function findAssociationByMarker(applicationId) {
  const { data, error } = await supabase
    .from('candidate_associations')
    .select('id, candidate_id, job_id, status')
    .eq('public_application_id', applicationId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function findExactAssociation(candidateId, jobId) {
  const { data, error } = await supabase
    .from('candidate_associations')
    .select('id, candidate_id, job_id, status, consultant_name, client_id, public_application_id')
    .eq('candidate_id', candidateId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function findCandidateById(candidateId) {
  const { data, error } = await supabase.from('candidates').select('*').eq('id', candidateId).maybeSingle()
  if (error) throw error
  if (!data) {
    throw Object.assign(new Error('The provisional conversion candidate no longer exists. An administrator must review this application.'), {
      statusCode: 409,
      preserveClaim: true
    })
  }
  return data
}

async function markExactAssociation(association, applicationId) {
  if (association.public_application_id === applicationId) return association
  if (association.public_application_id) {
    throw Object.assign(new Error('The candidate and mandate association already belongs to another public application.'), {
      statusCode: 409,
      preserveClaim: true
    })
  }
  const { data, error } = await supabase.from('candidate_associations').update({
    public_application_id: applicationId,
    updated_at: new Date().toISOString()
  }).eq('id', association.id).is('public_application_id', null).select('id, candidate_id, job_id, status, consultant_name, consultant_user_id, client_id, public_application_id').maybeSingle()
  if (error?.code === '23505') {
    const marker = await findAssociationByMarker(applicationId)
    if (marker) return marker
  }
  if (error) throw error
  if (data) return data
  const marker = await findAssociationByMarker(applicationId)
  if (marker) return marker
  throw Object.assign(new Error('The conversion association changed concurrently and can be safely retried.'), {
    statusCode: 409,
    preserveClaim: true
  })
}

async function finalizeRecoveredMarker(application, marker, userId, token) {
  if (application.converted_candidate_id && application.converted_candidate_id !== marker.candidate_id) {
    const removed = await candidateCreation.removeCandidateIfUnassociated(supabase, application.converted_candidate_id)
    if (!removed) {
      throw Object.assign(new Error('A provisional conversion candidate has another association and requires administrator review.'), {
        statusCode: 500,
        preserveClaim: true
      })
    }
  }
  return finalizeApplication(supabase, application.id, token, {
    application_status: 'converted',
    candidate_id: marker.candidate_id,
    association_id: marker.id,
    user_id: userId
  })
}

async function syncHiredMandate(jobId, status) {
  if (status !== 'Hired' || !jobId) return
  const { data: job, error } = await supabase.from('jobs').select('id, mandate_status, status').eq('id', jobId).maybeSingle()
  if (error) throw error
  if (!job || [job.mandate_status, job.status].some((value) => normalizeMandateStatus(value) === 'Scrapped')) return
  const { error: updateError } = await supabase.from('jobs').update({ mandate_status: 'Completed', status: 'Completed', updated_at: new Date().toISOString() }).eq('id', jobId)
  if (updateError) throw updateError
}

function booleanValue(value) {
  return value === true || String(value || '').toLowerCase() === 'true'
}

function requestedBlankFields(value) {
  if (value === true || String(value).toLowerCase() === 'true') return new Set([...FILLABLE_CANDIDATE_FIELDS, 'cv'])
  let parsed = value
  if (typeof value === 'string' && ['[', '{'].includes(value.trim()[0])) {
    try { parsed = JSON.parse(value) } catch { parsed = [] }
  }
  const fields = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' ? Object.keys(parsed).filter((field) => parsed[field]) : [])
  return new Set(fields.filter((field) => FILLABLE_CANDIDATE_FIELDS.includes(field) || field === 'cv'))
}

function isBlank(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

async function fillExistingCandidateBlanks(application, existing, candidatePayload, requested, userId) {
  const update = {}
  let adopted = null
  for (const field of FILLABLE_CANDIDATE_FIELDS) {
    if (requested.has(field) && isBlank(existing[field]) && !isBlank(candidatePayload[field])) update[field] = candidatePayload[field]
  }
  if (requested.has('cv') && isBlank(existing.cv_storage_path)) {
    adopted = await adoptStagedResume(supabase, application)
    Object.assign(update, adopted, {
      cv_attachments: [{
        path: adopted.cv_storage_path,
        name: adopted.cv_original_name,
        mime_type: adopted.cv_mimetype,
        file_hash: adopted.cv_file_hash,
        uploaded_at: new Date().toISOString()
      }]
    })
    delete update.created
  }
  if (!Object.keys(update).length) return { adopted: null }
  update.updated_by = userId
  update.updated_at = new Date().toISOString()
  const { error } = await supabase.from('candidates').update(update).eq('id', existing.id)
  if (error) {
    await removeAdoptedResumeIfUnreferenced(supabase, adopted)
    throw error
  }
  return { adopted }
}

async function loadLiveContext(application) {
  if (!application.job_id || !application.client_id) throw Object.assign(new Error('The original mandate or client no longer exists.'), { statusCode: 409 })
  const [{ data: job, error: jobError }, { data: client, error: clientError }] = await Promise.all([
    supabase.from('jobs').select('id, title, client_id, mandate_status, is_public, application_deadline, clients(client_name, name)').eq('id', application.job_id).maybeSingle(),
    supabase.from('clients').select('id, client_name, name').eq('id', application.client_id).maybeSingle()
  ])
  if (jobError) throw jobError
  if (clientError) throw clientError
  if (!job || !client) throw Object.assign(new Error('The original mandate or client no longer exists.'), { statusCode: 409 })
  return { job, client }
}

function roleNeedsHistoricalConfirmation(job) {
  return !job.is_public || normalizeMandateStatus(job.mandate_status) !== 'Ongoing (P1)' || !job.application_deadline || job.application_deadline < indiaDate()
}

async function notifyConversion(req, candidate, association) {
  try {
    await Promise.all([
      syncHiredMandate(association.job_id, association.status),
      createConsultantAssignmentNotification({
        type: 'candidate',
        senderId: req.user.id,
        consultantUserId: association.consultant_user_id,
        consultantName: association.consultant_name,
        entityName: candidate.full_name,
        clientId: association.client_id
      })
    ])
  } catch (error) {
    console.error('applied candidate post-conversion notification:', error.message)
  }
}

async function convertAppliedCandidate(req, res) {
  let claim = null
  let adopted = null
  let insertedCandidateId = ''
  let provisionalCandidateId = ''
  let durableAssociation = null
  try {
    const initial = await getApplication(supabase, req.params.id)
    if (initial?.application_status === 'converting') {
      const durableMarker = await findAssociationByMarker(initial.id)
      if (durableMarker) {
        const finalized = await finalizeRecoveredMarker(initial, durableMarker, req.user.id, initial.processing_token)
        return res.json({ data: {
          application_status: finalized.application_status,
          candidate_id: durableMarker.candidate_id,
          association_id: durableMarker.id
        } })
      }
    }
    claim = await claimApplication(supabase, req.params.id)
    const application = claim.application
    if (claim.idempotent) {
      return res.json({ data: {
        application_status: application.application_status,
        candidate_id: application.converted_candidate_id,
        association_id: application.converted_association_id
      } })
    }

    const recovered = await findAssociationByMarker(application.id)
    if (recovered) {
      const finalized = await finalizeRecoveredMarker(application, recovered, req.user.id, claim.token)
      return res.json({ data: { application_status: finalized.application_status, candidate_id: recovered.candidate_id, association_id: recovered.id } })
    }

    const { job } = await loadLiveContext(application)
    if (roleNeedsHistoricalConfirmation(job) && !booleanValue(req.body.confirm_closed_role)) {
      throw Object.assign(new Error('This role is closed, unpublished, or expired. Confirm historical conversion to continue.'), { statusCode: 409, releaseClaim: true })
    }

    const action = candidateCreation.clean(req.body.action || 'create')
    if (!['create', 'link_existing'].includes(action)) throw Object.assign(new Error('Choose whether to create or link the candidate.'), { statusCode: 400, releaseClaim: true })
    const requested = action === 'link_existing' ? requestedBlankFields(req.body.fill_blank_fields) : new Set()
    const admin = await isAdmin(req.user)
    await assertCanUpdateColumns('candidates', {
      ...candidateCreation.conversionRequestPermissionPayload(req.body),
      ...candidateCreation.conversionBlankFillPermissionPayload(requested)
    }, admin)

    const normalizedBody = { ...req.body, skills: req.body.skills === undefined ? application.skills : parseStringArray(req.body.skills) }
    let { candidate: candidatePayload, association: associationPayload } = candidateCreation.conversionPayload(application, normalizedBody)
    const validationErrors = candidateCreation.validateCandidatePayload({ ...candidatePayload, ...associationPayload })
    if (Object.keys(validationErrors).length) {
      throw Object.assign(new Error('Please correct the candidate details.'), { statusCode: 400, errors: validationErrors, releaseClaim: true })
    }
    await Promise.all([
      candidateCreation.validateMandateReference(supabase, associationPayload),
      candidateCreation.validateConsultantReference(supabase, associationPayload)
    ])

    const duplicates = await candidateCreation.findCandidateRowsByIdentity(supabase, candidatePayload.email, candidatePayload.mobile_number)

    if (application.converted_candidate_id && action !== 'create') {
      throw Object.assign(new Error('This partial conversion must resume candidate creation rather than link a different candidate.'), {
        statusCode: 409,
        preserveClaim: true
      })
    }

    if (action === 'link_existing') {
      const candidateId = candidateCreation.clean(req.body.existing_candidate_id)
      const existing = duplicates.find((candidate) => candidate.id === candidateId)
      if (!existing) throw Object.assign(new Error('Select one of the current duplicate candidates to link.'), { statusCode: 409, duplicateCandidates: duplicates, releaseClaim: true })
      await assertRowEditable('candidates', existing.id, admin)
      await fillExistingCandidateBlanks(application, existing, candidatePayload, requested, req.user.id)
      let association = await findExactAssociation(existing.id, application.job_id)
      if (!association) {
        const result = await candidateCreation.insertAssociation(supabase, {
          ...associationPayload,
          candidate_id: existing.id,
          created_by: req.user.id
        })
        if (result.error?.code === '23505') association = await findExactAssociation(existing.id, application.job_id)
        else if (result.error) throw result.error
        else association = result.data
      }
      durableAssociation = association
      const finalized = await finalizeApplication(supabase, application.id, claim.token, {
        application_status: 'linked_existing',
        candidate_id: existing.id,
        association_id: association.id,
        user_id: req.user.id
      })
      await notifyConversion(req, existing, association)
      return res.json({ data: { application_status: finalized.application_status, candidate_id: existing.id, association_id: association.id } })
    }

    let candidate = null
    if (application.converted_candidate_id) {
      provisionalCandidateId = application.converted_candidate_id
      candidate = await findCandidateById(provisionalCandidateId)
    } else {
      if (duplicates.length) throw Object.assign(new Error('A candidate already exists with this email or mobile number.'), { statusCode: 409, duplicateCandidates: duplicates, releaseClaim: true })
      adopted = await adoptStagedResume(supabase, application)
      ;({ candidate: candidatePayload, association: associationPayload } = candidateCreation.conversionPayload(application, normalizedBody, {
        ...adopted,
        cv_attachments: [{
          path: adopted.cv_storage_path,
          name: adopted.cv_original_name,
          mime_type: adopted.cv_mimetype,
          file_hash: adopted.cv_file_hash,
          uploaded_at: new Date().toISOString()
        }]
      }))
      delete candidatePayload.created
      const candidateResult = await candidateCreation.insertCandidateWithDisplayId(supabase, { ...candidatePayload, created_by: req.user.id })
      if (candidateResult.error) {
        if (candidateResult.error.code === '23505') {
          const raceDuplicates = await candidateCreation.findCandidateRowsByIdentity(supabase, candidatePayload.email, candidatePayload.mobile_number)
          if (raceDuplicates.length) {
            throw Object.assign(new Error('A candidate already exists with this email or mobile number.'), { statusCode: 409, duplicateCandidates: raceDuplicates, releaseClaim: true })
          }
        }
        throw candidateResult.error
      }
      candidate = candidateResult.data
      insertedCandidateId = candidate.id
      await recordConversionCandidate(supabase, application.id, claim.token, candidate.id)
      provisionalCandidateId = candidate.id
      insertedCandidateId = ''
    }
    let convertedCandidate = candidate
    const associationResult = await candidateCreation.insertAssociation(supabase, {
      ...associationPayload,
      candidate_id: candidate.id,
      public_application_id: application.id,
      created_by: req.user.id
    }, { requirePublicMarker: true })
    if (associationResult.error) {
      if (associationResult.error.code === '23505') {
        durableAssociation = await findAssociationByMarker(application.id)
        if (!durableAssociation) {
          const exactAssociation = await findExactAssociation(candidate.id, application.job_id)
          if (exactAssociation) durableAssociation = await markExactAssociation(exactAssociation, application.id)
        }
      }
      if (!durableAssociation) {
        if (provisionalCandidateId) associationResult.error.preserveClaim = true
        throw associationResult.error
      }
    } else {
      durableAssociation = associationResult.data
    }
    if (durableAssociation.candidate_id !== candidate.id) {
      const removed = await candidateCreation.removeCandidateIfUnassociated(supabase, candidate.id)
      if (!removed) {
        throw Object.assign(new Error('The duplicate conversion candidate is already associated and requires recovery before finalization.'), {
          statusCode: 500,
          preserveClaim: true
        })
      }
      insertedCandidateId = ''
      provisionalCandidateId = ''
      const { data: recoveredCandidate } = await supabase.from('candidates').select('id, full_name').eq('id', durableAssociation.candidate_id).maybeSingle()
      if (recoveredCandidate) convertedCandidate = recoveredCandidate
    }
    const finalized = await finalizeApplication(supabase, application.id, claim.token, {
      application_status: 'converted',
      candidate_id: durableAssociation.candidate_id,
      association_id: durableAssociation.id,
      user_id: req.user.id
    })
    await notifyConversion(req, convertedCandidate, durableAssociation)
    return res.json({ data: {
      application_status: finalized.application_status,
      candidate_id: durableAssociation.candidate_id,
      association_id: durableAssociation.id
    } })
  } catch (error) {
    let cleanupFailure = null
    if (insertedCandidateId && !durableAssociation) {
      try {
        const recoveredMarker = claim?.application?.id ? await findAssociationByMarker(claim.application.id) : null
        if (recoveredMarker) {
          durableAssociation = recoveredMarker
        } else {
          const removed = await candidateCreation.removeCandidateIfUnassociated(supabase, insertedCandidateId)
          if (!removed) {
            throw Object.assign(new Error('The inserted candidate is already associated and requires recovery before the application can be retried.'), {
              statusCode: 500,
              preserveClaim: true
            })
          }
          insertedCandidateId = ''
        }
      } catch (candidateCleanupFailure) {
        if (claim?.token && claim?.application?.id && insertedCandidateId) {
          try {
            await recordConversionCandidate(supabase, claim.application.id, claim.token, insertedCandidateId)
            provisionalCandidateId = insertedCandidateId
            insertedCandidateId = ''
          } catch (recordFailure) {
            cleanupFailure = candidateCleanupFailure
            console.error('record recoverable applied candidate:', recordFailure.message)
          }
        } else {
          cleanupFailure = candidateCleanupFailure
        }
      }
    }
    if (!durableAssociation && !provisionalCandidateId) await removeAdoptedResumeIfUnreferenced(supabase, adopted)
    if (claim?.token && !cleanupFailure && !provisionalCandidateId && (!durableAssociation || error.releaseClaim) && !error.preserveClaim) {
      try { await releaseApplicationClaim(supabase, req.params.id, claim.token) } catch (releaseError) { console.error('release applied candidate claim:', releaseError.message) }
    }
    if (cleanupFailure) return sendInternal(res, 'convertAppliedCandidate cleanup', cleanupFailure)
    if (error.duplicateCandidates) {
      try {
        return await duplicateResponse(res, error.duplicateCandidates, await isAdmin(req.user))
      } catch (permissionError) {
        return sendInternal(res, 'convertAppliedCandidate duplicate permissions', permissionError)
      }
    }
    return sendInternal(res, 'convertAppliedCandidate', error)
  }
}

module.exports = {
  listAppliedCandidates,
  getAppliedCandidate,
  getAppliedCandidateCv,
  rejectAppliedCandidate,
  updateAppliedCandidateStatus,
  convertAppliedCandidate
}
