const supabase = require('../services/supabaseAnon')
const CACHE_TTL_MS = 60 * 1000
const tokenCache = new Map()

function cachedUser(token) {
  const entry = tokenCache.get(token)
  if (!entry || entry.expiresAt <= Date.now()) {
    tokenCache.delete(token)
    return null
  }
  return entry.user
}

function cacheUser(token, user) {
  tokenCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS })
  if (tokenCache.size > 200) {
    for (const [key, entry] of tokenCache.entries()) {
      if (entry.expiresAt <= Date.now()) tokenCache.delete(key)
    }
  }
}

async function attachUser(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const match = header.match(/^Bearer\s+(.+)$/i)

    if (!match) {
      return next()
    }

    const token = match[1]
    const cached = cachedUser(token)
    if (cached) {
      req.user = cached
      return next()
    }

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return res.status(401).json({ error: 'Unauthorized' })

    req.user = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email
    }
    cacheUser(token, req.user)
    return next()
  } catch (err) {
    return next(err)
  }
}

module.exports = attachUser

