const { candidateCvDocuments, resolveCvIdentity } = require('./cvDocumentIdentity')
const { normalizeStoragePath } = require('./storageBuckets')
const unwrap = result => { if (result.error) throw result.error; return result.data }
const SNAPSHOT_FIELDS = ['cv_attachments', 'cv_storage_path', 'cv_link', 'resume_url', 'cv_file_hash', 'cv_original_name', 'cv_mimetype']

async function planCandidateCvCleanup(supabase, candidate, { hashMissing = false } = {}) {
  const docs = candidateCvDocuments(candidate)
  if (docs.length > 50) throw new Error('This candidate has more than 50 CV references. Review a smaller attachment set manually.')
  const expected = Object.fromEntries(SNAPSHOT_FIELDS.map(field => [field, candidate[field] ?? null]))
  const retained = [], removed = [], ambiguous = [], groups = new Map(), verified = new Set()
  for (const attachment of docs) {
    const identity = await resolveCvIdentity(supabase, attachment, { hashMissing })
    if (identity.ambiguous || !identity.sourceHash) {
      ambiguous.push({ path: attachment.path, reason: 'Content identity or stored output could not be verified.' })
      retained.push(attachment)
      continue
    }
    const document = { ...attachment, file_hash: identity.sourceHash }
    if (identity.branded) verified.add(document.path)
    const previous = groups.get(identity.sourceHash)
    if (!previous) { groups.set(identity.sourceHash, document); retained.push(document); continue }
    if (identity.branded && !verified.has(previous.path)) {
      retained.splice(retained.indexOf(previous), 1, document)
      removed.push({ path: previous.path, retained_path: document.path, source_sha256: identity.sourceHash })
      // Earlier duplicates in this group must point to the actual keeper.
      for (const item of removed) if (item.source_sha256 === identity.sourceHash) item.retained_path = document.path
      groups.set(identity.sourceHash, document)
    } else removed.push({ path: document.path, retained_path: previous.path, source_sha256: identity.sourceHash })
  }
  const seenReferences = new Set()
  for (const attachment of Array.isArray(candidate.cv_attachments) ? candidate.cv_attachments : []) {
    const path = normalizeStoragePath(attachment?.path || attachment?.storage_path || attachment?.storagePath || attachment?.url, 'resumes')
    if (!path) continue
    if (seenReferences.has(path)) removed.push({ path, retained_path: removed.find(item => item.path === path)?.retained_path || path, same_path_reference: true })
    seenReferences.add(path)
  }
  const paths = [...new Set(docs.map(document => document.path))]
  const references = paths.length ? unwrap(await supabase.rpc('cv_storage_reference_counts', { p_paths: paths })) : []
  return { candidate_id: candidate.id, expected, retained, removed, ambiguous,
    retained_branded_paths: [...verified].filter(path => retained.some(doc => doc.path === path)),
    shared_storage_references: references,
    potentially_unreferenced_after_apply: [...new Set(removed.filter(item => {
      if (retained.some(document => document.path === item.path)) return false
      const refs = references.find(row => row.path === item.path)
      return refs && Number(refs.candidates) === 1 && !Number(refs.uploads) && !Number(refs.transfers)
    }).map(item => item.path))],
    physically_delete_files: false }
}

async function applyCandidateCvCleanup(supabase, plan) {
  if (!plan.removed.length) return { changed: false }
  const candidate = unwrap(await supabase.from('candidates').select('*').eq('id', plan.candidate_id).maybeSingle())
  if (!candidate) throw new Error('Candidate no longer exists.')
  const current = await planCandidateCvCleanup(supabase, candidate, { hashMissing: true })
  if (JSON.stringify(current.expected) !== JSON.stringify(plan.expected) ||
    JSON.stringify(current.retained) !== JSON.stringify(plan.retained) || JSON.stringify(current.removed) !== JSON.stringify(plan.removed)) {
    throw new Error('The cleanup plan changed. Run and review a new dry-run.')
  }
  unwrap(await supabase.rpc('consolidate_candidate_cv_duplicates', { p_id: plan.candidate_id,
    p_expected: plan.expected, p_attachments: plan.retained }))
  return { changed: true, candidate_id: plan.candidate_id, references_removed: plan.removed.length }
}

module.exports = { planCandidateCvCleanup, applyCandidateCvCleanup }
