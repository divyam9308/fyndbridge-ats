const supabase = require('../services/supabaseAdmin')

function getUserId(req) {
  return req.user?.id || req.body?.user_id || req.query?.user_id
}

async function getPreference(req, res) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(400).json({ error: 'user_id is required' })

    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_key, value')
      .eq('user_id', userId)
      .eq('preference_key', req.params.key)
      .maybeSingle()

    if (error) {
      // Table might not exist yet — return null gracefully
      if (error.code === '42P01') return res.json({ data: null })
      throw error
    }
    return res.json({ data })
  } catch (err) {
    return res.status(500).json({ error: 'Unable to load preference', detail: err.message })
  }
}

async function savePreference(req, res) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(400).json({ error: 'user_id is required' })
    if (req.body.value === undefined) return res.status(400).json({ error: 'value is required' })

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        preference_key: req.params.key,
        value: req.body.value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,preference_key' })
      .select('preference_key, value')
      .single()

    if (error) throw error
    return res.json({ data })
  } catch (err) {
    return res.status(500).json({ error: 'Unable to save preference', detail: err.message })
  }
}

module.exports = {
  getPreference,
  savePreference
}
