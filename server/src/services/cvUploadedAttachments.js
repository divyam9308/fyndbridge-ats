const { normalizeAttachments } = require('./documentAttachments')
const { resolveCvIdentity, validHash } = require('./cvDocumentIdentity')
const { createHash } = require('node:crypto')

async function previousIdentity(supabase, attachment) {
  const result = await supabase.from('cv_branding_jobs').select('*').eq('target_path', attachment.path).maybeSingle()
  if (result.error) throw result.error
  const job = result.data
  if (job && !['ready', 'cancelled'].includes(job.status) && job.source_path && validHash(job.source_sha256)) {
    const source = await supabase.storage.from('cv-branding-staging').download(job.source_path)
    if (!source.error && source.data?.size <= 10 * 1024 * 1024) {
      const bytes = Buffer.from(await source.data.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest === (job.input_sha256 || job.source_sha256)) return { sourceHash: job.source_sha256, ambiguous: false, branded: false }
    }
  }
  return resolveCvIdentity(supabase, attachment)
}

// Incoming items come exclusively from backend staging, never request metadata.
// Verify old objects only while comparing a newly uploaded document to this
// selected candidate. Ordinary historical reads/edits never invoke branding.
async function mergeUploadedCvAttachments(supabase, previous, incoming) {
  let result = normalizeAttachments(previous, { bucket: 'resumes' })
  const staged = normalizeAttachments(incoming, { bucket: 'resumes' })
  const identities = new Map()
  for (const attachment of staged) {
    if (result.some(item => item.path === attachment.path)) continue
    const jobResult = await supabase.from('cv_branding_jobs').select('source_sha256,status').eq('target_path', attachment.path).maybeSingle()
    if (jobResult.error) throw jobResult.error
    const sourceHash = validHash(jobResult.data?.source_sha256)
    if (!sourceHash || jobResult.data.status === 'cancelled') { result.push(attachment); continue }
    identities.set(attachment.path, { sourceHash, ambiguous: false, branded: true })
    const matches = []
    for (let index = 0; index < result.length; index++) {
      const current = result[index]
      if (!identities.has(current.path)) identities.set(current.path, await previousIdentity(supabase, current))
      const identity = identities.get(current.path)
      if (!identity.ambiguous && identity.sourceHash === sourceHash) matches.push(index)
    }
    if (!matches.length) { result.push(attachment); continue }
    const keeper = matches.find(index => identities.get(result[index].path).branded)
    const retained = keeper === undefined ? { ...attachment, file_hash: sourceHash } : result[keeper]
    const first = matches[0]
    result = result.filter((item, index) => !matches.includes(index) || index === first)
    result[first] = retained
  }
  return result
}

module.exports = { mergeUploadedCvAttachments }
