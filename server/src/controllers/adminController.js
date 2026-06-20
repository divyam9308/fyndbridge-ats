const supabase = require('../services/supabaseAdmin')
const {
  normalizeEmail,
  isAdmin,
  listAdminUsers,
  serializeColumnDefs,
  getAllColumnPermissions
} = require('../services/adminAccess')

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' })
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function me(req, res) {
  try {
    return res.json({ isAdmin: await isAdmin(req.user), user: req.user })
  } catch (err) {
    return sendError(res, err)
  }
}

async function users(req, res) {
  try {
    return res.json({ data: await listAdminUsers() })
  } catch (err) {
    return sendError(res, err)
  }
}

async function addUser(req, res) {
  try {
    const email = normalizeEmail(req.body.email)
    if (!validEmail(email)) return res.status(400).json({ error: 'Valid email is required' })
    const name = email.split('@')[0]
    const { data, error } = await supabase
      .from('admin_users')
      .insert({ email, name, added_by: req.user.id })
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
    const email = normalizeEmail(req.params.email)
    const admins = await listAdminUsers()
    if (admins.length <= 1) return res.status(400).json({ error: 'Cannot remove the last admin' })
    const { error } = await supabase.from('admin_users').delete().eq('email', email)
    if (error) throw error
    return res.json({ ok: true })
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
    return res.json({ data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function lockedRecords(req, res) {
  try {
    const [clients, candidates, jobs] = await Promise.all([
      supabase.from('clients').select('id, client_display_id, client_name, name, is_locked, locked_by, locked_at').eq('is_locked', true),
      supabase.from('candidates').select('id, candidate_display_id, full_name, is_locked, locked_by, locked_at').eq('is_locked', true),
      supabase.from('jobs').select('id, job_display_id, title, is_locked, locked_by, locked_at').eq('is_locked', true)
    ])
    for (const result of [clients, candidates, jobs]) if (result.error) throw result.error
    return res.json({
      data: [
        ...(clients.data || []).map((row) => ({ type: 'Client', id: row.id, displayId: row.client_display_id, name: row.client_name || row.name, lockedBy: row.locked_by, lockedAt: row.locked_at })),
        ...(candidates.data || []).map((row) => ({ type: 'Candidate', id: row.id, displayId: row.candidate_display_id, name: row.full_name, lockedBy: row.locked_by, lockedAt: row.locked_at })),
        ...(jobs.data || []).map((row) => ({ type: 'Mandate', id: row.id, displayId: row.job_display_id, name: row.title, lockedBy: row.locked_by, lockedAt: row.locked_at }))
      ]
    })
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
  users,
  addUser,
  removeUser,
  columnPermissions,
  updateColumnPermission,
  lockedRecords,
  setLock
}
