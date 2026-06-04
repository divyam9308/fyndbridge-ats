const supabase = require('../services/supabaseAdmin')

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { data, error } = await supabase.auth.getUser(match[1])

    if (error || !data.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    req.user = {
      id: data.user.id,
      email: data.user.email
    }

    return next()
  } catch (err) {
    console.error('authMiddleware:', err.message)
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

module.exports = authMiddleware
