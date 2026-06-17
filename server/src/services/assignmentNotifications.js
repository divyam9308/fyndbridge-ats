const supabase = require('./supabaseAdmin')

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const sameName = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase()
const todayLocal = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

async function findProfileUser({ userId = '', name = '' } = {}) {
  const id = clean(userId)
  if (id) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, name, email')
      .eq('user_id', id)
      .maybeSingle()
    if (error) throw error
    if (data?.user_id) return { id: data.user_id, name: clean(data.name), email: data.email || '' }
  }

  const profileName = clean(name)
  if (!profileName) return null
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, name, email')
    .ilike('name', profileName)
    .limit(2)
  if (error) throw error
  const exact = (data || []).find(row => sameName(row.name, profileName))
  return exact ? { id: exact.user_id, name: clean(exact.name), email: exact.email || '' } : null
}

async function createConsultantAssignmentNotification({ type, senderId, consultantUserId, consultantName, previousConsultantName, entityName, clientId = null }) {
  const sender = clean(senderId)
  const selectedName = clean(consultantName)
  if (!sender || !selectedName || selectedName === '-') return
  if (previousConsultantName !== undefined && sameName(previousConsultantName, selectedName)) return

  const recipient = await findProfileUser({ userId: consultantUserId, name: selectedName })
  if (!recipient?.id || recipient.id === sender) return

  const label = type === 'candidate' ? 'candidate' : 'client'
  const title = type === 'candidate' ? 'New Candidate Assignment' : 'New Client Assignment'
  const { error } = await supabase.from('notifications').insert({
    recipient_user_id: recipient.id,
    sender_user_id: sender,
    client_id: clientId || null,
    role_type: 'consultant',
    title,
    message: `You are assigned as Consultant for ${label} ${clean(entityName) || '-'}.`,
    status: 'pending',
    action_type: `${type}_assignment`
  })
  if (error && error.code !== '23505' && error.code !== '42P01') throw error
}

async function createClientFollowUpDueNotification({ recipientUserId, consultantUserId = '', consultantName = '', clientId, clientName, followUpDate, followUpId = '' }) {
  const recipientProfile = clean(recipientUserId)
    ? { id: clean(recipientUserId) }
    : await findProfileUser({ userId: consultantUserId, name: consultantName })
  const recipient = clean(recipientProfile?.id)
  const dueDate = clean(followUpDate)
  const name = clean(clientName)
  if (!recipient || !clientId || !dueDate || dueDate !== todayLocal() || !name) return
  const message = `You have a follow up scheduled today for ${name}.`
  let existingQuery = supabase
    .from('notifications')
    .select('id')
    .eq('recipient_user_id', recipient)
    .eq('client_id', clientId)
    .eq('action_type', 'client_follow_up_due')
    .limit(1)
  if (clean(followUpId)) existingQuery = existingQuery.eq('follow_up_id', clean(followUpId))
  let { data: existing, error: existingError } = await existingQuery.eq('follow_up_date', dueDate)
  if (existingError?.code === '42703' || existingError?.code === 'PGRST204') {
    const fallback = await supabase
      .from('notifications')
      .select('id')
      .eq('recipient_user_id', recipient)
      .eq('client_id', clientId)
      .eq('action_type', 'client_follow_up_due')
      .eq('message', message)
      .limit(1)
    existing = fallback.data
    existingError = fallback.error
  }
  if (existingError && existingError.code !== '42P01' && existingError.code !== '42703' && existingError.code !== 'PGRST204') throw existingError
  if ((existing || []).length) return
  const row = {
    recipient_user_id: recipient,
    sender_user_id: null,
    client_id: clientId,
    role_type: 'system',
    title: 'Client Follow Up Due',
    message,
    status: 'pending',
    action_type: 'client_follow_up_due'
  }
  const withFollowUpFields = clean(followUpId)
    ? { ...row, follow_up_date: dueDate, follow_up_id: clean(followUpId) }
    : { ...row, follow_up_date: dueDate }
  let { error } = await supabase.from('notifications').insert(withFollowUpFields)
  if (error?.code === '23505' && clean(followUpId)) {
    const { data: existingRows, error: lookupError } = await supabase
      .from('notifications')
      .select('id, follow_up_id, title')
      .eq('recipient_user_id', recipient)
      .eq('client_id', clientId)
      .eq('follow_up_date', dueDate)
      .eq('action_type', 'client_follow_up_due')
      .limit(1)
    if (lookupError && lookupError.code !== '42703' && lookupError.code !== 'PGRST204') throw lookupError
    const existingRow = existingRows?.[0]
    if (existingRow?.follow_up_id && existingRow.follow_up_id !== clean(followUpId)) {
      const restoredTitle = String(existingRow.title || '').replace(/^\[cleared\]\s*/i, '') || row.title
      let restored = await supabase
        .from('notifications')
        .update({ ...row, title: restoredTitle, status: 'pending', read_at: null, cleared_at: null, follow_up_id: clean(followUpId), follow_up_date: dueDate })
        .eq('id', existingRow.id)
      if (restored.error?.code === '42703' || restored.error?.code === 'PGRST204') {
        restored = await supabase
          .from('notifications')
          .update({ ...row, title: restoredTitle, status: 'pending', read_at: null })
          .eq('id', existingRow.id)
      }
      if (restored.error) throw restored.error
      return
    }
  }
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    const fallback = await supabase.from('notifications').insert(row)
    error = fallback.error
  }
  if (error && error.code !== '23505' && error.code !== '42P01') throw error
}

module.exports = { createConsultantAssignmentNotification, createClientFollowUpDueNotification, findProfileUser, sameName, todayLocal }
