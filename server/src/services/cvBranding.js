const fs = require('node:fs/promises')
const { randomUUID, createHash } = require('node:crypto')
const { waitUntil } = require('@vercel/functions')
const { getDocumentFileMeta } = require('./documentFile')
const { brandCvPdf } = require('./cvBrandingPdf')
const { convertWordToPdf } = require('./cvWordConversion')
const { isBrandedCvPath } = require('../../../shared/cvBranding.cjs')
const STAGING_BUCKET = 'cv-branding-staging'
const CV_BUCKET = 'resumes'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const unwrap = result => { if (result.error) throw result.error; return result.data }
const pdfName = name => String(name || 'CV.pdf').replace(/\.(pdf|docx?)$/i, '') + '.pdf'

function createCvBrandingService({ supabase, brandPdf = brandCvPdf, convertWord = convertWordToPdf, logger = console }) {
  const table = () => supabase.from('cv_branding_jobs')
  async function getJob(targetPath) { return unwrap(await table().select('*').eq('target_path', targetPath).maybeSingle()) }
  async function stage(file, { buffer, targetPath } = {}) {
    const meta = getDocumentFileMeta(file)
    if (meta.extension !== 'pdf' && !process.env.CV_WORD_CONVERTER_URL && convertWord === convertWordToPdf) {
      throw Object.assign(new Error('Word CV conversion is not configured. Please upload a PDF CV.'), { statusCode: 400 })
    }
    buffer ||= file.buffer || await fs.readFile(file.path)
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('Each CV must be between 1 byte and 10 MB.'), { statusCode: 400 })
    const sourceHash = hash(buffer)
    const id = randomUUID()
    targetPath ||= `branded/fb1/${id}-${sourceHash}.pdf`
    if (!isBrandedCvPath(targetPath)) throw new Error('Invalid branded CV destination.')
    let job = await getJob(targetPath)
    if (job && (job.source_sha256 !== sourceHash || job.status === 'cancelled')) throw Object.assign(new Error('This CV upload has expired. Please select the file again.'), { statusCode: 409 })
    if (!job) {
      const result = await table().insert({ id, target_path: targetPath, source_path: `${id}.${meta.extension}`,
        source_extension: meta.extension, original_name: meta.originalName, source_sha256: sourceHash, status: 'staging' }).select('*').single()
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
    const rows = unwrap(await table().select('target_path,status,last_error,attempts').in('target_path', wanted)) || []
    const byPath = new Map(rows.map(row => [row.target_path, row]))
    return wanted.map(path => {
      const row = byPath.get(path)
      const status = row?.status === 'failed' && row.attempts < 3 ? 'retrying' : row?.status || 'failed'
      return { path, status, ...(status === 'failed' ? { error: 'CV branding could not finish. Please retry or upload the CV again.' } : {}) }
    })
  }
  async function assertReady(path) {
    if (!isBrandedCvPath(path)) return
    const job = await getJob(path)
    if (job?.status !== 'ready') throw Object.assign(new Error(job?.status === 'failed'
      ? 'CV branding failed. Retry branding before opening this CV.' : 'The CV is being branded. Please wait before opening it.'), { statusCode: 423, code: 'CV_BRANDING_PENDING' })
  }
  async function retry(paths) {
    if (!paths.length) return
    unwrap(await table().update({ status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
      .in('target_path', paths).eq('status', 'failed'))
  }
  async function change(job, patch) {
    return unwrap(await table().update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id)
      .eq('lease_token', job.lease_token).eq('status', job.status).select('*').maybeSingle())
  }
  async function cleanupCancelled(job) {
    const current = await getJob(job.target_path)
    if (current?.status !== 'cancelled') return
    unwrap(await supabase.storage.from(CV_BUCKET).remove([current.target_path]))
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
        if (hash(bytes) !== job.source_sha256) throw new Error('CV source verification failed.')
        if (job.source_extension !== 'pdf') bytes = await convertWord(bytes, job.original_name)
        const result = await brandPdf(bytes)
        // Check the lease immediately before writing a job-owned destination.
        const current = await getJob(job.target_path)
        if (current?.status !== 'processing' || current.lease_token !== job.lease_token) { await cleanupCancelled(job); return }
        unwrap(await supabase.storage.from(CV_BUCKET).upload(job.target_path, result.bytes, { contentType: 'application/pdf', upsert: true, cacheControl: '0' }))
        const saved = unwrap(await supabase.storage.from(CV_BUCKET).download(job.target_path))
        if (hash(Buffer.from(await saved.arrayBuffer())) !== hash(result.bytes)) throw new Error('The saved branded CV could not be verified.')
        const updated = await change(job, { status: 'finalizing', result_sha256: hash(result.bytes), file_size: result.bytes.length, page_count: result.pageCount })
        if (!updated) { await cleanupCancelled(job); return }
        job = updated
      } else {
        const saved = unwrap(await supabase.storage.from(CV_BUCKET).download(job.target_path))
        if (hash(Buffer.from(await saved.arrayBuffer())) !== job.result_sha256) throw new Error('Branded CV verification failed before cleanup.')
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
    while (processed < limit && Date.now() < deadline - 30000) {
      const jobs = unwrap(await supabase.rpc('claim_cv_branding_jobs', { p_paths: paths, p_limit: 1 })) || []
      if (!jobs.length) break
      await processJob(jobs[0]); processed++
    }
    return { processed }
  }
  function schedule(paths) {
    const work = run({ paths }).catch(error => logger.error('CV branding worker:', { code: error.code || 'WORKER_FAILED' }))
    waitUntil(work)
  }
  async function cancel(paths) {
    if (!paths.length) return
    unwrap(await table().update({ status: 'cancelled' }).in('target_path', paths).neq('status', 'cancelled'))
    const jobs = unwrap(await table().select('*').in('target_path', paths)) || []
    for (const job of jobs) if (!job.lease_until || new Date(job.lease_until) < new Date()) await cleanupCancelled(job)
  }
  async function reap() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const jobs = unwrap(await table().select('*').lt('created_at', cutoff).neq('status', 'cancelled').order('updated_at').limit(20)) || []
    let removed = 0
    for (const job of jobs) {
      const { data: url } = supabase.storage.from(CV_BUCKET).getPublicUrl(job.target_path)
      const values = [...new Set([job.target_path, url?.publicUrl].filter(Boolean))]
      const checks = await Promise.all([
        supabase.from('candidates').select('id', { head: true, count: 'exact' })
          .or(['cv_storage_path', 'cv_link', 'resume_url'].flatMap(field => values.map(value => `${field}.eq.${value}`)).join(',')),
        ...values.map(value => supabase.from('candidates').select('id', { head: true, count: 'exact' }).contains('cv_attachments', JSON.stringify([{ path: value }]))),
        supabase.from('assigned_candidate_uploads').select('id', { head: true, count: 'exact' }).eq('cv_storage_path', job.target_path).eq('storage_ready', true)
      ])
      if (checks.some(result => result.error)) throw checks.find(result => result.error).error
      if (!checks.some(result => result.count)) { await cancel([job.target_path]); removed++ }
      else unwrap(await table().update({ updated_at: new Date().toISOString() }).eq('id', job.id))
    }
    return { removed }
  }
  return { stage, statuses, assertReady, retry, run, schedule, cancel, reap, getJob }
}
let instance
function cvBranding() { return instance ||= createCvBrandingService({ supabase: require('./supabaseAdmin') }) }
module.exports = { cvBranding, createCvBrandingService, STAGING_BUCKET, CV_BUCKET, isBrandedCvPath, hash, pdfName }
