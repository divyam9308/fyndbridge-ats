const supabase = require('../services/supabaseAdmin')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const displayNameFromEmail = (email) => clean(email).split('@')[0] || clean(email) || '-'
const preferredName = (profile, fallbackEmail) => clean(profile?.name || profile?.full_name) || displayNameFromEmail(profile?.email || fallbackEmail)

async function profileMap(userIds = []) {
  const ids = [...new Set(userIds.map(clean).filter(Boolean))]
  if (!ids.length) return new Map()
  const [{ data: userProfiles }, { data: profiles }] = await Promise.all([
    supabase.from('user_profiles').select('user_id, email, name').in('user_id', ids),
    supabase.from('profiles').select('id, email, full_name').in('id', ids)
  ])
  const byId = new Map()
  ;(profiles || []).forEach(row => byId.set(row.id, { ...row, name: row.full_name }))
  ;(userProfiles || []).forEach(row => byId.set(row.user_id, { ...byId.get(row.user_id), ...row }))
  return byId
}

async function listNotifications(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) throw error
    const senders = await profileMap((data || []).map(row => row.sender_user_id))
    return res.json({
      data: (data || []).map(row => ({
        ...row,
        sender_name: row.sender_user_id ? preferredName(senders.get(row.sender_user_id), '') : 'System'
      }))
    })
  } catch (err) {
    console.error('listNotifications error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function markNotificationRead(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    const { data: notification, error: fetchError } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', req.params.id)
      .eq('recipient_user_id', req.user.id)
      .maybeSingle()
    if (fetchError) throw fetchError
    if (!notification) return res.status(404).json({ error: 'Notification not found' })

    const readAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('notifications')
      .update({ status: 'read', read_at: readAt })
      .eq('id', notification.id)
      .eq('recipient_user_id', req.user.id)
      .select('*')
      .single()
    if (error) throw error

    if (
      notification.sender_user_id &&
      notification.sender_user_id !== req.user.id &&
      notification.sender_user_id !== notification.recipient_user_id &&
      notification.role_type !== 'system'
    ) {
      const [{ data: job }, { data: client }, profiles] = await Promise.all([
        supabase.from('jobs').select('title').eq('id', notification.mandate_id).maybeSingle(),
        notification.client_id ? supabase.from('clients').select('name, client_name').eq('id', notification.client_id).maybeSingle() : Promise.resolve({ data: null }),
        profileMap([req.user.id])
      ])
      const recipientName = preferredName(profiles.get(req.user.id), req.user.email)
      const role = clean(job?.title) || 'Mandate'
      const clientName = clean(client?.client_name || client?.name) || 'Client'
      await supabase.from('notifications').insert({
        recipient_user_id: notification.sender_user_id,
        sender_user_id: req.user.id,
        mandate_id: notification.mandate_id,
        client_id: notification.client_id,
        role_type: 'system',
        title: 'Notification Read',
        message: `${recipientName} has read the mandate assignment notification for ${role} - ${clientName}.`,
        status: 'pending',
        action_type: 'mark_read'
      })
    }

    return res.json({ data })
  } catch (err) {
    console.error('markNotificationRead error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

module.exports = { listNotifications, markNotificationRead }
