const fs = require('node:fs/promises')
const { randomUUID, createHash } = require('node:crypto')
const { waitUntil } = require('@vercel/functions')
const { getDocumentFileMeta } = require('./documentFile')
const { brandCvPdf, inspectBrandedCvPdf } = require('./cvBrandingPdf')
const { convertWordToPdf } = require('./cvWordConversion')
const { isBrandedCvPath } = require('../../../shared/cvBranding.cjs')
const STAGING_BUCKET = 'cv-branding-staging'
const CV_BUCKET = 'resumes'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const unwrap = result => { if (result.error) throw result.error; return result.data }
const pdfName = name => String(name || 'CV.pdf').replace(/\.(pdf|docx?)$/i, '') + '.pdf'

function createCvBrandingService({ supabase, brandPdf = brandCvPdf, convertWord = convertWordToPdf, logger = console, runTransfers = async () => {} }) {
  const table = () => supabase.from('cv_branding_jobs')
  async function getJob(targetPath) { return unwrap(await table().select('*').eq('target_path', targetPath).maybeSingle()) }
  async function verifyReady(targetPath) {
    const job = await getJob(targetPath)
    if (job?.status !== 'ready' || !job.result_sha256) return null
    try {
      const blob = unwrap(await supabase.storage.from(CV_BUCKET).download(targetPath))
      const bytes = Buffer.from(await blob.arrayBuffer())
      if (hash(bytes) !== job.result_sha256 || !(await inspectBrandedCvPdf(bytes)).branded) return null
      return job
    } catch { return null }
  }
  async function findVerifiedByHash(sourceHash) {
    if (!/^[a-f0-9]{64}$/i.test(String(sourceHash || ''))) return null
    const jobs = unwrap(await table().select('*').eq('status', 'ready')
      .or(`source_sha256.eq.${sourceHash},result_sha256.eq.${sourceHash}`).order('completed_at').limit(20)) || []
    for (const job of jobs) {
      const verified = await verifyReady(job.target_path)
      if (verified) return verified
    }
    return null
  }
  async function stage(file, { buffer, targetPath } = {}) {
    const meta = getDocumentFileMeta(file)
    if (meta.extension !== 'pdf' && !process.env.CV_WORD_CONVERTER_URL && convertWord === convertWordToPdf) {
      throw Object.assign(new Error('Word CV conversion is not configured. Please upload a PDF CV.'), { statusCode: 400 })
    }
    buffer ||= file.buffer || await fs.readFile(file.path)
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('Each CV must be between 1 byte and 10 MB.'), { statusCode: 400 })
    const inputHash = hash(buffer)
    const verified = await findVerifiedByHash(inputHash)
    let sourceHash = verified?.source_sha256 || inputHash
    if (!targetPath && verified) return { path: verified.target_path, fileName: pdfName(meta.originalName), contentType: 'application/pdf',
      fileHash: sourceHash, size: verified.file_size, uploadedAt: new Date().toISOString(), bucket: CV_BUCKET, url: '' }
    const id = randomUUID()
    targetPath ||= `branded/fb1/${id}-${sourceHash}.pdf`
    if (!isBrandedCvPath(targetPath)) throw new Error('Invalid branded CV destination.')
    let job = await getJob(targetPath)
    // A verified derivative carries the original identity even when its old
    // stored copy has since disappeared. The supplied bytes must still prove it.
    if (job && inputHash === job.result_sha256 && meta.extension === 'pdf' && (await inspectBrandedCvPdf(buffer)).branded) sourceHash = job.source_sha256
    if (job && (job.source_sha256 !== sourceHash || job.status === 'cancelled')) throw Object.assign(new Error('This CV upload has expired. Please select the file again.'), { statusCode: 409 })
    if (job && !job.source_path && ['ready', 'failed'].includes(job.status) && !await verifyReady(targetPath)) {
      const repaired = unwrap(await table().update({ source_path: `${randomUUID()}.${meta.extension}`, source_extension: meta.extension,
        original_name: meta.originalName, input_sha256: inputHash, status: 'staging', attempts: 0, result_sha256: null,
        file_size: null, page_count: null, completed_at: null, last_error: null, next_attempt_at: new Date().toISOString() })
        .eq('id', job.id).eq('status', job.status).is('lease_token', null).select('*').maybeSingle())
      job = repaired || await getJob(targetPath)
      if (!job || job.status === 'cancelled') throw Object.assign(new Error('This CV upload has expired. Please select the file again.'), { statusCode: 409 })
    }
    if (!job) {
      const result = await table().insert({ id, target_path: targetPath, source_path: `${id}.${meta.extension}`,
        source_extension: meta.extension, original_name: meta.originalName, source_sha256: sourceHash, input_sha256: inputHash, status: 'staging' }).select('*').single()
      if (result.error?.code === '23505') job = await getJob(targetPath)
      else job = unwrap(result)
      if (!job || job.source_sha256 !== sourceHash || job.status === 'cancelled') throw new Error('CV upload could not be reserved.')
    }
    if (job.status === 'staging') {
      try {
        const upload = await supabase.storage.from(STAGING_BUCKET).upload(job.source_path, buffer, { contentType: meta.contentType, upsert: false })
        if (upload.error && !/already exists|duplicate/i.test(upload.error.message || '')) throw upload.error
        unwrap(await table().update({ status: 'queued', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'staging'))
      } catch (error) {
        // Keep the upload reservation retryable if storage/network failed.
        await table().update({ last_error: 'CV upload did not finish. Please retry.' }).eq('id', job.id).eq('status', 'staging')
        throw error
      }
    }
    return { path: targetPath, fileName: pdfName(meta.originalName), contentType: 'application/pdf', fileHash: sourceHash,
      size: buffer.length, uploadedAt: new Date().toISOString(), bucket: CV_BUCKET, url: '' }
  }
  async function statuses(paths) {
    const wanted = [...new Set(paths)].filter(isBrandedCvPath)
    if (!wanted.length) return []
    const rows = unwrap(await table().select('target_path,status,last_error,attempts,source_path').in('target_path', wanted)) || []
    const byPath = new Map(rows.map(row => [row.target_path, row]))
    return wanted.map(path => {
      const row = byPath.get(path)
      const status = row?.status === 'failed' && row.source_path && row.attempts < 3 ? 'retrying' : row?.status || 'failed'
      return { path, status, ...(status === 'failed' ? { error: row && !row.source_path
        ? 'The saved CV could not be verified. Please upload the CV again.' : 'CV branding could not finish. Please retry or upload the CV again.' } : {}) }
    })
  }
  async function assertReady(path) {
    if (!isBrandedCvPath(path)) return
    const job = await verifyReady(path)
    if (!job) {
      let current = await getJob(path)
      if (current?.status === 'ready') {
        unwrap(await table().update({ status: 'failed', attempts: 3,
          last_error: 'The saved CV could not be verified. Please upload the CV again.', updated_at: new Date().toISOString() })
          .eq('id', current.id).eq('status', 'ready').eq('result_sha256', current.result_sha256))
        current = await getJob(path)
      }
      const irrecoverable = current?.status === 'failed' && !current.source_path
      throw Object.assign(new Error(irrecoverable ? 'The saved CV could not be verified. Please upload the CV again.' : current?.status === 'failed'
        ? 'CV branding failed. Retry branding before opening this CV.' : 'The CV is being branded. Please wait before opening it.'),
      { statusCode: 423, code: irrecoverable ? 'CV_BRANDING_REUPLOAD_REQUIRED' : 'CV_BRANDING_PENDING' })
    }
  }
  async function retry(paths) {
    if (!paths.length) return
    unwrap(await table().update({ status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
      .in('target_path', paths).eq('status', 'failed').not('source_path', 'is', null))
  }
  async function change(job, patch) {
    return unwrap(await table().update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id)
      .eq('lease_token', job.lease_token).eq('status', job.status).select('*').maybeSingle())
  }
  async function cleanupCancelled(job) {
    const current = await getJob(job.target_path)
    if (current?.status !== 'cancelled') return
    if (!await require('./cvStorageIntegrity').removeCvIfUnreferenced(supabase, current.target_path)) return
    if (current.source_path) unwrap(await supabase.storage.from(STAGING_BUCKET).remove([current.source_path]))
    unwrap(await table().update({ source_path: null, lease_token: null, lease_until: null }).eq('id', current.id).eq('status', 'cancelled'))
  }
  async function processJob(claimed) {
    let job = claimed
    try {
      if (job.status === 'cancelled') { await cleanupCancelled(job); return }
      if (job.status !== 'finalizing') {
        const blob = unwrap(await supabase.storage.from(STAGING_BUCKET).download(job.source_path))
        let bytes = Buffer.from(await blob.arrayBuffer())
        if (hash(bytes) !== (job.input_sha256 || job.source_sha256)) throw new Error('CV source verification failed.')
        if (job.source_extension !== 'pdf') bytes = await convertWord(bytes, job.original_name)
        const result = await brandPdf(bytes)
        if (!(await inspectBrandedCvPdf(result.bytes)).branded) throw new Error('CV logo verification failed.')
        // Check the lease immediately before writing a job-owned destination.
        const current = await getJob(job.target_path)
        if (current?.status !== 'processing' || current.lease_token !== job.lease_token) { await cleanupCancelled(job); return }
        unwrap(await supabase.storage.from(CV_BUCKET).upload(job.target_path, result.bytes, { contentType: 'application/pdf', upsert: true, cacheControl: '0' }))
        const saved = unwrap(await supabase.storage.from(CV_BUCKET).download(job.target_path))
        const savedBytes = Buffer.from(await saved.arrayBuffer())
        if (hash(savedBytes) !== hash(result.bytes) || !(await inspectBrandedCvPdf(savedBytes)).branded) throw new Error('The saved branded CV could not be verified.')
        const updated = await change(job, { status: 'finalizing', result_sha256: hash(result.bytes), file_size: result.bytes.length, page_count: result.pageCount })
        if (!updated) { await cleanupCancelled(job); return }
        job = updated
      } else {
        const saved = unwrap(await supabase.storage.from(CV_BUCKET).download(job.target_path))
        const savedBytes = Buffer.from(await saved.arrayBuffer())
        if (hash(savedBytes) !== job.result_sha256 || !(await inspectBrandedCvPdf(savedBytes)).branded) throw new Error('Branded CV verification failed before cleanup.')
      }
      // Opening stays blocked until the private original has actually been removed.
      if (job.source_path) unwrap(await supabase.storage.from(STAGING_BUCKET).remove([job.source_path]))
      if (!await change(job, { status: 'ready', source_path: null, lease_token: null, lease_until: null, last_error: null, completed_at: new Date().toISOString() })) await cleanupCancelled(job)
    } catch (error) {
      logger.error('CV branding job failed:', { id: job.id, code: error.code || 'BRANDING_FAILED' })
      const updated = await change(job, { status: job.status === 'finalizing' ? 'finalizing' : 'failed', lease_token: null, lease_until: null,
        next_attempt_at: new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 5))).toISOString(),
        last_error: 'CV branding could not finish. Please retry or upload the CV again.' })
      if (!updated) await cleanupCancelled(job)
    }
  }
  async function run({ paths = null, limit = 3 } = {}) {
    const deadline = Date.now() + 50000
    let processed = 0
    await runTransfers({ limit: 3 })
    while (processed < limit && Date.now() < deadline - 30000) {
      const jobs = unwrap(await supabase.rpc('claim_cv_branding_jobs', { p_paths: paths, p_limit: 1 })) || []
      if (!jobs.length) break
      await processJob(jobs[0]); processed++
    }
    if (Date.now() < deadline - 5000) await runTransfers({ limit: 3 })
    return { processed }
  }
  function schedule(paths) {
    const work = run({ paths }).catch(error => logger.error('CV branding worker:', { code: error.code || 'WORKER_FAILED' }))
    waitUntil(work)
  }
  async function cancel(paths) {
    if (!paths.length) return
    for (const path of [...new Set(paths)]) {
      if (!await require('./cvStorageIntegrity').removeCvIfUnreferenced(supabase, path)) continue
      const job = await getJob(path)
      if (job && (!job.lease_until || new Date(job.lease_until) < new Date())) await cleanupCancelled(job)
    }
  }
  async function reap() {
    await require('./cvStorageIntegrity').reapPendingCvDeletions(supabase)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const jobs = unwrap(await table().select('*').lt('created_at', cutoff).neq('status', 'cancelled').order('updated_at').limit(20)) || []
    let removed = 0
    for (const job of jobs) {
      if (await require('./cvStorageIntegrity').removeCvIfUnreferenced(supabase, job.target_path)) { await cleanupCancelled(job); removed++ }
      else unwrap(await table().update({ updated_at: new Date().toISOString() }).eq('id', job.id))
    }
    return { removed }
  }
  return { stage, statuses, assertReady, verifyReady, findVerifiedByHash, retry, run, schedule, cancel, reap, getJob }
}
let instance
function cvBranding() { return instance ||= createCvBrandingService({ supabase: require('./supabaseAdmin'),
  runTransfers: options => require('./assignedCvTransfer').assignedCvTransfer().run(options) }) }
module.exports = { cvBranding, createCvBrandingService, STAGING_BUCKET, CV_BUCKET, isBrandedCvPath, hash, pdfName }
