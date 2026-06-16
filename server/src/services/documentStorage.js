const fs = require('fs/promises')
const { randomUUID } = require('crypto')
const supabase = require('./supabaseAdmin')
const { normalizeStoragePath } = require('./storageBuckets')
const { getDocumentFileMeta } = require('./documentFile')

function safeFileName(value) {
  return String(value || 'document').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document'
}

async function uploadDocument(file, bucket, folder = '') {
  if (!file) return null
  const meta = getDocumentFileMeta(file)
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {})
  const buffer = file.buffer || await fs.readFile(file.path)
  const baseName = safeFileName(meta.fileName).replace(/\.(pdf|docx?)$/i, '')
  const objectPath = [folder, `${randomUUID()}-${baseName}.${meta.extension}`].filter(Boolean).join('/')
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: meta.contentType,
    upsert: false
  })
  if (error) throw error
  return { url: '', path: normalizeStoragePath(objectPath, bucket), contentType: meta.contentType, fileName: `${baseName}.${meta.extension}` }
}

module.exports = { uploadDocument }

