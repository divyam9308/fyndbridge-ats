const supabase = require('../services/supabaseAdmin')
const { bucketForType, normalizeStoragePath } = require('../services/storageBuckets')

async function fileExists(bucket, objectPath) {
  const slash = objectPath.lastIndexOf('/')
  const folder = slash === -1 ? '' : objectPath.slice(0, slash)
  const name = slash === -1 ? objectPath : objectPath.slice(slash + 1)
  const { data, error } = await supabase.storage.from(bucket).list(folder, { search: name, limit: 1 })
  if (error) return false
  return (data || []).some((item) => item.name === name)
}

async function openDocument(req, res) {
  try {
    const bucket = bucketForType(req.params.type)
    const path = normalizeStoragePath(req.query.path || '', bucket)
    console.log('[document open] storage path', { type: req.params.type, bucket, path })
    if (!bucket || !path) return res.status(400).json({ error: 'Document path is required' })

    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    console.log('[document open] signed URL creation result', { type: req.params.type, ok: Boolean(data?.signedUrl), error: error?.message || '' })
    if (error || !data?.signedUrl) {
      const exists = await fileExists(bucket, path)
      if (!exists) return res.status(404).json({ error: 'Document file not found. Please re-upload the document.', path })
      return res.status(404).json({ error: error?.message || 'Document file could not be opened', path })
    }
    return res.json({ url: data.signedUrl, path })
  } catch (err) {
    console.error('openDocument:', err.message || err)
    return res.status(500).json({ error: 'Document file could not be opened' })
  }
}

module.exports = { openDocument }

