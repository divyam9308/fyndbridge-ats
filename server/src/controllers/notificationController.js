const supabase = require('../services/supabaseAdmin')
const { createClientFollowUpDueNotification, sameName, todayLocal } = require('../services/assignmentNotifications')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const CLEARED_TITLE_PREFIX = '[cleared] '
const missingColumn = (error, column) => (
  (error?.code === '42703' || error?.code === 'PGRST204') &&
  String(error.message || '').includes(column)
)
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

async function ensureClientFollowUpDueNotifications(req) {
  const userId = clean(req.user?.id)
  if (!userId) return

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, name')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError) throw profileError

  const profileName = clean(profile?.name)
  const dueDate = todayLocal()
  const { data: followUps, error: followUpsError } = await supabase
    .from('client_follow_ups')
    .select('*')
    .eq('follow_up_date', dueDate)
  if (followUpsError) throw followUpsError

  const clientIds = [...new Set((followUps || []).map(row => row.client_id).filter(Boolean))]
  if (!clientIds.length) return

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('*')
    .in('id', clientIds)
  if (clientsError) throw clientsError

  const clientsById = new Map((clients || []).map(client => [client.id, client]))
  for (const followUp of followUps || []) {
    const client = clientsById.get(followUp.client_id)
    if (!client) continue
    const consultantName = clean(client.consultant_name)
    const consultantUserId = clean(client.consultant_user_id)
    if (!consultantName || consultantName === '-') continue
    if (consultantUserId && consultantUserId !== userId) continue
    if (!consultantUserId && (!profileName || !sameName(consultantName, profileName))) continue
    await createClientFollowUpDueNotification({
      recipientUserId: userId,
      clientId: client.id,
      clientName: clean(client.client_name || client.name),
      followUpDate: followUp.follow_up_date,
      followUpId: followUp.id
    })
  }
}

async function listNotifications(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    await ensureClientFollowUpDueNotifications(req)
    let { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', req.user.id)
      .is('cleared_at', null)
      .order('created_at', { ascending: false })
      .limit(30)
    if (missingColumn(error, 'cleared_at')) {
      const fallback = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(30)
      data = fallback.data
      error = fallback.error
    }
    if (error) throw error
    const visibleRows = (data || []).filter(row => !String(row.title || '').startsWith(CLEARED_TITLE_PREFIX))
    const senders = await profileMap(visibleRows.map(row => row.sender_user_id))
    return res.json({
      data: visibleRows.map(row => ({
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

    let data = notification
    if (notification.status !== 'read') {
      const readAt = new Date().toISOString()
      const { data: updated, error } = await supabase
        .from('notifications')
        .update({ status: 'read', read_at: readAt })
        .eq('id', notification.id)
        .eq('recipient_user_id', req.user.id)
        .select('*')
        .single()
      if (error) throw error
      data = updated
    }

    if (
      notification.status !== 'read' &&
      notification.sender_user_id &&
      notification.sender_user_id !== req.user.id &&
      notification.sender_user_id !== notification.recipient_user_id &&
      notification.role_type !== 'system'
    ) {
      const isCandidateAssignment = notification.action_type === 'candidate_assignment'
      const isClientAssignment = notification.action_type === 'client_assignment'
      const [{ data: job }, { data: client }, profiles] = await Promise.all([
        notification.mandate_id ? supabase.from('jobs').select('title').eq('id', notification.mandate_id).maybeSingle() : Promise.resolve({ data: null }),
        notification.client_id ? supabase.from('clients').select('name, client_name').eq('id', notification.client_id).maybeSingle() : Promise.resolve({ data: null }),
        profileMap([req.user.id])
      ])
      const recipientName = preferredName(profiles.get(req.user.id), req.user.email)
      const role = clean(job?.title) || 'Mandate'
      const clientName = clean(client?.client_name || client?.name) || 'Client'
      const candidateName = clean(String(notification.message || '').match(/candidate\s+(.+?)\.$/i)?.[1]) || 'Candidate'
      const message = isCandidateAssignment
        ? `${recipientName} has read the candidate assignment notification for ${candidateName}.`
        : isClientAssignment
          ? `${recipientName} has read the client assignment notification for ${clientName}.`
          : `${recipientName} has read the mandate assignment notification for ${role} - ${clientName}.`
      const actionType = isCandidateAssignment || isClientAssignment
        ? `${notification.action_type}_read_confirmation`
        : 'assignment_read_confirmation'
      const { error: insertError } = await supabase.from('notifications').insert({
        recipient_user_id: notification.sender_user_id,
        sender_user_id: req.user.id,
        mandate_id: notification.mandate_id,
        client_id: notification.client_id,
        role_type: 'system',
        title: 'Notification Read',
        message,
        status: 'pending',
        action_type: actionType
      })
      if (insertError && insertError.code !== '23505' && insertError.code !== '42P01') throw insertError
    }

    return res.json({ data })
  } catch (err) {
    console.error('markNotificationRead error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function clearReadNotifications(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
    let { data, error } = await supabase
      .from('notifications')
      .update({ cleared_at: new Date().toISOString() })
      .eq('recipient_user_id', req.user.id)
      .eq('status', 'read')
      .is('cleared_at', null)
      .select('id')
    if (missingColumn(error, 'cleared_at')) {
      const { data: readRows, error: readError } = await supabase
        .from('notifications')
        .select('id, title')
        .eq('recipient_user_id', req.user.id)
        .eq('status', 'read')
      if (readError) throw readError
      const rows = (readRows || []).filter(row => !String(row.title || '').startsWith(CLEARED_TITLE_PREFIX))
      const updated = await Promise.all(rows.map(row => supabase
        .from('notifications')
        .update({ title: `${CLEARED_TITLE_PREFIX}${row.title || 'Notification'}` })
        .eq('id', row.id)
        .eq('recipient_user_id', req.user.id)
        .select('id')
        .single()))
      const failed = updated.find(result => result.error)
      if (failed) throw failed.error
      data = rows
      error = null
    }
    if (error) throw error
    return res.json({ success: true, cleared: (data || []).length })
  } catch (err) {
    console.error('clearReadNotifications error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

module.exports = { listNotifications, markNotificationRead, clearReadNotifications }

