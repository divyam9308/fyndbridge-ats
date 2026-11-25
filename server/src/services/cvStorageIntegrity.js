const { normalizeStoragePath } = require('./storageBuckets')

// The database claim takes the same path lock as every reference writer and
// leaves a durable tombstone. Never replace this with a check-then-delete query.
async function removeCvIfUnreferenced(supabase, value, { ignoreUploadId = null } = {}) {
  const path = normalizeStoragePath(value, 'resumes')
  if (!path || /^https?:\/\//i.test(path)) return false
  const claim = await supabase.rpc('claim_cv_storage_deletion', { p_path: path, p_ignore_upload: ignoreUploadId })
  if (claim.error) throw claim.error
  if (claim.data !== true) return false
  const removed = await supabase.storage.from('resumes').remove([path])
  if (removed.error) throw removed.error
  const completed = await supabase.from('cv_storage_deletion_claims').update({ removed_at: new Date().toISOString() }).eq('path', path)
  if (completed.error) throw completed.error
  return true
}

async function reapPendingCvDeletions(supabase) {
  const claims = await supabase.from('cv_storage_deletion_claims').select('path').is('removed_at', null).order('claimed_at').limit(20)
  if (claims.error) throw claims.error
  for (const claim of claims.data || []) await removeCvIfUnreferenced(supabase, claim.path)
}

module.exports = { removeCvIfUnreferenced, reapPendingCvDeletions }
