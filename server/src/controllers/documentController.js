const supabase = require('../services/supabaseAdmin')
const { bucketForType, normalizeStoragePath } = require('../services/storageBuckets')

async function openDocument(req, res) {
  try {
    const bucket = bucketForType(req.params.type)
    const path = normalizeStoragePath(req.query.path || '', bucket)
    if (!bucket || !path) return res.status(400).json({ error: 'Document bucket and path are required' })

    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    console.log('[document open signed URL]', {
      type: req.params.type,
      bucket,
      path,
      signedUrl: data?.signedUrl || '',
      error: error?.message || ''
    })
    if (error || !data?.signedUrl) return res.status(404).json({ error: 'Document file could not be opened' })
    return res.redirect(data.signedUrl)
  } catch (err) {
    console.error('openDocument:', err.message || err)
    return res.status(500).json({ error: 'Document file could not be opened' })
  }
}

module.exports = { openDocument }
