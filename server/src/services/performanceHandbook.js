const supabase = require('./supabaseAdmin')
const { uploadDocument } = require('./documentStorage')
const { pathExtension } = require('./documentFile')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')
const { isSuperAdmin } = require('./adminAccess')

const HANDBOOK_KEY = 'employee_handbook'
const HANDBOOK_FOLDER = 'current'

function serializeHandbook(value) {
  const row = value && typeof value === 'object' ? value : {}
  return {
    path: normalizeStoragePath(row.path || '', STORAGE_BUCKETS.EMPLOYEE_HANDBOOK),
    fileName: String(row.fileName || row.file_name || 'Employee Handbook.pdf').trim(),
    updatedAt: row.updatedAt || row.updated_at || ''
  }
}

async function getHandbook() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', HANDBOOK_KEY)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return serializeHandbook(data?.value)
}

async function updateHandbook(user, file) {
  if (!await isSuperAdmin(user)) {
    const err = new Error('Super Admin required')
    err.statusCode = 403
    throw err
  }
  if (!file) {
    const err = new Error('Employee handbook PDF is required')
    err.statusCode = 400
    throw err
  }
  if (pathExtension(file.originalname) !== 'pdf' || file.mimetype !== 'application/pdf') {
    const err = new Error('Only PDF files are accepted for the employee handbook')
    err.statusCode = 400
    throw err
  }

  const uploaded = await uploadDocument(file, STORAGE_BUCKETS.EMPLOYEE_HANDBOOK, HANDBOOK_FOLDER)
  const value = {
    path: uploaded.path,
    fileName: uploaded.fileName || 'Employee Handbook.pdf',
    updatedAt: new Date().toISOString()
  }

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: HANDBOOK_KEY, value, updated_at: value.updatedAt })

  if (error) throw error
  return serializeHandbook(value)
}

module.exports = { getHandbook, updateHandbook }
