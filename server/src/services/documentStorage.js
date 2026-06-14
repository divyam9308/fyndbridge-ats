const fs = require('fs/promises')
const { randomUUID } = require('crypto')
const supabase = require('./supabaseAdmin')
const { normalizeStoragePath } = require('./storageBuckets')

function safeFileName(value) {
  return String(value || 'document').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document'
}

async function uploadDocument(file, bucket, folder = '') {
  if (!file) return null
  await supabase.storage.createBucket(bucket, { public: true }).catch(() => {})
  const buffer = file.buffer || await fs.readFile(file.path)
  const objectPath = [folder, `${randomUUID()}-${safeFileName(file.originalname)}`].filter(Boolean).join('/')
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: file.mimetype,
    upsert: false
  })
  if (error) throw error
  return { url: '', path: normalizeStoragePath(objectPath, bucket) }
}

module.exports = { uploadDocument }
