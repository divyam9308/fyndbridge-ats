const supabase = require('./supabaseAdmin')
const { isAdmin } = require('./adminAccess')

const KEY = 'dashboard_restrict_non_admin_to_self'
const LOW_MANDATE_AUDIENCE_KEY = 'low_mandate_notification_audience'
const LOW_MANDATE_AUDIENCES = new Set(['everyone', 'admins', 'super_admins'])

function normalizeLowMandateAudience(value) {
  const audience = String(value || '').trim().toLowerCase()
  return LOW_MANDATE_AUDIENCES.has(audience) ? audience : 'super_admins'
}

async function getDashboardAccess(user) {
  const [admin, setting, profile] = await Promise.all([
    isAdmin(user),
    supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle(),
    supabase.from('user_profiles').select('name').eq('user_id', user?.id).maybeSingle()
  ])
  const restricted = setting.error || setting.data?.value !== false
  const consultantName = String(profile.data?.name || '').trim()
  return { isAdmin: admin, restrictedToSelf: !admin && restricted, consultantName }
}

async function getDashboardVisibility() {
  const { data, error } = await supabase.from('app_settings').select('key,value').in('key', [KEY, LOW_MANDATE_AUDIENCE_KEY])
  if (error && error.code !== '42P01') throw error
  const settings = new Map((data || []).map(row => [row.key, row.value]))
  return {
    restrictNonAdminToSelf: !settings.has(KEY) || settings.get(KEY) !== false,
    lowMandateNotificationAudience: normalizeLowMandateAudience(settings.get(LOW_MANDATE_AUDIENCE_KEY))
  }
}

async function setDashboardVisibility(settings = {}) {
  const input = typeof settings === 'object' && settings !== null ? settings : { restrictNonAdminToSelf: settings }
  const rows = []
  const updatedAt = new Date().toISOString()
  if (Object.hasOwn(input, 'restrictNonAdminToSelf')) {
    rows.push({ key: KEY, value: Boolean(input.restrictNonAdminToSelf), updated_at: updatedAt })
  }
  if (Object.hasOwn(input, 'lowMandateNotificationAudience')) {
    const audience = String(input.lowMandateNotificationAudience || '').trim().toLowerCase()
    if (!LOW_MANDATE_AUDIENCES.has(audience)) {
      const error = new Error('Invalid low-mandate notification audience.')
      error.statusCode = 400
      throw error
    }
    rows.push({ key: LOW_MANDATE_AUDIENCE_KEY, value: audience, updated_at: updatedAt })
  }
  if (!rows.length) return getDashboardVisibility()
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' })
  if (error) throw error
  return getDashboardVisibility()
}

module.exports = { getDashboardAccess, getDashboardVisibility, setDashboardVisibility, normalizeLowMandateAudience }
