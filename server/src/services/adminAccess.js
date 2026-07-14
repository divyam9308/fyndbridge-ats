const supabase = require('./supabaseAdmin')

const ACCESS = {
  EVERYONE: 'everyone',
  DISABLED: 'admin_disabled',
  HIDDEN: 'admin_hidden'
}
const ROLES = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
}
const PERMISSION_CACHE_TTL_MS = 10 * 60 * 1000
let permissionCache = null
let permissionCacheExpiresAt = 0
let pageViewPermissionCache = null
let pageViewPermissionCacheExpiresAt = 0

const PAGE_VIEW_DEFAULTS = {
  dashboard: 'everyone',
  candidates: 'everyone',
  clients: 'everyone',
  mandates: 'everyone',
  performance_review: 'everyone',
  attendance: 'everyone',
  report: 'everyone',
  invoice: 'admin_only',
  user_manual: 'everyone'
}
const PAGE_VIEW_PERMISSION_VALUES = new Set(['everyone', 'admin_only', 'super_admin_only'])

const COLUMN_DEFS = {
  clients: [
    ['Client ID', 'client_display_id', ['client_display_id']],
    ['Client Name', 'client_name', ['client_name', 'name']],
    ['Location', 'location', ['location', 'city']],
    ['Region', 'region', ['region', 'state']],
    ['Contact Person', 'contact_person', ['contact_person', 'contact']],
    ['Mobile', 'mobile', ['mobile', 'phone']],
    ['Email', 'email', ['email']],
    ['LinkedIn', 'linkedin', ['linkedin']],
    ['Sector', 'sector', ['sector']],
    ['Consultant', 'consultant_name', ['consultant_name', 'consultant', 'consultant_user_id']],
    ['Connected On Date', 'connected_on_date', ['connected_on_date']],
    ['Follow Up Date', 'follow_up_date', ['follow_up_date']],
    ['Status', 'status', ['status']],
    ['Terms Signed', 'terms_signed_type', ['terms_signed_type', 'terms_signed_custom']],
    ['GSTIN', 'gstin', ['gstin']],
    ['PAN', 'pan', ['pan']],
    ['Address on Invoice', 'address_on_invoice', ['address_on_invoice']],
    ['Designation', 'designation', ['designation']],
    ['Contract Signed', 'contract_signed', ['contract_signed']],
    ['Contract Document', 'contract_document', ['contract_document', 'contract_document_path', 'contract_document_name', 'contract_pdf_url', 'contract_pdf_storage_path']],
    ['Value', 'terms_value', ['terms_value', 'billing_entity']],
    ['Comments', 'comments', ['comments', 'notes']]
  ],
  candidates: [
    ['Candidate ID', 'candidate_display_id', ['candidate_display_id']],
    ['Candidate Name', 'full_name', ['full_name']],
    ['Consultant', 'consultant_name', ['consultant_name', 'consultant_user_id']],
    ['Email', 'email', ['email']],
    ['Mobile', 'mobile_number', ['mobile_number']],
    ['Designation', 'current_designation', ['current_designation']],
    ['Organization', 'current_organisation', ['current_organisation', 'current_company']],
    ['Experience', 'experience_years', ['experience_years']],
    ['Client ID', 'client_id', ['client_id', 'client_display_id']],
    ['Client Name', 'client_name', ['client_name']],
    ['Role', 'job_title', ['job_title']],
    ['Job ID', 'job_id', ['job_id', 'job_display_id']],
    ['Date', 'created_at', ['created_at']],
    ['Skills', 'skills', ['skills']],
    ['Current CTC', 'current_salary', ['current_salary']],
    ['Expected CTC', 'expected_salary', ['expected_salary']],
    ['Current Location', 'location', ['location', 'city', 'state']],
    ['Notice Period', 'notice_period', ['notice_period']],
    ['Open to Relocate', 'open_to_relocate', ['open_to_relocate']],
    ['Comments', 'notes', ['notes']],
    ['Status', 'status', ['status']],
    ['Month', 'created_at_month', ['created_at']],
    ['LinkedIn', 'linkedin_url', ['linkedin_url']],
    ['CV', 'cv_link', ['cv_link', 'resume_url', 'cv_storage_path', 'cv_file_hash', 'cv_original_name', 'cv_mimetype']],
    ['Education', 'education', ['education']]
  ],
  jobs: [
    ['Job ID', 'job_display_id', ['job_display_id']],
    ['Consultant', 'consultants', ['consultants', 'consultant_user_ids']],
    ['Team Lead', 'team_lead', ['team_lead', 'team_lead_user_id']],
    ['Client ID', 'client_id', ['client_id', 'client_display_id']],
    ['Client Name', 'client_name', ['client_name']],
    ['Role', 'title', ['title', 'role']],
    ['Location', 'city', ['city', 'location']],
    ['Budget', 'budget', ['budget']],
    ['Experience', 'experience', ['experience']],
    ['Sector', 'vertical', ['vertical']],
    ['Date of Allocation', 'allocation_date', ['allocation_date']],
    ['JD', 'jd_storage_path', ['jd_url', 'jd_storage_path']],
    ['Status', 'mandate_status', ['mandate_status', 'status', 'priority']],
    ['Comments', 'comments', ['comments', 'notes']]
  ]
}

const FIELD_TO_COLUMN = Object.fromEntries(Object.entries(COLUMN_DEFS).map(([table, rows]) => [
  table,
  rows.reduce((map, [, columnKey, fields]) => {
    fields.forEach((field) => { map[field] = columnKey })
    map[columnKey] = columnKey
    return map
  }, {})
]))

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

async function getPageViewPermissions() {
  if (pageViewPermissionCache && pageViewPermissionCacheExpiresAt > Date.now()) return pageViewPermissionCache
  const { data, error } = await supabase.from('page_view_permissions').select('page_key, view_permission')
  if (error) throw error
  pageViewPermissionCache = { ...PAGE_VIEW_DEFAULTS }
  for (const row of data || []) {
    if (Object.hasOwn(PAGE_VIEW_DEFAULTS, row.page_key) && PAGE_VIEW_PERMISSION_VALUES.has(row.view_permission)) {
      pageViewPermissionCache[row.page_key] = row.view_permission
    }
  }
  pageViewPermissionCacheExpiresAt = Date.now() + PERMISSION_CACHE_TTL_MS
  return pageViewPermissionCache
}

async function getPageViewPermission(pageKey, { fresh = false } = {}) {
  if (!Object.hasOwn(PAGE_VIEW_DEFAULTS, pageKey)) return null
  if (!fresh) return (await getPageViewPermissions())[pageKey]
  const { data, error } = await supabase
    .from('page_view_permissions')
    .select('view_permission')
    .eq('page_key', pageKey)
    .maybeSingle()
  if (error) throw error
  return PAGE_VIEW_PERMISSION_VALUES.has(data?.view_permission)
    ? data.view_permission
    : PAGE_VIEW_DEFAULTS[pageKey]
}

function invalidatePageViewPermissionCache() {
  pageViewPermissionCache = null
  pageViewPermissionCacheExpiresAt = 0
}

function serializeColumnDefs() {
  return Object.fromEntries(Object.entries(COLUMN_DEFS).map(([table, rows]) => [
    table,
    rows.map(([label, key, fields]) => ({ label, key, fields }))
  ]))
}

async function isAdmin(user) {
  const email = normalizeEmail(user?.email)
  if (!email && !user?.id) return false
  return Boolean(await findAdminUser(user))
}

async function isSuperAdmin(user) {
  const admin = await findAdminUser(user)
  return adminRole(admin) === ROLES.SUPER_ADMIN
}

async function listAdminUsers() {
  const { data, error } = await supabase.from('admin_users').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(serializeAdminUser)
}

async function findAdminUser(user) {
  const email = normalizeEmail(user?.email)
  const admins = await listAdminUsers()
  return admins.find(admin => {
    return (email && normalizeEmail(admin.email) === email) || (user?.id && admin.user_id === user.id)
  })
}

function adminRole(admin) {
  return admin?.role === ROLES.SUPER_ADMIN || admin?.is_super_admin ? ROLES.SUPER_ADMIN : ROLES.ADMIN
}

function serializeAdminUser(admin, currentUser = null) {
  const role = adminRole(admin)
  const currentEmail = normalizeEmail(currentUser?.email)
  return {
    ...admin,
    role,
    is_super_admin: role === ROLES.SUPER_ADMIN,
    is_current_user: Boolean((currentEmail && normalizeEmail(admin.email) === currentEmail) || (currentUser?.id && admin.user_id === currentUser.id))
  }
}

function countSuperAdmins(admins) {
  return admins.filter(admin => adminRole(admin) === ROLES.SUPER_ADMIN).length
}

async function assertCanManageAdminUsers(user) {
  if (await isSuperAdmin(user)) return
  const err = new Error('Super Admin required')
  err.statusCode = 403
  throw err
}

function assertCanRevokeAdmin(targetAdmin, currentUser, admins) {
  if (serializeAdminUser(targetAdmin, currentUser).is_current_user) {
    const err = new Error('You cannot revoke your own access.')
    err.statusCode = 403
    throw err
  }
  if (adminRole(targetAdmin) === ROLES.SUPER_ADMIN && countSuperAdmins(admins) <= 1) {
    const err = new Error('At least one Super Admin must remain.')
    err.statusCode = 400
    throw err
  }
}

function assertCanPromoteAdmin(targetAdmin) {
  if (!targetAdmin) {
    const err = new Error('Admin not found')
    err.statusCode = 404
    throw err
  }
}

function assertCanDemoteSuperAdmin(targetAdmin, currentUser, admins) {
  if (!targetAdmin) {
    const err = new Error('Admin not found')
    err.statusCode = 404
    throw err
  }
  if (serializeAdminUser(targetAdmin, currentUser).is_current_user) {
    const err = new Error('You cannot revoke your own access.')
    err.statusCode = 403
    throw err
  }
  if (adminRole(targetAdmin) === ROLES.SUPER_ADMIN && countSuperAdmins(admins) <= 1) {
    const err = new Error('At least one Super Admin must remain.')
    err.statusCode = 400
    throw err
  }
}

async function getColumnPermissions(tableName) {
  const defs = COLUMN_DEFS[tableName] || []
  const all = await getAllColumnPermissions()
  return defs.reduce((acc, [, key]) => {
    acc[key] = all?.[tableName]?.[key] || ACCESS.EVERYONE
    return acc
  }, {})
}

async function getAllColumnPermissions() {
  if (permissionCache && permissionCacheExpiresAt > Date.now()) return permissionCache
  const { data, error } = await supabase.from('column_permissions').select('table_name, column_key, access_mode')
  if (error && error.code !== '42P01') throw error
  const byTable = (data || []).reduce((acc, row) => {
    acc[row.table_name] = acc[row.table_name] || {}
    acc[row.table_name][row.column_key] = row.access_mode
    return acc
  }, {})
  permissionCache = Object.fromEntries(Object.entries(COLUMN_DEFS).map(([table, defs]) => [
    table,
    defs.reduce((acc, [, key]) => {
      acc[key] = byTable?.[table]?.[key] || ACCESS.EVERYONE
      return acc
    }, {})
  ]))
  permissionCacheExpiresAt = Date.now() + PERMISSION_CACHE_TTL_MS
  return permissionCache
}

function invalidateColumnPermissionCache() {
  permissionCache = null
  permissionCacheExpiresAt = 0
}

function hiddenColumnKeys(permissions) {
  return new Set(Object.entries(permissions || {}).filter(([, mode]) => mode === ACCESS.HIDDEN).map(([key]) => key))
}

async function stripHiddenFields(tableName, rows, admin) {
  if (admin) return rows
  const permissions = await getColumnPermissions(tableName)
  const hidden = hiddenColumnKeys(permissions)
  if (!hidden.size) return rows
  const fieldMap = FIELD_TO_COLUMN[tableName] || {}
  const strip = (row) => {
    if (!row || typeof row !== 'object') return row
    const next = { ...row }
    for (const field of Object.keys(next)) {
      if (hidden.has(fieldMap[field])) delete next[field]
    }
    return next
  }
  return Array.isArray(rows) ? rows.map(strip) : strip(rows)
}

async function assertCanUpdateColumns(tableName, payload, admin) {
  if (admin) return
  const permissions = await getColumnPermissions(tableName)
  const fieldMap = FIELD_TO_COLUMN[tableName] || {}
  const blocked = Object.keys(payload || {}).filter((field) => {
    const mode = permissions[fieldMap[field]]
    return mode === ACCESS.DISABLED || mode === ACCESS.HIDDEN
  })
  if (blocked.length) {
    const err = new Error('You do not have permission to update protected fields.')
    err.statusCode = 403
    err.fields = blocked
    throw err
  }
}

async function assertRowEditable(tableName, rowId, admin) {
  if (admin || !rowId) return
  const { data, error } = await supabase.from(tableName).select('is_locked').eq('id', rowId).maybeSingle()
  if (error) throw error
  if (data?.is_locked) {
    const err = new Error('This record is locked by an admin.')
    err.statusCode = 403
    throw err
  }
}

module.exports = {
  ACCESS,
  ROLES,
  PAGE_VIEW_DEFAULTS,
  PAGE_VIEW_PERMISSION_VALUES,
  COLUMN_DEFS,
  normalizeEmail,
  serializeColumnDefs,
  serializeAdminUser,
  isAdmin,
  isSuperAdmin,
  listAdminUsers,
  countSuperAdmins,
  assertCanManageAdminUsers,
  assertCanRevokeAdmin,
  assertCanPromoteAdmin,
  assertCanDemoteSuperAdmin,
  getColumnPermissions,
  getAllColumnPermissions,
  invalidateColumnPermissionCache,
  getPageViewPermissions,
  getPageViewPermission,
  invalidatePageViewPermissionCache,
  stripHiddenFields,
  assertCanUpdateColumns,
  assertRowEditable
}
