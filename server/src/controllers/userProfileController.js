const supabase = require('../services/supabaseAdmin')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const nullable = (value) => clean(value) || null

function normalize(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name || '',
    email: row.email || '',
    gender: row.gender || '',
    blood_group: row.blood_group || '',
    pan: row.pan || '',
    emergency_mobile_number: row.emergency_mobile_number || '',
    mobile_number: row.mobile_number || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function getProfile(req, res) {
  try {
    const userId = clean(req.query.user_id || req.user?.id)
    const email = clean(req.query.email || req.user?.email)
    if (!userId && !email) return res.status(400).json({ error: 'user_id or email is required' })

    let query = supabase.from('user_profiles').select('*')
    query = userId ? query.eq('user_id', userId) : query.eq('email', email)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return res.json({ data: data ? normalize(data) : { user_id: userId, email } })
  } catch (err) {
    console.error('getProfile error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function saveProfile(req, res) {
  try {
    const userId = clean(req.body.user_id || req.user?.id)
    const email = clean(req.body.email || req.user?.email)
    if (!userId && !email) return res.status(400).json({ error: 'user_id or email is required' })

    const payload = {
      user_id: userId || email,
      name: nullable(req.body.name),
      email,
      gender: nullable(req.body.gender),
      blood_group: nullable(req.body.blood_group),
      pan: nullable(req.body.pan),
      emergency_mobile_number: nullable(req.body.emergency_mobile_number),
      mobile_number: nullable(req.body.mobile_number),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single()
    if (error) throw error
    return res.json({ data: normalize(data) })
  } catch (err) {
    console.error('saveProfile error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function listProfileOptions(req, res) {
  try {
    const { data, error } = await supabase.from('user_profiles').select('name, email').order('name')
    if (error) throw error
    const users = [...new Set((data || []).map(row => clean(row.name) || clean(row.email)).filter(Boolean))]
    return res.json({ data: users })
  } catch (err) {
    console.error('listProfileOptions error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

module.exports = { getProfile, saveProfile, listProfileOptions }

