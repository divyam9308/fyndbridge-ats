const supabase = require('../services/supabaseAdmin')

const OFFLINE_CUTOFF_MS = 75 * 1000

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

function initials(name, email) {
  const value = clean(name || email)
  const source = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ') : value
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase()
}

function normalizeStatus(value) {
  return value === 'away' ? 'away' : 'online'
}

function serialize(row) {
  return {
    id: row.user_id,
    user_id: row.user_id,
    email: row.email || '',
    name: row.display_name || row.email || 'User',
    display_name: row.display_name || '',
    initials: row.initials || initials(row.display_name, row.email),
    avatar_color: row.avatar_color || '',
    status: normalizeStatus(row.status),
    current_path: row.current_path || '',
    last_seen_at: row.last_seen_at,
    updated_at: row.updated_at
  }
}

function latestRow(rows) {
  return rows.reduce((best, row) => (
    !best || new Date(row.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? row : best
  ), null)
}

function aggregatePresence(rows) {
  const byUser = new Map()

  for (const row of rows || []) {
    const userRows = byUser.get(row.user_id) || []
    userRows.push(row)
    byUser.set(row.user_id, userRows)
  }

  return [...byUser.values()].map((userRows) => {
    const latest = latestRow(userRows)
    return serialize({
      ...latest,
      status: userRows.some(row => row.status === 'online') ? 'online' : 'away'
    })
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''))
  })
}

async function listPresence(req, res) {
  try {
    const cutoff = new Date(Date.now() - OFFLINE_CUTOFF_MS).toISOString()
    const { data, error } = await supabase
      .from('user_presence')
      .select('*')
      .gte('last_seen_at', cutoff)
      .in('status', ['online', 'away'])
      .order('last_seen_at', { ascending: false })

    if (error) throw error

    return res.json({ data: aggregatePresence(data), cutoff })
  } catch (err) {
    console.error('listPresence:', err.message || err)
    return res.status(500).json({ error: 'Unable to load presence.' })
  }
}

async function heartbeat(req, res) {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const displayName = clean(req.body.display_name || req.body.name || req.user.name || req.user.email)
    const email = clean(req.body.email || req.user.email)
    const tabId = clean(req.body.tab_id)
    if (!tabId) return res.status(400).json({ error: 'Missing tab id.' })

    const payload = {
      user_id: userId,
      tab_id: tabId,
      email,
      display_name: displayName,
      initials: clean(req.body.initials) || initials(displayName, email),
      avatar_color: clean(req.body.avatar_color),
      status: normalizeStatus(req.body.status),
      current_path: clean(req.body.current_path),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('user_presence')
      .upsert(payload, { onConflict: 'user_id,tab_id' })
      .select('*')
      .single()

    if (error) throw error

    return res.json({ data: serialize(data) })
  } catch (err) {
    console.error('presenceHeartbeat:', err.message || err)
    return res.status(500).json({ error: 'Unable to update presence.' })
  }
}

async function offline(req, res) {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const tabId = clean(req.body.tab_id)
    if (!tabId) return res.status(400).json({ error: 'Missing tab id.' })

    const { error } = await supabase
      .from('user_presence')
      .delete()
      .eq('user_id', userId)
      .eq('tab_id', tabId)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) {
    console.error('presenceOffline:', err.message || err)
    return res.status(500).json({ error: 'Unable to clear presence.' })
  }
}

module.exports = { listPresence, heartbeat, offline }
