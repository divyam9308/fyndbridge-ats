const fs = require('fs/promises')
const { randomUUID } = require('crypto')
const supabase = require('./supabaseAdmin')
const { normalizeStoragePath } = require('./storageBuckets')
const { getDocumentFileMeta } = require('./documentFile')
const { normalizeAttachments, storagePaths, uploadedAttachment } = require('./documentAttachments')

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
  return {
    url: '',
    path: normalizeStoragePath(objectPath, bucket),
    contentType: meta.contentType,
    fileName: meta.fileName,
    size: Number(file.size) || buffer.length,
    uploadedAt: new Date().toISOString(),
    bucket
  }
}

async function removeDocuments(bucket, attachments) {
  const paths = storagePaths(attachments)
  if (!paths.length) return
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw error
}

async function removeUnreferencedDocuments(bucket, attachments, { table, attachmentField, legacyFields = [] }) {
  const targetPaths = new Set(storagePaths(attachments))
  if (!targetPaths.size) return
  const fields = ['id', attachmentField, ...legacyFields].filter(Boolean)
  const { data, error } = await supabase.from(table).select([...new Set(fields)].join(', '))
  if (error) throw error
  const referenced = new Set()
  for (const row of data || []) {
    const legacyPath = legacyFields.map(field => row[field]).find(Boolean)
    for (const attachment of normalizeAttachments(row[attachmentField], { bucket, legacy: { path: legacyPath } })) {
      referenced.add(attachment.path)
    }
  }
  await removeDocuments(bucket, [...targetPaths]
    .filter(path => !referenced.has(path))
    .map(path => ({ path })))
}

async function uploadDocuments(files, bucket, folder = '') {
  const uploaded = []
  try {
    for (const file of files || []) {
      const result = await uploadDocument(file, bucket, folder)
      const attachment = uploadedAttachment(result)
      if (attachment) uploaded.push(attachment)
    }
    return uploaded
  } catch (error) {
    try {
      await removeDocuments(bucket, uploaded)
    } catch (cleanupError) {
      console.error('uploadDocuments cleanup:', cleanupError.message)
    }
    throw error
  }
}

module.exports = { removeDocuments, removeUnreferencedDocuments, uploadDocument, uploadDocuments }
