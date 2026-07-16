const supabase = require('./supabaseAdmin')
const { getColumnPermissions, getPageViewPermission, isAdmin, isSuperAdmin } = require('./adminAccess')
const { allowsPageView } = require('./pageViewPermissionPolicy')
const { normalizeAttachments } = require('./documentAttachments')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')

const DOCUMENT_SCOPES = {
  cv: {
    table: 'candidates',
    page: 'candidates',
    permissionKey: 'cv_link',
    attachmentField: 'cv_attachments',
    bucket: STORAGE_BUCKETS.CV,
    select: 'id, cv_attachments, cv_storage_path, resume_url, cv_link, cv_original_name, cv_mimetype',
    legacy: row => ({
      path: row.cv_storage_path || row.resume_url || row.cv_link,
      name: row.cv_original_name,
      mimeType: row.cv_mimetype
    })
  },
  jd: {
    table: 'jobs',
    page: 'mandates',
    permissionKey: 'jd_storage_path',
    attachmentField: 'jd_attachments',
    bucket: STORAGE_BUCKETS.JD,
    select: 'id, jd_attachments, jd_storage_path, jd_url',
    legacy: row => ({ path: row.jd_storage_path || row.jd_url })
  },
  contract: {
    table: 'clients',
    page: 'clients',
    permissionKey: 'contract_document',
    attachmentField: 'contract_attachments',
    bucket: STORAGE_BUCKETS.CONTRACT,
    select: 'id, contract_attachments, contract_pdf_storage_path, contract_pdf_url, contract_document, contract_document_name',
    legacy: row => ({
      path: row.contract_pdf_storage_path || row.contract_pdf_url || row.contract_document,
      name: row.contract_document_name,
      mimeType: 'application/pdf'
    })
  }
}

async function assertPageAccess(user, pageKey, admin) {
  const permission = await getPageViewPermission(pageKey, { fresh: true })
  const superAdmin = admin ? await isSuperAdmin(user) : false
  if (!allowsPageView(permission, { isAdmin: admin, isSuperAdmin: superAdmin })) {
    const error = new Error('You do not have permission to view this document.')
    error.statusCode = 403
    throw error
  }
}

async function assertDocumentAccess(user, type, recordId, requestedPath) {
  const scope = DOCUMENT_SCOPES[String(type || '').toLowerCase()]
  if (!scope) return
  if (!recordId) {
    const error = new Error('A record ID is required to open this document.')
    error.statusCode = 400
    throw error
  }

  const admin = await isAdmin(user)
  await assertPageAccess(user, scope.page, admin)
  if (!admin) {
    const permissions = await getColumnPermissions(scope.table)
    if (permissions[scope.permissionKey] === 'admin_hidden') {
      const error = new Error('You do not have permission to view this document.')
      error.statusCode = 403
      throw error
    }
  }

  const { data, error } = await supabase
    .from(scope.table)
    .select(scope.select)
    .eq('id', recordId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const notFound = new Error('Document record not found.')
    notFound.statusCode = 404
    throw notFound
  }

  const attachments = normalizeAttachments(data[scope.attachmentField], {
    bucket: scope.bucket,
    legacy: scope.legacy(data)
  })
  const path = normalizeStoragePath(requestedPath, scope.bucket)
  if (!attachments.some(attachment => attachment.path === path)) {
    const forbidden = new Error('This document does not belong to the requested record.')
    forbidden.statusCode = 403
    throw forbidden
  }
}

module.exports = { assertDocumentAccess, DOCUMENT_SCOPES }
