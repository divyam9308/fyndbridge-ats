const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { normalizeAttachment } = require('./documentAttachments')
const { normalizeStoragePath } = require('./storageBuckets')
const SHA256 = /^[0-9a-f]{64}$/i
const validHash = value => SHA256.test(String(value || '')) ? String(value).toLowerCase() : ''
const unwrap = result => { if (result.error) throw result.error; return result.data }

// Include legacy primaries even when a secondary attachment list is present.
function candidateCvDocuments(candidate = {}) {
  const docs = []
  for (const rawPath of [candidate.cv_storage_path, candidate.cv_link, candidate.resume_url]) {
    const path = normalizeStoragePath(rawPath, 'resumes')
    if (!path || docs.some(item => item.path === path)) continue
    const item = normalizeAttachment({ path, name: candidate.cv_original_name, mime_type: candidate.cv_mimetype,
      file_hash: candidate.cv_file_hash }, 'resumes')
    if (item) docs.push(item)
  }
  const attachments = Array.isArray(candidate.cv_attachments) ? candidate.cv_attachments : []
  for (const raw of attachments) {
    const item = normalizeAttachment(raw, 'resumes')
    if (!item) continue
    const existing = docs.find(doc => doc.path === item.path)
    if (existing) Object.assign(existing, Object.fromEntries(Object.entries(item).filter(([, value]) => value !== '' && value !== null)))
    else docs.push(item)
  }
  return docs
}

async function resolveCvIdentity(supabase, attachment, { hashMissing = true } = {}) {
  const path = normalizeStoragePath(attachment?.path, 'resumes')
  const ambiguous = { path, sourceHash: '', branded: false, ambiguous: true }
  if (!path || /^https?:\/\//i.test(path)) return ambiguous
  const declared = validHash(attachment.source_sha256 || attachment.file_hash)
  const byPath = unwrap(await supabase.from('cv_branding_jobs').select('target_path,source_sha256,result_sha256,status,page_count')
    .eq('target_path', path).maybeSingle())
  // Even stored hashes do not prove that the object is present and intact.
  // Hashing is restricted to this selected record; external links are not fetched.
  if (!hashMissing && !declared && !byPath) return ambiguous
  let downloaded
  try { downloaded = await supabase.storage.from('resumes').download(path) } catch { return ambiguous }
  if (downloaded.error || !downloaded.data || downloaded.data.size > 10 * 1024 * 1024) return ambiguous
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return ambiguous
  const bytesHash = createHash('sha256').update(bytes).digest('hex')
  let inspection
  try { inspection = await require('./cvBrandingPdf').inspectBrandedCvPdf(bytes) } catch {
    // Legacy Word sources have no PDF graphics to inspect. Their exact bytes
    // still identify a supported original; malformed PDFs remain ambiguous.
    const word = /\.(docx?)$/i.test(attachment.name || path) &&
      (bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04])) || bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])))
    return word ? { path, sourceHash: bytesHash, branded: false, ambiguous: false } : ambiguous
  }
  if (byPath?.status === 'ready') {
    if (validHash(byPath.result_sha256) !== bytesHash || !inspection.branded || inspection.pageCount !== byPath.page_count) return ambiguous
    return { path, sourceHash: validHash(byPath.source_sha256), branded: true, ambiguous: !validHash(byPath.source_sha256) }
  }
  const jobs = unwrap(await supabase.from('cv_branding_jobs').select('source_sha256,result_sha256,status,page_count')
    .eq('result_sha256', bytesHash).eq('status', 'ready').limit(2)) || []
  const identities = [...new Set(jobs.filter(job => validHash(job.source_sha256) && job.page_count === inspection.pageCount).map(job => validHash(job.source_sha256)))]
  if (inspection.branded && identities.length === 1) return { path, sourceHash: identities[0], branded: true, ambiguous: false }
  // A branded output without a trustworthy source mapping is deliberately not
  // merged with an alleged original based on its filename or metadata alone.
  if (inspection.branded && declared && declared !== bytesHash) return ambiguous
  return { path, sourceHash: bytesHash, branded: inspection.branded, ambiguous: false }
}

const SNAPSHOT_FIELDS = ['cv_attachments', 'cv_storage_path', 'cv_link', 'resume_url', 'cv_file_hash', 'cv_original_name', 'cv_mimetype']
function cvIdentitySnapshot(candidate) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(field => [field, candidate?.[field] ?? null]))
}
async function resolveTransferCvEvidence(supabase, candidate, { priorEvidence = {}, limit = Infinity } = {}) {
  const snapshot = cvIdentitySnapshot(candidate)
  const sameSnapshot = isDeepStrictEqual(snapshot, priorEvidence.__snapshot)
  const evidence = sameSnapshot ? { ...priorEvidence, __verified_paths: { ...priorEvidence.__verified_paths } }
    : { __verified_paths: {}, __snapshot: snapshot }
  const documents = candidateCvDocuments(candidate)
  let processed = 0
  for (const attachment of documents) {
    if (Object.hasOwn(evidence, attachment.path)) continue
    if (processed >= limit) break
    processed++
    const identity = await resolveCvIdentity(supabase, attachment)
    evidence[identity.path] = identity.sourceHash
    if (identity.branded && !identity.ambiguous) evidence.__verified_paths[identity.path] = true
  }
  evidence.__complete = documents.every(item => Object.hasOwn(evidence, item.path))
  return evidence
}

module.exports = { candidateCvDocuments, resolveCvIdentity, resolveTransferCvEvidence, cvIdentitySnapshot, validHash }
