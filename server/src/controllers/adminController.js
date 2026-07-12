const supabase = require('../services/supabaseAdmin')
const {
  normalizeEmail,
  isAdmin,
  isSuperAdmin,
  listAdminUsers,
  serializeAdminUser,
  assertCanManageAdminUsers,
  assertCanRevokeAdmin,
  assertCanPromoteAdmin,
  assertCanDemoteSuperAdmin,
  serializeColumnDefs,
  getAllColumnPermissions,
  invalidateColumnPermissionCache,
  PAGE_VIEW_DEFAULTS,
  PAGE_VIEW_PERMISSION_VALUES,
  getPageViewPermissions,
  invalidatePageViewPermissionCache
} = require('../services/adminAccess')
const { getDashboardVisibility, setDashboardVisibility } = require('../services/dashboardAccess')
const { getPermissions: getPerformancePermissions } = require('../services/performanceReview')

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' })
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

async function profileOptions() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, name, email')
    .not('name', 'is', null)
    .order('name')
  if (error) throw error
  return (data || []).map((profile) => ({
    user_id: clean(profile.user_id),
    name: clean(profile.name),
    email: normalizeEmail(profile.email)
  })).filter((profile) => profile.user_id && profile.name && profile.email)
}

async function lockedByNameMap(rows) {
  const userIds = [...new Set((rows || []).map(row => row.locked_by).filter(Boolean))]
  if (!userIds.length) return new Map()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, name')
    .in('user_id', userIds)
  if (error) throw error
  return new Map((data || []).map(profile => [profile.user_id, clean(profile.name)]).filter(([, name]) => name))
}

function lockedRecord(type, row, profileNames) {
  return {
    type,
    id: row.id,
    displayId: row.client_display_id || row.candidate_display_id || row.job_display_id,
    name: row.client_name || row.name || row.full_name || row.title,
    lockedBy: row.locked_by,
    lockedByName: row.locked_by ? profileNames.get(row.locked_by) || 'Unknown user' : '',
    lockedAt: row.locked_at
  }
}

async function me(req, res) {
  try {
    const admins = await listAdminUsers()
    const admin = admins.find(row => serializeAdminUser(row, req.user).is_current_user)
    const role = admin?.role || null
    return res.json({
      isAdmin: await isAdmin(req.user),
      isSuperAdmin: await isSuperAdmin(req.user),
      role,
      email: req.user.email,
      name: req.user.name,
      user: req.user
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function users(req, res) {
  try {
    const [admins, profiles] = await Promise.all([listAdminUsers(), profileOptions()])
    const profilesByEmail = new Map(profiles.map((profile) => [profile.email, profile]))
    const profilesById = new Map(profiles.map((profile) => [profile.user_id, profile]))
    return res.json({ data: admins.map((admin) => {
      const profile = profilesById.get(admin.user_id) || profilesByEmail.get(normalizeEmail(admin.email))
      return serializeAdminUser({ ...admin, user_id: admin.user_id || profile?.user_id || null, name: profile?.name || admin.name }, req.user)
    }) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function serializedUsers(req) {
  const [admins, profiles] = await Promise.all([listAdminUsers(), profileOptions()])
  const profilesByEmail = new Map(profiles.map((profile) => [profile.email, profile]))
  const profilesById = new Map(profiles.map((profile) => [profile.user_id, profile]))
  return {
    admins: admins.map((admin) => {
      const profile = profilesById.get(admin.user_id) || profilesByEmail.get(normalizeEmail(admin.email))
      return serializeAdminUser({ ...admin, user_id: admin.user_id || profile?.user_id || null, name: profile?.name || admin.name }, req.user)
    }),
    profiles
  }
}

async function lockedRecordList() {
  const [clients, candidates, jobs] = await Promise.all([
    supabase.from('clients').select('id, client_display_id, client_name, name, is_locked, locked_by, locked_at').eq('is_locked', true),
    supabase.from('candidates').select('id, candidate_display_id, full_name, is_locked, locked_by, locked_at').eq('is_locked', true),
    supabase.from('jobs').select('id, job_display_id, title, is_locked, locked_by, locked_at').eq('is_locked', true)
  ])
  for (const result of [clients, candidates, jobs]) if (result.error) throw result.error
  const rows = [...(clients.data || []), ...(candidates.data || []), ...(jobs.data || [])]
  const profileNames = await lockedByNameMap(rows)
  return [
    ...(clients.data || []).map((row) => lockedRecord('Client', row, profileNames)),
    ...(candidates.data || []).map((row) => lockedRecord('Candidate', row, profileNames)),
    ...(jobs.data || []).map((row) => lockedRecord('Mandate', row, profileNames))
  ]
}

async function bootstrap(req, res) {
  try {
    const [{ admins, profiles }, locks, visibility, performancePermissions] = await Promise.all([
      serializedUsers(req),
      lockedRecordList(),
      getDashboardVisibility(),
      getPerformancePermissions()
    ])
    return res.json({
      data: {
        admins,
        lockedRecords: locks,
        profileOptions: profiles,
        dashboardVisibility: visibility,
        performancePermissions
      }
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function userProfiles(req, res) {
  try {
    return res.json({ data: await profileOptions() })
  } catch (err) {
    return sendError(res, err)
  }
}

async function addUser(req, res) {
  try {
    await assertCanManageAdminUsers(req.user)
    const userId = clean(req.body.user_id)
    const profile = (await profileOptions()).find((item) => item.user_id === userId)
    if (!profile) return res.status(400).json({ error: 'Select a saved user profile' })
    const email = profile.email
    if (!validEmail(email)) return res.status(400).json({ error: 'Selected profile has no valid email' })
    const role = req.body.role || (req.body.isSuperAdmin ? 'super_admin' : 'admin')
    if (!['admin', 'super_admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
    const { data, error } = await supabase
      .from('admin_users')
      .insert({ user_id: profile.user_id, email, name: profile.name, added_by: req.user.id, role, is_super_admin: role === 'super_admin' })
      .select('*')
      .single()
    if (error?.code === '23505') return res.status(409).json({ error: 'Admin already exists' })
    if (error) throw error
    return res.status(201).json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function removeUser(req, res) {
  try {
    await assertCanManageAdminUsers(req.user)
    const email = normalizeEmail(req.params.email)
    const admins = await listAdminUsers()
    const target = admins.find(admin => normalizeEmail(admin.email) === email)
    if (!target) return res.status(404).json({ error: 'Admin not found' })
    assertCanRevokeAdmin(target, req.user, admins)
    const { error } = await supabase.from('admin_users').delete().eq('id', target.id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err)
  }
}

async function updateUserRole(req, res) {
  try {
    await assertCanManageAdminUsers(req.user)
    const email = normalizeEmail(req.params.email)
    const role = req.body.role
    if (!['admin', 'super_admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
    const admins = await listAdminUsers()
    const target = admins.find(admin => normalizeEmail(admin.email) === email)
    if (!target) return res.status(404).json({ error: 'Admin not found' })
    if (role === 'super_admin') assertCanPromoteAdmin(target, req.user, admins)
    if (role === 'admin') assertCanDemoteSuperAdmin(target, req.user, admins)
    const { data, error } = await supabase
      .from('admin_users')
      .update({ role, is_super_admin: role === 'super_admin' })
      .eq('id', target.id)
      .select('*')
      .single()
    if (error) throw error
    return res.json({ data: serializeAdminUser(data, req.user) })
  } catch (err) {
    return sendError(res, err)
  }
}

async function columnPermissions(req, res) {
  try {
    return res.json({ columns: serializeColumnDefs(), permissions: await getAllColumnPermissions() })
  } catch (err) {
    return sendError(res, err)
  }
}

async function pageViewPermissions(req, res) {
  try {
    if (req.method === 'GET') return res.json({ permissions: await getPageViewPermissions() })
    await assertCanManageAdminUsers(req.user)
    const pageKey = clean(req.body?.pageKey)
    const viewPermission = clean(req.body?.viewPermission)
    if (!Object.hasOwn(PAGE_VIEW_DEFAULTS, pageKey)) return res.status(400).json({ error: 'Invalid page key' })
    if (!PAGE_VIEW_PERMISSION_VALUES.has(viewPermission)) return res.status(400).json({ error: 'Invalid view permission' })
    const { data, error } = await supabase
      .from('page_view_permissions')
      .upsert({ page_key: pageKey, view_permission: viewPermission, updated_by: req.user.id, updated_at: new Date().toISOString() }, { onConflict: 'page_key' })
      .select('page_key, view_permission')
      .single()
    if (error) throw error
    invalidatePageViewPermissionCache()
    return res.json({ data, permissions: await getPageViewPermissions() })
  } catch (err) {
    return sendError(res, err)
  }
}

async function dashboardVisibility(req, res) {
  try {
    if (!(await isAdmin(req.user))) return res.status(403).json({ error: 'Admin required' })
    if (req.method === 'PATCH') return res.json(await setDashboardVisibility(req.body?.restrictNonAdminToSelf))
    return res.json(await getDashboardVisibility())
  } catch (err) { return sendError(res, err) }
}

async function updateColumnPermission(req, res) {
  try {
    const { tableName, columnKey, accessMode } = req.body
    if (!['clients', 'candidates', 'jobs'].includes(tableName)) return res.status(400).json({ error: 'Invalid table' })
    if (!['everyone', 'admin_disabled', 'admin_hidden'].includes(accessMode)) return res.status(400).json({ error: 'Invalid access mode' })
    const { data, error } = await supabase
      .from('column_permissions')
      .upsert({
        table_name: tableName,
        column_key: columnKey,
        access_mode: accessMode,
        updated_by: req.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'table_name,column_key' })
      .select('*')
      .single()
    if (error) throw error
    invalidateColumnPermissionCache()
    return res.json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function lockedRecords(req, res) {
  try {
    return res.json({ data: await lockedRecordList() })
  } catch (err) {
    return sendError(res, err)
  }
}

async function setLock(req, res) {
  try {
    const table = { clients: 'clients', candidates: 'candidates', jobs: 'jobs' }[req.params.table]
    if (!table) return res.status(400).json({ error: 'Invalid table' })
    const locked = req.body.locked !== false
    const { data, error } = await supabase
      .from(table)
      .update({
        is_locked: locked,
        locked_by: locked ? req.user.id : null,
        locked_at: locked ? new Date().toISOString() : null
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Record not found' })
    return res.json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = {
  me,
  bootstrap,
  users,
  userProfiles,
  addUser,
  removeUser,
  updateUserRole,
  columnPermissions,
  pageViewPermissions,
  dashboardVisibility,
  updateColumnPermission,
  lockedRecords,
  setLock
}
