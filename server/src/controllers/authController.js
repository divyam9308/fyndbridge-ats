const supabase = require('../services/supabaseAdmin')
const { getEmployeeStatus } = require('../services/employeeStatus')

async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  return res.json({ user: req.user })
}

async function employmentStatus(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    const [{ data: profile, error: profileError }, status] = await Promise.all([
      supabase.from('user_profiles').select('user_id, name').eq('user_id', req.user.id).maybeSingle(),
      getEmployeeStatus(req.user.id)
    ])
    if (profileError) throw profileError
    const profileComplete = Boolean(String(profile?.name || '').trim())
    return res.json({
      data: {
        user_id: req.user.id,
        profile_complete: profileComplete,
        status: profileComplete ? status?.status || 'active' : null
      }
    })
  } catch (error) {
    console.error('employmentStatus:', error.message || error)
    return res.status(500).json({ error: 'Unable to validate account status.' })
  }
}

module.exports = { me, employmentStatus }
