const supabase = require('../services/supabaseAdmin')
const { bucketForType, normalizeStoragePath } = require('../services/storageBuckets')
const { MIME_BY_EXTENSION, pathExtension } = require('../services/documentFile')

function debugDocumentOpen(message, details) {
  if (process.env.NODE_ENV === 'production') return
  console.debug(`[document open] ${message}`, details)
}

function isValidStoragePath(path) {
  const text = String(path || '').trim()
  return Boolean(text && text !== '-' && !text.startsWith('/tmp/'))
}

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
    debugDocumentOpen('storage path', { type: req.params.type, bucket, path })
    if (!bucket || !isValidStoragePath(path)) return res.status(400).json({ error: 'Document path is required' })

    const extension = pathExtension(path)
    const fileName = path.split('/').pop() || `document.${extension || 'pdf'}`
    const contentType = MIME_BY_EXTENSION[extension] || 'application/octet-stream'
    const disposition = extension === 'pdf' ? 'inline' : 'attachment'
    const options = disposition === 'attachment' ? { download: fileName } : undefined
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, options)
    debugDocumentOpen('signed URL creation result', { type: req.params.type, ok: Boolean(data?.signedUrl), error: error?.message || '' })
    if (error || !data?.signedUrl) {
      const exists = await fileExists(bucket, path)
      if (!exists) return res.status(404).json({ error: 'Document file not found. Please re-upload the document.', path })
      return res.status(404).json({ error: error?.message || 'Document file could not be opened', path })
    }
    return res.json({ url: data.signedUrl, fileName, contentType, disposition, path })
  } catch (err) {
    console.error('openDocument:', err.message || err)
    return res.status(500).json({ error: 'Document file could not be opened' })
  }
}

module.exports = { openDocument }

