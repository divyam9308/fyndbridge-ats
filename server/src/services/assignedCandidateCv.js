const fs = require('fs/promises')
const { createHash } = require('crypto')
const { createBulkResumeParser } = require('./bulkResumeParser')
const { extractName, extractPhone } = require('./extractorUtils')
const { withAssignedCvParsing } = require('./assignedCvParsing')
const { STORAGE_BUCKETS } = require('./storageBuckets')

// Reuses PDF text-first/OCR extraction without full AI parsing or enrichment.
const parseIdentity = createBulkResumeParser({
  normalizeText: text => String(text || '').replaceAll('\u0000', '').trim(),
  parseResumeTextImpl: async text => ({ full_name: extractName(text)[0] || '', mobile_number: extractPhone(text) || '' }),
  parseResumeFileImpl: async () => { throw new Error('Manual details required for this document.') },
  logger: { info() {}, warn() {}, error() {} }
})

async function prepareAssignedCv(file, id, userId) {
  const { getDocumentFileMeta } = require('./documentFile')
  const meta = getDocumentFileMeta(file)
  const buffer = await fs.readFile(file.path)
  if (!buffer.length) throw Object.assign(new Error('The selected CV is empty. Select a valid file.'), { statusCode: 400 })
  const hash = createHash('sha256').update(buffer).digest('hex')
  const path = `assigned/${userId}/${id}-${hash}.${meta.extension}`
  let parsed = {}; let parseError = ''
  try { parsed = await withAssignedCvParsing(() => parseIdentity(file)) } catch { parseError = 'Could not parse this CV. Enter the details manually.' }
  if (!parsed.full_name || !parsed.mobile_number) parseError = parseError || 'Enter missing candidate details manually.'
  return { buffer, metadata: { id, uploaded_by: userId, cv_storage_path: path, cv_original_name: meta.originalName,
    cv_mimetype: meta.contentType, cv_file_hash: hash, file_size: buffer.length,
    parsed_name: parsed.full_name || '', parsed_mobile: parsed.mobile_number || '', parse_error: parseError } }
}

async function cleanupAssignedCvs(supabase) {
  const { data, error } = await supabase.from('assigned_candidate_uploads').select('id,cv_storage_path')
    .or(`retired_at.not.is.null,expires_at.lt.${new Date().toISOString()}`).order('created_at').limit(100)
  if (error) throw error
  let pending = (data || []).length === 100 ? 1 : 0
  for (const row of data || []) {
    try {
      const claim = await supabase.rpc('claim_assigned_cv_cleanup', { p_id: row.id })
      if (claim.error) throw claim.error
      if (!claim.data) continue
      // All reference queries are targeted; no candidate table download.
      const path = row.cv_storage_path
      const legacy = await supabase.from('candidates').select('id', { head: true, count: 'exact' })
        .or(`cv_storage_path.eq.${path},cv_link.eq.${path},resume_url.eq.${path}`)
      const attachments = await supabase.from('candidates').select('id', { head: true, count: 'exact' })
        .contains('cv_attachments', [{ path }])
      if (legacy.error || attachments.error) throw legacy.error || attachments.error
      if (legacy.count || attachments.count) {
        const kept = await supabase.from('assigned_candidate_uploads').update({ cleanup_claimed_at: null, retired_at: null, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }).eq('id', row.id)
        if (kept.error) throw kept.error
        continue
      }
      const removed = await supabase.storage.from(STORAGE_BUCKETS.CV).remove([path])
      if (removed.error) throw removed.error
      const deleted = await supabase.from('assigned_candidate_uploads').delete().eq('id', row.id)
      if (deleted.error) throw deleted.error
    } catch {
      pending += 1 // Durable upload row retains the cleanup job for a retry.
      await supabase.from('assigned_candidate_uploads').update({ cleanup_claimed_at: null }).eq('id', row.id)
    }
  }
  return pending
}
module.exports = { parseIdentity, prepareAssignedCv, cleanupAssignedCvs }
