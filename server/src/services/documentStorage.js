const fs = require('fs/promises')
const { randomUUID } = require('crypto')
const supabase = require('./supabaseAdmin')
const { normalizeStoragePath } = require('./storageBuckets')
const { getDocumentFileMeta } = require('./documentFile')
const { normalizeAttachments, storagePaths, uploadedAttachment } = require('./documentAttachments')
const { cvBranding, isBrandedCvPath } = require('./cvBranding')

function safeFileName(value) {
  return String(value || 'document').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document'
}

async function uploadDocument(file, bucket, folder = '') {
  if (!file) return null
  if (bucket === 'resumes') return cvBranding().stage(file)
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
  if (bucket === 'resumes') await cvBranding().cancel(paths.filter(isBrandedCvPath))
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw error
}

async function removeUnreferencedDocuments(bucket, attachments, { table, attachmentField, legacyFields = [] }) {
  const targetPaths = new Set(storagePaths(attachments))
  if (!targetPaths.size) return
  // New CVs can be shared through duplicate/transfer flows. Check each path
  // directly so Supabase's default row limit cannot hide a later reference.
  if (bucket === 'resumes') {
    for (const path of [...targetPaths].filter(isBrandedCvPath)) {
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
      const values = [...new Set([path, urlData?.publicUrl].filter(Boolean))]
      const checks = await Promise.all([
        supabase.from(table).select('id', { head: true, count: 'exact' }).or(legacyFields.flatMap(field => values.map(value => `${field}.eq.${value}`)).join(',')),
        ...values.map(value => supabase.from(table).select('id', { head: true, count: 'exact' }).contains(attachmentField, JSON.stringify([{ path: value }]))),
        supabase.from('assigned_candidate_uploads').select('id', { head: true, count: 'exact' }).eq('cv_storage_path', path)
      ])
      if (checks.some(result => result.error)) throw checks.find(result => result.error).error
      if (!checks.some(result => result.count)) await removeDocuments(bucket, [{ path }])
      targetPaths.delete(path)
    }
    if (!targetPaths.size) return
  }
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
  const assignedPaths = bucket === 'resumes' ? [...targetPaths].filter(path => path.startsWith('assigned/')) : []
  if (assignedPaths.length) {
    // The assignment owns this object even after it becomes a main candidate CV.
    // Its cleanup queue checks both modules before releasing the document.
    const assigned = await supabase.from('assigned_candidate_uploads').select('cv_storage_path').in('cv_storage_path', assignedPaths)
    if (assigned.error) throw assigned.error
    for (const upload of assigned.data || []) referenced.add(upload.cv_storage_path)
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
