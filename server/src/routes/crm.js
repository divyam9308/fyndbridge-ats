const express = require('express')
const supabase = require('../services/supabaseAdmin')
const { requirePageViewPermission } = require('../middleware/pageViewAccessMiddleware')
const { localDate } = require('../services/attendanceUtils')
const { normalizeClientName } = require('../../../shared/clientNames.cjs')
const SECTOR_OPTIONS = require('../../../shared/sectorOptions.json')
const router = express.Router()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = new Set(['organisation_name', 'contacts', 'sector', 'connected_through', 'conversion_probability', 'status', 'assigned_consultant_id', 'next_follow_up_date', 'ats_client_id', 'comment'])
const safe = handler => async (req, res, next) => { try { await handler(req, res) } catch (error) { next(error) } }
const integer = (value, fallback, max) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), max)
router.use(requirePageViewPermission('crm'))
router.use((req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
router.get('/check-duplicate', safe(async (req, res) => {
  const { data, error } = await supabase.rpc('crm_duplicate', { p_name: normalizeClientName(String(req.query.name || '').slice(0, 200)), p_exclude: UUID.test(req.query.exclude || '') ? req.query.exclude : null })
  if (error) throw error
  res.json({ duplicate: Boolean(data), existing: data })
}))
router.get('/', safe(async (req, res) => {
  const today = localDate()
  const { data, error } = await supabase.rpc('crm_list', {
    p_search: String(req.query.search || '').slice(0, 300), p_follow_up: String(req.query.follow_up || 'all'), p_today: today,
    p_page: integer(req.query.page, 1, 1000000), p_size: integer(req.query.pageSize, 25, 100),
    p_sort: req.query.sort === 'organisation_name' ? 'organisation_name' : 'created_at', p_ascending: req.query.direction === 'asc'
  })
  if (error) throw error
  res.json({ ...data, today })
}))
router.param('id', (req, res, next, id) => UUID.test(id) ? next() : res.status(404).json({ error: 'CRM client not found.' }))
router.get('/:id', safe(async (req, res) => {
  const { data, error } = await supabase.from('crm_clients').select('*').eq('id', req.params.id).maybeSingle()
  if (error) throw error
  if (!data) return res.status(404).json({ error: 'CRM client not found.' })
  const latest = await supabase.from('crm_comments').select('*').eq('crm_client_id', data.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
  if (latest.error) throw latest.error
  res.json({ data: { ...data, latest_comment: latest.data?.[0] || null } })
}))
for (const kind of ['comments', 'activities']) {
  router.get(`/:id/${kind}`, safe(async (req, res) => {
    const page = integer(req.query.page, 1, 1000000)
    const { data, error, count } = await supabase.from(`crm_${kind}`).select('*', { count: 'exact' }).eq('crm_client_id', req.params.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 25, page * 25 - 1)
    if (error) throw error
    const ids = [...new Set((data || []).flatMap(row => [row.created_by, kind === 'activities' && row.activity_type === 'assigned_consultant_id_changed' ? row.previous_value : null, kind === 'activities' && row.activity_type === 'assigned_consultant_id_changed' ? row.new_value : null]).filter(Boolean))]
    const profiles = ids.length ? await supabase.from('user_profiles').select('user_id,name').in('user_id', ids) : { data: [] }
    if (profiles.error) throw profiles.error
    const names = Object.fromEntries((profiles.data || []).map(profile => [profile.user_id, profile.name]))
    const commentIds = (data || []).map(row => row.comment_id).filter(Boolean)
    const comments = commentIds.length ? await supabase.from('crm_comments').select('id,body').in('id', commentIds) : { data: [] }
    if (comments.error) throw comments.error
    const bodies = Object.fromEntries((comments.data || []).map(row => [row.id, row.body]))
    res.json({ data: (data || []).map(row => ({ ...row, actor_name: names[row.created_by] || 'Former / unavailable employee', comment_body: bodies[row.comment_id], ...(row.activity_type === 'assigned_consultant_id_changed' ? { previous_label: names[row.previous_value] || 'Unassigned / unavailable employee', new_label: names[row.new_value] || 'Unassigned / unavailable employee' } : {}) })), total: count || 0 })
  }))
}
const save = safe(async (req, res) => {
  const body = req.body || {}
  if (req.params.id && (!Number.isInteger(body.version) || body.version < 1)) return res.status(400).json({ error: 'A record version is required.' })
  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => FIELDS.has(key)))
  if (Object.hasOwn(payload, 'organisation_name') && !normalizeClientName(payload.organisation_name)) return res.status(400).json({ error: 'Organisation Name is required.' })
  if (payload.sector && !SECTOR_OPTIONS.includes(payload.sector)) return res.status(400).json({ error: 'Select a valid sector.' })
  if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No changes supplied.' })
  const { data, error } = await supabase.rpc('crm_save', { p_actor: req.user.id, p_id: req.params.id || null, p_version: body.version || null, p_data: payload })
  if (error) throw error
  res.status(req.params.id ? 200 : 201).json({ data })
})
router.post('/', save)
router.patch('/:id', save)
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error.code === '23505') {
    let existing = null
    try { existing = JSON.parse(error.details) } catch { /* A unique constraint still blocks concurrent duplicates. */ }
    return res.status(409).json({ error: 'Client already exists. Select the existing client or add a contact person under that client.', duplicate: true, existing })
  }
  const status = { '40001': 409, P0002: 404, '42501': 403, P0001: 400, '23514': 400, '23502': 400, '23503': 400, '22007': 400, '22008': 400, '22P02': 400 }[error.code]
  if (status) return res.status(status).json({ error: status === 400 && error.code !== 'P0001' ? 'Invalid CRM field value. Check the form and try again.' : error.message })
  console.error('CRM request failed:', error.code || error.message)
  res.status(500).json({ error: 'Unable to complete the CRM request. Please try again.' })
})
module.exports = router
