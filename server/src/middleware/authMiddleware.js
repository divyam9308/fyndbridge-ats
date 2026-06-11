const supabase = require('../services/supabaseAnon')

async function attachUser(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const match = header.match(/^Bearer\s+(.+)$/i)

    if (!match) {
      return next()
    }

    const token = match[1]
    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email
    }

    return next()
  } catch (err) {
    return next(err)
  }
}

module.exports = attachUser
