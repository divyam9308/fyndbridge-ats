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
    if (clean(data?.name)) return { id: data.user_id, name: clean(data.name), email: data.email || '' }
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

async function createClientFollowUpDueNotification({ recipientUserId, clientId, clientName, followUpDate }) {
  const recipient = clean(recipientUserId)
  const dueDate = clean(followUpDate)
  const name = clean(clientName)
  if (!recipient || !clientId || !dueDate || dueDate !== todayLocal() || !name) return
  const { error } = await supabase.from('notifications').insert({
    recipient_user_id: recipient,
    sender_user_id: null,
    client_id: clientId,
    follow_up_date: dueDate,
    role_type: 'system',
    title: 'Client Follow Up Due',
    message: `Today you have a follow up with ${name}`,
    status: 'pending',
    action_type: 'client_follow_up_due'
  })
  if (error && error.code !== '23505' && error.code !== '42P01') throw error
}

module.exports = { createConsultantAssignmentNotification, createClientFollowUpDueNotification, findProfileUser, sameName, todayLocal }
