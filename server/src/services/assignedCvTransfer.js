const { normalizeStoragePath } = require('./storageBuckets')
const unwrap = result => { if (result.error) throw result.error; return result.data }
const errorMessage = 'CV transfer could not finish. Retry the transfer after reviewing its assignment.'

function createAssignedCvTransferService({ supabase, branding, authorize = async () => {}, logger = console }) {
  const table = () => supabase.from('assigned_cv_transfer_requests')
  async function get(id) { return unwrap(await table().select('*').eq('assignment_id', id).maybeSingle()) }
  async function enqueue({ id, actorId, candidate, association, existingId = null, upload }) {
    let request = await get(id)
    if (request?.status === 'pending' || request?.status === 'complete') return request
    const payload = { assignment_id: id, actor_id: actorId, candidate_payload: candidate, association_payload: association,
      existing_candidate_id: existingId, source_path: normalizeStoragePath(upload?.cv_storage_path, 'resumes') || null,
      status: 'pending', last_error: null, attempts: 0, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (request) {
      request = unwrap(await table().update(payload).eq('assignment_id', id).eq('status', 'failed').select('*').maybeSingle()) || await get(id)
    } else {
      const result = await table().insert(payload).select('*').single()
      if (result.error?.code === '23505') request = await get(id)
      else request = unwrap(result)
    }
    return request
  }
  async function retry(id) {
    const request = await get(id)
    if (!request) throw Object.assign(new Error('Transfer not found.'), { statusCode: 404 })
    if (request.status !== 'failed') return request
    if (request.target_path) await branding.retry([request.target_path])
    return unwrap(await table().update({ status: 'pending', attempts: 0, last_error: null,
      next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('assignment_id', id).eq('status', 'failed').select('*').maybeSingle()) || await get(id)
  }
  async function process(request) {
    const assignment = unwrap(await supabase.from('assigned_candidates').select('*,assigned_candidate_uploads(*)')
      .eq('id', request.assignment_id).maybeSingle())
    if (!assignment) return
    await authorize(request, assignment)
    const upload = assignment.assigned_candidate_uploads
    let target = request.target_path
    if (request.source_path) {
      if (!target) {
        // A transfer is the only caller that stages an existing assigned CV.
        // The original upload remains unchanged and recoverable until completion.
        const known = await branding.getJob(request.source_path)
        if (known) target = known.target_path
        else {
          const blob = unwrap(await supabase.storage.from('resumes').download(request.source_path))
          if (blob.size > 10 * 1024 * 1024) throw new Error('CV exceeds the supported size.')
          const buffer = Buffer.from(await blob.arrayBuffer())
          const equivalent = await branding.findVerifiedByHash(require('./cvBranding').hash(buffer))
          if (equivalent) target = equivalent.target_path
          else {
            const staged = await branding.stage({ buffer, originalname: upload?.cv_original_name || 'CV.pdf',
              mimetype: upload?.cv_mimetype || 'application/pdf' }, { buffer, targetPath: `branded/fb1/transfer-${assignment.upload_id}.pdf` })
            target = staged.path
          }
        }
        unwrap(await table().update({ target_path: target, updated_at: new Date().toISOString() })
          .eq('assignment_id', request.assignment_id).eq('status', 'pending'))
      }
      const job = await branding.getJob(target)
      const ready = job?.status === 'ready' ? await branding.verifyReady(target) : null
      if (request.source_path !== target && job &&
        (job.status === 'ready' && !ready || job.status === 'failed' && !job.source_path)) {
        // A targeted transfer still owns its legacy source. Repair only this
        // defective reservation, without touching unrelated historical CVs.
        const original = unwrap(await supabase.storage.from('resumes').download(request.source_path))
        if (original.size > 10 * 1024 * 1024) throw new Error('CV exceeds the supported size.')
        const buffer = Buffer.from(await original.arrayBuffer())
        await branding.stage({ buffer, originalname: upload?.cv_original_name || 'CV.pdf', mimetype: upload?.cv_mimetype || 'application/pdf' },
          { buffer, targetPath: target })
        return false
      }
      if (job?.status === 'failed' && job.attempts >= 3 || job?.status === 'cancelled') throw new Error('CV branding failed.')
      if (job?.status !== 'ready') return false
      if (!ready) throw new Error('Stored branded CV could not be verified. Re-upload or retry from the source CV.')
      unwrap(await table().update({ source_sha256: job.source_sha256 }).eq('assignment_id', request.assignment_id).eq('status', 'pending'))
    }
    const candidate = { ...request.candidate_payload }
    if (request.existing_candidate_id) {
      const current = unwrap(await supabase.from('candidates').select('*').eq('id', request.existing_candidate_id).maybeSingle())
      if (!current) throw new Error('Destination candidate no longer exists.')
      const evidence = await require('./cvDocumentIdentity').resolveTransferCvEvidence(supabase, current,
        { priorEvidence: candidate._cv_identity_evidence, limit: 5 })
      candidate._cv_identity_evidence = evidence
      candidate._cv_identity_snapshot = evidence.__snapshot
      if (!evidence.__complete) {
        unwrap(await table().update({ candidate_payload: candidate }).eq('assignment_id', request.assignment_id).eq('status', 'pending'))
        return false
      }
    }
    candidate._cv_identity_evidence ||= {}
    candidate._cv_identity_evidence.__verified_paths ||= {}
    if (target) candidate._cv_identity_evidence.__verified_paths[target] = true
    const result = await supabase.rpc('transfer_assigned_candidate', { p_id: request.assignment_id, p_actor: request.actor_id,
      p_candidate: candidate, p_association: request.association_payload, p_existing: request.existing_candidate_id })
    unwrap(result)
    // RPC commits the candidate, association, assignment and request together.
    return true
  }
  async function run({ limit = 3 } = {}) {
    const requests = unwrap(await table().select('*').eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
      .order('created_at').limit(Math.min(3, Math.max(1, limit)))) || []
    let completed = 0
    for (const request of requests) {
      const claimed = unwrap(await table().update({ next_attempt_at: new Date(Date.now() + 120000).toISOString(),
        updated_at: new Date().toISOString() }).eq('assignment_id', request.assignment_id).eq('status', 'pending')
        .eq('updated_at', request.updated_at).select('*').maybeSingle())
      if (!claimed) continue
      try {
        if (await process(claimed)) completed++
        else unwrap(await table().update({ next_attempt_at: new Date().toISOString() })
          .eq('assignment_id', request.assignment_id).eq('status', 'pending'))
      } catch (error) {
        logger.error('Assigned CV transfer failed:', { id: request.assignment_id, code: error.code || 'TRANSFER_FAILED' })
        // Another transfer may have changed this candidate after byte verification.
        // Rebuild the evidence against its new complete attachment list.
        if (error.code === '40001') {
          const candidate = { ...request.candidate_payload }
          delete candidate._cv_identity_evidence
          delete candidate._cv_identity_snapshot
          unwrap(await table().update({ candidate_payload: candidate, next_attempt_at: new Date().toISOString() })
            .eq('assignment_id', request.assignment_id).eq('status', 'pending'))
          continue
        }
        // The reviewed payload and original assigned upload remain durable.
        unwrap(await table().update({ status: 'failed', attempts: request.attempts + 1,
          last_error: errorMessage, updated_at: new Date().toISOString() }).eq('assignment_id', request.assignment_id).eq('status', 'pending'))
      }
    }
    return { completed }
  }
  return { get, enqueue, retry, run }
}

let instance
function assignedCvTransfer() {
  return instance ||= createAssignedCvTransferService({ supabase: require('./supabaseAdmin'), branding: require('./cvBranding').cvBranding(),
    authorize: async request => {
      const supabase = require('./supabaseAdmin')
      const result = await supabase.auth.admin.getUserById(request.actor_id)
      if (result.error || !result.data?.user) throw new Error('Transfer actor unavailable.')
      const user = result.data.user
      const access = require('./adminAccess'), admin = await access.isAdmin(user)
      const { assertPageAccess } = require('./documentAccess')
      await assertPageAccess(user, 'assigned_candidates', admin)
      await assertPageAccess(user, 'candidates', admin)
      await access.assertCanUpdateColumns('candidates', { ...request.candidate_payload, ...request.association_payload, cv_files: true }, admin)
      if (request.existing_candidate_id) await access.assertRowEditable('candidates', request.existing_candidate_id, admin)
    } })
}
module.exports = { assignedCvTransfer, createAssignedCvTransferService }
